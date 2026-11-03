import type { VercelRequest, VercelResponse } from "@vercel/node";

/*
  POST /api/marker
  The only AI endpoint. A marker sends what the student typed plus the passage it sits on and some note context;
  Claude decides whether the result belongs in the note (insert) or in the marker's thread (answer).

  Env:
    ANTHROPIC_API_KEY   required for AI
    ANTHROPIC_MODEL     optional, defaults to claude-sonnet-5-5
    SUPABASE_URL, SUPABASE_ANON_KEY   when set, requests must carry a signed-in user's token
    AI_DAILY_LIMIT      optional per-user daily cap (needs Supabase), e.g. 60
*/

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const TYPES = ["note", "question", "explain", "math", "visual", "link", "reminder"];

const SYSTEM = `You are a marker inside LiveBoard, a study notes app for students. A marker is anchored to a passage the student selected in their notes (or to an empty spot, when they want to write or generate something new). Everything the student does in LiveBoard happens through markers, so you handle explaining, expanding, summarizing, drafting, reformatting, quizzing and visualizing.

Decide where your result belongs:
- kind "insert": content that should become part of the note itself (expanded explanation, worked example, summary, outline, drafted notes, list or table conversion, a diagram). Write it as clean note content, not as a chat reply. No greetings, no "Here is".
- kind "answer": a reply to a question about the passage that the student may or may not want in the note. Keep it short and direct.

Rules:
- Ground everything in the passage and the note context. If the note does not support a claim and it is standard course knowledge, you may use it, but never invent course-specific facts (dates, policies, what the professor said).
- Never compute numeric results yourself. When arithmetic or algebra is needed, put a single mathjs-compatible expression in "calc" (for example: "e^0.5 * 0.5^4 / factorial(4)") and refer to its result in words; the app evaluates it exactly and fills it in.
- For a requested diagram, flowchart, cycle or timeline, put Mermaid source in "mermaid" (flowchart TD or LR, under 15 nodes, short labels) and use "markdown" for a one-line caption.
- Markdown only: headings (## or ###), bullet or numbered lists, **bold**, tables, inline code. Inline math as plain Unicode (x², Σ, √), not LaTeX.
- Keep inserts under 220 words unless the student asks for a full draft.
- Always provide "recall": one short question that tests understanding of the passage (not trivia about wording), and its answer in one or two sentences.
- Pick "type" for what this marker now is: explain, question, math, visual, note (drafted or reformatted writing), link, reminder.
- This is a study tool. If the student asks you to write graded work for them (an essay to submit, homework answers to hand in), explain the idea and help them work it out instead of producing the finished submission.`;

const TOOL = {
  name: "marker_result",
  description: "Return the marker's result.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["insert", "answer"] },
      type: { type: "string", enum: TYPES },
      markdown: { type: "string" },
      calc: { type: ["string", "null"] },
      mermaid: { type: ["string", "null"] },
      recall: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] }
    },
    required: ["kind", "type", "markdown", "recall"]
  }
};

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

async function checkUser(req: VercelRequest): Promise<{ ok: true; token: string | null } | { ok: false; status: number; error: string }> {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: true, token: null };
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401, error: "Sign in to use AI markers." };
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, status: 401, error: "Your session expired. Sign in again." };
  const limit = Number(process.env.AI_DAILY_LIMIT || 0);
  if (limit > 0) {
    const u = await fetch(`${url}/rest/v1/rpc/bump_ai_usage`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    if (u.ok) {
      const count = Number(await u.json());
      if (count > limit) return { ok: false, status: 429, error: `You've used today's ${limit} AI markers. Math, formatting, links and reminders still work, and AI resets tomorrow.` };
    }
  }
  return { ok: true, token };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ ai: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "AI isn't connected yet. Add ANTHROPIC_API_KEY to the server (see the setup guide)." });

  const auth = await checkUser(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const b = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  const action = b.action === "recall" ? "recall" : "run";
  const thread = Array.isArray(b.thread) ? b.thread.slice(-6) : [];
  const context = [
    `Course: ${clip(b.course, 60)}`,
    `Note title: ${clip(b.title, 140)}`,
    b.passage ? `Marked passage: """${clip(b.passage, 1500)}"""` : "This marker is on an empty spot in the note (the student wants to write or generate here).",
    `Text around the marker: """${clip(b.before, 1500)} [MARKER] ${clip(b.after, 1500)}"""`,
    `Whole note (may be truncated): """${clip(b.note, 9000)}"""`,
    thread.length ? `Earlier in this marker:\n${thread.map((m: { role: string; text: string }) => `${m.role === "user" ? "Student" : "Marker"}: ${clip(m.text, 800)}`).join("\n")}` : ""
  ].filter(Boolean).join("\n\n");
  const ask = action === "recall"
    ? "Write only the recall question and answer for this passage. Set kind to answer, markdown to an empty string."
    : `The student typed into the marker: """${clip(b.intent, 600)}"""`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "marker_result" },
        messages: [{ role: "user", content: `${context}\n\n${ask}` }]
      })
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("anthropic error", r.status, detail.slice(0, 500));
      const msg = r.status === 429 || r.status === 529 ? "The AI is busy right now. Try again in a moment." : "The AI request failed. Try again.";
      return res.status(502).json({ error: msg });
    }
    const data = await r.json();
    const block = (data.content || []).find((c: { type: string }) => c.type === "tool_use");
    if (!block) return res.status(502).json({ error: "The AI didn't return a result. Try rephrasing." });
    const out = block.input || {};
    return res.status(200).json({
      kind: out.kind === "insert" ? "insert" : "answer",
      type: TYPES.includes(out.type) ? out.type : "explain",
      markdown: clip(out.markdown, 8000),
      calc: out.calc ? clip(out.calc, 300) : null,
      mermaid: out.mermaid ? clip(out.mermaid, 3000) : null,
      recall: out.recall && out.recall.q ? { q: clip(out.recall.q, 300), a: clip(out.recall.a, 600) } : null
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Something went wrong reaching the AI. Try again." });
  }
}

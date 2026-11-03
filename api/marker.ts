/*
  POST /api/marker
  The only AI endpoint. A marker sends what the student typed plus the passage it sits on and some note context;
  Claude decides whether the result belongs in the note (insert) or in the marker's thread (answer).

  This endpoint spends money, so every check fails closed: no verified sign-in, no working quota check,
  or a malformed request means no model call.

  Env (server only):
    ANTHROPIC_API_KEY            required for AI
    ANTHROPIC_MODEL              optional, defaults to claude-sonnet-5-5
    SUPABASE_URL, SUPABASE_ANON_KEY   required: used to verify the caller and enforce quotas
    AI_DAILY_LIMIT               per-user requests per day (default 60)
    AI_PER_MINUTE_LIMIT          per-user requests per minute (default 8)
    AI_GLOBAL_DAILY_LIMIT        whole-app requests per day, a cost cutoff (default 5000)
    AI_DISABLED=true             emergency switch: AI off, writing keeps working
    ALLOW_ANONYMOUS_AI=true      local `vercel dev` only (VERCEL_ENV=development); ignored everywhere else
*/

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Res { status(code: number): Res; json(body: unknown): unknown; setHeader?(name: string, value: string): unknown }

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const TYPES = ["note", "question", "explain", "math", "visual", "link", "reminder"];
const MAX_BODY = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;

const SYSTEM = `You are a marker inside LiveBoard, a study notes app for students. A marker is anchored to a passage the student selected in their notes (or to an empty spot, when they want to write or generate something new). Everything the student does in LiveBoard happens through markers, so you handle explaining, expanding, summarizing, drafting, reformatting, quizzing and visualizing.

Decide where your result belongs:
- kind "insert": content that should become part of the note itself (expanded explanation, worked example, summary, outline, drafted notes, list or table conversion, a diagram). Write it as clean note content, not as a chat reply. No greetings, no "Here is".
- kind "answer": a reply to a question about the passage that the student may or may not want in the note. Keep it short and direct.

Rules:
- Ground everything in the passage and the note context. If the note does not support a claim and it is standard course knowledge, you may use it, but never invent course-specific facts (dates, policies, what the professor said).
- Never compute numeric results yourself. When arithmetic or algebra is needed, put a single mathjs-compatible expression in "calc" (for example: "e^0.5 * 0.5^4 / factorial(4)") and refer to its result in words; the app evaluates it with a math engine and fills it in.
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
const intEnv = (name: string, dflt: number) => { const v = Number(process.env[name] ?? dflt); return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt; };
const header = (req: Req, name: string) => { const v = req.headers[name] ?? req.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
const rid = () => (globalThis.crypto && "randomUUID" in globalThis.crypto ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2));
const devAnonymous = () => process.env.ALLOW_ANONYMOUS_AI === "true" && process.env.VERCEL_ENV === "development"; // `vercel dev` only
const authConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/* ---------- request validation ---------- */
interface Body { action: "run" | "recall"; intent: string; passage: string; before: string; after: string; note: string; title: string; course: string; thread: { role: string; text: string }[] }
function parseBody(req: Req): Body {
  let raw = req.body;
  const len = Number(header(req, "content-length") || 0);
  if (len > MAX_BODY) throw new HttpError(413, "That request is too large.");
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    if (raw.length > MAX_BODY) throw new HttpError(413, "That request is too large.");
    try { raw = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "The request wasn't valid JSON."); }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "The request body must be a JSON object.");
  const b = raw as Record<string, unknown>;
  const str = (k: string, max: number, required = false) => {
    const v = b[k];
    if (v === undefined || v === null) { if (required) throw new HttpError(400, `Missing ${k}.`); return ""; }
    if (typeof v !== "string") throw new HttpError(400, `${k} must be text.`);
    return v.slice(0, max);
  };
  const action = b.action === "recall" ? "recall" : "run";
  const threadIn = b.thread === undefined || b.thread === null ? [] : b.thread;
  if (!Array.isArray(threadIn) || threadIn.length > 40) throw new HttpError(400, "thread must be a short list.");
  const thread = threadIn.slice(-6).map(t => {
    if (!t || typeof t !== "object") throw new HttpError(400, "Each thread item must be an object.");
    const { role, text } = t as { role?: unknown; text?: unknown };
    if (!["user", "marker", "self"].includes(String(role)) || typeof text !== "string") throw new HttpError(400, "Thread items need a role and text.");
    return { role: String(role), text: text.slice(0, 800) };
  });
  const body: Body = { action, intent: str("intent", 600, action === "run"), passage: str("passage", 1500), before: str("before", 1500), after: str("after", 1500), note: str("note", 9000), title: str("title", 140), course: str("course", 60), thread };
  if (action === "run" && !body.intent.trim()) throw new HttpError(400, "Type what you want the marker to do.");
  return body;
}

/* ---------- identity and quota (fail closed) ---------- */
async function authorize(req: Req): Promise<{ token: string | null }> {
  if (devAnonymous()) return { token: null };
  if (!authConfigured()) throw new HttpError(503, "AI isn't fully set up on this server (sign-in checks are missing). Writing, math and recall still work.");
  const url = process.env.SUPABASE_URL!, anon = process.env.SUPABASE_ANON_KEY!;
  const token = String(header(req, "authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Sign in to use AI markers.");
  let user: { id?: unknown } | null = null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (r.status === 401 || r.status === 403) throw new HttpError(401, "Your session expired. Sign in again.");
    if (!r.ok) throw new HttpError(503, "Couldn't verify your sign-in right now. Try again in a moment.");
    user = await r.json().catch(() => null);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "Couldn't verify your sign-in right now. Try again in a moment.");
  }
  if (!user || typeof user.id !== "string" || !user.id) throw new HttpError(401, "Your session expired. Sign in again.");

  // One atomic database call checks and counts per-user daily, per-user per-minute and app-wide daily usage.
  let q: { allowed?: unknown; reason?: unknown } | null = null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/begin_ai_request`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_daily: intEnv("AI_DAILY_LIMIT", 60), p_per_minute: intEnv("AI_PER_MINUTE_LIMIT", 8), p_global: intEnv("AI_GLOBAL_DAILY_LIMIT", 5000) }),
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error(`quota ${r.status}`);
    q = await r.json().catch(() => null);
  } catch {
    throw new HttpError(503, "The usage check is unavailable, so AI is paused for a moment. Writing, math and recall still work.");
  }
  if (!q || typeof q.allowed !== "boolean") throw new HttpError(503, "The usage check returned something unexpected, so AI is paused. Try again soon.");
  if (!q.allowed) {
    const reason = String(q.reason || "daily");
    if (reason === "minute") throw new HttpError(429, "That's a lot of requests in a minute. Wait a few seconds and try again.");
    if (reason === "global") throw new HttpError(429, "AI has reached today's app-wide limit. It resets tomorrow; writing, math and recall still work.");
    throw new HttpError(429, `You've used today's ${intEnv("AI_DAILY_LIMIT", 60)} AI markers. Math, formatting, links and reminders still work, and AI resets tomorrow.`);
  }
  return { token };
}

/* ---------- handler ---------- */
export default async function handler(req: Req, res: Res) {
  const id = rid(), started = Date.now();
  res.setHeader?.("x-request-id", id);
  const done = (status: number, body: unknown) => {
    console.log(JSON.stringify({ rid: id, status, ms: Date.now() - started })); // no note text, prompts, emails or tokens
    return res.status(status).json(body);
  };
  try {
    const keyed = !!process.env.ANTHROPIC_API_KEY, disabled = process.env.AI_DISABLED === "true";
    if (req.method === "GET") return done(200, { ai: keyed && !disabled && (authConfigured() || devAnonymous()), model: MODEL });
    if (req.method !== "POST") return done(405, { error: "Use POST." });
    if (disabled) return done(503, { error: "AI is turned off for now. Writing, math and recall still work." });
    if (!keyed) return done(501, { error: "AI isn't connected yet. Add ANTHROPIC_API_KEY to the server (see the setup guide)." });

    const b = parseBody(req);
    await authorize(req);

    const context = [
      `Course: ${clip(b.course, 60)}`,
      `Note title: ${clip(b.title, 140)}`,
      b.passage ? `Marked passage: """${b.passage}"""` : "This marker is on an empty spot in the note (the student wants to write or generate here).",
      `Text around the marker: """${b.before} [MARKER] ${b.after}"""`,
      `Whole note (may be truncated): """${b.note}"""`,
      b.thread.length ? `Earlier in this marker:\n${b.thread.map(m => `${m.role === "user" ? "Student" : m.role === "self" ? "Student's own answer" : "Marker"}: ${m.text}`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    const ask = b.action === "recall"
      ? "Write only the recall question and answer for this passage. Set kind to answer, markdown to an empty string."
      : `The student typed into the marker: """${b.intent}"""`;

    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "marker_result" }, messages: [{ role: "user", content: `${context}\n\n${ask}` }] }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
    } catch (e) {
      const timeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      return done(timeout ? 504 : 502, { error: timeout ? "The AI took too long. Your question is saved in the marker; try again." : "Couldn't reach the AI. Try again." });
    }
    if (!r.ok) {
      const msg = r.status === 429 || r.status === 529 ? "The AI is busy right now. Try again in a moment." : "The AI request failed. Try again.";
      return done(502, { error: msg });
    }
    const data = await r.json().catch(() => null) as { content?: { type: string; input?: Record<string, unknown> }[] } | null;
    const block = data?.content?.find(c => c && c.type === "tool_use");
    const out = block?.input && typeof block.input === "object" ? block.input : null;
    if (!out || typeof out.markdown !== "string") return done(502, { error: "The AI didn't return a usable result. Try rephrasing." });
    const recall = out.recall && typeof out.recall === "object" ? out.recall as { q?: unknown; a?: unknown } : null;
    return done(200, {
      kind: out.kind === "insert" ? "insert" : "answer",
      type: TYPES.includes(String(out.type)) ? out.type : "explain",
      markdown: clip(out.markdown, 8000),
      calc: typeof out.calc === "string" && out.calc ? clip(out.calc, 300) : null,
      mermaid: typeof out.mermaid === "string" && out.mermaid ? clip(out.mermaid, 3000) : null,
      recall: recall && typeof recall.q === "string" && recall.q ? { q: clip(recall.q, 300), a: clip(recall.a, 600) } : null
    });
  } catch (e) {
    if (e instanceof HttpError) return done(e.status, { error: e.message });
    console.error(JSON.stringify({ rid: id, error: (e as Error)?.name || "Error" }));
    return done(500, { error: "Something went wrong. Try again." });
  }
}

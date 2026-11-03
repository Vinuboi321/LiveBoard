import { authToken, syncConfigured, currentUser } from "./sync";
import type { AIResult, ThreadMsg } from "./types";
import { DAY } from "./util";

/* ---------- What the marker box can do without the AI (instant, free, works offline) ---------- */
export type LocalAction =
  | { do: "format"; fmt: "heading" | "subheading" | "list" | "numbered" | "checklist" | "bold" | "highlight" | "quote" | "plain" }
  | { do: "calc"; expr: string }
  | { do: "link"; query: string }
  | { do: "related" }
  | { do: "remind"; at: number; label: string }
  | { do: "ask-exam" }; // "before the exam" with no exam date known for the course

const WORDY = /\b(explain|why|what|how|make|turn|give|quiz|draw|summar|outline|draft|list|write|expand|example|compare|define|describe|show)\b/i;

/* Math runs in a worker that is stopped after a few seconds, so an expression like 99999! can't freeze the app.
   The single-file preview can't load workers, so there it runs on the page (inputs are still length- and size-limited). */
const MATH_TIMEOUT_MS = 4000;
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, { ok: (v: string) => void; no: (e: Error) => void }>();
function mathWorker() {
  if (!worker) {
    worker = new Worker(new URL("./mathWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: string; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.ok(e.data.value!); else w.no(new Error(e.data.error));
    };
    worker.onerror = () => { killWorker(new Error("The calculator stopped. Try again.")); };
  }
  return worker;
}
function killWorker(err: Error) {
  worker?.terminate();
  worker = null;
  waiting.forEach(w => w.no(err));
  waiting.clear();
}
export async function evaluate(expr: string): Promise<string> {
  if (import.meta.env.VITE_ARTIFACT || typeof Worker === "undefined") return (await import("./mathCore")).calc(expr);
  const id = ++seq;
  return new Promise<string>((ok, no) => {
    const timer = setTimeout(() => killWorker(new Error("That calculation took too long, so it was stopped.")), MATH_TIMEOUT_MS);
    waiting.set(id, { ok: v => { clearTimeout(timer); ok(v); }, no: e => { clearTimeout(timer); no(e); } });
    mathWorker().postMessage({ id, expr });
  });
}

function nextWeekday(name: string) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const target = days.findIndex(d => d.startsWith(name.slice(0, 3).toLowerCase()));
  const d = new Date();
  let add = (target - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export async function localIntent(raw: string, examDate?: string | null): Promise<LocalAction | null> {
  const s = raw.trim();
  const low = s.toLowerCase();
  if (!s) return null;
  const fmt = (re: RegExp) => re.test(low) && /^(make|turn|convert|format|as|into)\b|^(heading|subheading|list|bullets?|numbered|checklist|todo|bold|highlight|quote|plain)\b/.test(low);
  if (fmt(/\bsub ?heading\b/)) return { do: "format", fmt: "subheading" };
  if (fmt(/\b(heading|title)\b/)) return { do: "format", fmt: "heading" };
  if (fmt(/\b(numbered|steps|ordered)\b/)) return { do: "format", fmt: "numbered" };
  if (fmt(/\b(checklist|to-?do|tasks?)\b/)) return { do: "format", fmt: "checklist" };
  if (fmt(/\b(bullet|bullets|list)\b/)) return { do: "format", fmt: "list" };
  if (fmt(/\bbold\b/)) return { do: "format", fmt: "bold" };
  if (fmt(/\bhighlight\b/)) return { do: "format", fmt: "highlight" };
  if (fmt(/\bquote\b/)) return { do: "format", fmt: "quote" };
  if (fmt(/\b(plain|normal) text\b/)) return { do: "format", fmt: "plain" };

  const link = low.match(/^(link|connect)( this)?( to| with)?\s+(.+)/);
  if (link) return { do: "link", query: link[4] };
  if (/^(related|where else|find related|other notes)/.test(low)) return { do: "related" };

  if (/^(remind|review|revisit)\b/.test(low)) {
    let at = Date.now() + 2 * DAY, label = "in 2 days";
    const inN = low.match(/in (\d+) (day|days|week|weeks)/);
    const wd = low.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/);
    if (/tomorrow/.test(low)) { const d = new Date(Date.now() + DAY); d.setHours(8, 0, 0, 0); at = d.getTime(); label = "tomorrow morning"; }
    else if (inN) { const n = +inN[1] * (inN[2].startsWith("week") ? 7 : 1); at = Date.now() + n * DAY; label = `in ${n} day${n > 1 ? "s" : ""}`; }
    else if (wd) { at = nextWeekday(wd[1]); label = `on ${new Date(at).toLocaleDateString(undefined, { weekday: "long" })}`; }
    else if (/\b(exam|test|midterm|final|quiz)\b/.test(low)) {
      const exam = examDate && /^\d{4}-\d\d-\d\d$/.test(examDate) ? new Date(`${examDate}T08:00:00`).getTime() : NaN;
      if (!(exam > Date.now())) return { do: "ask-exam" };
      const d = new Date(Math.max(Date.now() + 36e5, exam - 2 * DAY)); d.setHours(8, 0, 0, 0);
      at = Math.min(Math.max(d.getTime(), Date.now() + 36e5), exam);
      label = `${new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}, before your exam on ${new Date(exam).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    return { do: "remind", at, label };
  }

  const calcExpr = s.replace(/^(calc(ulate)?|compute|=)\s*/i, "");
  if (/\d/.test(calcExpr) && !WORDY.test(calcExpr) && calcExpr.length < 200) {
    try { await evaluate(calcExpr); return { do: "calc", expr: calcExpr }; } catch { /* not math, fall through to the AI */ }
  }
  return null;
}

/* ---------- AI ---------- */
let health: Promise<{ ai: boolean; model?: string }> | null = null;
export function aiHealth() {
  if (!health) {
    health = fetch("/api/marker", { method: "GET" })
      .then(r => (r.ok ? r.json() : { ai: false }))
      .then(j => ({ ai: !!j.ai, model: j.model }))
      .catch(() => ({ ai: false }));
  }
  return health;
}

export interface MarkerRequest {
  action?: "run" | "recall";
  intent?: string;
  passage: string;
  before: string;
  after: string;
  note: string;
  title: string;
  course: string;
  thread: ThreadMsg[];
}

export async function askMarker(body: MarkerRequest): Promise<AIResult> {
  if (syncConfigured() && !currentUser()) throw new Error("Sign in (Settings) to use AI markers. Math, formatting, links and reminders work without it.");
  const token = authToken();
  let r: Response;
  try {
    r = await fetch("/api/marker", {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...body, thread: body.thread.map(m => ({ role: m.role, text: m.text })) })
    });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") throw new Error("The AI took too long. Your question is saved in the marker; try again.");
    throw new Error(navigator.onLine ? "Couldn't reach the AI. Try again." : "You're offline. AI markers need a connection; math, formatting, links and reminders still work.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) throw new Error("AI isn't set up on this server yet. See the setup guide in the README.");
    throw new Error(j.error || "The AI request failed. Try again.");
  }
  return j as AIResult;
}

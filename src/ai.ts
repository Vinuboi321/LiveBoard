import { authToken, syncConfigured, currentUser } from "./sync";
import type { AIResult, ThreadMsg } from "./types";
import { DAY } from "./util";

/* ---------- What the marker box can do without the AI (instant, free, works offline) ---------- */
export type LocalAction =
  | { do: "format"; fmt: "heading" | "subheading" | "list" | "numbered" | "checklist" | "bold" | "highlight" | "quote" | "plain" }
  | { do: "calc"; expr: string }
  | { do: "link"; query: string }
  | { do: "related" }
  | { do: "remind"; at: number; label: string };

const WORDY = /\b(explain|why|what|how|make|turn|give|quiz|draw|summar|outline|draft|list|write|expand|example|compare|define|describe|show)\b/i;

let mathMod: typeof import("mathjs") | null = null;
export async function mathjs() {
  if (!mathMod) mathMod = await import("mathjs");
  return mathMod;
}
export async function evaluate(expr: string): Promise<string> {
  const m = await mathjs();
  const v = m.evaluate(expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√\s*\(/g, "sqrt("));
  if (typeof v === "function" || v === undefined) throw new Error("That isn't something to calculate.");
  return m.format(v, { precision: 10 });
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

export async function localIntent(raw: string): Promise<LocalAction | null> {
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
    else if (/\b(exam|test|midterm|final|quiz)\b/.test(low)) { at = Date.now() + 3 * DAY; label = "in 3 days, before your exam"; }
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
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...body, thread: body.thread.map(m => ({ role: m.role, text: m.text })) })
    });
  } catch {
    throw new Error(navigator.onLine ? "Couldn't reach the AI. Try again." : "You're offline. AI markers need a connection; math, formatting, links and reminders still work.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) throw new Error("AI isn't set up on this server yet. See the setup guide in the README.");
    throw new Error(j.error || "The AI request failed. Try again.");
  }
  return j as AIResult;
}

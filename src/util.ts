export const H = 36e5;
export const DAY = 864e5;

export const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T | null;
export const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll(s)] as T[];

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function agoLong(t: number) {
  const ms = Date.now() - t, h = ms / H, d = ms / DAY;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} hr ago`;
  if (d < 14) { const r = Math.round(d); return `${r} day${r > 1 ? "s" : ""} ago`; }
  if (d < 60) return `${Math.round(d / 7)} wk ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${(d / 365).toFixed(1)} yr ago`;
}

export const wrapDeg = (a: number) => ((a % 360) + 540) % 360 - 180;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let toastTimer: number | undefined;
export function toast(msg: string, ms = 2800) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), ms);
}

/** A button that needs a second tap within 3 seconds before it acts. */
export function armButton(btn: HTMLElement, idleLabel: string, armedLabel: string, action: () => void) {
  let timer: number | null = null;
  btn.addEventListener("click", () => {
    if (timer === null) {
      btn.textContent = armedLabel;
      btn.classList.add("warn");
      timer = window.setTimeout(() => { timer = null; btn.textContent = idleLabel; btn.classList.remove("warn"); }, 3000);
      return;
    }
    clearTimeout(timer);
    timer = null;
    action();
  });
}

export const COURSE_COLORS = ["#3A86FF", "#FF7A1A", "#10C49B", "#A24BFF", "#FF4FA3", "#FFB703", "#00B4D8", "#F15BB5", "#FF5A5F", "#2EC4B6"];

export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: number | undefined;
  const d = (...a: A) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
  d.flush = (...a: A) => { clearTimeout(t); fn(...a); };
  return d as typeof d & { flush: (...a: A) => void };
};

import { askMarker, evaluate, localIntent, type LocalAction } from "../ai";
import { mdToHtml } from "../md";
import { courseName, liveNotes, note, putMarker, state } from "../store";
import type { Marker, MarkerType, Mastery, ThreadMsg } from "../types";
import { $, agoLong, armButton, esc, toast } from "../util";
import { repaintAll } from "./extensions";
import { applyFormat, contextAround, insertOutput, removeMarkerFromDoc } from "./ops";

/* The marker box: the one tool in Tray. A single input that understands what you mean, plus the marker's history. */

export const TYPE_INFO: Record<MarkerType, { label: string; hint: string }> = {
  note: { label: "Writing", hint: "Your own words or drafted notes" },
  question: { label: "Question", hint: "Something you're unsure about" },
  explain: { label: "Explanation", hint: "Explained or expanded by the marker" },
  math: { label: "Math", hint: "Calculated exactly" },
  visual: { label: "Visual", hint: "A diagram" },
  link: { label: "Link", hint: "Connected to another note" },
  reminder: { label: "Reminder", hint: "Comes back for review" }
};
const MASTERY = ["Unsure", "Getting it", "Mastered"];

let box: HTMLElement | null = null;
let current: Marker | null = null;
let busy = false;
let openNoteFn: (id: string) => void = () => {};
export const setOpenNote = (fn: (id: string) => void) => { openNoteFn = fn; };
export const boxOpen = () => !!box;

export function closeBox() {
  box?.remove();
  box = null;
  current = null;
}

function suggestions(m: Marker) {
  return m.text
    ? ["Explain this simpler", "Give me an example", "Expand on this", "Quiz me on this", "Turn this into a list", "Draw a diagram", "Related notes", "Remind me tomorrow"]
    : ["Outline this topic", "Summarize this note", "Draft notes on …", "Make a checklist from this note", "Calculate …"];
}

export function openBox(id: string, anchor?: Element | null) {
  const m = state.markers.get(id);
  if (!m) return;
  closeBox();
  current = m;
  box = document.createElement("div");
  box.className = "mbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Marker");
  document.body.appendChild(box);
  render();
  position(anchor || document.querySelector(`.pin[data-pin="${CSS.escape(id)}"]`));
  setTimeout(() => (box?.querySelector("#mIn") as HTMLInputElement | null)?.focus({ preventScroll: true }), 30);
}

function position(anchor: Element | null) {
  if (!box) return;
  if (innerWidth < 640 || !anchor) { box.classList.add("sheet"); return; }
  const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(16, Math.min(innerWidth - w - 16, r.left - 24)) + "px";
  box.style.top = (r.bottom + h + 16 < innerHeight ? r.bottom + 10 : Math.max(16, r.top - h - 10)) + "px";
}

function msgHTML(msg: ThreadMsg, i: number) {
  if (msg.role === "user") return `<div class="mmsg user">${esc(msg.text)}</div>`;
  const calc = msg.calc ? `<div class="mcalc"><code>${esc(msg.calc)}</code> = <b>${esc(msg.result ?? "…")}</b></div>` : "";
  const body = msg.text ? `<div class="mmd">${mdToHtml(msg.text)}</div>` : "";
  const act = msg.inserted ? `<div class="mnote">Written into your note</div>` : (msg.text || msg.calc) ? `<button class="mlink" data-add="${i}">Add to note</button>` : "";
  return `<div class="mmsg marker">${body}${calc}${act}</div>`;
}

function render() {
  if (!box || !current) return;
  const m = current;
  const linked = m.linkNoteId ? note(m.linkNoteId) : null;
  box.dataset.type = m.type;
  box.innerHTML = `
    <div class="mhead">
      <button class="mtype" id="mType" aria-haspopup="true" aria-expanded="false"><i class="tdot"></i>${TYPE_INFO[m.type].label}<span aria-hidden="true">▾</span></button>
      <span class="spacer"></span>
      <button class="mx" id="mClose" aria-label="Close marker">×</button>
    </div>
    <div class="mtypes" id="mTypes" hidden>${(Object.keys(TYPE_INFO) as MarkerType[]).map(t => `<button data-t="${t}" data-type="${t}" class="${t === m.type ? "on" : ""}"><i class="tdot"></i><b>${TYPE_INFO[t].label}</b><small>${TYPE_INFO[t].hint}</small></button>`).join("")}</div>
    ${m.text ? `<blockquote class="mquote">${esc(m.text)}</blockquote>` : `<div class="mquote blank">Blank marker · write, draft or generate here</div>`}
    ${linked ? `<button class="mchip" data-open="${linked.id}">Linked to ${esc(linked.title)} →</button>` : ""}
    ${m.type === "reminder" && m.remindAt ? `<div class="mchip static">Comes back ${new Date(m.remindAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>` : ""}
    <div class="mthread" id="mThread">${m.thread.map(msgHTML).join("")}${busy ? `<div class="mmsg marker thinking"><i></i><i></i><i></i></div>` : ""}</div>
    ${!m.thread.length ? `<div class="msugg">${suggestions(m).map(s => `<button>${esc(s)}</button>`).join("")}</div>` : ""}
    <form class="minput" id="mForm"><input id="mIn" autocomplete="off" maxlength="600" placeholder="${m.text ? "Ask, explain, calculate, format…" : "Draft, outline, summarize, calculate…"}" ${busy ? "disabled" : ""}><button ${busy ? "disabled" : ""} aria-label="Run">↵</button></form>
    <div class="mfoot">
      <div class="mastery" role="group" aria-label="How well you know this">${MASTERY.map((l, i) => `<button data-m="${i}" aria-pressed="${m.mastery === i}">${l}</button>`).join("")}</div>
      <button class="mdel" id="mDel">Remove</button>
    </div>`;
  const thread = $("#mThread", box)!;
  thread.scrollTop = thread.scrollHeight;

  $("#mClose", box)!.onclick = closeBox;
  const typeBtn = $("#mType", box)!, types = $("#mTypes", box)!;
  typeBtn.onclick = () => { types.hidden = !types.hidden; typeBtn.setAttribute("aria-expanded", String(!types.hidden)); };
  types.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => update({ type: b.dataset.t as MarkerType }));
  box.querySelectorAll<HTMLButtonElement>(".mastery button").forEach(b => b.onclick = () => update({ mastery: Number(b.dataset.m) as Mastery }));
  box.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.onclick = () => { const nid = b.dataset.open!; closeBox(); openNoteFn(nid); });
  box.querySelectorAll<HTMLButtonElement>(".msugg button").forEach(b => b.onclick = () => {
    const t = b.textContent || "";
    if (t.includes("…")) { const i = $("#mIn", box!) as HTMLInputElement; i.value = t.replace("…", "").replace(/\s+$/, " "); i.focus(); return; }
    run(t);
  });
  box.querySelectorAll<HTMLButtonElement>("[data-add]").forEach(b => b.onclick = () => addToNote(Number(b.dataset.add)));
  ($("#mForm", box) as HTMLFormElement).onsubmit = e => { e.preventDefault(); const i = $("#mIn", box!) as HTMLInputElement; const v = i.value.trim(); if (v) run(v); };
  armButton($("#mDel", box)!, "Remove", "Tap again to remove", () => {
    const id = m.id;
    closeBox();
    removeMarkerFromDoc(id);
    toast("Marker removed. Undo with Ctrl/⌘ Z.");
  });
}

async function update(patch: Partial<Marker>) {
  if (!current) return;
  current = { ...current, ...patch };
  await putMarker(current);
  repaintAll();
  render();
}

async function addToNote(i: number) {
  if (!current) return;
  const msg = current.thread[i];
  if (!msg) return;
  const ok = insertOutput(current.id, msg.text, { calcLine: msg.calc ? `${msg.calc} = ${msg.result}` : null });
  if (!ok) return toast("Couldn't find this marker in the note.");
  const thread = current.thread.map((t, j) => (j === i ? { ...t, inserted: true } : t));
  await update({ thread });
}

function pushMsg(msg: ThreadMsg) {
  if (!current) return [];
  return [...current.thread, msg];
}

async function runLocal(a: LocalAction, said: string): Promise<boolean> {
  if (!current) return false;
  const m = current;
  const user: ThreadMsg = { role: "user", text: said, at: Date.now() };
  if (a.do === "format") {
    const multi = /[.;!?]\s+\S/.test(m.text) || m.text.includes(",");
    if (["list", "numbered", "checklist"].includes(a.fmt) && multi) return false; // splitting a passage into items needs the AI
    applyFormat(m.id, a.fmt);
    await update({ thread: [...pushMsg(user), { role: "marker", text: `Formatted as ${a.fmt === "subheading" ? "a subheading" : a.fmt === "heading" ? "a heading" : a.fmt}.`, at: Date.now(), inserted: true }] });
    return true;
  }
  if (a.do === "calc") {
    const result = await evaluate(a.expr);
    await update({ type: m.type === "note" || m.type === "question" ? "math" : m.type, thread: [...pushMsg(user), { role: "marker", text: "", calc: a.expr, result, at: Date.now() }] });
    return true;
  }
  if (a.do === "remind") {
    await update({ type: "reminder", remindAt: a.at, due: a.at, thread: [...pushMsg(user), { role: "marker", text: `This marker will come back in your recall ${a.label}.`, at: Date.now(), inserted: true }] });
    return true;
  }
  const words = (a.do === "link" ? a.query : m.text || (note(m.noteId)?.title ?? "")).toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const hits = liveNotes().filter(n => n.id !== m.noteId).map(n => {
    const hay = (n.title + " " + n.plain).toLowerCase();
    return { n, score: words.filter(w => hay.includes(w)).length + (a.do === "link" && n.title.toLowerCase().includes(a.query) ? 5 : 0) };
  }).filter(h => h.score > 0).sort((x, y) => y.score - x.score).slice(0, 5);
  if (a.do === "link") {
    if (!hits.length) { await update({ thread: [...pushMsg(user), { role: "marker", text: `No note matches "${a.query}".`, at: Date.now(), inserted: true }] }); return true; }
    const t = hits[0].n;
    await update({ type: "link", linkNoteId: t.id, thread: [...pushMsg(user), { role: "marker", text: `Linked to **${t.title}** (${courseName(t.courseId)}). It shows up on that note too.`, at: Date.now(), inserted: true }] });
    return true;
  }
  const text = hits.length
    ? hits.map(h => `- **${h.n.title}** · ${courseName(h.n.courseId)} · opened ${agoLong(h.n.openedAt)}`).join("\n") + `\n\nType "link to" and a title to connect one.`
    : "Nothing else in your notes mentions this yet.";
  await update({ thread: [...pushMsg(user), { role: "marker", text, at: Date.now(), inserted: true }] });
  return true;
}

async function run(said: string) {
  if (!current || busy) return;
  try {
    const local = await localIntent(said);
    if (local && (await runLocal(local, said))) return;
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  const id = current.id;
  const n = note(current.noteId);
  const ctx = contextAround(id);
  const withUser: Marker = { ...current, thread: pushMsg({ role: "user", text: said, at: Date.now() }) };
  await putMarker(withUser);
  current = withUser;
  busy = true;
  render();
  let reply: ThreadMsg;
  let patch: Partial<Marker> = {};
  try {
    const res = await askMarker({ intent: said, passage: withUser.text, before: ctx.before, after: ctx.after, note: ctx.note, title: n?.title || "", course: courseName(n?.courseId), thread: withUser.thread.slice(0, -1) });
    let result: string | null = null;
    if (res.calc) { try { result = await evaluate(res.calc); } catch { result = null; } }
    reply = { role: "marker", text: res.markdown, at: Date.now(), calc: res.calc && result ? res.calc : null, result };
    if (res.kind === "insert") reply.inserted = insertOutput(id, res.markdown, { mermaid: res.mermaid, calcLine: res.calc && result ? `${res.calc} = ${result}` : null });
    patch = { recallQ: res.recall?.q || withUser.recallQ || null, recallA: res.recall?.a || withUser.recallA || null };
    if (withUser.type !== "link" && withUser.type !== "reminder") patch.type = res.type;
  } catch (e) {
    reply = { role: "marker", text: `⚠︎ ${(e as Error).message}`, at: Date.now(), inserted: true };
  }
  busy = false;
  const base = state.markers.get(id) || withUser;
  const saved: Marker = { ...base, ...patch, thread: [...base.thread, reply] };
  await putMarker(saved);
  repaintAll();
  if (current && current.id === id) { current = saved; render(); }
}

document.addEventListener("pointerdown", e => {
  if (!box) return;
  const t = e.target as Element;
  if (box.contains(t) || t.closest(".pin, .mk, .rail, .mout")) return;
  closeBox();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && box) { e.stopPropagation(); closeBox(); } }, true);

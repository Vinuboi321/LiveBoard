import { aiHealth, askMarker, askQuiz } from "../ai";
import { course, courseColor, courseName, liveMarkers, liveNotes, note, putMeta, state } from "../store";
import { compareAnswer, gradeMarker, keyIdeas, recallText, recallable, studiedOn } from "../study";
import type { Marker, Note } from "../types";
import { $, DAY, dayKey, esc, uid } from "../util";

/* Cram: its own screen for getting one course ready for an exam. Daily recall stays small and lives in the dial's hub;
   cramming is a longer sitting, so it gets room.

   Set up: choose the weak spots or everything, which notes (topics) to include and how long a sitting. Add extra
   questions written from those notes: by the AI when it's connected (optionally told what to cover), otherwise as
   fill-in-the-blanks made on the device.

   Run: one question at a time. Marker questions are typed from memory, then compared with the stored answer and
   graded Again / Almost / Got it. Generated multiple-choice questions grade themselves. Anything not known comes
   round again before the sitting ends (up to twice).

   What is recorded: only the first answer to a marker's question moves its mastery and schedule (Got it or Again;
   Almost changes nothing and just asks again). Generated questions never touch the schedule. */

type Res = "got" | "almost" | "again";
interface Q { id: string; kind: "short" | "choice"; q: string; a: string; choices?: string[]; why?: string; noteId?: string; markerId?: string; made?: "ai" | "device" }
interface Opts { courseId: string; openNote: (noteId: string, markerId?: string) => void; onClose: () => void }

interface State {
  o: Opts; view: "setup" | "run" | "done";
  pool: "weak" | "all"; topics: Set<string>; len: number;
  gen: Q[]; ask: string; busy: boolean; err: string; aiOn: boolean | null;
  queue: Q[]; i: number; typed: string; revealed: boolean; chosen: number; hint: boolean; struck: number; ai: string; checking: boolean;
  first: Map<string, Res>; last: Map<string, Res>; tries: Map<string, number>; order: Q[];
  started: number; ended: number; pct0: number; graded: boolean;
}
let S: State | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

export const cramOpen = () => !!S;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.+\-/%^=]*[\p{L}\p{N}%]|[\p{L}\p{N}]/gu;
const courseNotes = (cid: string) => liveNotes().filter(n => n.courseId === cid).sort((a, b) => b.openedAt - a.openedAt);
const courseMarkers = (cid: string) => liveMarkers().filter(m => recallable(m) && note(m.noteId)?.courseId === cid);
function readiness(cid: string) {
  const ms = courseMarkers(cid), c = [0, 0, 0];
  ms.forEach(m => c[m.mastery]++);
  return { n: ms.length, counts: c, pct: ms.length ? Math.round(100 * (c[1] * 0.5 + c[2]) / ms.length) : 0 };
}
function examIn(cid: string) {
  const d = course(cid)?.examDate;
  if (!d || !/^\d{4}-\d\d-\d\d$/.test(d)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${d}T00:00:00`).getTime() - today.getTime()) / DAY);
  return days < 0 ? null : days;
}

/** The marker questions this sitting will ask, weakest first. */
function markerQs(): Q[] {
  if (!S) return [];
  let ms = courseMarkers(S.o.courseId).filter(m => S!.topics.has(m.noteId));
  if (S.pool === "weak") { const weak = ms.filter(m => m.mastery < 2); if (weak.length) ms = weak; }
  ms.sort((a, b) => a.mastery - b.mastery || a.due - b.due);
  if (S.len) ms = ms.slice(0, S.len);
  return ms.map(m => { const t = recallText(m); return { id: m.id, kind: "short" as const, q: t.q, a: t.a, noteId: m.noteId, markerId: m.id }; });
}

/** Fill-in-the-blank questions made on the device from the notes' own sentences (no AI). `ask` narrows them to sentences
 *  that mention its words. Every other one is offered as multiple choice when the notes hold enough other terms. */
export function localQuestions(notes: Pick<Note, "id" | "plain">[], ask: string, max = 6): Q[] {
  const want = (ask.toLowerCase().match(WORD) || []).filter(w => w.length > 3);
  const sents: { s: string; id: string; score: number }[] = [];
  for (const n of notes) {
    for (const raw of (n.plain || "").split(/(?<=[.!?])\s+|\n+/)) {
      const s = raw.trim();
      if (s.length < 45 || s.length > 240 || /\?$/.test(s)) continue;
      const low = s.toLowerCase();
      sents.push({ s, id: n.id, score: want.filter(w => low.includes(w)).length });
    }
  }
  const pool = want.length && sents.some(x => x.score) ? sents.filter(x => x.score) : sents;
  // spread the picks through the notes instead of taking the first few sentences
  const step = Math.max(1, Math.floor(pool.length / max)), picked = pool.filter((_, i) => i % step === 0).slice(0, max);
  const terms = [...new Set(sents.flatMap(x => keyIdeas(x.s).filter(w => w.length > 4 && !/\d/.test(w))))];
  const out: Q[] = [];
  picked.forEach((x, k) => {
    const ideas = keyIdeas(x.s).filter(w => x.s.indexOf(w) > 0 && !/\d/.test(w)); // a word to recall, never a number to compute
    const term = ideas.sort((a, b) => b.length - a.length)[0];
    if (!term) return;
    const blanked = x.s.replace(term, "_____");
    const others = terms.filter(t => t.toLowerCase() !== term.toLowerCase() && !x.s.includes(t));
    if (k % 2 && others.length >= 3) {
      const pick = [0, 1, 2].map(j => others[(k * 7 + j * 3) % others.length]).filter((v, j, a) => a.indexOf(v) === j);
      if (pick.length === 3) {
        const choices = [...pick]; choices.splice(k % 4, 0, term);
        out.push({ id: uid(), kind: "choice", q: `Which word completes this? “${blanked}”`, a: term, choices, why: x.s, noteId: x.id, made: "device" });
        return;
      }
    }
    out.push({ id: uid(), kind: "short", q: `Fill in the blank: “${blanked}”`, a: term, why: x.s, noteId: x.id, made: "device" });
  });
  return out;
}

export function openCram(o: Opts) {
  closeCram(true);
  const topics = new Set(courseNotes(o.courseId).map(n => n.id));
  S = { o, view: "setup", pool: "weak", topics, len: 20, gen: [], ask: "", busy: false, err: "", aiOn: null,
    queue: [], i: 0, typed: "", revealed: false, chosen: -1, hint: false, struck: -1, ai: "", checking: false,
    first: new Map(), last: new Map(), tries: new Map(), order: [], started: 0, ended: 0, pct0: readiness(o.courseId).pct, graded: false };
  const el = document.createElement("div");
  el.id = "cram";
  el.className = "cram";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", `Cram for ${courseName(o.courseId)}`);
  el.style.setProperty("--cc", courseColor(o.courseId));
  el.innerHTML = `<div class="crsheet"><div class="crbody" id="crBody"></div></div>`;
  el.addEventListener("pointerdown", e => { if (e.target === el && S?.view !== "run") closeCram(); });
  document.body.appendChild(el);
  document.documentElement.classList.add("cramming");
  // keys belong to this screen while it is open (the dial behind it also listens for arrows and numbers)
  onKey = e => { if (!S) return; e.stopPropagation(); keys(e); };
  window.addEventListener("keydown", onKey, true);
  aiHealth().then(h => { if (S && S.o === o) { S.aiOn = h.ai; if (S.view === "setup") render(); } });
  render();
}
export function closeCram(quiet = false) {
  if (!S) return;
  const o = S.o;
  S = null;
  if (onKey) window.removeEventListener("keydown", onKey, true);
  onKey = null;
  $("#cram")?.remove();
  document.documentElement.classList.remove("cramming");
  if (!quiet) o.onClose();
}

function render() {
  const body = $("#crBody");
  if (!body || !S) return;
  if (S.view === "setup") setup(body);
  else if (S.view === "run") run(body);
  else done(body);
}
const ring = (pct: number, size = 64) => `<svg class="crring" viewBox="0 0 36 36" width="${size}" height="${size}" aria-hidden="true"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" stroke-width="3.4"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--cc)" stroke-width="3.4" stroke-linecap="round" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg>`;
const head = (right: string) => {
  const cid = S!.o.courseId, d = examIn(cid);
  return `<header class="crhead"><span class="crtab">Cram</span><h2>${esc(courseName(cid))}</h2>${d === null ? "" : `<span class="crwhen">exam ${d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}</span>`}<span class="crgrow"></span>${right}</header>`;
};

/* ---------- setting up ---------- */
function setup(body: HTMLElement) {
  const s = S!, cid = s.o.courseId, r = readiness(cid), notes = courseNotes(cid), all = courseMarkers(cid);
  const inTopics = all.filter(m => s.topics.has(m.noteId)), weak = inTopics.filter(m => m.mastery < 2);
  const mq = markerQs(), total = mq.length + s.gen.length;
  const perNote = (id: string) => { const ms = all.filter(m => m.noteId === id), c = [0, 0, 0]; ms.forEach(m => c[m.mastery]++); return { n: ms.length, c }; };
  const ideas = s.aiOn ? ["Harder, applied questions", "Compare the main ideas", "Definitions I should know", "Common mistakes"] : [];
  body.innerHTML = `${head(`<button class="mapclose" id="crClose" aria-label="Close">Close<kbd>Esc</kbd></button>`)}
    <div class="crsetup">
      <section class="crcol">
        <div class="crready">${ring(r.pct, 76)}<div><b>${r.pct}%</b> ready<small>${r.n ? `${r.counts[2]} mastered · ${r.counts[1]} getting it · ${r.counts[0]} unsure` : "No markers in this course yet"}</small></div></div>
        <h3>What to go over</h3>
        <div class="crseg" role="group" aria-label="Which markers">
          <button data-pool="weak" aria-pressed="${s.pool === "weak"}"><b>Weak spots</b><small>${weak.length} not mastered yet</small></button>
          <button data-pool="all" aria-pressed="${s.pool === "all"}"><b>Everything</b><small>${inTopics.length} marker${inTopics.length === 1 ? "" : "s"}</small></button>
        </div>
        <h3>Topics <button class="crlink" id="crAll">${s.topics.size === notes.length ? "Clear all" : "Select all"}</button></h3>
        <div class="crtopics">${notes.length ? notes.map(n => { const p = perNote(n.id); return `<label class="crtopic"><input type="checkbox" data-topic="${n.id}" ${s.topics.has(n.id) ? "checked" : ""}><span class="crt"><b>${esc(n.title || "Untitled")}</b><small>${p.n ? `${p.n} marker${p.n === 1 ? "" : "s"}` : "no markers, notes only"}</small></span>${p.n ? `<span class="crmini" aria-hidden="true">${p.c.map((k, i) => k ? `<i data-m="${i}" style="flex:${k}"></i>` : "").join("")}</span>` : ""}</label>`; }).join("") : `<p class="crnote">This course has no notes yet.</p>`}</div>
        <h3>How long</h3>
        <div class="crchips" role="group" aria-label="How many marker questions">${[10, 20, 30, 0].map(n => `<button data-len="${n}" aria-pressed="${s.len === n}">${n || "All"}</button>`).join("")}<span class="crnote">marker questions at most</span></div>
      </section>
      <section class="crcol crgen">
        <h3>Extra questions from your notes</h3>
        <p class="crnote">${s.aiOn ? "Written from the topics you picked. Say what you want, or leave it empty for a mix." : s.aiOn === false ? "AI isn't connected here, so these are fill-in-the-blanks built from sentences in your notes. Type a word or two to focus them." : "Checking whether AI is connected…"}</p>
        <textarea id="crAsk" rows="2" maxlength="400" placeholder="${s.aiOn ? "e.g. harder questions on Le Chatelier, or what I'd get wrong on gas laws" : "e.g. equilibrium, enzymes"}" aria-label="What should the questions cover?">${esc(s.ask)}</textarea>
        ${ideas.length ? `<div class="crideas">${ideas.map(t => `<button data-idea="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
        <button class="crgenbtn" id="crGen" ${s.busy || !s.topics.size ? "disabled" : ""}><span class="spark" aria-hidden="true">✦</span>${s.busy ? "Writing questions…" : s.gen.length ? "Generate more" : "Generate questions"}</button>
        ${s.err ? `<div class="crerr" role="alert">${esc(s.err)}</div>` : ""}
        <div class="crgenlist" aria-live="polite">${s.gen.map((q, i) => `<div class="crgq" style="--i:${Math.min(i, 12)}"><span class="crkind">${q.kind === "choice" ? "Choice" : "Short"}</span><span class="crgqt">${esc(q.q)}</span><button data-drop="${q.id}" aria-label="Remove this question" title="Remove">×</button></div>`).join("")}</div>
      </section>
    </div>
    <footer class="crfoot"><span class="crnote">${total ? `${mq.length} from your markers${s.gen.length ? ` · ${s.gen.length} generated` : ""}. Missed ones come round again before you finish.` : "Pick a topic with markers, or generate some questions."}</span>
      <button class="crstart" id="crStart" ${total ? "" : "disabled"}>Start cram<span class="cnt">${total}</span></button></footer>`;
  $("#crClose", body)!.onclick = () => closeCram();
  body.querySelectorAll<HTMLButtonElement>("[data-pool]").forEach(b => b.onclick = () => { s.pool = b.dataset.pool as "weak"; render(); });
  body.querySelectorAll<HTMLButtonElement>("[data-len]").forEach(b => b.onclick = () => { s.len = Number(b.dataset.len); render(); });
  body.querySelectorAll<HTMLInputElement>("[data-topic]").forEach(c => c.onchange = () => { c.checked ? s.topics.add(c.dataset.topic!) : s.topics.delete(c.dataset.topic!); render(); });
  $("#crAll", body)!.onclick = () => { s.topics = s.topics.size === notes.length ? new Set() : new Set(notes.map(n => n.id)); render(); };
  const ask = $("#crAsk", body) as HTMLTextAreaElement;
  ask.oninput = () => { s.ask = ask.value; };
  body.querySelectorAll<HTMLButtonElement>("[data-idea]").forEach(b => b.onclick = () => { s.ask = b.dataset.idea!; generate(); });
  body.querySelectorAll<HTMLButtonElement>("[data-drop]").forEach(b => b.onclick = () => { s.gen = s.gen.filter(q => q.id !== b.dataset.drop); render(); });
  $("#crGen", body)!.onclick = generate;
  $("#crStart", body)!.onclick = () => start();
}

async function generate() {
  const s = S;
  if (!s || s.busy) return;
  const notes = courseNotes(s.o.courseId).filter(n => s.topics.has(n.id));
  s.err = "";
  if (!notes.length) { s.err = "Pick at least one topic first."; return render(); }
  const have = new Set(s.gen.map(q => q.q.toLowerCase()));
  const add = (qs: Q[]) => { const fresh = qs.filter(q => !have.has(q.q.toLowerCase())); s.gen = [...s.gen, ...fresh].slice(0, 24); return fresh.length; };
  if (!s.aiOn) {
    const n = add(localQuestions(notes, s.ask, 6 + s.gen.length).slice(-8));
    if (!n) s.err = notes.some(x => (x.plain || "").length > 80) ? "That's every sentence these notes can be quizzed on. Add a topic or change the words above." : "These notes don't have enough written in them yet to build questions from.";
    return render();
  }
  s.busy = true;
  render();
  try {
    // share the 9,000 characters the AI reads fairly between the chosen notes
    const each = Math.max(600, Math.floor(8600 / notes.length));
    const material = notes.map(n => `## ${n.title || "Untitled"}\n${(n.plain || "").slice(0, each)}`).join("\n\n");
    const got = await askQuiz({ material, course: courseName(s.o.courseId), topics: notes.map(n => n.title).join(", "), ask: s.ask.trim() });
    if (S !== s) return;
    if (!add(got.map(g => ({ id: uid(), kind: g.kind, q: g.q, a: g.a, choices: g.kind === "choice" ? g.choices : undefined, why: g.why || "", made: "ai" as const })))) s.err = "The AI returned questions you already have. Say what else you want covered.";
  } catch (e) { if (S === s) s.err = (e as Error).message; }
  if (S !== s) return;
  s.busy = false;
  if (s.view === "setup") render();
}

/* ---------- the sitting ---------- */
function start(only?: Q[]) {
  const s = S!;
  let q: Q[];
  if (Array.isArray(only)) q = only;
  else {
    // generated questions are spread through the marker questions instead of bunched at the end
    const mq = markerQs(), gap = s.gen.length ? Math.max(1, Math.floor(mq.length / (s.gen.length + 1))) : 0;
    q = [];
    let g = 0;
    mq.forEach((m, i) => { q.push(m); if (gap && (i + 1) % gap === 0 && g < s.gen.length) q.push(s.gen[g++]); });
    q.push(...s.gen.slice(g));
  }
  if (!q.length) return;
  s.queue = [...q]; s.order = [...q]; s.i = 0;
  s.first = new Map(); s.last = new Map(); s.tries = new Map();
  s.started = Date.now(); s.view = "run";
  fresh();
  render();
}
function fresh() { const s = S!; s.typed = ""; s.revealed = false; s.chosen = -1; s.hint = false; s.struck = -1; s.ai = ""; s.checking = false; }

function run(body: HTMLElement) {
  const s = S!, q = s.queue[s.i];
  const n = q.noteId ? note(q.noteId) : undefined;
  const again = (s.tries.get(q.id) || 0) > 0;
  const bar = s.order.map(x => `<i data-r="${s.last.get(x.id) || ""}" class="${x.id === q.id ? "now" : ""}"></i>`).join("");
  const gotN = [...s.last.values()].filter(v => v === "got").length;
  const src = q.markerId ? `From your marker in <b>${esc(n?.title || "a note")}</b>` : q.made === "ai" ? "Generated from your notes" : `Built from <b>${esc(n?.title || "your notes")}</b>`;
  let mid = "";
  if (q.kind === "choice") {
    const right = q.choices!.indexOf(q.a), picked = s.chosen >= 0;
    mid = `<div class="cropts" role="group" aria-label="Answers">${q.choices!.map((c, i) => `<button class="cropt ${picked ? (i === right ? "right" : i === s.chosen ? "wrong" : "dim") : i === s.struck ? "struck" : ""}" data-opt="${i}" ${picked || i === s.struck ? "disabled" : ""}><kbd>${"ABCD"[i]}</kbd><span>${esc(c)}</span></button>`).join("")}</div>
      ${picked ? `<div class="crverdict ${s.chosen === right ? "ok" : "low"}"><b>${s.chosen === right ? "Right." : "Not quite."}</b> ${esc(q.why || "")}</div>
        <div class="cracts"><button class="crnext" id="crNext">${s.i + 1 >= s.queue.length && s.chosen === right ? "Finish" : "Next"}<kbd>Enter</kbd></button></div>`
      : `<div class="cracts quiet">${s.struck < 0 && q.choices!.length > 2 ? `<button class="crlink" id="crHint">Hint: rule one out</button>` : ""}</div>`}`;
  } else if (!s.revealed) {
    const ideas = keyIdeas(q.a);
    mid = `<textarea id="crAns" class="crans" rows="3" maxlength="600" autocapitalize="sentences" placeholder="Answer from memory. It's fine to be rough." aria-label="Your answer from memory">${esc(s.typed)}</textarea>
      ${s.hint ? `<div class="crhint">${ideas.length > 1 ? `The answer has <b>${ideas.length}</b> key ideas. ` : ""}It starts: “${esc(q.a.split(/\s+/).slice(0, 3).join(" "))}…”</div>` : ""}
      <div class="cracts"><button class="crshow" id="crShow">Show answer<kbd>Enter</kbd></button>${s.hint ? "" : `<button class="crlink" id="crHint">Hint</button>`}</div>`;
  } else {
    const cmp = s.typed ? compareAnswer(s.typed, q.a) : null;
    const strong = cmp && cmp.total ? cmp.hit / cmp.total >= 0.6 : null;
    mid = `${s.typed ? `<div class="cryou"><small>You wrote</small>${esc(s.typed)}</div>` : ""}
      <div class="crans2"><small>Answer</small><div>${cmp ? cmp.html : esc(q.a)}</div>${q.why && q.why !== q.a ? `<p class="crwhy">${esc(q.why)}</p>` : ""}</div>
      ${cmp && cmp.total ? `<div class="crscore ${strong ? "ok" : "low"}"><b>${cmp.hit} of ${cmp.total}</b> key ideas${s.aiOn && !s.ai ? ` · <button class="crlink" id="crCheck" ${s.checking ? "disabled" : ""}>${s.checking ? "Checking…" : "Check with AI"}</button>` : ""}</div>` : ""}
      ${s.ai ? `<div class="crai">${esc(s.ai)}</div>` : ""}
      <div class="crgrade" role="group" aria-label="How did you do?"><button data-g="again" class="again"><b>Again</b><small>didn't know it</small><kbd>1</kbd></button><button data-g="almost" class="almost"><b>Almost</b><small>ask me once more</small><kbd>2</kbd></button><button data-g="got" class="got"><b>Got it</b><small>knew it cold</small><kbd>3</kbd></button></div>
      ${q.markerId ? `<button class="crlink cropen" id="crOpen">Open this in the note</button>` : ""}`;
  }
  body.innerHTML = `${head(`<span class="crclock" id="crClock">${clock(Date.now() - s.started)}</span><button class="mapclose" id="crEnd">End<kbd>Esc</kbd></button>`)}
    <div class="crbar" role="img" aria-label="${gotN} of ${s.order.length} known so far">${bar}</div>
    <div class="crrun"><div class="crmeta"><span><b>${s.i + 1}</b> of ${s.queue.length}</span>${again ? `<span class="crtag">coming round again</span>` : ""}<span class="crgrow"></span><span class="crsrc">${src}</span></div>
      <article class="crcard ${q.kind}" data-key="${q.id}:${s.revealed || s.chosen >= 0 ? 1 : 0}"><h3 class="crq">${esc(q.q)}</h3>${mid}</article></div>`;
  $("#crEnd", body)!.onclick = endRun;
  if (q.kind === "choice") {
    body.querySelectorAll<HTMLButtonElement>("[data-opt]").forEach(b => b.onclick = () => choose(Number(b.dataset.opt)));
    const nx = $("#crNext", body); if (nx) { nx.onclick = () => answer(s.chosen === q.choices!.indexOf(q.a) ? "got" : "again"); nx.focus({ preventScroll: true }); }
    const h = $("#crHint", body); if (h) h.onclick = hint;
  } else if (!s.revealed) {
    const ta = $("#crAns", body) as HTMLTextAreaElement;
    ta.oninput = () => { s.typed = ta.value; };
    $("#crShow", body)!.onclick = reveal;
    const h = $("#crHint", body); if (h) h.onclick = hint;
    if (matchMedia("(pointer: fine)").matches) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
  } else {
    body.querySelectorAll<HTMLButtonElement>("[data-g]").forEach(b => b.onclick = () => answer(b.dataset.g as Res));
    const c = $("#crCheck", body); if (c) c.onclick = () => aiCheck(q);
    const o = $("#crOpen", body); if (o) o.onclick = () => { const op = s.o; closeCram(); op.openNote(q.noteId!, q.markerId); };
  }
  tick();
}
const clock = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
let ticking = 0;
function tick() {
  clearTimeout(ticking);
  if (!S || S.view !== "run") return;
  const c = $("#crClock"); if (c) c.textContent = clock(Date.now() - S.started);
  ticking = window.setTimeout(tick, 1000);
}
function reveal() { const s = S!; if (s.view !== "run" || s.revealed) return; s.typed = s.typed.trim(); s.revealed = true; render(); }
function hint() {
  const s = S!, q = s.queue[s.i];
  if (q.kind === "choice") { const right = q.choices!.indexOf(q.a); s.struck = q.choices!.findIndex((_, i) => i !== right && (i + s.i) % 2 === 0); if (s.struck < 0) s.struck = q.choices!.findIndex((_, i) => i !== right); }
  else s.hint = true;
  render();
}
function choose(i: number) { const s = S!; if (s.chosen >= 0 || i === s.struck || i >= (s.queue[s.i].choices?.length || 0)) return; s.chosen = i; render(); }
async function aiCheck(q: Q) {
  const s = S!;
  if (s.checking) return;
  s.checking = true; render();
  let verdict: string;
  try {
    const r = await askMarker({ intent: `I answered a practice question from memory. In at most two short sentences, tell me what I got right and what I missed or got wrong. Be direct and kind. Don't restate the full answer.\nQuestion: ${q.q.slice(0, 160)}\nMy answer: ${s.typed.slice(0, 260)}`, passage: q.a.slice(0, 1500), before: "", after: "", note: "", title: note(q.noteId)?.title || "", course: "", thread: [] });
    verdict = r.markdown.replace(/[#*_`>]/g, "").trim().slice(0, 320);
  } catch (e) { verdict = (e as Error).message; }
  if (S !== s || s.queue[s.i] !== q || !s.revealed) return;
  s.checking = false; s.ai = verdict; render();
}
async function answer(res: Res) {
  const s = S!, q = s.queue[s.i];
  if (!s.first.has(q.id)) {
    s.first.set(q.id, res);
    const m: Marker | undefined = q.markerId ? state.markers.get(q.markerId) : undefined;
    if (m && res !== "almost") { await gradeMarker(m, res === "got"); s.graded = true; }
    if (S !== s) return;
  }
  s.last.set(q.id, res);
  const t = (s.tries.get(q.id) || 0) + 1;
  s.tries.set(q.id, t);
  if (res !== "got" && t < 3) s.queue.push(q); // it comes round again, at most twice
  s.i++;
  fresh();
  if (s.i >= s.queue.length) return finish();
  render();
}
function endRun() { const s = S!; if (s.first.size) finish(); else { s.view = "setup"; render(); } }
async function finish() {
  const s = S!;
  s.view = "done"; s.ended = Date.now();
  clearTimeout(ticking);
  if (s.graded && !studiedOn(Date.now())) await putMeta({ studyDays: [...state.meta.studyDays, dayKey(Date.now())] }); // a finished sitting counts as today's study
  if (S === s) render();
}

/* ---------- afterwards ---------- */
function done(body: HTMLElement) {
  const s = S!, asked = s.order.filter(q => s.first.has(q.id));
  const firstGot = asked.filter(q => s.first.get(q.id) === "got").length, r = readiness(s.o.courseId);
  const shaky = asked.filter(q => s.first.get(q.id) !== "got");
  const groups = new Map<string, { name: string; got: number; n: number }>();
  for (const q of asked) {
    const key = q.markerId || q.made === "device" ? q.noteId || "" : "gen";
    const g = groups.get(key) || { name: key === "gen" ? "Generated questions" : note(key)?.title || "Notes", got: 0, n: 0 };
    g.n++; if (s.first.get(q.id) === "got") g.got++;
    groups.set(key, g);
  }
  const pct = asked.length ? Math.round(100 * firstGot / asked.length) : 0;
  body.innerHTML = `${head(`<button class="mapclose" id="crClose" aria-label="Close">Close<kbd>Esc</kbd></button>`)}
    <div class="crdone">
      <section class="crcol crsum">
        <div class="crbig">${ring(pct, 132)}<div class="crbign"><b>${firstGot}</b><span>of ${asked.length}</span></div></div>
        <p class="crline">known on the first try${asked.length < s.order.length ? ` · ended early, ${s.order.length - asked.length} not reached` : ""}</p>
        <div class="crstats"><div><b>${clock(s.ended - s.started)}</b><small>time</small></div><div><b>${s.pct0}% → ${r.pct}%</b><small>ready for the exam</small></div><div><b>${[...s.tries.values()].reduce((a, b) => a + b, 0)}</b><small>answers given</small></div></div>
        <div class="cracts center">${shaky.length ? `<button class="crstart" id="crRedo">Go again on ${shaky.length}<span class="cnt">↻</span></button>` : ""}<button class="crghost" id="crSetup">New sitting</button><button class="${shaky.length ? "crghost" : "crstart"}" id="crDone">Back to the dial</button></div>
      </section>
      <section class="crcol">
        <h3>By topic</h3>
        <div class="crtopicbars">${[...groups.values()].map(g => `<div><span>${esc(g.name)}</span><i><u style="width:${Math.round(100 * g.got / g.n)}%"></u></i><b>${g.got}/${g.n}</b></div>`).join("")}</div>
        ${shaky.length ? `<h3>Still shaky</h3><div class="crshaky">${shaky.slice(0, 8).map(q => `<div class="crsh"><span data-r="${s.first.get(q.id)}"></span><p>${esc(q.q.slice(0, 120))}</p>${q.markerId ? `<button class="crlink" data-open="${q.id}">Open note</button>` : ""}</div>`).join("")}</div>
          <p class="crnote">${s.graded ? "The markers you missed are back in recall in 10 minutes." : ""}</p>` : `<p class="crnote">Nothing shaky this time. Everything was known on the first try.</p>`}
      </section>
    </div>`;
  $("#crClose", body)!.onclick = $("#crDone", body)!.onclick = () => closeCram();
  $("#crSetup", body)!.onclick = () => { s.view = "setup"; s.pct0 = r.pct; s.graded = false; render(); };
  const redo = $("#crRedo", body); if (redo) { redo.onclick = () => start(shaky); redo.focus({ preventScroll: true }); } else $("#crDone", body)!.focus({ preventScroll: true });
  body.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.onclick = () => { const q = s.order.find(x => x.id === b.dataset.open); if (!q) return; const op = s.o; closeCram(); op.openNote(q.noteId!, q.markerId); });
}

function keys(e: KeyboardEvent) {
  const s = S!;
  if (e.key === "Escape") { e.preventDefault(); if (s.view === "run") endRun(); else closeCram(); return; }
  if (s.view !== "run" || e.metaKey || e.ctrlKey || e.altKey) return;
  const q = s.queue[s.i], typing = (e.target as HTMLElement)?.tagName === "TEXTAREA";
  if (q.kind === "choice") {
    if (s.chosen < 0) { const i = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase()); if (i >= 0 && e.key.length === 1) { e.preventDefault(); choose(i); } }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); answer(s.chosen === q.choices!.indexOf(q.a) ? "got" : "again"); }
  } else if (!s.revealed) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); reveal(); }
  } else if (!typing && "123".includes(e.key) && e.key.length === 1) { e.preventDefault(); answer((["again", "almost", "got"] as const)["123".indexOf(e.key)]); }
}

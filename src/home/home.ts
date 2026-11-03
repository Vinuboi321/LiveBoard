import { courseColor, courseName, liveMarkers, liveNotes, note, putMarker, putMeta, putLocalMeta, state, streak, course } from "../store";
import { leaderboard, logRecall, currentUser, syncConfigured } from "../sync";
import type { Marker, Note } from "../types";
import { $, agoLong, DAY, dayKey, esc, H, reducedMotion, wrapDeg } from "../util";
import { setPendingOpen, TYPE_INFO } from "../editor/markerBox";

/* The home screen: a morning strip over a spinning dial of notes arranged by when they were last opened.
   Recall plays inside the dial's center while the ring turns to each question's note. */

type Band = { l: string; s: string; max: number; w: number };
const BANDS: Band[] = [
  { l: "Recently opened", s: "last 24 hours", max: DAY, w: 2.6 },
  { l: "This week", s: "1–7 days", max: 7 * DAY, w: 1.9 },
  { l: "This month", s: "1–4 weeks", max: 31 * DAY, w: 1.15 },
  { l: "Last month", s: "1–2 months", max: 62 * DAY, w: 0.75 },
  { l: "This year", s: "2–12 months", max: 365 * DAY, w: 0.55 },
  { l: "Last year", s: "1–2 years", max: 730 * DAY, w: 0.45 },
  { l: "Older", s: "2+ years", max: Infinity, w: 0.4 }
];
const FOLDC: [string, string][] = [["--g1", "#fff"], ["--g2", "#2B1500"], ["--g3", "#2A2100"], ["--g4", "#032E2A"], ["--g5", "#fff"], ["--g6", "#fff"], ["--g7", "#fff"]];
const WMAX = 2.6, GAPDEG = 7, SAMEGAP = 2.5, MAXFILES = 5, LOOSE = 3;

interface Item { b: Band; ns: Note[]; w: number; loose?: boolean; more?: boolean; span: number; ang: number; W: number; x: number; y: number; near: number }
interface Recall { queue: string[]; i: number; revealed: boolean; got: number; done: boolean; k: number }

let items: Item[] = [];
let rot = 0, target = 0, sel = -1, hoverF = -1, hoverNote: string | null = null, dragging = false, lastDrawn: number | null = null, raf = 0;
let G: { c: number; rF: number; hub: number; els: HTMLElement[] } = { c: 0, rF: 0, hub: 0, els: [] };
let R: Recall | null = null;
let focusNote: string | null = null;
let lbOpen = false;
let handlers: { openNote: (id: string) => void; newBlank: () => void; importFile: () => void; openSettings: (section?: string) => void } | null = null;
let alive = false;
const off: (() => void)[] = [];

export const setFocusNote = (id: string | null) => { focusNote = id; };

/* ---------- recall queue ---------- */
const isDue = (m: Marker) => m.due <= Date.now();
const hasDue = (noteId: string) => liveMarkers().some(m => m.noteId === noteId && isDue(m) && recallable(m));
function recallable(m: Marker) {
  if (m.recallOff) return false;
  if (m.type === "link" && !m.text) return false;
  return !!(m.text || m.recallQ || m.thread.some(t => t.role === "marker" && t.text && !t.text.startsWith("⚠")));
}
function curCourseId() {
  const n = note(focusNote) || [...liveNotes()].sort((a, b) => b.openedAt - a.openedAt)[0];
  return n?.courseId || null;
}
function inScope(m: Marker) {
  const age = Date.now() - m.createdAt;
  if (m.type === "reminder" && m.remindAt && m.remindAt <= Date.now()) return true;
  if (state.meta.scope === "due") return true;
  if (state.meta.scope === "night") return age < 36 * H;
  if (state.meta.scope === "week") return age < 7 * DAY;
  return note(m.noteId)?.courseId === curCourseId();
}
const queue = () => liveMarkers().filter(m => isDue(m) && recallable(m) && inScope(m)).sort((a, b) => a.due - b.due).slice(0, 20);
const doneToday = () => state.meta.studyDays.includes(dayKey(Date.now()));

/* ---------- morning strip ---------- */
async function renderMorning() {
  const el = $("#morning");
  if (!el) return;
  const hr = new Date().getHours();
  const greet = (hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + (state.meta.displayName ? `, ${state.meta.displayName.split(" ")[0]}` : "");
  const q = queue(), st = streak();
  const cid = curCourseId();
  const scopeName = { due: "", night: "last night", week: "this week", unit: courseName(cid) }[state.meta.scope];
  const overdue = q.filter(m => m.due < Date.now() - DAY).length;
  const from = scopeName ? ` from ${esc(scopeName)}` : "";
  const wk = [...Array(7)].map((_, i) => { const back = 6 - i, k = dayKey(Date.now() - back * DAY); return `<i class="${state.meta.studyDays.includes(k) ? "on" : ""} ${back === 0 ? "today" : ""}"></i>`; }).join("");
  const c = course(cid);
  el.innerHTML = `<div class="greet"><b>${esc(greet)}</b><span>${q.length ? `${q.length} marker${q.length > 1 ? "s" : ""}${from} to recall${overdue ? ` · ${overdue} overdue` : ""}` : doneToday() ? "Today's recall is done" : `Nothing due${from}`}</span></div>
    <div class="chip streakchip" title="Study streak: days you finished a recall"><b>${st}</b><small>day streak</small><span class="wk" aria-hidden="true">${wk}</span></div>
    <div class="scope" role="group" aria-label="Recall from">${(["due", "night", "week", "unit"] as const).map(s => `<button data-s="${s}" aria-pressed="${s === state.meta.scope}">${{ due: "All due", night: "Last night", week: "Week", unit: "Course" }[s]}</button>`).join("")}</div>
    <button class="recallbtn" id="recallBtn" ${q.length ? "" : "disabled"}>${q.length ? `Start recall <span class="cnt">${q.length}</span>` : "All caught up"}</button>
    <div class="lbwrap" id="lbWrap">${c?.classId && currentUser()
      ? `<button class="chip lbchip" id="lbBtn" aria-expanded="${lbOpen}" aria-controls="lbPop"><b id="lbRank">#–</b><small>in ${esc(c.name)}</small></button><div class="lbpop" id="lbPop" ${lbOpen ? "" : "hidden"}><h3>${esc(c.name)} · this week</h3><div id="lbRows">Loading…</div></div>`
      : `<button class="chip lbchip" id="lbJoin"><small>${syncConfigured() ? "Join a class" : "Classes"}</small></button>`}</div>`;
  el.querySelectorAll<HTMLButtonElement>(".scope button").forEach(b => b.onclick = async () => { await putLocalMeta({ scope: b.dataset.s as "due" }); renderMorning(); });
  $("#recallBtn")!.onclick = startRecall;
  const join = $("#lbJoin");
  if (join) join.onclick = () => handlers?.openSettings("classes");
  const lbBtn = $("#lbBtn");
  if (lbBtn && c?.classId) {
    lbBtn.onclick = e => { e.stopPropagation(); lbOpen = !lbOpen; $("#lbPop")!.hidden = !lbOpen; lbBtn.setAttribute("aria-expanded", String(lbOpen)); };
    const rows = await leaderboard(c.classId);
    if (!alive || !$("#lbRows")) return;
    if (!rows) { $("#lbRows")!.textContent = "Couldn't load the leaderboard."; return; }
    const me = rows.findIndex(r => r.is_me);
    $("#lbRank")!.textContent = me >= 0 ? `#${me + 1}` : "#–";
    $("#lbRows")!.innerHTML = rows.map((r, i) => `<div class="br ${r.is_me ? "me" : ""}"><span class="n">${i + 1}</span><span>${esc(r.display_name)}</span><span class="p">${r.points} pts</span></div>`).join("") + `<div class="note">Points come from recall answers this week.</div>`;
  }
}
function closeLb() {
  if (!lbOpen) return;
  lbOpen = false;
  const p = $("#lbPop");
  if (p) { p.hidden = true; $("#lbBtn")?.setAttribute("aria-expanded", "false"); }
}

/* ---------- Follow a thought: the markers you touched most recently ---------- */
function renderFollow() {
  const el = $("#follow");
  if (!el) return;
  const all = liveMarkers();
  const recent = [...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  if (!recent.length) {
    el.innerHTML = `<div class="followhead"><h2>Follow a thought.</h2></div><p class="followempty">Markers you place show up here, so you can pick a thought back up from anywhere.</p>`;
    return;
  }
  el.innerHTML = `<div class="followhead"><h2>Follow a thought.</h2><span>${all.length} living point${all.length === 1 ? "" : "s"} in your notes</span></div>
    <div class="fcards">${recent.map(m => {
      const n = note(m.noteId);
      const saved = m.thread.filter(t => t.role !== "user").length + (m.draft?.trim() ? 1 : 0);
      return `<button class="fcard" data-m="${m.id}" data-type="${m.type}">
        <span class="fpath"><i class="fdot" data-mastery="${m.mastery}"></i>${esc(courseName(n?.courseId))} / ${esc(n?.title || "")}</span>
        <span class="ftext">${m.text ? esc(m.text.length > 140 ? m.text.slice(0, 140) + "…" : m.text) : `<em>A blank point · ${esc(TYPE_INFO[m.type].label.toLowerCase())}</em>`}</span>
        <span class="fmeta">${saved} saved item${saved === 1 ? "" : "s"} · ${agoLong(m.updatedAt)} · <b>Open marker ↗</b></span></button>`;
    }).join("")}</div>`;
  el.querySelectorAll<HTMLButtonElement>(".fcard").forEach(b => b.onclick = () => {
    const m = state.markers.get(b.dataset.m!);
    if (!m) return;
    setPendingOpen(m.id);
    handlers?.openNote(m.noteId);
  });
}

/* ---------- dial ---------- */
function layout() {
  const notes = liveNotes().sort((a, b) => b.openedAt - a.openedAt);
  const out: Omit<Item, "span" | "ang" | "W" | "x" | "y" | "near">[] = [];
  BANDS.forEach((b, bi) => {
    const lo = bi ? BANDS[bi - 1].max : -Infinity;
    const ns = notes.filter(n => { const age = Date.now() - n.openedAt; return age >= lo && age < b.max; });
    if (!ns.length) return;
    if (bi === 0) {
      ns.slice(0, LOOSE).forEach(n => out.push({ b, ns: [n], w: b.w, loose: true }));
      if (ns.length > LOOSE) out.push({ b, ns: ns.slice(LOOSE), w: 1.25, more: true });
    } else out.push({ b, ns, w: b.w });
  });
  const gaps = out.reduce((t, f, i) => t + (i ? (out[i - 1].b === f.b ? SAMEGAP : GAPDEG) : 0), 0) + GAPDEG;
  const tw = out.reduce((t, f) => t + f.w, 0) || 1, unit = Math.min(70 / WMAX, (360 - gaps) / tw);
  let a = out.length ? -out[0].w * unit / 2 : 0;
  items = out.map((f, i) => {
    if (i) a += out[i - 1].b === f.b ? SAMEGAP : GAPDEG;
    const span = f.w * unit, it: Item = { ...f, span, ang: a + span / 2, W: 0, x: 0, y: 0, near: 0 };
    a += span;
    return it;
  });
}

function itemHTML(f: Item, i: number) {
  const fc = FOLDC[BANDS.indexOf(f.b) % FOLDC.length];
  if (f.loose) {
    const n = f.ns[0], mc = liveMarkers().filter(x => x.noteId === n.id).length;
    return `<div class="folder loose" data-f="${i}" style="--fc:var(${fc[0]})">
      <button class="file solo" data-n="${n.id}" tabindex="-1" style="--c:${courseColor(n.courseId)};--k:0" aria-label="${esc(courseName(n.courseId) + ", " + n.title)}">
        <span class="fc"><span class="dot" style="background:${courseColor(n.courseId)}"></span>${esc(courseName(n.courseId))}</span>
        <span class="ft">${esc(n.title)}</span><span class="fm">${agoLong(n.openedAt)} · ${mc} marker${mc === 1 ? "" : "s"}</span>${hasDue(n.id) ? '<span class="md"></span>' : ""}</button></div>`;
  }
  const show = f.ns.slice(0, MAXFILES), m = show.length;
  return `<div class="folder" data-f="${i}" style="--fc:var(${fc[0]});--ft:${fc[1]}">
    <div class="fback"><span class="ftab"></span></div>
    ${show.map((n, k) => `<button class="file" data-n="${n.id}" tabindex="-1" style="--c:${courseColor(n.courseId)};--k:${k};z-index:${10 + m - k}" aria-label="${esc(courseName(n.courseId) + ", " + n.title)}"><span class="ft">${esc(n.title)}</span><span class="fm">${esc(courseName(n.courseId))} · ${agoLong(n.openedAt)}</span>${hasDue(n.id) ? '<span class="md"></span>' : ""}</button>`).join("")}
    <div class="ffront"><b>${f.more ? `+${f.ns.length} more` : f.b.l}</b><span>${f.more ? "recently opened" : `${f.ns.length} note${f.ns.length > 1 ? "s" : ""}${f.ns.length > MAXFILES ? ` · top ${MAXFILES}` : ""}`}</span></div></div>`;
}

export function renderHome(stage: HTMLElement, h: NonNullable<typeof handlers>, keep = false) {
  handlers = h;
  alive = true;
  layout();
  const prevRot = rot, prevTarget = target;
  stage.innerHTML = `<div class="dialwrap"><div class="morning" id="morning"></div>
    <div id="dial" tabindex="0" role="listbox" aria-label="Your notes, arranged by when you last opened them. Use the arrow keys to spin and Enter to open.">
      <div class="ringline" id="ringline"></div><div id="folders"></div><div class="pointer"></div>
      <div class="hub" id="hub"><svg class="hubprog" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
        <div class="info" id="info" aria-live="polite"></div>
        <div class="hubacts">
          <button class="hbtn" data-act="import" title="Import lecture"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg><span>Import lecture</span></button>
          <button class="hbtn" data-act="blank" title="Blank page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></svg><span>Blank page</span></button></div></div></div>
    <div id="infoSlot"></div>
    <div class="spinrow"><button class="spinbtn" id="spinPrev" aria-label="Spin toward newer notes">←</button><span class="spinhint">Drag or scroll to move through time · select a folder to peek inside</span><button class="spinbtn" id="spinNext" aria-label="Spin toward older notes">→</button></div>
    <section class="follow" id="follow"></section></div>`;
  $("#folders")!.innerHTML = items.map(itemHTML).join("");
  $("#hub")!.querySelectorAll<HTMLButtonElement>(".hbtn").forEach(b => b.onclick = () => (b.dataset.act === "blank" ? h.newBlank() : h.importFile()));
  renderMorning();
  renderFollow();
  $("#spinPrev")!.onclick = () => goTo(sel - 1);
  $("#spinNext")!.onclick = () => goTo(sel + 1);
  sel = -1; hoverF = -1; hoverNote = null;
  sizeDial();
  bindDial();
  if (keep) { rot = prevRot; target = prevTarget; }
  else {
    let k = items.findIndex(f => f.ns.some(n => n.id === focusNote));
    if (k < 0) k = 0;
    target = items.length ? -items[k].ang : 0;
    rot = reducedMotion() ? target : target + 60;
  }
  lastDrawn = null;
  if (R) $("#dial")!.classList.add("recall");
  if (!items.length) $("#info")!.innerHTML = `<div class="infoin"><span class="pill" style="background:var(--g5)">Start here</span><div class="htitle">Import a lecture or start a blank page</div></div>`;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

export function destroyHome() {
  alive = false;
  cancelAnimationFrame(raf);
  off.splice(0).forEach(f => f());
  R = null;
  lbOpen = false;
}

function sizeDial() {
  const st = $("#stage")!, dial = $("#dial");
  if (!dial) return;
  const w = st.clientWidth - 32, h = st.clientHeight - $("#morning")!.offsetHeight - 80;
  const mw = (sz: number) => Math.max(120, Math.min(250, sz * 0.33));
  const rise = (W: number) => (W / 13) * (1.6 + (MAXFILES - 1) * 2) - W * 0.74 * 0.16;
  let size = Math.max(300, Math.min(w, 780));
  if (w >= 560) size = Math.max(320, Math.min(size, h - rise(mw(size)) * 0.5));
  const maxW = mw(size), c = size / 2;
  const rF = c - 10 - maxW * 0.42, hub = Math.max(120, 2 * (rF - maxW * 0.3));
  dial.style.marginTop = Math.max(0, rise(maxW) * 0.5) + "px";
  dial.style.setProperty("--size", size + "px");
  dial.style.setProperty("--hub", hub + "px");
  const ring = $("#ringline")!;
  ring.style.width = ring.style.height = 2 * rF + "px";
  G = { c, rF, hub, els: [...document.querySelectorAll<HTMLElement>("#folders .folder")] };
  items.forEach((f, i) => {
    const arc = rF * f.span * Math.PI / 180;
    f.W = Math.max(64, Math.min(maxW * Math.pow(f.w / WMAX, 0.85), arc * 1.08));
    const el = G.els[i];
    el.style.setProperty("--W", f.W + "px");
    el.classList.toggle("small", f.W < 100);
    el.classList.toggle("mini", f.W < 78);
  });
  const compact = hub < 210, info = $("#info")!;
  if (compact && info.parentElement?.id !== "infoSlot") $("#infoSlot")!.appendChild(info);
  else if (!compact && info.parentElement?.id !== "hub") $("#hub")!.insertBefore(info, $("#hub .hubacts"));
  dial.classList.toggle("tight", hub < 320);
  lastDrawn = null;
}

function draw() {
  const { c, rF } = G;
  let best = 0, bd = 999;
  items.forEach((f, i) => {
    const a = f.ang + rot, d = wrapDeg(a), t = a * Math.PI / 180;
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
    f.x = c + rF * Math.sin(t); f.y = c - rF * Math.cos(t); f.near = Math.max(0, 1 - Math.abs(d) / 90);
  });
  if (best !== sel) { sel = best; updateInfo(); }
  paint();
}
function paint() {
  const rk = R && !R.done ? R.k : -1;
  items.forEach((f, i) => {
    const el = G.els[i];
    if (!el) return;
    const open = rk >= 0 ? i === rk : i === sel || i === hoverF;
    const grow = f.loose ? (open ? 1.06 : 1) : open ? Math.max(1.04, f.W < 150 ? 150 / f.W : 1) : 1;
    const sc = (0.92 + 0.08 * f.near) * grow;
    el.style.transform = `translate(${f.x}px,${f.y}px) translate(-50%,-50%) scale(${sc})`;
    el.style.zIndex = String(i === hoverF ? 400 : open ? 250 : Math.round(100 + f.near * 50));
    el.style.opacity = String(rk >= 0 ? (i === rk ? 1 : 0.28) : open || f.loose ? 1 : (0.7 + 0.3 * f.near).toFixed(2));
    el.classList.toggle("open", open);
  });
}
function loop() {
  if (!alive || !$("#dial")) return;
  if (!dragging) { const d = target - rot; rot = Math.abs(d) < 0.03 ? target : rot + d * (reducedMotion() ? 1 : 0.14); }
  if (rot !== lastDrawn) { draw(); lastDrawn = rot; }
  raf = requestAnimationFrame(loop);
}
const snapFrom = (r: number) => {
  if (!items.length) return r;
  let bk = 0, bd = 999;
  items.forEach((f, k) => { const d = Math.abs(wrapDeg(f.ang + r)); if (d < bd) { bd = d; bk = k; } });
  return r - wrapDeg(items[bk].ang + r);
};
const goTo = (k: number) => { if (!items.length) return; k = ((k % items.length) + items.length) % items.length; target = rot - wrapDeg(items[k].ang + rot); };

function setHc(v: string, el: HTMLElement) { [$("#hub"), el].forEach(x => x?.style.setProperty("--hc", v)); }
function updateInfo() {
  if (R) return;
  const el = $("#info"), fi = hoverF >= 0 ? hoverF : sel, f = items[fi];
  if (!el || !f) return;
  const n = hoverNote ? note(hoverNote) : f.loose ? f.ns[0] : null;
  const fc = FOLDC[BANDS.indexOf(f.b) % FOLDC.length];
  const key = n ? n.id : "f" + fi;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  let html: string;
  if (n) {
    const ms = liveMarkers().filter(m => m.noteId === n.id), due = ms.filter(m => isDue(m) && recallable(m)).length, mastered = ms.filter(m => m.mastery === 2).length;
    const ago = agoLong(n.openedAt), num = (ago.match(/^[\d.]+/) || [""])[0], lab = num ? ago.slice(num.length).trim() : "opened";
    setHc(courseColor(n.courseId), el);
    html = `<span class="band">${esc(f.more ? "More recent" : f.b.l)}</span><span class="pill" style="background:${courseColor(n.courseId)}">${esc(courseName(n.courseId))}</span>
      <div class="htitle">${esc(n.title)}</div>
      <div class="stats"><span class="stat"><b>${num || "Now"}</b>${esc(lab)}</span><span class="stat"><b>${ms.length}</b>marker${ms.length === 1 ? "" : "s"}</span>${ms.length ? `<span class="stat"><b>${mastered}</b>mastered</span>` : ""}${due ? `<span class="stat due"><b>${due}</b>to recall</span>` : ""}</div>
      <button class="openlink">Open note</button>`;
  } else {
    setHc(`var(${fc[0]})`, el);
    const cs = [...new Set(f.ns.map(x => x.courseId))];
    html = `<span class="pill" style="background:var(${fc[0]});color:${fc[1]}">${f.more ? "More recent" : f.b.l}</span>
      <div class="bignum" style="--a:var(${fc[0]})">${f.ns.length}<small>note${f.ns.length > 1 ? "s" : ""}</small></div>
      <div class="cdots">${cs.slice(0, 8).map(c => `<span title="${esc(courseName(c))}" style="background:${courseColor(c)}"></span>`).join("")}<em>${cs.length} course${cs.length > 1 ? "s" : ""}</em></div>
      <button class="openlink">Open newest</button>`;
  }
  el.innerHTML = `<div class="infoin">${html}</div>`;
  el.querySelector<HTMLButtonElement>(".openlink")!.onclick = () => handlers?.openNote((n || f.ns[0]).id);
}

function bindDial() {
  const d = $("#dial")!;
  let last = 0, v = 0, moved = 0, downEl: HTMLElement | null = null, pid: number | null = null;
  const ang = (e: PointerEvent) => { const r = d.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI; };
  d.addEventListener("pointerdown", e => {
    if (e.button > 0 || (e.target as Element).closest(".hub")) return;
    dragging = true; moved = 0; v = 0; last = ang(e);
    downEl = (e.target as Element).closest<HTMLElement>(".file,.folder");
    pid = e.pointerId; d.setPointerCapture(pid); d.classList.add("dragging");
  });
  d.addEventListener("pointermove", e => {
    if (!dragging || e.pointerId !== pid) return;
    const a = ang(e), dd = wrapDeg(a - last);
    rot += dd; target = rot; moved += Math.abs(dd); v = dd * 0.6 + v * 0.4; last = a;
    if (moved > 3 && hoverF >= 0) { hoverF = -1; hoverNote = null; paint(); updateInfo(); }
  });
  const up = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; d.classList.remove("dragging");
    if (moved < 3 && downEl) {
      const fi = Number(downEl.closest<HTMLElement>(".folder")!.dataset.f);
      if (!R && downEl.classList.contains("file") && (fi === sel || fi === hoverF)) handlers?.openNote(downEl.dataset.n!);
      else goTo(fi);
    } else target = snapFrom(rot + (reducedMotion() ? 0 : v * 9));
  };
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
  const folders = $("#folders")!;
  folders.addEventListener("pointerover", e => {
    if (dragging || e.pointerType === "touch" || R) return;
    const fo = (e.target as Element).closest<HTMLElement>(".folder"), fl = (e.target as Element).closest<HTMLElement>(".file");
    const fi = fo ? Number(fo.dataset.f) : -1, nn = fl ? fl.dataset.n! : null;
    if (fi !== hoverF || nn !== hoverNote) { hoverF = fi; hoverNote = nn; paint(); updateInfo(); }
  });
  folders.addEventListener("pointerleave", () => { if (hoverF !== -1) { hoverF = -1; hoverNote = null; paint(); updateInfo(); } });
  let acc = 0;
  d.addEventListener("wheel", e => { e.preventDefault(); acc += e.deltaY + e.deltaX; if (Math.abs(acc) > 50) { goTo(sel + Math.sign(acc)); acc = 0; } }, { passive: false });
  d.addEventListener("keydown", e => {
    if (e.target !== d) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goTo(sel + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goTo(sel - 1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(items.length - 1); }
    else if (e.key === "Enter" && !R && items[sel]) { e.preventDefault(); handlers?.openNote(items[sel].ns[0].id); }
  });
}

/* ---------- recall in the hub ---------- */
function startRecall() {
  const q = queue();
  if (!q.length) return;
  closeLb();
  R = { queue: q.map(m => m.id), i: 0, revealed: false, got: 0, done: false, k: -1 };
  hoverF = -1; hoverNote = null;
  $("#dial")!.classList.add("recall");
  showRecall();
}
function setProg() {
  const c = document.querySelector<SVGCircleElement>(".hubprog circle");
  if (c && R) c.style.strokeDashoffset = String(100 - 100 * (R.done ? 1 : R.i / R.queue.length));
}
function recallText(m: Marker) {
  const lastReply = [...m.thread].reverse().find(t => t.role === "marker" && t.text && !t.text.startsWith("⚠") && !/^(Formatted|This marker will|Linked to)/.test(t.text));
  const q = m.recallQ || (m.text ? `What does this mean, in your own words? “${m.text.length > 140 ? m.text.slice(0, 140) + "…" : m.text}”` : `What did you write here about ${note(m.noteId)?.title || "this note"}?`);
  const a = m.recallA || lastReply?.text.replace(/[#*_`>-]/g, "").slice(0, 400) || m.text || "Check the note.";
  return { q, a };
}
function showRecall() {
  const el = $("#info");
  if (!el || !R) return;
  el.dataset.key = "";
  if (R.done) return showDone();
  const m = state.markers.get(R.queue[R.i]);
  const n = m ? note(m.noteId) : undefined;
  if (!m || !n) { R.i++; if (R.i >= R.queue.length) R.done = true; return showRecall(); }
  R.k = items.findIndex(f => f.ns.some(x => x.id === m.noteId));
  if (R.k >= 0) goTo(R.k);
  setHc(courseColor(n.courseId), el);
  const { q, a } = recallText(m);
  el.innerHTML = `<div class="infoin"><div class="rtop"><span class="pill" style="background:${courseColor(n.courseId)}">Recall ${R.i + 1} of ${R.queue.length}</span><button class="rx" aria-label="End recall" title="End recall">×</button></div>
    <div class="rq">${esc(q)}</div><div class="rsrc">${esc(courseName(n.courseId))} · ${esc(n.title)}</div>
    ${R.revealed ? `<div class="ra">${esc(a)}</div><div class="racts"><button class="again">Again</button><button class="got">Got it</button></div>` : `<button class="openlink" id="reveal">Show answer</button>`}</div>`;
  el.querySelector<HTMLButtonElement>(".rx")!.onclick = endRecall;
  if (R.revealed) {
    el.querySelector<HTMLButtonElement>(".again")!.onclick = () => grade(m, false);
    const got = el.querySelector<HTMLButtonElement>(".got")!;
    got.onclick = () => grade(m, true);
    got.focus({ preventScroll: true });
  } else {
    const b = $("#reveal")!;
    b.onclick = () => { R!.revealed = true; showRecall(); };
    b.focus({ preventScroll: true });
  }
  setProg();
  paint();
}
async function grade(m0: Marker, good: boolean) {
  if (!R) return;
  const m = state.markers.get(m0.id) || m0; // latest copy, in case it was edited since the question was shown
  const ivl = good ? Math.max(1, (m.ivl || 1) * 2.5) : 1;
  const mastery = (good ? Math.min(2, m.mastery + 1) : Math.max(0, m.mastery - 1)) as Marker["mastery"];
  await putMarker({ ...m, ivl, mastery, due: Date.now() + (good ? ivl * DAY : 10 * 60 * 1000), type: m.type === "reminder" ? "question" : m.type, remindAt: m.type === "reminder" ? null : m.remindAt });
  const pts = good ? 10 : 3;
  await putMeta({ points: state.meta.points + pts });
  logRecall(course(note(m.noteId)?.courseId)?.classId, m.id, good);
  if (good) R.got++;
  R.i++;
  R.revealed = false;
  if (R.i >= R.queue.length) {
    R.done = true;
    if (!doneToday()) await putMeta({ studyDays: [...state.meta.studyDays, dayKey(Date.now())] });
  }
  showRecall();
}
function showDone() {
  const el = $("#info")!;
  setHc("var(--g1)", el);
  const cols = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6", "--g7"], s = streak();
  el.innerHTML = `<div class="infoin"><div class="burst" aria-hidden="true">${[...Array(14)].map((_, i) => { const a = (i / 14) * Math.PI * 2, r = 60 + (i % 3) * 18; return `<i style="background:var(${cols[i % 7]});--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px"></i>`; }).join("")}</div>
    <span class="pill" style="background:var(--g1)">Recall done</span><div class="donebig">${s} day${s === 1 ? "" : "s"}</div>
    <div class="rsrc">${R!.got} of ${R!.queue.length} right · streak kept</div><button class="openlink" id="doneBtn">Back to notes</button></div>`;
  $("#doneBtn")!.onclick = endRecall;
  $("#doneBtn")!.focus({ preventScroll: true });
  setProg();
  paint();
  renderMorning();
}
function endRecall() {
  if (!R) return;
  R = null;
  const d = $("#dial");
  if (d && handlers) { d.classList.remove("recall"); renderHome($("#stage")!, handlers, true); }
}

/* ---------- global listeners (installed once) ---------- */
let installed = false;
export function installHomeListeners() {
  if (installed) return;
  installed = true;
  addEventListener("resize", () => { if (alive && $("#dial")) { sizeDial(); lastDrawn = null; } });
  document.addEventListener("pointerdown", e => { if (lbOpen && !(e.target as Element).closest(".lbwrap")) closeLb(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !alive) return;
    if (lbOpen) { closeLb(); return; }
    if (R) endRecall();
  });
}
export const homeAlive = () => alive;
export const inRecall = () => !!R;

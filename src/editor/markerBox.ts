import { aiHealth, askMarker, evaluate, localIntent, type LocalAction } from "../ai";
import { mdToHtml } from "../md";
import { courseName, liveMarkers, liveNotes, newMarker, newNote, note, putMarker, putNote, state } from "../store";
import type { Marker, MarkerType, Mastery, ThreadMsg } from "../types";
import { $, agoLong, armButton, DAY, debounce, esc, toast } from "../util";
import { repaintAll } from "./extensions";
import { applyFormat, contextAround, insertOutput, removeMarkerFromDoc, restoreOutput, scrollToOutput } from "./ops";

/* The marker workspace: everything a marker can do, in one large panel anchored to its passage.
   Write · Ask · Expand · Calculate · Related · Recall. Ask also takes plain-word commands. */

export const TYPE_INFO: Record<MarkerType, { label: string; hint: string }> = {
  note: { label: "Writing", hint: "Your own words or drafted notes" },
  question: { label: "Question", hint: "Something you're unsure about" },
  explain: { label: "Explanation", hint: "Explained or expanded" },
  math: { label: "Math", hint: "Calculated by a math engine" },
  visual: { label: "Visual", hint: "A diagram" },
  link: { label: "Link", hint: "Connected to other points" },
  reminder: { label: "Reminder", hint: "Comes back for review" }
};
type Tab = "write" | "ask" | "expand" | "calc" | "related" | "recall";
const TABS: [Tab, string][] = [["write", "Write"], ["ask", "Ask"], ["expand", "Expand"], ["calc", "Calculate"], ["related", "Related"], ["recall", "Recall"]];
const MASTERY = ["Unsure", "Getting it", "Mastered"];

let ws: HTMLElement | null = null;
let current: Marker | null = null;
let tab: Tab = "ask";
let busy = false;
let aiOn: boolean | null = null;
let pendingOpen: string | null = null;
let lastCalc = "";
let reopenTab: Tab | null = null; // shown at the top of the Calculate tab after a run
let openNoteFn: (id: string) => void = () => {};
export const setOpenNote = (fn: (id: string) => void) => { openNoteFn = fn; };
export const boxOpen = () => !!ws;
export const takePendingOpen = () => { const p = pendingOpen; pendingOpen = null; return p; };
function takeReopenTab() { const t = reopenTab; reopenTab = null; return t; }
export const setPendingOpen = (id: string) => { pendingOpen = id; };
aiHealth().then(h => { aiOn = h.ai; if (ws) render(); });

export function closeBox() {
  saveDraft.flush();
  if (ws) {
    const el = ws;
    el.classList.add("closing");
    setTimeout(() => el.remove(), 160);
  }
  ws = null;
  current = null;
  document.body.classList.remove("ws-open");
}

export function openBox(id: string, anchorEl?: Element | null, startTab?: Tab) {
  const m = state.markers.get(id);
  if (!m) return;
  if (ws && current?.id === id) { if (startTab) { tab = startTab; render(); } return; }
  closeBox();
  current = m;
  lastCalc = "";
  moved = false;
  tab = startTab || takeReopenTab() || (!m.text ? "write" : m.thread.length || m.type !== "question" ? "ask" : "ask");
  ws = document.createElement("aside");
  ws.className = "mws";
  ws.setAttribute("role", "dialog");
  ws.setAttribute("aria-label", "Marker workspace");
  document.body.appendChild(ws);
  document.body.classList.add("ws-open");
  render();
  revealPin(id);
  placeCard(anchorEl && anchorEl.isConnected ? anchorEl : pinEl(id));
  // on phones, focusing a field would pop the keyboard over the note; let the student tap in when ready
  if (matchMedia("(pointer: fine)").matches) setTimeout(() => (ws?.querySelector<HTMLElement>("[data-autofocus]"))?.focus({ preventScroll: true }), 40);
}

/* ---------- the card: opens out of its marker, floats over the page, can be dragged by its header ---------- */
const pinEl = (id: string) => document.querySelector<HTMLElement>(`#editor .pin[data-pin="${CSS.escape(id)}"]`);
let moved = false; // the student dragged the card; keep it where they put it

/** Open as a compact card right next to the marker that was tapped: beside it if there's room, otherwise just below
    or above it. Same behavior at every screen size; never a sheet glued to an edge. */
function placeCard(anchor: Element | null) {
  if (!ws) return;
  const vw = innerWidth, vh = innerHeight, top0 = 64, gap = 14, edge = 12;
  const W = Math.min(440, vw - edge * 2);
  let H = Math.min(560, vh - top0 - edge * 2);
  let left: number, top: number;
  let a = anchor?.getBoundingClientRect();
  if (a && W > vw - 2 * edge - 60) {
    // narrow screen: the card goes below or above the marker; make room by scrolling the marker up if needed
    const below = vh - a.bottom - gap - edge, above = a.top - gap - top0;
    if (below < 300 && above < 300) {
      document.getElementById("stage")?.scrollBy({ top: a.top - (top0 + 70) });
      a = anchor!.getBoundingClientRect();
    }
  }
  if (!a) { left = (vw - W) / 2; top = top0 + 16; }
  else {
    const cx = a.left + a.width / 2;
    if (a.right + gap + W <= vw - edge) { left = a.right + gap; top = a.top - 56; }
    else if (a.left - gap - W >= edge) { left = a.left - gap - W; top = a.top - 56; }
    else {
      left = cx - W / 2;
      const below = vh - a.bottom - gap - edge, above = a.top - gap - top0;
      if (below >= Math.min(H, 360) || below >= above) { top = a.bottom + gap; H = Math.min(H, below); }
      else { H = Math.min(H, above); top = a.top - gap - H; }
    }
    left = Math.min(Math.max(left, edge), vw - W - edge);
    top = Math.min(Math.max(top, top0), vh - H - edge);
  }
  H = Math.max(260, H);
  Object.assign(ws.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${Math.round(W)}px`, height: `${Math.round(H)}px` });
  if (a) ws.style.transformOrigin = `${Math.round(a.left + a.width / 2 - left)}px ${Math.round(a.top + a.height / 2 - top)}px`;
}
function clampCard() {
  if (!ws) return;
  const r = ws.getBoundingClientRect();
  ws.style.left = `${Math.min(Math.max(r.left, 8), innerWidth - r.width - 8)}px`;
  ws.style.top = `${Math.min(Math.max(r.top, 56), innerHeight - 80)}px`;
}
addEventListener("resize", () => { if (!ws || !current) return; if (moved) clampCard(); else placeCard(pinEl(current.id)); });

/** Drag the card by its grab bar or header, with mouse, pen or touch. */
function bindDrag() {
  if (!ws) return;
  ws.querySelectorAll<HTMLElement>(".wsgrab, .wshead").forEach(h => {
    h.onpointerdown = e => {
      if (!ws || (e.target as Element).closest("button:not(.wsgrab)")) return;
      e.preventDefault();
      const r = ws.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      h.setPointerCapture(e.pointerId);
      ws.classList.add("dragging");
      h.onpointermove = ev => {
        if (!ws) return;
        moved = true;
        ws.style.left = `${Math.min(Math.max(r.left + ev.clientX - sx, 8 - r.width * 0.5), innerWidth - r.width * 0.5)}px`;
        ws.style.top = `${Math.min(Math.max(r.top + ev.clientY - sy, 56), innerHeight - 60)}px`;
      };
      h.onpointerup = h.onpointercancel = () => { h.onpointermove = null; ws?.classList.remove("dragging"); };
    };
  });
}

/** The card is placed beside the marker, so only make sure the marker itself is on screen. */
function revealPin(id: string) {
  const el = pinEl(id);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: "center" });
}
const isFree = (id: string) => !!document.querySelector(`#editor .pin.free[data-pin="${CSS.escape(id)}"]`);

/* ---------- shared bits ---------- */
/** Write to one specific marker, merged into its latest stored copy (never a stale snapshot). */
async function updateMarker(id: string, patch: Partial<Marker>, rerender = true) {
  const base = state.markers.get(id) || (current?.id === id ? current : null);
  if (!base) return;
  const next = { ...base, ...patch };
  await putMarker(next);
  repaintAll();
  if (current?.id === id) { current = next; if (rerender) render(); }
}
const update = (patch: Partial<Marker>, rerender = true) => (current ? updateMarker(current.id, patch, rerender) : Promise.resolve());
const msg = (role: ThreadMsg["role"], text: string, extra: Partial<ThreadMsg> = {}): ThreadMsg => ({ role, text, at: Date.now(), ...extra });

function threadHTML(items: [ThreadMsg, number][]) {
  if (!items.length) return "";
  return `<div class="wsthread">${items.map(([t, i]) => {
    if (t.role === "user") return `<div class="tq">${esc(t.text)}</div>`;
    const calc = t.calc ? `<div class="mcalc"><code>${esc(t.calc)}</code> = <b>${esc(t.result ?? "…")}</b></div>` : "";
    const body = t.text ? `<div class="mmd">${mdToHtml(t.text)}</div>` : "";
    const who = t.role === "self" ? `<span class="who">Your answer</span>` : "";
    const act = t.inserted ? `<span class="mnote">In your note</span>` : (t.text || t.calc) && !t.text.startsWith("⚠") ? `<button class="mlink" data-add="${i}">Add to note ↗</button>` : "";
    return `<div class="ta ${t.role}">${who}${body}${calc}${act}</div>`;
  }).join("")}${busy ? `<div class="ta thinking"><i></i><i></i><i></i></div>` : ""}</div>`;
}

function render() {
  if (!ws || !current) return;
  const m = current;
  const n = note(m.noteId);
  const linkCount = (m.links || []).length + (m.linkNoteId ? 1 : 0);
  ws.dataset.type = m.type;
  ws.innerHTML = `
    <button class="wsgrab" id="mGrab" aria-label="Drag to move" title="Drag to move"><i></i></button>
    <div class="wshead">
      <span class="eyebrow"><i class="tdot"></i>Marker workspace · ${TYPE_INFO[m.type].label}</span>
      <button class="mx" id="mClose" aria-label="Close marker">×</button>
    </div>
    <div class="wsanchor">
      ${m.text ? `<blockquote>${esc(m.text)}</blockquote>` : `<blockquote class="blank">${isFree(m.id) ? "A free point on your page." : "A blank point in your note."} Write, draft or generate here.</blockquote>`}
      <div class="wsmeta"><span>Anchored in ${esc(n?.title || "this note")}</span><span>${esc(courseName(n?.courseId))}</span><span>Placed ${agoLong(m.createdAt)}</span></div>
      <div class="wschips"><span class="chipm" data-mastery="${m.mastery}"><i></i>${MASTERY[m.mastery]}</span>${m.recallOff ? `<span class="chipm off">Not in recall</span>` : `<span class="chipm">Review ${m.due <= Date.now() ? "due now" : new Date(m.due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>`}${linkCount ? `<span class="chipm">${linkCount} link${linkCount > 1 ? "s" : ""}</span>` : ""}</div>
    </div>
    <nav class="wstabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</nav>
    <div class="wsbody" id="wsBody" role="tabpanel">${body()}</div>
    <div class="wsfoot">
      <span class="saved"><i></i>Autosaved with this note</span>
      <button class="more" id="mMore" aria-label="More marker options" aria-expanded="false">•••</button>
      <div class="moremenu" id="mMenu" hidden>
        <div class="mmlabel">Marker type</div>
        ${(Object.keys(TYPE_INFO) as MarkerType[]).map(t => `<button data-t="${t}" data-type="${t}" class="${t === m.type ? "on" : ""}"><i class="tdot"></i>${TYPE_INFO[t].label}<small>${TYPE_INFO[t].hint}</small></button>`).join("")}
        <button class="danger" id="mDel">Remove marker</button>
      </div>
    </div>`;
  bindCommon();
  bindTab();
}

function bindCommon() {
  if (!ws || !current) return;
  $("#mClose", ws)!.onclick = closeBox;
  bindDrag();
  ws.querySelectorAll<HTMLButtonElement>(".wstabs button").forEach(b => b.onclick = () => { saveDraft.flush(); tab = b.dataset.tab as Tab; render(); });
  ws.querySelector<HTMLElement>(".wstabs")!.onkeydown = e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex(t => t[0] === tab), j = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    tab = TABS[j][0]; render(); ws?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
  };
  const more = $("#mMore", ws)!, menu = $("#mMenu", ws)!;
  more.onclick = () => { menu.hidden = !menu.hidden; more.setAttribute("aria-expanded", String(!menu.hidden)); };
  menu.querySelectorAll<HTMLButtonElement>("[data-t]").forEach(b => b.onclick = () => update({ type: b.dataset.t as MarkerType }));
  const id = current.id;
  armButton($("#mDel", ws)!, "Remove marker", "Tap again to remove", () => { closeBox(); removeMarkerFromDoc(id); toast("Marker removed. Undo with Ctrl/⌘ Z."); });
  ws.querySelectorAll<HTMLButtonElement>("[data-add]").forEach(b => b.onclick = () => addToNote(Number(b.dataset.add)));
}

/* ---------- tab bodies ---------- */
function body(): string {
  const m = current!;
  const aiBanner = (on: string, off: string) => `<div class="wsnote ${aiOn ? "" : "off"}">${aiOn ? on : off}</div>`;
  switch (tab) {
    case "write": {
      const kept = m.thread.map((t, i) => [t, i] as [ThreadMsg, number]).filter(([t]) => t.role === "self" && t.text.startsWith("✎"));
      return `<h3>Think here. Keep the page clear.</h3><p class="sub">Draft, outline, or collect a thought inside this point.</p>
        <textarea id="wDraft" data-autofocus rows="7" placeholder="What do you want to add here?">${esc(m.draft || "")}</textarea>
        <div class="tchips"><button data-tpl="outline">+ Outline</button><button data-tpl="check">+ Checklist</button><button data-tpl="example">+ Worked example</button><button data-tpl="def">+ Definition</button></div>
        <div class="wsrow"><button class="btn2" id="wKeep">Keep in marker</button><button class="btn1" id="wInsert">Insert into note ↗</button></div>
        <button class="textlink" id="wNew">↗ Turn this draft into a new note</button>
        ${kept.length ? `<div class="wslabel">Kept in this marker</div>${threadHTML(kept.map(([t, i]) => [{ ...t, text: t.text.replace(/^✎\s*/, "") }, i]))}` : ""}
        ${writtenHTML(m)}`;
    }
    case "ask": {
      const items = m.thread.map((t, i) => [t, i] as [ThreadMsg, number]).filter(([t]) => !(t.role === "self" && t.text.startsWith("✎")));
      const ctx = contextAround(m.id);
      return `${threadHTML(items)}
        ${aiOn === false ? `<div class="wsnote off">AI is not connected. Save a question and work through your own answer. Commands like "make this a list", "remind me Friday" or "link to …" still work.</div>` : ""}
        <div class="tchips sugg ${items.length ? "compact" : ""}">${contextActions(m).map(s => `<button data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        <form id="aForm" class="askform">
          <textarea id="mIn" data-autofocus rows="3" maxlength="600" placeholder="${m.text ? "Ask about this point, or tell the marker what to do…" : "Draft, outline, summarize, calculate…"}" ${busy ? "disabled" : ""}></textarea>
          ${aiOn === false ? `<textarea id="aSelf" rows="3" placeholder="Your answer or reasoning (optional)…"></textarea><button class="btn1" id="aGo">Save question + answer</button>` : `<button class="btn1" id="aGo" ${busy ? "disabled" : ""}>Ask ↵</button>`}
        </form>
        <details class="src"><summary>Read surrounding source</summary><p>${esc(ctx.before.slice(-500))} <mark>${esc(m.text || "[this point]")}</mark> ${esc(ctx.after.slice(0, 500))}</p></details>`;
    }
    case "expand":
      return `<h3>Turn a point into a page.</h3><p class="sub">Create an editable scaffold from this marker's source and saved work.</p>
        ${aiBanner("Written into your note under this point, tinted until you keep it.", "Local templates · these organize your material, without generating AI explanations.")}
        <div class="cards">
          <button class="card" data-x="study"><span class="ic">✦</span><span><b>Study note</b><small>Source → explanation → example</small></span><span class="go">↗</span></button>
          <button class="card" data-x="outline"><span class="ic">≡</span><span><b>Outline</b><small>Structure your next section</small></span><span class="go">↗</span></button>
          <button class="card" data-x="collect"><span class="ic">↳</span><span><b>Collect marker work</b><small>Bring your saved thoughts together</small></span><span class="go">↗</span></button>
          ${aiOn ? `<button class="card" data-x="diagram"><span class="ic">◇</span><span><b>Diagram</b><small>Draw how this works</small></span><span class="go">↗</span></button>` : ""}
        </div>`;
    case "calc": {
      const calcs = m.thread.map((t, i) => [t, i] as [ThreadMsg, number]).filter(([t]) => t.calc);
      const guess = (m.text.match(/-?[\d.]+\s*[-+*/^×÷]\s*-?[\d.]+(\s*[-+*/^×÷]\s*-?[\d.]+)*/) || [""])[0];
      return `<h3>Work it out precisely.</h3><p class="sub">A math engine does the arithmetic with 64 significant digits, so the answer is computed, not guessed. Units work too: <code>23.4 mL * 0.1 mol/L</code>, <code>5 kg to lb</code>.</p>
        <form id="cForm" class="wsrow"><input id="cIn" data-autofocus class="code" value="${esc(guess)}" placeholder="e.g. e^0.5 * 0.5^4 / 4!" maxlength="300"><button class="btn1">Run</button></form>
        <div class="result" id="cOut">${lastCalc}</div>
        ${calcs.length ? `<div class="wslabel">Worked in this marker</div>${threadHTML(calcs)}` : ""}`;
    }
    case "related": {
      const linked = (m.links || []).map(id => state.markers.get(id)).filter((x): x is Marker => !!x && !x.deleted);
      const ln = m.linkNoteId ? note(m.linkNoteId) : null;
      const sugg = suggestMarkers(m);
      const others = liveMarkers().filter(x => x.id !== m.id && !(m.links || []).includes(x.id) && x.text);
      const groups = new Map<string, Marker[]>();
      others.forEach(x => { const t = note(x.noteId)?.title || "Note"; groups.set(t, [...(groups.get(t) || []), x]); });
      const opt = (x: Marker) => `<option value="${x.id}">${esc(x.text.slice(0, 70))}${x.text.length > 70 ? "…" : ""}</option>`;
      return `<h3>Connect the dots.</h3><p class="sub">Link another marker, including one in a different note.</p>
        <label class="wslabel" for="rSel">Choose a marker</label>
        <select id="rSel" data-autofocus><option value="">Select a marker…</option>
          ${sugg.length ? `<optgroup label="Suggested">${sugg.map(opt).join("")}</optgroup>` : ""}
          ${[...groups].map(([t, xs]) => `<optgroup label="${esc(t)}">${xs.map(opt).join("")}</optgroup>`).join("")}</select>
        <button class="btn1" id="rLink">Link to this point</button>
        <p class="sub small">Suggestions use shared words in your notes.</p>
        ${(m.links || []).length ? `<button class="card guide" id="rGuide"><span class="ic">✦</span><span><b>Build a study guide</b><small>Combine ${connectedMarkers(m).length} connected points into one note, with links back to each</small></span><span class="go">↗</span></button>` : ""}
        ${linked.length || ln ? `<div class="wslabel">Linked</div><div class="links">${linked.map(x => `<div class="lrow"><button class="lopen" data-m="${x.id}"><b>${esc(x.text.slice(0, 80))}</b><small>${esc(note(x.noteId)?.title || "")}</small></button><button class="lx" data-unlink="${x.id}" aria-label="Unlink">×</button></div>`).join("")}${ln ? `<div class="lrow"><button class="lopen" data-note="${ln.id}"><b>${esc(ln.title)}</b><small>Whole note</small></button><button class="lx" data-unlinknote aria-label="Unlink">×</button></div>` : ""}</div>` : ""}
        ${relatedNotesHTML(m)}`;
    }
    case "recall": {
      const q = m.recallQ || (m.text ? `What does this mean, in your own words?` : "");
      const a = m.recallA || m.text;
      return `<h3>Give this thought another day.</h3><p class="sub">Choose what you want to remember. Review stays connected to its source.</p>
        ${m.passageEditedAt && m.recallQ ? `<div class="wsnote">The marked words changed since this question was written. Check that it still fits${aiOn ? ", or rewrite it with AI below" : ""}.</div>` : ""}
        <label class="check"><input type="checkbox" id="rcOn" ${m.recallOff ? "" : "checked"}> Include this marker in daily recall</label>
        <label class="wslabel" for="rcQ">Question</label><textarea id="rcQ" rows="2" data-autofocus>${esc(q)}</textarea>
        <label class="wslabel" for="rcA">Answer to reveal</label><textarea id="rcA" rows="3">${esc(a)}</textarea>
        ${aiOn ? `<button class="textlink" id="rcGen">✦ Write a better question with AI</button>` : ""}
        <div class="wslabel">How well you know it</div>
        <div class="mastery" role="group" aria-label="How well you know this">${MASTERY.map((l, i) => `<button data-m="${i}" aria-pressed="${m.mastery === i}">${l}</button>`).join("")}</div>
        <div class="wslabel">Next review: ${m.due <= Date.now() ? "due now" : new Date(m.due).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
        <div class="tchips"><button data-in="1">Tomorrow</button><button data-in="3">In 3 days</button><button data-in="7">Next week</button><button data-in="0">Now</button></div>`;
    }
  }
}

/** What this marker has written into the note, each with its saved versions. */
function writtenHTML(m: Marker) {
  const outs = Object.entries(m.outputs || {}).filter(([oid]) => document.querySelector(`#editor .mout[data-oid="${CSS.escape(oid)}"]`));
  if (!outs.length) return "";
  return `<div class="wslabel">Written into this note</div><div class="written">${outs.map(([oid, revs]) => {
    const last = revs[revs.length - 1];
    return `<div class="wout"><button class="wjump" data-jump="${oid}"><b>${esc(last.text.slice(0, 120))}${last.text.length > 120 ? "…" : ""}</b><small>${revs.length} version${revs.length > 1 ? "s" : ""} · last ${agoLong(last.at)}</small></button>
      ${revs.length > 1 ? `<details class="wrevs"><summary>History</summary>${[...revs].reverse().map((r, i) => `<div class="wrev"><span><small>${i === 0 ? "Current" : new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>${esc(r.text.slice(0, 160))}${r.text.length > 160 ? "…" : ""}</span>${i === 0 ? "" : `<button class="btn2 small" data-restore="${oid}" data-rev="${revs.length - 1 - i}">Restore</button>`}</div>`).join("")}</details>` : ""}</div>`;
  }).join("")}</div>`;
}

/** Shortcuts that fit the marked content: math gets steps and checks, definitions get flashcards, processes get steps, and so on. */
export function contextActions(m: Marker): string[] {
  const t = m.text.trim();
  if (!t) return ["Outline this topic", "Summarize this note", "Make a checklist from this note", "Quiz me on this note"];
  const a: string[] = [];
  const mathy = /[=^√Σ∫≤≥±]|\d\s*[-+*/×÷]\s*\d|\b(equation|formula|derivative|integral|series|limit|matrix|probability)\b/i.test(t);
  const code = /[{};]\s*$|=>|\b(function|return|class|def|for\s*\(|while\s*\()\b/.test(t);
  if (code) a.push("Explain this code line by line", "What does this output?");
  if (mathy && !code) a.push("Show the steps", "Try it with numbers", "Explain each symbol");
  if (/\b(is|are|means|refers to|defined as|called)\b/i.test(t) && t.length < 240) a.push("Make a flashcard", "Give a counterexample");
  if (/\b(first|then|next|finally|steps?|process|stages?|cycle|phases?|pathway)\b/i.test(t)) a.push("Turn into numbered steps", "Draw the process");
  if (/\b(1[5-9]\d{2}|20\d{2})\b|\b(century|war|era|revolution|dynasty|treaty)\b/i.test(t)) a.push("Put this on a timeline");
  if (/\b(vs\.?|versus|compared|unlike|whereas|differs?)\b/i.test(t)) a.push("Compare in a table");
  if (/\b(because|causes?|leads? to|results? in|so that|therefore)\b/i.test(t)) a.push("Why does this happen?");
  if (/\?\s*$/.test(t)) a.push("Answer this");
  if (t.length > 280) a.push("Summarize in one sentence");
  a.push("Explain this simpler", "Give me an example", "Quiz me on this");
  return [...new Set(a)].slice(0, 6);
}

/** Every marker reachable through links from this one (including itself), nearest first. */
function connectedMarkers(m: Marker, max = 15) {
  const seen = new Set([m.id]), out: Marker[] = [m], queue = [m];
  while (queue.length && out.length < max) {
    const cur = queue.shift()!;
    for (const id of cur.links || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const x = state.markers.get(id);
      if (!x || x.deleted || !note(x.noteId) || note(x.noteId)!.deleted) continue;
      out.push(x);
      queue.push(x);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Combine connected points into a new study-guide note. Each section is a marker linked back to its source point. */
async function buildStudyGuide(m: Marker) {
  const points = connectedMarkers(m);
  if (points.length < 2) return toast("Link this marker to at least one other point first.");
  const src = note(m.noteId);
  const title = `Study guide: ${(m.text || src?.title || "connected points").slice(0, 70)}`;
  const guide = await newNote(src?.courseId || "", title, "blank", "<p></p>");
  const sections: { mk: Marker; html: string }[] = [];
  for (const p of points) {
    const pn = note(p.noteId);
    const back = newMarker(guide.id, p.text || pn?.title || "A point", "link");
    back.links = [p.id];
    back.recallQ = p.recallQ || null;
    back.recallA = p.recallA || null;
    const answers = p.thread.filter(t => t.role !== "user" && (t.text || t.calc) && !t.text.startsWith("⚠") && !/^(Formatted|This marker will|Linked to)/.test(t.text)).slice(-2)
      .map(t => (t.calc ? `<p><code>${esc(t.calc)}</code> = <strong>${esc(t.result || "")}</strong></p>` : mdToHtml(t.text.replace(/^✎\s*/, ""))));
    const body = [
      p.recallQ ? `<p><strong>Q:</strong> ${esc(p.recallQ)}</p>${p.recallA ? `<p><strong>A:</strong> ${esc(p.recallA)}</p>` : ""}` : "",
      ...answers,
      p.draft?.trim() ? mdToHtml(p.draft) : "",
      `<p><em>From ${esc(pn?.title || "a note")} · ${esc(courseName(pn?.courseId))}</em></p>`
    ].join("");
    sections.push({ mk: back, html: `<h3><span data-marker="${back.id}">${esc((p.text || pn?.title || "A point").slice(0, 160))}</span><span data-pin="${back.id}"></span></h3>${body}` });
  }
  let intro = `<p>${points.length} connected points from ${[...new Set(points.map(p => note(p.noteId)?.title))].map(t => esc(t || "")).join(", ")}. Each heading's marker links back to where the point came from.</p>`;
  if (aiOn) {
    try {
      const all = points.map(p => `- ${p.text || note(p.noteId)?.title}${p.recallA ? ` (${p.recallA})` : ""}`).join("\n");
      const r = await askMarker({ intent: "Write a short overview (under 120 words) of how these points connect, as the opening of a study guide.", passage: "", before: "", after: "", note: all, title, course: courseName(src?.courseId), thread: [] });
      if (r.markdown) intro = mdToHtml(r.markdown) + intro;
    } catch { /* the guide still works without the overview */ }
  }
  for (const sct of sections) { state.markers.set(sct.mk.id, sct.mk); await putMarker(sct.mk); }
  for (const p of points) {
    const back = sections.find(x => x.mk.links?.[0] === p.id)!.mk;
    const latest = state.markers.get(p.id)!;
    await putMarker({ ...latest, links: [...new Set([...(latest.links || []), back.id])] });
  }
  const html = `<h2>${esc(title)}</h2>${intro}${sections.map(x => x.html).join("")}`;
  await putNote({ ...guide, html, plain: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  closeBox();
  openNoteFn(guide.id);
  toast("Study guide created. Each section links back to its point.");
}

function suggestMarkers(m: Marker) {
  const words = new Set((m.text + " " + (m.draft || "")).toLowerCase().match(/[a-z]{5,}/g) || []);
  if (!words.size) return [];
  return liveMarkers().filter(x => x.id !== m.id && x.text && !(m.links || []).includes(x.id))
    .map(x => ({ x, s: (x.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter(w => words.has(w)).length }))
    .filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 5).map(r => r.x);
}
function relatedNotesHTML(m: Marker) {
  const words = (m.text || note(m.noteId)?.title || "").toLowerCase().match(/[a-z0-9]{5,}/g) || [];
  const hits = liveNotes().filter(n => n.id !== m.noteId).map(n => {
    const hay = (n.title + " " + n.plain).toLowerCase();
    return { n, s: words.filter(w => hay.includes(w)).length };
  }).filter(h => h.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  if (!hits.length) return "";
  return `<div class="wslabel">Notes that mention this</div><div class="links">${hits.map(h => `<div class="lrow"><button class="lopen" data-note="${h.n.id}"><b>${esc(h.n.title)}</b><small>${esc(courseName(h.n.courseId))} · opened ${agoLong(h.n.openedAt)}</small></button><button class="lx plus" data-linknote="${h.n.id}" title="Link this note" aria-label="Link this note">+</button></div>`).join("")}</div>`;
}

/* ---------- tab behavior ---------- */
/* Draft autosave: keeps the latest text and writes it shortly after typing stops (or right away on flush). */
/* Delayed saves remember which marker they belong to, so switching markers or closing the card can't misapply them. */
let pendingDraft: { id: string; v: string } | null = null;
let pendingQA: { id: string; q: string; a: string } | null = null;
const commitPending = debounce(() => {
  const d = pendingDraft, qa = pendingQA;
  pendingDraft = null;
  pendingQA = null;
  if (d && state.markers.get(d.id)?.draft !== d.v) updateMarker(d.id, { draft: d.v }, false);
  if (qa) updateMarker(qa.id, { recallQ: qa.q || null, recallA: qa.a || null, passageEditedAt: null }, false);
}, 500);
const saveDraft = Object.assign((v: string) => { if (current) { pendingDraft = { id: current.id, v }; commitPending(); } }, {
  flush: (v?: string) => { if (v !== undefined && current) pendingDraft = { id: current.id, v }; commitPending.flush(); }
});
const saveQA = (q: string, a: string) => { if (current) { pendingQA = { id: current.id, q, a }; commitPending(); } };
const TEMPLATES: Record<string, string> = {
  outline: "1. \n2. \n3. ",
  check: "- [ ] \n- [ ] \n- [ ] ",
  example: "**Example**\nGiven: \nSteps: \nAnswer: ",
  def: "**Term:** \n**Means:** \n**Not to confuse with:** "
};

function bindTab() {
  if (!ws || !current) return;
  const m = current;
  if (tab === "write") {
    const ta = $("#wDraft", ws) as HTMLTextAreaElement;
    ta.oninput = () => saveDraft(ta.value);
    ws.querySelectorAll<HTMLButtonElement>("[data-tpl]").forEach(b => b.onclick = () => {
      const t = TEMPLATES[b.dataset.tpl!];
      ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, "\n\n") : "") + t;
      ta.focus();
      saveDraft(ta.value);
    });
    $("#wKeep", ws)!.onclick = async () => {
      const v = ta.value.trim();
      if (!v) return toast("Write something first.");
      saveDraft.flush("");
      await update({ draft: "", thread: [...m.thread, msg("self", "✎ " + v)] });
      toast("Kept in this marker.");
    };
    $("#wInsert", ws)!.onclick = async () => {
      const v = ta.value.trim();
      if (!v) return toast("Write something first.");
      if (!insertOutput(m.id, v, { status: "accepted" })) return toast("Couldn't find this marker in the note.");
      saveDraft.flush("");
      await update({ draft: "", type: m.type === "question" ? "note" : m.type });
      toast("Added to your note.");
    };
    ws.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach(b => b.onclick = () => scrollToOutput(b.dataset.jump!));
    ws.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach(b => b.onclick = () => {
      const rev = current?.outputs?.[b.dataset.restore!]?.[Number(b.dataset.rev)];
      if (rev && restoreOutput(b.dataset.restore!, rev.html)) { toast("Restored that version."); scrollToOutput(b.dataset.restore!); }
    });
    $("#wNew", ws)!.onclick = async () => {
      const v = ta.value.trim();
      if (!v) return toast("Write something first.");
      const src = note(m.noteId);
      const title = v.split("\n")[0].replace(/^[#*\-\d.\s[\]]+/, "").slice(0, 80) || "From a marker";
      const html = (m.text ? `<blockquote><p>${esc(m.text)}</p></blockquote>` : "") + mdToHtml(v);
      const nn = await newNote(src?.courseId || "", title, "blank", html);
      saveDraft.flush("");
      await update({ draft: "", linkNoteId: nn.id, type: m.type === "question" ? "link" : m.type });
      closeBox();
      openNoteFn(nn.id);
      toast("New note created and linked to this point.");
    };
  }
  if (tab === "ask") {
    const form = $("#aForm", ws) as HTMLFormElement, ta = $("#mIn", ws) as HTMLTextAreaElement;
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    ws.querySelectorAll<HTMLButtonElement>("[data-q]").forEach(b => b.onclick = () => run(b.dataset.q!));
    form.onsubmit = async e => {
      e.preventDefault();
      const q = ta.value.trim();
      if (!q) return;
      const self = $("#aSelf", ws!) as HTMLTextAreaElement | null;
      if (aiOn === false) {
        const local = await localIntent(q).catch(() => null);
        if (local && (await runLocal(local, q))) return;
        const ans = self?.value.trim() || "";
        await update({
          thread: [...m.thread, msg("user", q), ...(ans ? [msg("self", ans)] : [])],
          recallQ: m.recallQ || q, recallA: m.recallA || ans || m.text
        });
        toast(ans ? "Question and answer saved. It's now your recall question." : "Question saved.");
        return;
      }
      run(q);
    };
  }
  if (tab === "expand") {
    ws.querySelectorAll<HTMLButtonElement>("[data-x]").forEach(b => b.onclick = () => expand(b.dataset.x!));
  }
  if (tab === "calc") {
    const form = $("#cForm", ws) as HTMLFormElement, inp = $("#cIn", ws) as HTMLInputElement, out = $("#cOut", ws)!;
    form.onsubmit = async e => {
      e.preventDefault();
      const v = inp.value.trim().replace(/^=\s*/, "");
      if (!v) return;
      try {
        const result = await evaluate(v);
        lastCalc = `<code>${esc(v)}</code> = <b>${esc(result)}</b>`;
        out.innerHTML = lastCalc;
        await update({ type: m.type === "question" || m.type === "note" ? "math" : m.type, thread: [...m.thread, msg("marker", "", { calc: v, result })] });
      } catch (err) {
        out.textContent = (err as Error).message.replace(/^Undefined symbol (\w+)/, "“$1” isn't a number or function the engine knows");
      }
    };
  }
  if (tab === "related") {
    $("#rGuide", ws)?.addEventListener("click", () => buildStudyGuide(m));
    const sel = $("#rSel", ws) as HTMLSelectElement;
    $("#rLink", ws)!.onclick = async () => {
      if (!sel.value) return toast("Choose a marker to link.");
      const other = state.markers.get(sel.value);
      if (!other) return;
      await putMarker({ ...other, links: [...new Set([...(other.links || []), m.id])] });
      await update({ links: [...new Set([...(m.links || []), other.id])], type: m.type === "question" ? "link" : m.type });
      toast("Linked. It shows on both points.");
    };
    ws.querySelectorAll<HTMLButtonElement>("[data-unlink]").forEach(b => b.onclick = async () => {
      const oid = b.dataset.unlink!, other = state.markers.get(oid);
      if (other) await putMarker({ ...other, links: (other.links || []).filter(x => x !== m.id) });
      await update({ links: (m.links || []).filter(x => x !== oid) });
    });
    ws.querySelector<HTMLButtonElement>("[data-unlinknote]")?.addEventListener("click", () => update({ linkNoteId: null }));
    ws.querySelectorAll<HTMLButtonElement>("[data-linknote]").forEach(b => b.onclick = () => update({ linkNoteId: b.dataset.linknote!, type: m.type === "question" ? "link" : m.type }));
    ws.querySelectorAll<HTMLButtonElement>(".lopen").forEach(b => b.onclick = () => {
      const target = b.dataset.m ? state.markers.get(b.dataset.m) : null;
      const nid = target ? target.noteId : b.dataset.note!;
      if (target && target.noteId === m.noteId) { openBox(target.id, null, "related"); document.querySelector(`.pin[data-pin="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
      pendingOpen = target ? target.id : null;
      reopenTab = "related";
      closeBox();
      openNoteFn(nid);
    });
  }
  if (tab === "recall") {
    const on = $("#rcOn", ws) as HTMLInputElement, q = $("#rcQ", ws) as HTMLTextAreaElement, a = $("#rcA", ws) as HTMLTextAreaElement;
    on.onchange = () => update({ recallOff: !on.checked });
    q.oninput = a.oninput = () => saveQA(q.value.trim(), a.value.trim());
    ws.querySelectorAll<HTMLButtonElement>(".mastery button").forEach(b => b.onclick = () => update({ mastery: Number(b.dataset.m) as Mastery }));
    ws.querySelectorAll<HTMLButtonElement>("[data-in]").forEach(b => b.onclick = () => {
      const d = Number(b.dataset.in);
      const at = d === 0 ? Date.now() - 1000 : (() => { const x = new Date(Date.now() + d * DAY); x.setHours(8, 0, 0, 0); return x.getTime(); })();
      update({ due: at, recallOff: false });
    });
    $("#rcGen", ws)?.addEventListener("click", async () => {
      const n = note(m.noteId), ctx = contextAround(m.id);
      try {
        const r = await askMarker({ action: "recall", passage: m.text, before: ctx.before, after: ctx.after, note: ctx.note, title: n?.title || "", course: courseName(n?.courseId), thread: m.thread });
        if (r.recall) await update({ recallQ: r.recall.q, recallA: r.recall.a, passageEditedAt: null });
      } catch (err) { toast((err as Error).message); }
    });
  }
}

/* ---------- actions ---------- */
async function addToNote(i: number) {
  if (!current) return;
  const t = current.thread[i];
  if (!t) return;
  const ok = insertOutput(current.id, t.text, { calcLine: t.calc ? `${t.calc} = ${t.result}` : null, status: t.role === "self" ? "accepted" : "pending" });
  if (!ok) return toast("Couldn't find this marker in the note.");
  await update({ thread: current.thread.map((x, j) => (j === i ? { ...x, inserted: true } : x)) });
}

async function expand(kind: string) {
  if (!current) return;
  const m = current;
  if (kind === "collect" || !aiOn) {
    let md = "";
    const short = m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text;
    if (kind === "study") md = `### ${short || "Study note"}\n**Source:** ${m.text || "—"}\n\n**In my words:** \n\n**Example:** `;
    else if (kind === "outline") md = `### Outline${short ? `: ${short}` : ""}\n1. \n2. \n3. `;
    else {
      const parts = m.thread.filter(t => (t.role !== "user" && (t.text || t.calc)) && !t.text.startsWith("⚠")).map(t => t.calc ? `- ${t.calc} = **${t.result}**` : `- ${t.text.replace(/^✎\s*/, "").replace(/\n+/g, " ")}`);
      if (m.draft?.trim()) parts.push(`- ${m.draft.trim().replace(/\n+/g, " ")}`);
      if (!parts.length) return toast("This marker has no saved work yet. Write, ask or calculate first.");
      md = `### What I worked out${short ? ` about “${short}”` : ""}\n${parts.join("\n")}`;
    }
    if (insertOutput(m.id, md, { status: "accepted" })) toast("Added to your note. Fill it in there.");
    return;
  }
  const prompts: Record<string, string> = {
    study: "Write a short study note on this: a plain explanation, then one worked example.",
    outline: "Outline the next section of my notes that builds on this point.",
    diagram: "Draw a diagram of how this works."
  };
  tab = "ask";
  render();
  run(prompts[kind]);
}

async function runLocal(a: LocalAction, said: string): Promise<boolean> {
  if (!current) return false;
  const m = current;
  const user = msg("user", said);
  if (a.do === "format") {
    const multi = /[.;!?]\s+\S/.test(m.text) || m.text.includes(",");
    if (["list", "numbered", "checklist"].includes(a.fmt) && multi && aiOn) return false;
    applyFormat(m.id, a.fmt);
    await update({ thread: [...m.thread, user, msg("marker", `Formatted as ${a.fmt === "subheading" ? "a subheading" : a.fmt === "heading" ? "a heading" : a.fmt}.`, { inserted: true })] });
    return true;
  }
  if (a.do === "calc") {
    const result = await evaluate(a.expr);
    await update({ type: m.type === "note" || m.type === "question" ? "math" : m.type, thread: [...m.thread, user, msg("marker", "", { calc: a.expr, result })] });
    return true;
  }
  if (a.do === "remind") {
    await update({ type: "reminder", remindAt: a.at, due: a.at, recallOff: false, thread: [...m.thread, user, msg("marker", `This marker will come back in your recall ${a.label}.`, { inserted: true })] });
    return true;
  }
  if (a.do === "link") {
    const q = a.query.toLowerCase();
    const t = liveNotes().filter(n => n.id !== m.noteId).sort((x, y) => Number(y.title.toLowerCase().includes(q)) - Number(x.title.toLowerCase().includes(q)) || (y.plain.toLowerCase().includes(q) ? 1 : 0) - (x.plain.toLowerCase().includes(q) ? 1 : 0))[0];
    if (!t || !(t.title + t.plain).toLowerCase().includes(q)) { await update({ thread: [...m.thread, user, msg("marker", `No note matches "${a.query}".`, { inserted: true })] }); return true; }
    await update({ type: "link", linkNoteId: t.id, thread: [...m.thread, user, msg("marker", `Linked to **${t.title}** (${courseName(t.courseId)}).`, { inserted: true })] });
    return true;
  }
  tab = "related";
  await update({ thread: [...m.thread] });
  return true;
}

async function run(said: string) {
  if (!current || busy) return;
  try {
    const local = await localIntent(said);
    if (local && (await runLocal(local, said))) return;
  } catch (e) { toast((e as Error).message); return; }
  if (aiOn === false) {
    await update({ thread: [...current.thread, msg("user", said)] });
    toast("Saved as a question. Connect the AI to get answers.");
    return;
  }
  const id = current.id, n = note(current.noteId), ctx = contextAround(id);
  const withUser: Marker = { ...current, thread: [...current.thread, msg("user", said)] };
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
    reply = msg("marker", res.markdown, { calc: res.calc && result ? res.calc : null, result });
    if (res.kind === "insert") reply.inserted = insertOutput(id, res.markdown, { mermaid: res.mermaid, calcLine: res.calc && result ? `${res.calc} = ${result}` : null });
    patch = { recallQ: res.recall?.q || withUser.recallQ || null, recallA: res.recall?.a || withUser.recallA || null };
    if (withUser.type !== "link" && withUser.type !== "reminder") patch.type = res.type;
  } catch (e) {
    reply = msg("marker", `⚠︎ ${(e as Error).message}`, { inserted: true });
  }
  busy = false;
  const base = state.markers.get(id) || withUser;
  const saved: Marker = { ...base, ...patch, thread: [...base.thread, reply] };
  await putMarker(saved);
  repaintAll();
  if (current && current.id === id) { current = saved; render(); const th = ws?.querySelector(".wsthread"); if (th) th.scrollTop = th.scrollHeight; }
}

document.addEventListener("pointerdown", e => {
  if (!ws || moved) return; // a card the student has dragged into place stays until closed
  const t = e.target as Element;
  if (ws.contains(t) || t.closest(".pin, .mk, .rail, .mout, .floatbtn")) return;
  closeBox();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !ws) return;
  const menu = ws.querySelector<HTMLElement>("#mMenu");
  e.stopPropagation();
  if (menu && !menu.hidden) { menu.hidden = true; return; }
  closeBox();
}, true);

import { aiHealth, askMarker, evaluate, localIntent, type LocalAction } from "../ai";
import { mdToHtml } from "../md";
import { courseName, liveMarkers, liveNotes, newNote, note, putMarker, state } from "../store";
import type { Marker, MarkerType, Mastery, ThreadMsg } from "../types";
import { $, agoLong, armButton, DAY, debounce, esc, toast } from "../util";
import { repaintAll } from "./extensions";
import { applyFormat, contextAround, insertOutput, removeMarkerFromDoc } from "./ops";

/* The marker workspace: everything a marker can do, in one large panel anchored to its passage.
   Write · Ask · Expand · Calculate · Related · Recall. Ask also takes plain-word commands. */

export const TYPE_INFO: Record<MarkerType, { label: string; hint: string }> = {
  note: { label: "Writing", hint: "Your own words or drafted notes" },
  question: { label: "Question", hint: "Something you're unsure about" },
  explain: { label: "Explanation", hint: "Explained or expanded" },
  math: { label: "Math", hint: "Calculated exactly" },
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
  placeCard(anchorEl || pinEl(id));
  revealPin(id);
  // on phones, focusing a field would pop the keyboard over the note; let the student tap in when ready
  if (innerWidth >= 900) setTimeout(() => (ws?.querySelector<HTMLElement>("[data-autofocus]"))?.focus({ preventScroll: true }), 40);
}

/* ---------- the card: opens out of its marker, floats over the page, can be dragged by its header ---------- */
const pinEl = (id: string) => document.querySelector<HTMLElement>(`#editor .pin[data-pin="${CSS.escape(id)}"]`);
let moved = false; // the student dragged the card; keep it where they put it

function placeCard(anchor: Element | null) {
  if (!ws) return;
  const vw = innerWidth, vh = innerHeight, top0 = 68;
  const a = anchor?.getBoundingClientRect();
  let W: number, H: number, left: number, top: number;
  if (vw < 900) {
    W = vw - 24;
    H = Math.round(vh * (ws.classList.contains("tall") ? 0.86 : 0.58));
    left = 12;
    top = vh - H - 12;
  } else {
    W = Math.min(540, vw - 48);
    H = Math.min(680, vh - top0 - 28);
    if (a) {
      // beside the marker when there's room, otherwise over the page, never glued to an edge
      left = a.right + 28 + W <= vw - 24 ? a.right + 28 : a.left - 28 - W >= 24 ? a.left - 28 - W : (vw - W) / 2;
      top = Math.min(Math.max(a.top - 140, top0 + 8), vh - H - 20);
    } else { left = (vw - W) / 2; top = top0 + 12; }
  }
  Object.assign(ws.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${Math.round(W)}px`, height: `${Math.round(H)}px` });
  if (a) ws.style.transformOrigin = `${Math.round(a.left + a.width / 2 - left)}px ${Math.round(a.top + a.height / 2 - top)}px`;
}
function clampCard() {
  if (!ws) return;
  const r = ws.getBoundingClientRect();
  const left = Math.min(Math.max(r.left, 8), innerWidth - r.width - 8), top = Math.min(Math.max(r.top, 60), innerHeight - Math.min(r.height, innerHeight - 70) - 8);
  ws.style.left = `${left}px`;
  ws.style.top = `${top}px`;
}
addEventListener("resize", () => { if (!ws || !current) return; if (moved) clampCard(); else placeCard(pinEl(current.id)); });

function bindDrag() {
  if (!ws || innerWidth < 900) return;
  const head = ws.querySelector<HTMLElement>(".wshead");
  if (!head) return;
  head.onpointerdown = e => {
    if ((e.target as Element).closest("button") || !ws) return;
    const r = ws.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    head.setPointerCapture(e.pointerId);
    ws.classList.add("dragging");
    head.onpointermove = ev => {
      if (!ws) return;
      moved = true;
      ws.style.left = `${Math.min(Math.max(r.left + ev.clientX - sx, 8), innerWidth - r.width - 8)}px`;
      ws.style.top = `${Math.min(Math.max(r.top + ev.clientY - sy, 60), innerHeight - 80)}px`;
    };
    head.onpointerup = head.onpointercancel = () => { head.onpointermove = null; ws?.classList.remove("dragging"); };
  };
}

/** Keep the marker visible beside or above the workspace instead of hidden behind it. */
function revealPin(id: string) {
  const el = document.querySelector<HTMLElement>(`#editor .pin[data-pin="${CSS.escape(id)}"]`), stage = document.getElementById("stage");
  if (!el || !stage || !ws) return;
  requestAnimationFrame(() => {
    if (!ws) return;
    const r = el.getBoundingClientRect(), w = ws.getBoundingClientRect();
    if (innerWidth < 900) {
      const room = w.top - 70; // visible space above the sheet
      const want = 70 + Math.max(40, room * 0.4);
      if (r.top < 70 || r.bottom > w.top - 10) stage.scrollBy({ top: r.top - want, behavior: "smooth" });
    } else if (r.right > w.left - 8 && r.left > w.left - 40) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  });
}
const isFree = (id: string) => !!document.querySelector(`#editor .pin.free[data-pin="${CSS.escape(id)}"]`);

/* ---------- shared bits ---------- */
async function update(patch: Partial<Marker>, rerender = true) {
  if (!current) return;
  current = { ...current, ...patch };
  await putMarker(current);
  repaintAll();
  if (rerender) render();
}
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
    <button class="wsgrab" id="mGrab" aria-label="${ws.classList.contains("tall") ? "Shrink" : "Expand"} marker workspace"><i></i></button>
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
  $("#mGrab", ws)!.onclick = () => { ws!.classList.toggle("tall"); render(); placeCard(current ? pinEl(current.id) : null); };
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
        ${kept.length ? `<div class="wslabel">Kept in this marker</div>${threadHTML(kept.map(([t, i]) => [{ ...t, text: t.text.replace(/^✎\s*/, "") }, i]))}` : ""}`;
    }
    case "ask": {
      const items = m.thread.map((t, i) => [t, i] as [ThreadMsg, number]).filter(([t]) => !(t.role === "self" && t.text.startsWith("✎")));
      const ctx = contextAround(m.id);
      return `${threadHTML(items)}
        ${aiOn === false ? `<div class="wsnote off">AI is not connected. Save a question and work through your own answer. Commands like "make this a list", "remind me Friday" or "link to …" still work.</div>` : ""}
        ${!items.length ? `<div class="tchips sugg">${(m.text ? ["Explain this simpler", "Why does this work?", "Give me an example", "Quiz me on this", "Turn this into a list", "Draw a diagram"] : ["Outline this topic", "Summarize this note", "Make a checklist from this note"]).map(s => `<button data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
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
      return `<h3>Work it out exactly.</h3><p class="sub">A math engine does the arithmetic, so the answer is exact. Units work too: <code>23.4 mL * 0.1 mol/L</code>, <code>5 kg to lb</code>.</p>
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
        ${linked.length || ln ? `<div class="wslabel">Linked</div><div class="links">${linked.map(x => `<div class="lrow"><button class="lopen" data-m="${x.id}"><b>${esc(x.text.slice(0, 80))}</b><small>${esc(note(x.noteId)?.title || "")}</small></button><button class="lx" data-unlink="${x.id}" aria-label="Unlink">×</button></div>`).join("")}${ln ? `<div class="lrow"><button class="lopen" data-note="${ln.id}"><b>${esc(ln.title)}</b><small>Whole note</small></button><button class="lx" data-unlinknote aria-label="Unlink">×</button></div>` : ""}</div>` : ""}
        ${relatedNotesHTML(m)}`;
    }
    case "recall": {
      const q = m.recallQ || (m.text ? `What does this mean, in your own words?` : "");
      const a = m.recallA || m.text;
      return `<h3>Give this thought another day.</h3><p class="sub">Choose what you want to remember. Review stays connected to its source.</p>
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
let pendingDraft: string | null = null;
const commitDraft = debounce(() => {
  if (pendingDraft === null || !current) return;
  const v = pendingDraft;
  pendingDraft = null;
  if (current.draft !== v) update({ draft: v }, false);
}, 500);
const saveDraft = Object.assign((v: string) => { pendingDraft = v; commitDraft(); }, {
  flush: (v?: string) => { if (v !== undefined) pendingDraft = v; commitDraft.flush(); }
});
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
    const saveQA = debounce(() => update({ recallQ: q.value.trim() || null, recallA: a.value.trim() || null }, false), 500);
    q.oninput = saveQA; a.oninput = saveQA;
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
        if (r.recall) await update({ recallQ: r.recall.q, recallA: r.recall.a });
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
  if (!ws || innerWidth >= 900) return; // docked on wide screens; a tap outside closes the sheet on phones
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

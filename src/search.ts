import { courseColor, courseName, liveMarkers, liveNotes, note, state } from "./store";
import type { Marker } from "./types";
import { $, agoLong, esc } from "./util";
import { setPendingOpen, TYPE_INFO } from "./editor/markerBox";

/* Search across every marker's thoughts: the marked passage, drafts, questions, answers, recall cards and what it connects to. */

interface Hit { m: Marker; score: number; field: string; text: string }
let panel: HTMLElement | null = null;
let openNoteFn: (id: string) => void = () => {};

function fields(m: Marker): [string, string][] {
  const f: [string, string][] = [];
  if (m.text) f.push(["Passage", m.text]);
  if (m.draft?.trim()) f.push(["Draft", m.draft]);
  for (const t of m.thread) {
    if (!t.text && !t.calc) continue;
    f.push([t.role === "user" ? "Question" : t.role === "self" ? "Your answer" : "Marker", (t.text || "").replace(/^✎\s*/, "") + (t.calc ? ` ${t.calc} = ${t.result}` : "")]);
  }
  if (m.recallQ) f.push(["Recall", m.recallQ + (m.recallA ? ` — ${m.recallA}` : "")]);
  for (const id of m.links || []) { const o = state.markers.get(id); if (o && !o.deleted && o.text) f.push(["Connected to", o.text]); }
  for (const r of Object.values(m.outputs || {})) { const last = r[r.length - 1]; if (last) f.push(["Written into note", last.text]); }
  return f;
}

function snippet(text: string, terms: string[]) {
  const low = text.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map(t => { const i = low.indexOf(t); return i < 0 ? Infinity : i; })));
  const start = Math.max(0, (isFinite(at) ? at : 0) - 50);
  let s = esc((start ? "…" : "") + text.slice(start, start + 170) + (start + 170 < text.length ? "…" : ""));
  for (const t of terms) s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
  return s;
}

function search(q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return { markers: [] as Hit[], notes: [] as ReturnType<typeof liveNotes> };
  const markers: Hit[] = [];
  for (const m of liveMarkers()) {
    const f = fields(m), n = note(m.noteId);
    const hay = (f.map(x => x[1]).join(" ") + " " + (n?.title || "") + " " + courseName(n?.courseId)).toLowerCase();
    if (!terms.every(t => hay.includes(t))) continue;
    const best = f.find(([, v]) => terms.some(t => v.toLowerCase().includes(t))) || ["Note", n?.title || ""];
    const score = terms.reduce((s, t) => s + (m.text.toLowerCase().includes(t) ? 3 : 0) + (hay.split(t).length - 1), 0) + m.updatedAt / 1e13;
    markers.push({ m, score, field: best[0], text: best[1] });
  }
  markers.sort((a, b) => b.score - a.score);
  const notes = liveNotes().filter(n => terms.every(t => (n.title + " " + n.plain).toLowerCase().includes(t))).sort((a, b) => b.openedAt - a.openedAt).slice(0, 6);
  return { markers: markers.slice(0, 30), notes };
}

export function closeSearch() { panel?.remove(); panel = null; }

export function openSearch(openNote: (id: string) => void) {
  openNoteFn = openNote;
  if (panel) { $("#qIn", panel)?.focus(); return; }
  panel = document.createElement("div");
  panel.className = "searchwrap";
  panel.innerHTML = `<div class="searchbox" role="dialog" aria-label="Search your markers">
    <div class="qrow"><span aria-hidden="true">⌕</span><input id="qIn" placeholder="Search passages, drafts, answers, connections…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="qres" id="qRes"></div></div>`;
  document.body.appendChild(panel);
  const inp = $("#qIn", panel) as HTMLInputElement, res = $("#qRes", panel)!;
  let sel = 0, items: HTMLElement[] = [];
  const draw = () => {
    const q = inp.value.trim();
    const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (!terms.length) {
      const recent = [...liveMarkers()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
      res.innerHTML = recent.length ? `<div class="qhead">Recent markers</div>${recent.map(m => row({ m, score: 0, field: TYPE_INFO[m.type].label, text: m.text || m.draft || "A blank point" }, [])).join("")}` : `<p class="qempty">Place a marker and its thoughts become searchable here.</p>`;
    } else {
      const r = search(q);
      res.innerHTML = (r.markers.length ? `<div class="qhead">Markers · ${r.markers.length}</div>${r.markers.map(h => row(h, terms)).join("")}` : "")
        + (r.notes.length ? `<div class="qhead">Notes</div>${r.notes.map(n => `<button class="qrow2" data-note="${n.id}"><i class="qdot" style="background:${courseColor(n.courseId)}"></i><span><b>${esc(n.title)}</b><small>${esc(courseName(n.courseId))} · opened ${agoLong(n.openedAt)}</small></span></button>`).join("")}` : "")
        || `<p class="qempty">Nothing matches “${esc(q)}”.</p>`;
    }
    items = [...res.querySelectorAll<HTMLElement>("button")];
    sel = 0;
    items[0]?.classList.add("on");
  };
  const row = (h: Hit, terms: string[]) => {
    const n = note(h.m.noteId);
    return `<button class="qrow2" data-m="${h.m.id}" data-type="${h.m.type}"><i class="qdot marker" data-mastery="${h.m.mastery}"></i><span>
      <b>${terms.length ? snippet(h.m.text || h.text, terms) : esc((h.m.text || h.text).slice(0, 140))}</b>
      ${terms.length && h.field !== "Passage" ? `<em>${esc(h.field)}: ${snippet(h.text, terms)}</em>` : ""}
      <small>${esc(courseName(n?.courseId))} / ${esc(n?.title || "")} · ${agoLong(h.m.updatedAt)}</small></span></button>`;
  };
  const go = (b: HTMLElement | undefined) => {
    if (!b) return;
    if (b.dataset.m) { const m = state.markers.get(b.dataset.m); if (!m) return; setPendingOpen(m.id); closeSearch(); openNoteFn(m.noteId); }
    else if (b.dataset.note) { closeSearch(); openNoteFn(b.dataset.note); }
  };
  inp.oninput = draw;
  inp.onkeydown = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[sel]?.classList.remove("on");
      sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % Math.max(1, items.length);
      items[sel]?.classList.add("on");
      items[sel]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); go(items[sel]); }
    else if (e.key === "Escape") closeSearch();
  };
  res.onclick = e => go((e.target as Element).closest<HTMLElement>("button") || undefined);
  panel.addEventListener("pointerdown", e => { if (e.target === panel) closeSearch(); });
  draw();
  inp.focus();
}

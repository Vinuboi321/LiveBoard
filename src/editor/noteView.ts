import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import Highlight from "@tiptap/extension-highlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Diagram, MarkerMark, MarkerOutput, Pin, repaintAll } from "./extensions";
import { closeBox, openBox, setOpenNote, setPendingOpen, takePendingOpen, TYPE_INFO } from "./markerBox";
import { dropFreeMarker, giveOutputIds, markRange, moveFreeMarker, outputsInDoc, pinIds, setEditor } from "./ops";
import { courseColor, deleteNote, liveCourses, liveMarkers, markersOf, newCourse, newMarker, note, onChange, onRemote, patchNote, putMarker, putMeta, putNote, reconcilePins, state } from "../store";
import type { Note } from "../types";
import { $, armButton, debounce, esc, toast, uid } from "../util";
import { stripMarkers } from "../sync";

let ed: Editor | null = null;
let unsub: (() => void) | null = null;
let cleanup: (() => void)[] = [];
let flushSave: (() => void) | null = null;
/** Write any edit still waiting in the editor (used before switching accounts and when the page is hidden). */
export function flushNote() { flushSave?.(); }

export function destroyNote() {
  closeBox();
  cleanup.forEach(f => f());
  cleanup = [];
  flushSave = null;
  unsub?.();
  unsub = null;
  if (ed) { ed.destroy(); ed = null; setEditor(null); }
  document.querySelectorAll(".floatbtn,.railwrap").forEach(e => e.remove());
}

const TOOLS: [string, string, (e: Editor) => void, (e: Editor) => boolean][] = [
  ["B", "Bold", e => e.chain().focus().toggleBold().run(), e => e.isActive("bold")],
  ["I", "Italic", e => e.chain().focus().toggleItalic().run(), e => e.isActive("italic")],
  ["U", "Underline", e => e.chain().focus().toggleUnderline().run(), e => e.isActive("underline")],
  ["H", "Heading", e => e.chain().focus().toggleHeading({ level: 2 }).run(), e => e.isActive("heading", { level: 2 })],
  ["h", "Subheading", e => e.chain().focus().toggleHeading({ level: 3 }).run(), e => e.isActive("heading", { level: 3 })],
  ["•", "Bullet list", e => e.chain().focus().toggleBulletList().run(), e => e.isActive("bulletList")],
  ["1.", "Numbered list", e => e.chain().focus().toggleOrderedList().run(), e => e.isActive("orderedList")],
  ["☐", "Checklist", e => e.chain().focus().toggleTaskList().run(), e => e.isActive("taskList")],
  ["❝", "Quote", e => e.chain().focus().toggleBlockquote().run(), e => e.isActive("blockquote")],
  ["</>", "Code", e => e.chain().focus().toggleCodeBlock().run(), e => e.isActive("codeBlock")],
  ["▮", "Highlight", e => e.chain().focus().toggleHighlight().run(), e => e.isActive("highlight")],
  ["↶", "Undo", e => e.chain().focus().undo().run(), () => false],
  ["↷", "Redo", e => e.chain().focus().redo().run(), () => false]
];

export function renderNote(stage: HTMLElement, id: string, goHome: () => void, openNote: (id: string) => void) {
  destroyNote();
  const n0 = note(id);
  if (!n0 || n0.deleted) { goHome(); return; }
  setOpenNote(openNote);
  let n: Note = { ...n0, openedAt: Date.now() };
  putNote(n, false);
  /** The server revision the editor's content is built on. If sync replaces the note underneath, a save keeps both versions. */
  let baseRev = n0.rev ?? 0;
  let dirty = false;

  const courses = liveCourses();
  const backlinks = liveMarkers().filter(m => m.type === "link" && m.linkNoteId === id && m.noteId !== id);
  stage.innerHTML = `
    <article class="paper" id="paper">
      <div class="ptop">
        <button class="tbtn back" id="backBtn">← Dial</button>
        <label class="coursesel"><span class="dot" id="cdot" style="background:${courseColor(n.courseId)}"></span>
          <select id="courseSel" aria-label="Course">${courses.map(c => `<option value="${c.id}" ${c.id === n.courseId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="__new">+ New course…</option></select>
          <input id="newCourse" placeholder="Course name" hidden maxlength="32"></label>
        <span class="mcount" id="mcount"></span>
        <span class="spacer"></span>
        <button class="tbtn drop" id="dropBtn" aria-pressed="false" title="Drop a marker anywhere on the page">+ Marker</button>
        <button class="tbtn ${state.meta.showTools ? "on" : ""}" id="toolsBtn" aria-pressed="${state.meta.showTools}" title="Show classic formatting tools">Aa</button>
        <button class="tbtn" id="delNote">Delete</button>
      </div>
      <div class="toolbar" id="toolbar" ${state.meta.showTools ? "" : "hidden"}>${TOOLS.map((t, i) => `<button data-i="${i}" title="${t[1]}" aria-label="${t[1]}">${esc(t[0])}</button>`).join("")}</div>
      <input class="ptitle" id="ptitle" value="${esc(n.title)}" aria-label="Title" maxlength="140" placeholder="Untitled note">
      ${backlinks.length ? `<div class="backlinks">Linked from ${backlinks.map(m => { const src = note(m.noteId); return src ? `<button data-open="${src.id}">${esc(src.title)}</button>` : ""; }).join("")}</div>` : ""}
      <div class="hint" id="hint">Select text to mark it, or drop a marker anywhere: tap <b>+ Marker</b>, double-click a margin, or press and hold on the page. Drag a free marker to move it.</div>
      <div class="editorwrap" id="ewrap"><svg class="strings" id="strings" aria-hidden="true"></svg><div id="editor"></div><div class="stringtags" id="stringTags"></div><div class="rail" id="rail" aria-label="Markers on this page"></div></div>
      <button class="tapzone" id="tapzone" aria-label="Add a line at the end">Tap here to keep writing</button>
    </article>`;

  const placeBtn = document.createElement("button");
  placeBtn.className = "floatbtn place";
  placeBtn.hidden = true;
  placeBtn.innerHTML = `<span class="pindot"></span>Place marker`;
  const plusBtn = document.createElement("button");
  plusBtn.className = "floatbtn plus";
  plusBtn.hidden = true;
  plusBtn.setAttribute("aria-label", "Place a marker on this empty line");
  plusBtn.title = "Place a marker here to write or generate";
  plusBtn.textContent = "+";
  document.body.append(placeBtn, plusBtn);

  const save0 = debounce(() => {
    if (!ed) return;
    dirty = false;
    const cur = state.notes.get(id);
    if (cur && (cur.rev ?? 0) > baseRev && JSON.stringify(cur.doc) !== JSON.stringify(n.doc)) {
      // Another device's version arrived while this one was being edited. Keep it as a copy, then save what's on screen.
      const t = Date.now();
      putNote({ ...cur, id: uid(), title: `${cur.title} (from another device)`.slice(0, 140), doc: stripMarkers(cur.doc), conflictOf: id, rev: undefined, createdAt: t, openedAt: t, updatedAt: t });
      toast("This note also changed on another device. That version was saved as a copy.", 6000);
    }
    baseRev = cur?.rev ?? baseRev;
    patchNote(id, { doc: ed.getJSON(), html: null, plain: ed.getText({ blockSeparator: "\n" }).slice(0, 200000) });
    n = state.notes.get(id) || n;
    syncPassages();
    recordRevisions();
  }, 600);
  const save = Object.assign(() => { dirty = true; save0(); }, { flush: () => { if (dirty || !n.doc) save0.flush(); } });
  flushSave = () => save.flush();
  /* Another device's version replaced this note: show it, unless there are unsaved edits (then the save keeps both). */
  cleanup.push(onRemote((kind, ids) => {
    if (kind !== "notes" || !ids.includes(id) || !ed) return;
    const r = state.notes.get(id);
    if (!r) return;
    if (r.deleted) { toast("This note was deleted on another device."); goHome(); return; }
    if (dirty) return;
    baseRev = r.rev ?? baseRev;
    n = r;
    if (JSON.stringify(r.doc) !== JSON.stringify(ed.getJSON()) && r.doc) {
      const { from } = ed.state.selection;
      ed.commands.setContent(r.doc as object, { emitUpdate: false });
      try { ed.commands.setTextSelection(Math.min(from, ed.state.doc.content.size)); } catch { /* selection outside the new doc */ }
      repaintAll(); layoutRail();
    }
    const t = $("#ptitle", stage) as HTMLInputElement | null;
    if (t && document.activeElement !== t) t.value = r.title;
  }));
  const onHide = () => { if (document.visibilityState === "hidden") save.flush(); };
  const onPageHide = () => save.flush();
  document.addEventListener("visibilitychange", onHide);
  addEventListener("pagehide", onPageHide);
  cleanup.push(() => { document.removeEventListener("visibilitychange", onHide); removeEventListener("pagehide", onPageHide); });
  /** Keep a short history of every block a marker wrote, so edits can be traced and undone later. */
  function recordRevisions() {
    if (!ed) return;
    giveOutputIds();
    const byMarker = new Map<string, ReturnType<typeof outputsInDoc>>();
    for (const o of outputsInDoc()) if (o.oid) byMarker.set(o.marker, [...(byMarker.get(o.marker) || []), o]);
    for (const [mid, outs] of byMarker) {
      const m = state.markers.get(mid);
      if (!m) continue;
      const hist = { ...(m.outputs || {}) };
      let changed = false;
      for (const o of outs) {
        const list = hist[o.oid!] || [];
        if (list[list.length - 1]?.text === o.text) continue;
        hist[o.oid!] = [...list, { at: Date.now(), text: o.text, html: o.html }].slice(-12);
        changed = true;
      }
      if (changed) putMarker({ ...m, outputs: hist });
    }
  }
  /** When a marked passage is edited, the marker (and its default recall answer) follows the new wording. */
  function syncPassages() {
    if (!ed) return;
    for (const m of markersOf(id)) {
      if (!m.text) continue;
      const r = markRange(m.id);
      if (!r) continue;
      const now = ed.state.doc.textBetween(r.from, r.to, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
      if (!now || now === m.text) continue;
      putMarker({ ...m, text: now, recallA: !m.recallA || m.recallA === m.text ? now : m.recallA, passageEditedAt: Date.now() });
    }
  }
  cleanup.push(() => save.flush());

  ed = new Editor({
    element: $("#editor", stage)!,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, trailingNode: false }),
      Highlight, TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Start writing, or tap + to place a marker here") }),
      MarkerMark, Pin, MarkerOutput, Diagram
    ],
    content: (n.doc as object) || n.html || "",
    editorProps: {
      attributes: { class: "body", spellcheck: "true" },
      transformPastedHTML: html => html.replace(/data-(pin|marker|marker-output)="[^"]*"/g, "")
    },
    onUpdate: () => { save(); reconcilePins(id, pinIds()); layoutRail(); updateFloat(); },
    onSelectionUpdate: () => updateFloat(),
    onBlur: () => setTimeout(updateFloat, 120),
    onFocus: () => updateFloat()
  });
  setEditor(ed);
  if (!n.doc) save();
  reconcilePins(id, pinIds());

  /* ----- header ----- */
  $("#backBtn", stage)!.onclick = goHome;
  const sel = $("#courseSel", stage) as HTMLSelectElement, nc = $("#newCourse", stage) as HTMLInputElement;
  sel.onchange = () => {
    if (sel.value === "__new") { nc.hidden = false; nc.focus(); return; }
    patchNote(id, { courseId: sel.value });
    n = state.notes.get(id) || n;
    $("#cdot", stage)!.style.background = courseColor(n.courseId);
  };
  nc.onkeydown = async e => {
    if (e.key === "Escape") { nc.hidden = true; sel.value = n.courseId; return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = nc.value.trim();
    if (!v) return;
    const c = liveCourses().find(x => x.name.toLowerCase() === v.toLowerCase()) || (await newCourse(v));
    await patchNote(id, { courseId: c.id });
    n = state.notes.get(id) || n;
    sel.insertAdjacentHTML("afterbegin", `<option value="${c.id}">${esc(c.name)}</option>`);
    sel.value = c.id;
    nc.hidden = true;
    nc.value = "";
    $("#cdot", stage)!.style.background = c.color;
  };
  nc.onblur = () => { if (!nc.value.trim()) { nc.hidden = true; sel.value = n.courseId; } };
  const title = $("#ptitle", stage) as HTMLInputElement;
  title.oninput = () => { patchNote(id, { title: title.value.trim() || "Untitled note" }); n = state.notes.get(id) || n; };
  title.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); ed?.commands.focus("start"); } };
  armButton($("#delNote", stage)!, "Delete", "Tap again to delete", async () => { save.flush(); await deleteNote(id); toast("Note deleted."); goHome(); });
  stage.querySelectorAll<HTMLButtonElement>(".backlinks [data-open]").forEach(b => b.onclick = () => openNote(b.dataset.open!));

  const toolsBtn = $("#toolsBtn", stage)!, toolbar = $("#toolbar", stage)!;
  toolsBtn.onclick = () => {
    const on = toolbar.hidden;
    toolbar.hidden = !on;
    toolsBtn.classList.toggle("on", on);
    toolsBtn.setAttribute("aria-pressed", String(on));
    putMeta({ showTools: on });
  };
  toolbar.addEventListener("mousedown", e => e.preventDefault());
  toolbar.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => { if (ed) { TOOLS[+b.dataset.i!][2](ed); refreshTools(); } });
  const refreshTools = () => { if (!ed || toolbar.hidden) return; toolbar.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.classList.toggle("on", TOOLS[+b.dataset.i!][3](ed!))); };
  ed.on("selectionUpdate", refreshTools);
  ed.on("transaction", refreshTools);

  $("#tapzone", stage)!.onclick = () => {
    if (!ed) return;
    const last = ed.state.doc.lastChild;
    if (last && (last.type.name !== "paragraph" || last.content.size > 0)) ed.chain().insertContentAt(ed.state.doc.content.size, "<p></p>").run();
    ed.commands.focus("end");
  };

  /* ----- placing markers ----- */
  function updateFloat() {
    if (!ed) return;
    const { state: st, view } = ed;
    const s = st.selection;
    placeBtn.hidden = true;
    plusBtn.hidden = true;
    if (!view.hasFocus() && document.activeElement !== placeBtn && document.activeElement !== plusBtn) return;
    if (!s.empty) {
      const text = st.doc.textBetween(s.from, s.to, " ").trim();
      if (!text) return;
      const a = view.coordsAtPos(s.from), b = view.coordsAtPos(s.to);
      placeBtn.hidden = false;
      const w = placeBtn.offsetWidth;
      const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
      placeBtn.style.left = Math.max(12, Math.min(innerWidth - w - 12, mid - w / 2)) + "px";
      placeBtn.style.top = (a.top > 70 ? a.top - 46 : b.bottom + 10) + "px";
      return;
    }
    const $f = s.$from;
    if ($f.parent.isTextblock && $f.parent.content.size === 0 && $f.parent.type.name !== "codeBlock") {
      const c = view.coordsAtPos(s.from);
      const paper = $("#paper")!.getBoundingClientRect();
      plusBtn.hidden = false;
      plusBtn.style.left = Math.max(4, paper.left + 4) + "px";
      plusBtn.style.top = c.top + (c.bottom - c.top) / 2 - 15 + "px";
    }
  }
  placeBtn.addEventListener("mousedown", e => e.preventDefault());
  plusBtn.addEventListener("mousedown", e => e.preventDefault());
  placeBtn.onclick = () => {
    if (!ed) return;
    const { from, to, $from, $to } = ed.state.selection;
    if ($from.parent !== $to.parent) return toast("Select text within one paragraph to place a marker.");
    let hasPin = false;
    ed.state.doc.nodesBetween(from, to, nd => { if (nd.type.name === "pin") hasPin = true; });
    if (hasPin || ed.state.doc.rangeHasMark(from, to, ed.schema.marks.marker)) return toast("Markers can't overlap. Select text outside an existing marker.");
    const text = ed.state.doc.textBetween(from, to, " ").trim().slice(0, 2000);
    const m = newMarker(id, text, "question");
    state.markers.set(m.id, m);
    putMarker(m);
    ed.chain().focus().insertContentAt(to, { type: "pin", attrs: { id: m.id } }).setTextSelection({ from, to }).setMark("marker", { id: m.id }).setTextSelection(to + 1).run();
    repaintAll();
    placeBtn.hidden = true;
    openBox(m.id);
  };
  plusBtn.onclick = () => {
    if (!ed) return;
    const m = newMarker(id, "", "note");
    state.markers.set(m.id, m);
    putMarker(m);
    ed.chain().focus().insertContent({ type: "pin", attrs: { id: m.id } }).run();
    plusBtn.hidden = true;
    openBox(m.id);
  };

  /* ----- free markers: drop anywhere, drag to move ----- */
  const paperEl = $("#paper", stage)!, wrapEl = $("#ewrap", stage)!, dropBtn = $("#dropBtn", stage)!;
  let dropMode = false;
  const setDrop = (on: boolean) => { dropMode = on; dropBtn.setAttribute("aria-pressed", String(on)); dropBtn.classList.toggle("on", on); paperEl.classList.toggle("dropping", on); };
  dropBtn.onclick = e => { e.stopPropagation(); setDrop(!dropMode); if (dropMode) toast("Tap anywhere on the page to drop a marker."); };
  const dropAt = (x: number, y: number) => {
    if (!ed) return;
    const m = newMarker(id, "", "note");
    state.markers.set(m.id, m);
    putMarker(m);
    if (!dropFreeMarker(m.id, x, y)) { toast("Couldn't place a marker there."); return; }
    repaintAll();
    setDrop(false);
    setTimeout(() => openBox(m.id), 30);
  };
  const inPaper = (x: number, y: number) => { const r = paperEl.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  paperEl.addEventListener("click", e => {
    if (!dropMode || (e.target as Element).closest("#dropBtn,.pin,.ptop,.toolbar,input,select,.backlinks")) return;
    e.preventDefault(); e.stopPropagation();
    dropAt(e.clientX, e.clientY);
  }, true);
  // double-click in the page margins (not on text) drops a marker there
  paperEl.addEventListener("dblclick", e => {
    const t = e.target as Element;
    if (t.closest(".ProseMirror p, .ProseMirror li, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror blockquote, .ptop, .toolbar, input, button, .mout")) return;
    if (!t.closest(".editorwrap, .paper")) return;
    e.preventDefault();
    dropAt(e.clientX, e.clientY);
  });
  // press and hold (mouse or pen) anywhere on the page
  let holdTimer: number | undefined, holdStart: { x: number; y: number } | null = null;
  wrapEl.addEventListener("pointerdown", e => {
    if (e.pointerType === "touch" || e.button !== 0 || (e.target as Element).closest(".pin, .mout, .rail, .stringtag")) return;
    holdStart = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => { if (holdStart) { getSelection()?.removeAllRanges(); dropAt(holdStart.x, holdStart.y); holdStart = null; } }, 650);
  });
  const cancelHold = (e: PointerEvent) => { if (holdStart && (e.type !== "pointermove" || Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 6)) { clearTimeout(holdTimer); holdStart = null; } };
  wrapEl.addEventListener("pointermove", cancelHold);
  wrapEl.addEventListener("pointerup", cancelHold);
  wrapEl.addEventListener("pointercancel", cancelHold);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dropMode) setDrop(false); };
  document.addEventListener("keydown", onKey);
  cleanup.push(() => document.removeEventListener("keydown", onKey));

  // drag a free marker to move it
  let drag: { id: string; el: HTMLElement; sx: number; sy: number; moved: boolean; pid: number } | null = null;
  wrapEl.addEventListener("pointerdown", e => {
    const el = (e.target as Element).closest<HTMLElement>(".pin.free");
    if (!el?.dataset.pin) return;
    e.preventDefault();
    clearTimeout(holdTimer); holdStart = null;
    drag = { id: el.dataset.pin, el, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  wrapEl.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.el.classList.add("dragging");
    drag.el.style.translate = `${dx}px ${dy}px`;
    layoutStrings();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    d.el.classList.remove("dragging");
    d.el.style.translate = "";
    if (!d.moved) { openBox(d.id, d.el); return; }
    if (inPaper(e.clientX, e.clientY)) moveFreeMarker(d.id, e.clientX, e.clientY);
    setTimeout(layoutRail, 30);
  };
  wrapEl.addEventListener("pointerup", endDrag);
  wrapEl.addEventListener("pointercancel", endDrag);

  // "marker ↗" on anything a marker wrote reopens that marker on its Write tab, where its versions live
  const onOpenMarker = (e: Event) => {
    const { id: mid } = (e as CustomEvent).detail || {};
    if (mid && state.markers.get(mid)) openBox(mid, document.querySelector(`#editor .pin[data-pin="${CSS.escape(mid)}"]`), "write");
  };
  stage.addEventListener("open-marker", onOpenMarker);
  cleanup.push(() => stage.removeEventListener("open-marker", onOpenMarker));

  /* ----- opening markers from the page ----- */
  const edEl = $("#editor", stage)!;
  edEl.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const pinEl = t.closest<HTMLElement>(".pin");
    if (pinEl?.dataset.pin) { e.preventDefault(); if (!pinEl.classList.contains("free")) openBox(pinEl.dataset.pin, pinEl); return; }
    const mk = t.closest<HTMLElement>(".mk");
    if (mk?.dataset.marker && ed?.state.selection.empty) openBox(mk.dataset.marker, mk);
  });
  edEl.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if ((e.key === "Enter" || e.key === " ") && t.classList?.contains("pin") && t.dataset.pin) { e.preventDefault(); openBox(t.dataset.pin, t); }
  });

  /* ----- margin rail ----- */
  function layoutRail() {
    const rail = $("#rail");
    if (!rail || !ed) return;
    const wrapTop = rail.getBoundingClientRect().top;
    const pins = [...document.querySelectorAll<HTMLElement>("#editor .pin")];
    let lastY = -20;
    rail.innerHTML = pins.map(p => {
      const m = state.markers.get(p.dataset.pin || "");
      if (!m) return "";
      let y = p.getBoundingClientRect().top - wrapTop;
      if (y < lastY + 14) y = lastY + 14;
      lastY = y;
      return `<button class="rdot" data-id="${m.id}" data-type="${m.type}" data-mastery="${m.mastery}" style="top:${y}px" title="${esc(TYPE_INFO[m.type].label)}${m.text ? ": " + esc(m.text.slice(0, 60)) : ""}" aria-label="Open ${esc(TYPE_INFO[m.type].label)} marker"></button>`;
    }).join("");
    layoutStrings();
    const ms = markersOf(id);
    const mastered = ms.filter(m => m.mastery === 2).length;
    const mc = $("#mcount");
    const lost = ms.filter(m => m.detachedAt);
    if (mc) {
      mc.innerHTML = (ms.length ? `${ms.length} marker${ms.length > 1 ? "s" : ""} · ${mastered} mastered` : "")
        + (lost.length ? ` <button class="lostbtn" id="lostBtn" title="Markers whose passage was deleted. Their thinking is kept.">${lost.length} lost ${lost.length > 1 ? "their" : "its"} place</button>` : "");
      const lb = $("#lostBtn");
      if (lb) lb.onclick = () => openBox(lost[0].id, null);
    }
  }
  /* ----- strings: a thin thread between connected markers ----- */
  function layoutStrings() {
    const svg = $("#strings") as SVGSVGElement | null, tags = $("#stringTags");
    const wrap = $("#ewrap");
    if (!svg || !tags || !wrap) return;
    const wr = wrap.getBoundingClientRect();
    document.querySelectorAll<HTMLElement>("#editor .pin.free:not(.dragging)").forEach(el => {
      el.style.marginLeft = "";
      const r = el.getBoundingClientRect();
      const over = r.right - (wr.right + 14), under = (wr.left - 30) - r.left;
      if (over > 0) el.style.marginLeft = `${-over}px`;
      else if (under > 0) el.style.marginLeft = `${under}px`;
    });
    svg.setAttribute("width", String(wr.width));
    svg.setAttribute("height", String(wr.height));
    const center = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - wr.left, y: r.top + r.height / 2 - wr.top }; };
    const dots = new Map<string, HTMLElement>();
    document.querySelectorAll<HTMLElement>("#editor .pin[data-pin]").forEach(el => dots.set(el.dataset.pin!, el));
    const seen = new Set<string>();
    let paths = "", tagHtml = "", gi = 0;
    const color = (t: string) => getComputedStyle(document.documentElement).getPropertyValue(`--t-${t}`).trim() || "#8338EC";
    for (const [mid, el] of dots) {
      const m = state.markers.get(mid);
      if (!m) continue;
      const a = center(el);
      for (const oid of m.links || []) {
        const key = [mid, oid].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const other = state.markers.get(oid);
        if (!other || other.deleted) continue;
        const oel = dots.get(oid);
        if (oel) {
          const b = center(oel);
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const sag = Math.min(90, 18 + dist * 0.22);
          const cx = (a.x + b.x) / 2, cy = Math.max(a.y, b.y) + sag;
          const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          const g = `sg${gi++}`;
          paths += `<defs><linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><stop offset="0" stop-color="${color(m.type)}"/><stop offset="1" stop-color="${color(other.type)}"/></linearGradient></defs>
            <g class="string" data-a="${mid}" data-b="${oid}" filter="url(#fuzz)"><path class="sline" d="${d}" stroke="url(#${g})"/><path class="sfiber" d="${d}" stroke="url(#${g})" transform="translate(0 -.8)"/><path class="sfiber b" d="${d}" stroke="url(#${g})" transform="translate(0 .8)"/></g>`;
        } else if (note(other.noteId) && !note(other.noteId)!.deleted) {
          // the other end lives in another note: a short dangling thread ending in a tag
          const left = a.x > wr.width * 0.55; // near the right edge, the thread swings down and to the left
          const ex = left ? a.x - 64 : a.x + 64, ey = a.y + 30 + (gi % 3) * 22;
          gi++;
          const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${((a.x + ex) / 2).toFixed(1)} ${(ey + 16).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
          paths += `<g class="string out" data-a="${mid}" filter="url(#fuzz)"><path class="sline" d="${d}" stroke="${color(m.type)}"/><path class="sfiber" d="${d}" stroke="${color(m.type)}"/></g>`;
          tagHtml += `<button class="stringtag ${left ? "toleft" : ""}" data-open-marker="${oid}" data-type="${other.type}" style="left:${ex}px;top:${ey}px" title="Linked to a point in ${esc(note(other.noteId)!.title)}">↗ ${esc(note(other.noteId)!.title.slice(0, 28))}</button>`;
        }
      }
    }
    svg.innerHTML = `<defs><filter id="fuzz" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter></defs>` + paths;
    tags.innerHTML = tagHtml;
  }
  $("#stringTags", stage)!.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-open-marker]");
    const other = b ? state.markers.get(b.dataset.openMarker!) : null;
    if (!other) return;
    setPendingOpen(other.id);
    openNote(other.noteId);
  });
  // light up a marker's strings while you hover it
  $("#ewrap", stage)!.addEventListener("pointerover", e => {
    const el = (e.target as Element).closest<HTMLElement>(".pin[data-pin]");
    document.querySelectorAll(".string.lit").forEach(g => g.classList.remove("lit"));
    if (el) document.querySelectorAll(`.string[data-a="${CSS.escape(el.dataset.pin!)}"], .string[data-b="${CSS.escape(el.dataset.pin!)}"]`).forEach(g => g.classList.add("lit"));
  });

  $("#rail", stage)!.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".rdot");
    if (!b) return;
    const pinEl = document.querySelector<HTMLElement>(`#editor .pin[data-pin="${CSS.escape(b.dataset.id!)}"]`);
    pinEl?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => openBox(b.dataset.id!, pinEl), 280);
  });
  const ro = new ResizeObserver(() => layoutRail());
  ro.observe($("#editor", stage)!);
  cleanup.push(() => ro.disconnect());
  const onScroll = () => { placeBtn.hidden = true; plusBtn.hidden = true; };
  stage.addEventListener("scroll", onScroll);
  cleanup.push(() => stage.removeEventListener("scroll", onScroll));
  const onResize = () => { layoutRail(); updateFloat(); };
  addEventListener("resize", onResize);
  cleanup.push(() => removeEventListener("resize", onResize));
  unsub = onChange(k => { if (k === "markers") { repaintAll(); layoutRail(); } });
  setTimeout(layoutRail, 50);
  const pend = takePendingOpen();
  if (pend) setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`#editor .pin[data-pin="${CSS.escape(pend)}"]`);
    el?.scrollIntoView({ block: "center" });
    openBox(pend, el);
  }, 120);
  if (!n.plain.trim() && n.title === "Untitled note") title.select();
}

export const currentEditor = () => ed;

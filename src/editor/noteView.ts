import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Diagram, MarkerMark, MarkerOutput, Pin, repaintAll } from "./extensions";
import { closeBox, openBox, setOpenNote, takePendingOpen, TYPE_INFO } from "./markerBox";
import { pinIds, setEditor } from "./ops";
import { courseColor, deleteNote, liveCourses, liveMarkers, markersOf, newCourse, newMarker, note, onChange, putMarker, putMeta, putNote, reconcilePins, state } from "../store";
import type { Note } from "../types";
import { $, armButton, debounce, esc, toast } from "../util";

let ed: Editor | null = null;
let unsub: (() => void) | null = null;
let cleanup: (() => void)[] = [];

export function destroyNote() {
  closeBox();
  cleanup.forEach(f => f());
  cleanup = [];
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
        <button class="tbtn ${state.meta.showTools ? "on" : ""}" id="toolsBtn" aria-pressed="${state.meta.showTools}" title="Show classic formatting tools">Aa</button>
        <button class="tbtn" id="delNote">Delete</button>
      </div>
      <div class="toolbar" id="toolbar" ${state.meta.showTools ? "" : "hidden"}>${TOOLS.map((t, i) => `<button data-i="${i}" title="${t[1]}" aria-label="${t[1]}">${esc(t[0])}</button>`).join("")}</div>
      <input class="ptitle" id="ptitle" value="${esc(n.title)}" aria-label="Title" maxlength="140" placeholder="Untitled note">
      ${backlinks.length ? `<div class="backlinks">Linked from ${backlinks.map(m => { const src = note(m.noteId); return src ? `<button data-open="${src.id}">${esc(src.title)}</button>` : ""; }).join("")}</div>` : ""}
      <div class="hint" id="hint">Select any text to place a marker. On an empty line, tap <b class="plus">+</b> to write or generate with one.</div>
      <div class="editorwrap"><div id="editor"></div><div class="rail" id="rail" aria-label="Markers on this page"></div></div>
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

  const save = debounce(() => {
    if (!ed) return;
    n = { ...n, doc: ed.getJSON(), html: null, plain: ed.getText({ blockSeparator: "\n" }).slice(0, 200000) };
    putNote(n);
  }, 600);
  cleanup.push(() => save.flush());

  ed = new Editor({
    element: $("#editor", stage)!,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline, Highlight, TaskList, TaskItem.configure({ nested: true }),
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
    n = { ...n, courseId: sel.value };
    putNote(n);
    $("#cdot", stage)!.style.background = courseColor(n.courseId);
  };
  nc.onkeydown = async e => {
    if (e.key === "Escape") { nc.hidden = true; sel.value = n.courseId; return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = nc.value.trim();
    if (!v) return;
    const c = liveCourses().find(x => x.name.toLowerCase() === v.toLowerCase()) || (await newCourse(v));
    n = { ...n, courseId: c.id };
    await putNote(n);
    sel.insertAdjacentHTML("afterbegin", `<option value="${c.id}">${esc(c.name)}</option>`);
    sel.value = c.id;
    nc.hidden = true;
    nc.value = "";
    $("#cdot", stage)!.style.background = c.color;
  };
  nc.onblur = () => { if (!nc.value.trim()) { nc.hidden = true; sel.value = n.courseId; } };
  const title = $("#ptitle", stage) as HTMLInputElement;
  title.oninput = () => { n = { ...n, title: title.value.trim() || "Untitled note" }; putNote(n); };
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

  /* ----- opening markers from the page ----- */
  const edEl = $("#editor", stage)!;
  edEl.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const pinEl = t.closest<HTMLElement>(".pin");
    if (pinEl?.dataset.pin) { e.preventDefault(); openBox(pinEl.dataset.pin, pinEl); return; }
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
    const ms = markersOf(id);
    const mastered = ms.filter(m => m.mastery === 2).length;
    const mc = $("#mcount");
    if (mc) mc.textContent = ms.length ? `${ms.length} marker${ms.length > 1 ? "s" : ""} · ${mastered} mastered` : "";
  }
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

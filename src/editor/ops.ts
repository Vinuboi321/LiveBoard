import type { Editor } from "@tiptap/core";
import { mdToNoteHtml } from "../md";
import { esc, uid } from "../util";
import { DOMSerializer } from "@tiptap/pm/model";

/* Editor operations the marker box performs. One editor is open at a time. */
let ed: Editor | null = null;
export const setEditor = (e: Editor | null) => { ed = e; };
export const editor = () => ed;

export function findPin(id: string): number | null {
  if (!ed) return null;
  let at: number | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (at !== null) return false;
    if (n.type.name === "pin" && n.attrs.id === id) { at = pos; return false; }
    return true;
  });
  return at;
}

export function markRange(id: string): { from: number; to: number } | null {
  if (!ed) return null;
  let from = Infinity, to = -1;
  ed.state.doc.descendants((n, pos) => {
    if (n.isText && n.marks.some(m => m.type.name === "marker" && m.attrs.id === id)) {
      from = Math.min(from, pos);
      to = Math.max(to, pos + n.nodeSize);
    }
  });
  return to < 0 ? null : { from, to };
}

export function contextAround(id: string) {
  if (!ed) return { before: "", after: "", note: "" };
  const doc = ed.state.doc;
  const p = findPin(id) ?? doc.content.size;
  const r = markRange(id);
  const start = r ? r.from : p;
  return {
    before: doc.textBetween(Math.max(0, start - 1500), start, "\n", " "),
    after: doc.textBetween(Math.min(doc.content.size, p + 1), Math.min(doc.content.size, p + 1500), "\n", " "),
    note: ed.getText({ blockSeparator: "\n" })
  };
}

/** Write a marker's result into the note, right after the block that holds the marker. */
export function insertOutput(id: string, markdown: string, extra: { mermaid?: string | null; calcLine?: string | null; status?: "pending" | "accepted" } = {}) {
  if (!ed) return false;
  const p = findPin(id);
  if (p === null) return false;
  const $p = ed.state.doc.resolve(p);
  const insertAt = $p.after($p.depth);
  let html = markdown.trim() ? mdToNoteHtml(markdown) : "";
  if (extra.calcLine) html += `<p><strong>${esc(extra.calcLine)}</strong></p>`;
  if (extra.mermaid) html += `<div data-diagram="" data-code="${esc(extra.mermaid)}"></div>`;
  if (!html) return false;
  ed.chain().insertContentAt(insertAt, `<div data-marker-output="${esc(id)}" data-oid="${uid()}" data-status="${extra.status || "pending"}">${html}</div>`).run();
  return true;
}

export type Fmt = "heading" | "subheading" | "list" | "numbered" | "checklist" | "bold" | "highlight" | "quote" | "plain";
export function applyFormat(id: string, fmt: Fmt) {
  if (!ed) return false;
  const p = findPin(id);
  if (p === null) return false;
  const r = markRange(id);
  const c = ed.chain().focus().setTextSelection(p);
  switch (fmt) {
    case "heading": c.setNode("heading", { level: 2 }); break;
    case "subheading": c.setNode("heading", { level: 3 }); break;
    case "list": c.toggleBulletList(); break;
    case "numbered": c.toggleOrderedList(); break;
    case "checklist": c.toggleTaskList(); break;
    case "quote": c.toggleBlockquote(); break;
    case "plain": c.setParagraph(); break;
    case "bold": if (r) c.setTextSelection(r).toggleBold(); break;
    case "highlight": if (r) c.setTextSelection(r).toggleHighlight(); break;
  }
  return c.run();
}

/** Remove a marker from the note: the pin goes, the passage stays as plain text. */
export function removeMarkerFromDoc(id: string) {
  if (!ed) return;
  const r = markRange(id);
  const chain = ed.chain();
  if (r) chain.setTextSelection(r).unsetMark("marker");
  chain.command(({ tr }) => {
    const p = findPin(id);
    if (p !== null) tr.delete(p, p + 1);
    return true;
  }).run();
}

/** Where a free marker dropped at a screen point should live: the nearest text position, plus an offset to the point. */
function anchorFor(x: number, y: number) {
  if (!ed) return null;
  const view = ed.view, box = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: Math.min(Math.max(x, box.left + 2), box.right - 2), top: Math.min(Math.max(y, box.top + 2), box.bottom - 2) });
  if (!hit) return null;
  let pos = hit.pos;
  const $p = ed.state.doc.resolve(pos);
  if (!$p.parent.inlineContent) {
    // between blocks: use the start of the nearest textblock
    let best: number | null = null;
    ed.state.doc.descendants((n, p) => { if (best === null && n.isTextblock && p + 1 >= pos - 1) best = p + 1; return best === null; });
    if (best === null) ed.state.doc.descendants((n, p) => { if (n.isTextblock) best = p + 1; });
    if (best === null) return null;
    pos = best;
  }
  const c = view.coordsAtPos(pos);
  return { pos, dx: Math.round(x - c.left), dy: Math.round(y - c.top) };
}

export function dropFreeMarker(id: string, x: number, y: number) {
  if (!ed) return false;
  const a = anchorFor(x, y);
  if (!a) return false;
  ed.chain().insertContentAt(a.pos, { type: "pin", attrs: { id, dx: a.dx, dy: a.dy } }).run();
  return true;
}

export function moveFreeMarker(id: string, x: number, y: number) {
  if (!ed) return false;
  const old = findPin(id);
  if (old === null) return false;
  const a = anchorFor(x, y);
  if (!a) return false;
  ed.chain().command(({ tr, state }) => {
    tr.delete(old, old + 1);
    const pos = tr.mapping.map(a.pos);
    tr.insert(pos, state.schema.nodes.pin.create({ id, dx: a.dx, dy: a.dy }));
    return true;
  }).run();
  // the anchor moved, so recompute the offset against where it actually landed
  const p = findPin(id);
  if (p !== null) {
    const c = ed.view.coordsAtPos(p);
    const dx = Math.round(x - c.left), dy = Math.round(y - c.top);
    ed.chain().command(({ tr }) => { tr.setNodeMarkup(p, undefined, { id, dx, dy }); return true; }).run();
  }
  return true;
}

/** Every block a marker wrote, with its current content (used to keep revision history). */
export function outputsInDoc() {
  const out: { pos: number; marker: string; oid: string | null; text: string; html: string }[] = [];
  if (!ed) return out;
  const ser = DOMSerializer.fromSchema(ed.schema);
  ed.state.doc.descendants((n, pos) => {
    if (n.type.name !== "markerOutput") return true;
    const box = document.createElement("div");
    box.appendChild(ser.serializeFragment(n.content));
    out.push({ pos, marker: n.attrs.marker, oid: n.attrs.oid, text: n.textContent.trim(), html: box.innerHTML });
    return false;
  });
  return out;
}
export function giveOutputIds() {
  if (!ed) return;
  const missing = outputsInDoc().filter(o => !o.oid);
  if (!missing.length) return;
  ed.chain().command(({ tr }) => {
    missing.forEach(o => { const n = tr.doc.nodeAt(o.pos); if (n) tr.setNodeMarkup(o.pos, undefined, { ...n.attrs, oid: uid() }); });
    tr.setMeta("addToHistory", false);
    return true;
  }).run();
}
export function restoreOutput(oid: string, html: string) {
  if (!ed) return false;
  const o = outputsInDoc().find(x => x.oid === oid);
  if (!o) return false;
  const n = ed.state.doc.nodeAt(o.pos)!;
  ed.chain().insertContentAt({ from: o.pos + 1, to: o.pos + n.nodeSize - 1 }, html).run();
  return true;
}
export function scrollToOutput(oid: string) {
  const el = document.querySelector<HTMLElement>(`#editor .mout[data-oid="${CSS.escape(oid)}"]`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.classList.add("flash");
  setTimeout(() => el?.classList.remove("flash"), 1200);
}

export function pinIds(): Set<string> {
  const ids = new Set<string>();
  ed?.state.doc.descendants(n => { if (n.type.name === "pin" && n.attrs.id) ids.add(n.attrs.id); });
  return ids;
}

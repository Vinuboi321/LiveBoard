import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { state } from "../store";

/* The marked passage: a faint highlight in the marker's type color. */
export const MarkerMark = Mark.create({
  name: "marker",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return { id: { default: null, parseHTML: el => el.getAttribute("data-marker"), renderHTML: a => ({ "data-marker": a.id }) } };
  },
  parseHTML() { return [{ tag: "span[data-marker]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "mk" }), 0]; }
});

/** Color a pin or highlight from its marker's current type and mastery. */
export function paintPin(el: HTMLElement) {
  const id = el.dataset.pin || el.dataset.marker;
  const m = id ? state.markers.get(id) : undefined;
  el.dataset.type = m?.type || "note";
  el.dataset.mastery = String(m?.mastery ?? 0);
}
export function repaintAll(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-pin],.mk[data-marker]").forEach(paintPin);
  root.querySelectorAll<HTMLElement>(".mout[data-marker-output]").forEach(el => {
    const m = state.markers.get(el.dataset.markerOutput || "");
    if (m) el.dataset.type = m.type;
  });
}

/* The marker itself. Inline: a small dot after its passage. Free (dx/dy set): an invisible anchor in the text with
   the dot floating at an offset from it, so it can sit anywhere on the page and still move with the words near it. */
const num = (v: string | null) => (v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
export const Pin = Node.create({
  name: "pin",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute("data-pin"), renderHTML: a => ({ "data-pin": a.id }) },
      dx: { default: null, parseHTML: el => num(el.getAttribute("data-dx")), renderHTML: a => (a.dx === null ? {} : { "data-dx": a.dx }) },
      dy: { default: null, parseHTML: el => num(el.getAttribute("data-dy")), renderHTML: a => (a.dy === null ? {} : { "data-dy": a.dy }) }
    };
  },
  parseHTML() { return [{ tag: "span[data-pin]" }, { tag: "button[data-pin]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "pin" })]; },
  addNodeView() {
    return ({ node }) => {
      let cur = node;
      const dot = document.createElement("span");
      dot.className = "pin";
      dot.dataset.pin = node.attrs.id;
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", "Open marker");
      dot.tabIndex = 0;
      const anchor = document.createElement("span");
      anchor.className = "pinanchor";
      anchor.contentEditable = "false";
      const place = () => {
        const free = cur.attrs.dx !== null && cur.attrs.dy !== null;
        dot.classList.toggle("free", free);
        if (free) {
          if (dot.parentNode !== anchor) anchor.appendChild(dot);
          dot.style.left = cur.attrs.dx + "px";
          dot.style.top = cur.attrs.dy + "px";
        } else { dot.style.left = dot.style.top = ""; }
        paintPin(dot);
      };
      place();
      const free = node.attrs.dx !== null && node.attrs.dy !== null;
      if (!free) dot.contentEditable = "false";
      return {
        dom: free ? anchor : dot,
        update(n) {
          if (n.type !== cur.type) return false;
          const wasFree = cur.attrs.dx !== null, isFree = n.attrs.dx !== null;
          if (wasFree !== isFree) return false; // re-create the view when switching between inline and free
          cur = n;
          place();
          return true;
        },
        ignoreMutation: () => true
      };
    };
  }
});

/* What a marker wrote into the note. Tinted until the student keeps it. */
export const MarkerOutput = Node.create({
  name: "markerOutput",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      marker: { default: null, parseHTML: el => el.getAttribute("data-marker-output"), renderHTML: a => ({ "data-marker-output": a.marker }) },
      status: { default: "pending", parseHTML: el => el.getAttribute("data-status") || "pending", renderHTML: a => ({ "data-status": a.status }) },
      oid: { default: null, parseHTML: el => el.getAttribute("data-oid"), renderHTML: a => (a.oid ? { "data-oid": a.oid } : {}) }
    };
  },
  parseHTML() { return [{ tag: "div[data-marker-output]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "mout" }), 0]; },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement("div");
      dom.className = "mout";
      const bar = document.createElement("div");
      bar.className = "moutbar";
      bar.contentEditable = "false";
      const content = document.createElement("div");
      content.className = "moutbody";
      dom.append(bar, content);
      const render = () => {
        dom.dataset.status = cur.attrs.status;
        dom.dataset.markerOutput = cur.attrs.marker;
        if (cur.attrs.oid) dom.dataset.oid = cur.attrs.oid;
        const m = state.markers.get(cur.attrs.marker);
        dom.dataset.type = m?.type || "explain";
        const revs = (m?.outputs?.[cur.attrs.oid] || []).length;
        bar.innerHTML = cur.attrs.status === "pending"
          ? `<button type="button" class="moutlabel" data-act="open" title="Open the marker that wrote this"><i></i>Written by a marker ↗</button><button type="button" data-act="keep">Keep</button><button type="button" data-act="undo">Remove</button>`
          : `<button type="button" class="moutsrc" data-act="open" title="Open the marker that wrote this${revs > 1 ? ` · ${revs} versions` : ""}"><i></i>${revs > 1 ? `${revs} versions · ` : ""}marker ↗</button>`;
        dom.classList.toggle("kept", cur.attrs.status !== "pending");
      };
      bar.addEventListener("mousedown", e => e.preventDefault());
      bar.addEventListener("click", e => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
        const pos = typeof getPos === "function" ? getPos() : null;
        if (!act || pos == null) return;
        if (act === "open") {
          dom.dispatchEvent(new CustomEvent("open-marker", { bubbles: true, detail: { id: cur.attrs.marker, oid: cur.attrs.oid } }));
          return;
        }
        editor.chain().command(({ tr }) => {
          if (act === "keep") tr.setNodeMarkup(pos, undefined, { ...cur.attrs, status: "accepted" });
          else tr.delete(pos, pos + cur.nodeSize);
          return true;
        }).run();
      });
      render();
      return {
        dom,
        contentDOM: content,
        update(n) { if (n.type !== cur.type) return false; cur = n; render(); return true; },
        ignoreMutation: m => !content.contains(m.target as globalThis.Node) || (m.type === "attributes" && m.target === dom)
      };
    };
  }
});

/* A diagram a marker drew (Mermaid source, rendered on screen). */
export const Diagram = Node.create({
  name: "diagram",
  group: "block",
  atom: true,
  addAttributes() {
    return { code: { default: "", parseHTML: el => el.getAttribute("data-code") || "", renderHTML: a => ({ "data-code": a.code }) } };
  },
  parseHTML() { return [{ tag: "div[data-diagram]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-diagram": "", class: "diagram" })]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "diagram";
      dom.contentEditable = "false";
      dom.innerHTML = `<div class="diagram-wait">Drawing diagram…</div>`;
      renderMermaid(node.attrs.code).then(svg => { dom.innerHTML = svg; }).catch(() => {
        dom.innerHTML = `<pre class="diagram-src"></pre>`;
        dom.querySelector("pre")!.textContent = node.attrs.code;
      });
      return { dom, ignoreMutation: () => true };
    };
  }
});

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
let n = 0;
async function renderMermaid(code: string) {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then(m => {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      m.default.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict", fontFamily: "Bricolage Grotesque, system-ui, sans-serif" });
      return m.default;
    });
  }
  const mermaid = await mermaidReady;
  const { svg } = await mermaid.render(`dg${Date.now()}${n++}`, code);
  return svg;
}

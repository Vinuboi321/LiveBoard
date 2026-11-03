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

/* The marker itself: a small dot after the passage (or alone on an empty line). */
export const Pin = Node.create({
  name: "pin",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { id: { default: null, parseHTML: el => el.getAttribute("data-pin"), renderHTML: a => ({ "data-pin": a.id }) } };
  },
  parseHTML() { return [{ tag: "span[data-pin]" }, { tag: "button[data-pin]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "pin" })]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "pin";
      dom.dataset.pin = node.attrs.id;
      dom.contentEditable = "false";
      dom.setAttribute("role", "button");
      dom.setAttribute("aria-label", "Open marker");
      dom.tabIndex = 0;
      paintPin(dom);
      return { dom, ignoreMutation: () => true };
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
      status: { default: "pending", parseHTML: el => el.getAttribute("data-status") || "pending", renderHTML: a => ({ "data-status": a.status }) }
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
        const m = state.markers.get(cur.attrs.marker);
        dom.dataset.type = m?.type || "explain";
        bar.innerHTML = cur.attrs.status === "pending"
          ? `<span class="moutlabel"><i></i>Written by a marker</span><button type="button" data-act="keep">Keep</button><button type="button" data-act="undo">Remove</button>`
          : "";
      };
      bar.addEventListener("mousedown", e => e.preventDefault());
      bar.addEventListener("click", e => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
        const pos = typeof getPos === "function" ? getPos() : null;
        if (!act || pos == null) return;
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

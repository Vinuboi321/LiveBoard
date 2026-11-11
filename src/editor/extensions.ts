import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { state } from "../store";
import { isDark } from "../theme";
import { PIC_SRC } from "./picture";

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
  const was = el.dataset.mastery, now = String(m?.mastery ?? 0);
  el.dataset.mastery = now;
  // a small flash the moment a marker becomes mastered
  if (was !== undefined && was !== "2" && now === "2" && el.classList.contains("pin")) { el.classList.add("spark"); setTimeout(() => el.classList.remove("spark"), 900); }
}
/* Highlights take their marker's type color. The editor redraws highlight spans as you type, which would drop a color
   set on the span itself, so the colors live in a small stylesheet keyed by marker id. */
let typeStyle: HTMLStyleElement | null = null;
function paintTypes() {
  const ids = new Set<string>();
  document.querySelectorAll<HTMLElement>("#editor .mk[data-marker]").forEach(el => ids.add(el.dataset.marker!));
  const css = [...ids].map(id => { const m = state.markers.get(id); return m ? `.mk[data-marker="${CSS.escape(id)}"]{--tc:var(--t-${m.type})}` : ""; }).join("");
  if (!typeStyle) { typeStyle = document.createElement("style"); typeStyle.id = "mkTypes"; document.head.appendChild(typeStyle); }
  if (typeStyle.textContent !== css) typeStyle.textContent = css;
}
export function repaintAll(root: ParentNode = document) {
  paintTypes();
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
      // writing that arrives while the note is open slides in; what was already there when it opened doesn't
      if (editor.isInitialized && node.attrs.status === "pending") { dom.classList.add("arrive"); setTimeout(() => dom.classList.remove("arrive"), 1200); }
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

/* A picture in the note: a pasted screenshot, a dropped file, a photo of the board. Stored inline (see picture.ts)
   and never loaded from a web address. Select it to change its size, describe it, or remove it. */
export const Picture = Node.create({
  name: "picture",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: el => { const v = el.getAttribute("src") || ""; return PIC_SRC.test(v) ? v : ""; }, renderHTML: a => (PIC_SRC.test(a.src) ? { src: a.src } : {}) },
      alt: { default: "", parseHTML: el => (el.getAttribute("alt") || "").slice(0, 300), renderHTML: a => ({ alt: a.alt || "" }) },
      w: { default: "m", parseHTML: el => (["s", "m", "l"].includes(el.getAttribute("data-w") || "") ? el.getAttribute("data-w") : "m"), renderHTML: a => ({ "data-w": a.w }) }
    };
  },
  parseHTML() { return [{ tag: 'img[src^="data:image/"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(HTMLAttributes, { class: "pic" })]; },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement("figure");
      dom.className = "pic"; dom.contentEditable = "false";
      const img = document.createElement("img"), bar = document.createElement("div"), cap = document.createElement("figcaption");
      img.draggable = false; img.decoding = "async";
      bar.className = "picbar";
      const set = (attrs: Record<string, string>) => { const pos = getPos(); if (typeof pos === "number") editor.chain().setNodeSelection(pos).updateAttributes("picture", attrs).run(); };
      const paint = () => {
        if (PIC_SRC.test(cur.attrs.src)) img.src = cur.attrs.src; else img.removeAttribute("src");
        img.alt = cur.attrs.alt || "";
        dom.dataset.w = cur.attrs.w;
        cap.textContent = cur.attrs.alt || ""; cap.hidden = !cur.attrs.alt;
        bar.innerHTML = `<span role="group" aria-label="Picture size">${([["s", "Small"], ["m", "Medium"], ["l", "Full"]] as const).map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${cur.attrs.w === k}">${l}</button>`).join("")}</span><button type="button" data-do="cap">${cur.attrs.alt ? "Edit caption" : "Caption"}</button><button type="button" data-do="del" aria-label="Remove picture">Remove</button>`;
      };
      bar.onmousedown = e => e.preventDefault(); // keep the picture selected while pressing its buttons
      bar.onclick = e => {
        const b = (e.target as Element).closest<HTMLElement>("button");
        if (!b) return;
        if (b.dataset.w) return set({ w: b.dataset.w });
        if (b.dataset.do === "del") { const pos = getPos(); if (typeof pos === "number") editor.chain().focus().deleteRange({ from: pos, to: pos + cur.nodeSize }).run(); return; }
        // caption: an inline field in the bar, so there's no dialog to dismiss
        bar.innerHTML = `<input type="text" maxlength="300" placeholder="What is this a picture of?" aria-label="Caption"><button type="button" data-do="ok">Done</button>`;
        const inp = bar.querySelector("input")!;
        inp.value = cur.attrs.alt || "";
        inp.onmousedown = ev => ev.stopPropagation();
        const done = () => set({ alt: inp.value.trim() });
        inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); done(); } if (ev.key === "Escape") paint(); };
        bar.querySelector<HTMLElement>('[data-do="ok"]')!.onclick = ev => { ev.stopPropagation(); done(); };
        inp.focus();
      };
      dom.append(img, cap, bar);
      paint();
      return {
        dom,
        update: n => { if (n.type.name !== "picture") return false; cur = n; paint(); return true; },
        selectNode: () => dom.classList.add("on"),
        deselectNode: () => { dom.classList.remove("on"); paint(); },
        stopEvent: e => !!(e.target as Element | null)?.closest?.(".picbar"),
        ignoreMutation: () => true
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
      const dark = isDark();
      m.default.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict", fontFamily: "Bricolage Grotesque, system-ui, sans-serif" });
      return m.default;
    });
  }
  const mermaid = await mermaidReady;
  const { svg } = await mermaid.render(`dg${Date.now()}${n++}`, code);
  return svg;
}

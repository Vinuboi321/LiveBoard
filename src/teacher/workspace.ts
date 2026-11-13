import { askMarker } from "../ai";
import { mdToHtml } from "../md";
import { esc, toast, uid } from "../util";
import { mediaURL, packWorksheet, teacherDB, unpackWorksheet, type Hub, type Response, type Worksheet, type HubAnchor, type OCRWord } from "./model";
import "./workspace.css";
import { mountNoteTools, noteToolbar } from "./notetools";
import { ocrLayer, scanWords } from "./ocr";
import { clamp, dragRect, styleRect, union, type PlacementMode } from "./anchors";

export function renderTeacher(root: HTMLElement, initialId?: string): () => void {
  const db = teacherDB();
  let alive = true, current: Worksheet | null = null, selected: Hub | null = null;
  let preview = false, placement: PlacementMode | null = null, page = 1, pageCount = 1, revision = 0;
  let cleanupPage = () => {};
  let pendingText: HubAnchor | null = null;
  let tools: ReturnType<typeof mountNoteTools> | null = null;
  let scanBusy = false;
  let pdf: import("pdfjs-dist").PDFDocumentProxy | null = null;
  let pdfTask: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
  let objectURL: string | null = null, pageContext = "";
  let writeQueue = Promise.resolve();
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const run = (fn: () => Promise<unknown>) => { void fn().catch(e => { if (alive) toast(e.message || "Something went wrong.", 6000); }); };
  function save() {
    if (!current) return;
    current.updatedAt = Date.now();
    // Snapshot each edit so a later mutation cannot alter an already queued write.
    const snapshot = structuredClone(current);
    writeQueue = writeQueue.catch(() => {}).then(async () => { await db.worksheets.put(snapshot); });
    void writeQueue.catch(() => toast("Couldn't save this worksheet. Keep this page open and export a copy.", 8000));
  }
  function releaseDocument() {
    revision++; cleanupPage();
    void pdfTask?.destroy(); pdfTask = null; pdf = null;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
  }
  root.innerHTML = `<section class="teacher"><header class="tw-head"><div><span class="tw-eyebrow">TEACHER WORKSPACE</span><h1>Worksheet studio</h1><p>Place interactive hubs on your worksheet. Keep the document, expand what students can do.</p></div><a class="btn" href="#">Student notes ↗</a></header>
    <div class="tw-toolbar"><label class="btn primary">Upload document<input id="tw-upload" type="file" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp" hidden></label><label class="btn">Open lesson file<input id="tw-open" type="file" accept=".json" hidden></label><label class="tw-picker">Saved lessons<select id="tw-lessons" aria-label="Saved lessons"><option value="">Choose a lesson</option></select></label><span id="tw-status" role="status">Saved on this device · export to share</span></div>
    <div id="tw-work"><div class="tw-empty"><span class="tw-orbit">✦</span><h2>Your worksheet is the starting point.</h2><p>Upload a PDF, image, or text document. Add questions, progressive hints, media, and space for students to think—right where they belong.</p><p>PDF pages keep their original text, pictures, and layout. Scans work too.</p></div></div></section>`;
  async function list() {
    const items = await db.worksheets.orderBy("updatedAt").reverse().toArray();
    if (!alive) return;
    q<HTMLSelectElement>("#tw-lessons").innerHTML = `<option value="">Choose a lesson</option>` + items.map(w => `<option value="${esc(w.id)}">${esc(w.title)}</option>`).join("");
    if (current) q<HTMLSelectElement>("#tw-lessons").value = current.id;
  }
  async function open(w: Worksheet, student = false) {
    releaseDocument();
    q("#tw-work").innerHTML = '<p role="status">Opening document…</p>';
    root.querySelector('#tw-remove-menu')?.remove(); root.querySelector('#tw-undo-remove')?.remove();
    current = w; selected = null; page = 1; pageCount = 1; preview = student; placement = null;
    const token = revision;
    if (w.sourceKind === "pdf") {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      if (!alive || token !== revision) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      pdfTask = pdfjs.getDocument({ data: new Uint8Array(await w.source.arrayBuffer()), isEvalSupported: false });
      try { pdf = await pdfTask.promise; }
      catch { throw new Error("Couldn't open that PDF. Use an unlocked, valid PDF."); }
      if (!alive || token !== revision) return;
      if (pdf.numPages > 150) { releaseDocument(); throw new Error("Use a PDF with 150 pages or fewer."); }
      pageCount = pdf.numPages;
    } else if (w.sourceKind === "image") objectURL = URL.createObjectURL(w.source);
    if (!alive || token !== revision) return;
    shell(); await drawPage(); await list();
  }
  function shell() {
    if (!current) return;
    q("#tw-work").innerHTML = `<div class="tw-lessonbar"><label>Lesson title<input id="tw-title" maxlength="200" value="${esc(current.title)}" ${preview ? "readonly" : ""}></label><button class="btn" id="tw-preview">${preview ? "Back to authoring" : "Preview as student"}</button><button class="btn" id="tw-export">Export lesson</button></div>
      <details class="tw-instruction-details"><summary>Lesson instructions</summary><label class="tw-instructions">Student instructions<textarea id="tw-instructions" maxlength="10000" ${preview ? "readonly" : ""} placeholder="What should students explore or complete?">${esc(current.instructions)}</textarea></label></details>
      <div class="tw-dashboard">${noteToolbar}</div><div class="tw-layout"><div class="tw-document"><span id="tw-placement" class="tw-sr-status" role="status"></span><div id="tw-page" class="tw-page"></div><nav id="tw-marker-list" aria-label="Worksheet markers"></nav></div><div id="tw-hub-window" class="tw-hub-window" role="dialog" aria-label="Marker hub" hidden><div class="tw-hub-chrome"><span>◎ FLUID MARKER</span><button id="tw-close-hub" aria-label="Close marker hub" type="button">×</button></div><aside id="tw-hub" class="tw-hub" aria-label="Marker content"></aside></div></div>`;
    q("#tw-close-hub").onclick = closeHub;
    q("#tw-place").hidden = preview;
    q<HTMLInputElement>("#tw-title").oninput = e => { current!.title = (e.target as HTMLInputElement).value; save(); };
    q<HTMLTextAreaElement>("#tw-instructions").oninput = e => { current!.instructions = (e.target as HTMLTextAreaElement).value; save(); };
    q("#tw-preview").onclick = () => { preview = !preview; placement = null; shell(); run(async () => { await drawPage(); if (selected) await hub(); }); };
    q("#tw-export").onclick = () => run(async () => {
      const blob = new Blob([await packWorksheet(current!)], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `${current!.title.replace(/[^a-z0-9_-]/gi, "_") || "lesson"}.liveboard.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Lesson exported. Students can open it in Teacher Studio with Open lesson file. Responses are not included.", 8000);
    });
    q("#tw-place").onclick = () => { tools?.select(); setPlacement(placement === 'region' ? null : 'region'); };
    q("#tw-prev").onclick = () => changePage(-1);
    q("#tw-next").onclick = () => changePage(1);
  }
  function closeHub() {
    const h = selected; selected = null;
    q('#tw-hub-window').hidden = true;
    if (h) root.querySelector<HTMLButtonElement>(`[aria-label="Open marker: ${CSS.escape(h.title)}"]`)?.focus();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') root.querySelector('#tw-remove-menu')?.remove();
    if (e.key === 'Escape' && placement) { e.preventDefault(); setPlacement(null); }
    else if (e.key === 'Escape' && root.querySelector('#tw-hub-window:not([hidden])')) { e.preventDefault(); closeHub(); }
  };
  document.addEventListener('keydown', onKey);
  function changePage(delta: number) { page = Math.max(1, Math.min(pageCount, page + delta)); run(drawPage); }
  async function drawPage() {
    if (!current || !alive) return;
    const token = ++revision, w = current, pageNumber = page;
    cleanupPage(); pendingText = null;
    const surface = q("#tw-page"); surface.innerHTML = "";
    const disposers: (() => void)[] = [];
    q("#tw-page-label").textContent = `Page ${page} of ${pageCount}`;
    q<HTMLButtonElement>("#tw-prev").disabled = page === 1;
    q<HTMLButtonElement>("#tw-next").disabled = page === pageCount;
    if (pdf) {
      const p = await pdf.getPage(pageNumber);
      if (!alive || token !== revision) return;
      const original = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: Math.min(Math.max(1.6, surface.clientWidth / original.width * Math.min(devicePixelRatio || 1, 2)), 2000 / original.width, 3000 / original.height) });
      const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
      canvas.setAttribute("aria-label", `Document page ${pageNumber}. Use the marker list below to open activities.`);
      surface.appendChild(canvas);
      await p.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const text = await p.getTextContent();
      if (!alive || token !== revision) return;
      pageContext = text.items.map(i => "str" in i ? i.str : "").join(" ").slice(0, 5000);
      const pdfjs = await import("pdfjs-dist");
      if (!alive || token !== revision) return;
      const layer = document.createElement('div'); layer.className = 'textLayer tw-pdf-text';
      layer.style.setProperty('--scale-factor', String(viewport.scale));
      layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`;
      surface.appendChild(layer);
      const textLayer = new pdfjs.TextLayer({ textContentSource: text, container: layer, viewport });
      await textLayer.render();
      if (!alive || token !== revision) return;
      const scaleText = () => { layer.style.transform = `scale(${surface.clientWidth / viewport.width})`; };
      scaleText(); const observer = new ResizeObserver(scaleText); observer.observe(surface);
      disposers.push(() => { observer.disconnect(); textLayer.cancel(); });
      if (!alive || token !== revision) { disposers.forEach(f => f()); return; }
    } else if (w.sourceKind === "image") {
      surface.innerHTML = `<img class="tw-source-image" src="${esc(objectURL)}" alt="${esc(w.filename)}">`;
      pageContext = "";
      await surface.querySelector<HTMLImageElement>("img")!.decode();
    } else {
      const text = await w.source.text();
      if (!alive || token !== revision) return;
      surface.innerHTML = `<div class="tw-text">${esc(text)}</div>`; pageContext = text.slice(0, 5000);
    }
    if (!alive || token !== revision) return;
    const addText = document.createElement('button'); addText.id = 'tw-place-selection'; addText.className = 'btn primary tw-place-selection';
    addText.textContent = '+ Add marker'; addText.hidden = true;
    addText.onpointerdown = e => e.preventDefault();
    addText.onclick = () => { if (pendingText) createHub(pendingText); };
    surface.appendChild(addText);
    const selectionChanged = () => {
      if (placement === 'region' || !['select', undefined].includes(surface.dataset.noteTool)) return;
      const selection = window.getSelection();
      addText.hidden = true; pendingText = null;
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!surface.contains(range.startContainer) || !surface.contains(range.endContainer)) return;
      const text = selection.toString().trim().slice(0, 5000); if (!text) return;
      const bounds = surface.getBoundingClientRect();
      const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1).slice(0, 100).map(r => {
        const x = clamp((r.left-bounds.left)/bounds.width), y = clamp((r.top-bounds.top)/bounds.height);
        return { x, y, width: clamp((r.right-bounds.left)/bounds.width)-x, height: clamp((r.bottom-bounds.top)/bounds.height)-y };
      }).filter(r => r.width > 0 && r.height > 0);
      if (!rects.length) return;
      pendingText = { kind: 'text', text, rects };
      const box = rects[rects.length-1];
      addText.style.top = `${(box.y+box.height)*100}%`;
      addText.hidden = preview;
      addText.style.left = `${Math.max(0, Math.min(box.x*surface.clientWidth, surface.clientWidth - addText.offsetWidth - 8))}px`;
    };
    document.addEventListener('selectionchange', selectionChanged);
    disposers.push(() => document.removeEventListener('selectionchange', selectionChanged));
    let start: { x: number; y: number } | null = null, draggingId: number | null = null;
    const selectionBox = document.createElement('div'); selectionBox.className = 'tw-drag-selection'; selectionBox.hidden = true; surface.appendChild(selectionBox);
    const point = (e: PointerEvent) => { const r = surface.getBoundingClientRect(); return { x: clamp((e.clientX-r.left)/r.width), y: clamp((e.clientY-r.top)/r.height) }; };
    const cancelDrag = () => { start = null; draggingId = null; selectionBox.hidden = true; };
    surface.onpointerdown = e => {
      if (preview || placement !== 'region' || e.button !== 0 || (e.target as Element).closest('button')) return;
      e.preventDefault(); start = point(e); draggingId = e.pointerId; surface.setPointerCapture(e.pointerId);
      selectionBox.hidden = false; styleRect(selectionBox, { ...start, width: 0, height: 0 });
    };
    surface.onpointermove = e => { if (start && draggingId === e.pointerId) styleRect(selectionBox, dragRect(start, point(e))); };
    surface.onpointerup = e => {
      if (!start || draggingId !== e.pointerId) return;
      const rect = dragRect(start, point(e));
      cancelDrag(); if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
      if (placement !== 'region' || preview) return;
      if (rect.width * surface.clientWidth < 8 || rect.height * surface.clientHeight < 8) { toast('Drag a box around the content, like taking a screenshot.'); return; }
      createHub({ kind: 'region', rects: [rect] });
    };
    surface.onpointercancel = cancelDrag;
    cleanupPage = () => { cancelDrag(); disposers.forEach(f => f()); surface.onpointerdown = surface.onpointermove = surface.onpointerup = surface.onpointercancel = null; };
    pins(); setPlacement(placement);
    tools = mountNoteTools(root, surface, w, pageNumber, save, () => pendingText, () => setPlacement(null), scanCurrent);
    disposers.push(() => { tools?.destroy(); tools = null; });
    let disposeOCR = () => {};
    const cached = w.ocr?.[String(pageNumber)];
    if (cached) { surface.querySelector('.tw-pdf-text')?.remove(); disposeOCR = ocrLayer(cached, surface); pageContext = cached.map(x=>x.text).join(' ').slice(0,5000); }
    disposers.push(() => disposeOCR());
    async function scanCurrent() {
      if (scanBusy) return;
      const source = surface.querySelector<HTMLCanvasElement | HTMLImageElement>('canvas, .tw-source-image');
      if (!source) { toast('This page already contains selectable text.'); return; }
      scanBusy = true; q<HTMLButtonElement>('#nt-scan').disabled = true;
      const status = (text:string) => { if (alive && token === revision) q('#nt-status').textContent = text; };
      status('Scanning page locally…');
      try {
        const words: OCRWord[] = await scanWords(source, status);
        if (!alive || token !== revision) return;
        (w.ocr ||= {})[String(pageNumber)] = words; save();
        // Avoid duplicate overlapping text when a PDF already supplied a native text layer.
        surface.querySelector('.tw-pdf-text')?.remove(); disposeOCR(); disposeOCR = ocrLayer(words, surface);
        pageContext = words.map(x=>x.text).join(' ').slice(0,5000);
        status(words.length ? `Scan ready · ${words.length} selectable words. OCR can contain errors.` : 'No words found. Try a clearer scan or use Add marker to select a region.');
      } finally { scanBusy = false; if (alive && token === revision) q<HTMLButtonElement>('#nt-scan').disabled = false; }
    }
    if (!cached && !pageContext.trim() && (pdf || w.sourceKind === 'image')) run(scanCurrent);
  }
  function setPlacement(mode: PlacementMode | null) {
    placement = preview ? null : mode;
    const surface = q('#tw-page');
    surface.dataset.placement = placement || '';
    if (placement && root.querySelector('#tw-hub-window:not([hidden])')) closeHub();
    window.getSelection()?.removeAllRanges(); pendingText = null;
    root.querySelector<HTMLElement>('#tw-place-selection')?.setAttribute('hidden', '');
    root.querySelector<HTMLElement>('.tw-drag-selection')?.setAttribute('hidden', '');
    q('#tw-place').setAttribute('aria-pressed', String(placement === 'region'));
    q('#tw-placement').textContent = preview ? 'Select words to copy or highlight. Open a marker to explore.' : placement === 'region' ? 'Drag a region for the marker. Escape cancels.' : 'Select words for a marker or highlight. Add marker draws a region. Right-click a marker to remove it.';
  }
  function createHub(anchor: HubAnchor) {
    if (!current || preview) return;
    if (current.hubs.length >= 200) { toast('This lesson has reached its 200 marker limit.'); return; }
    const box = union(anchor.rects);
    const h: Hub = { id: uid(), page, x: Math.min(.98,box.x+box.width), y: Math.max(.02,box.y), anchor,
      title: anchor.kind === 'text' ? (anchor.text || 'Selected text').slice(0, 65) : `${anchor.kind === 'image' ? 'Image' : 'Region'} activity ${current.hubs.length+1}`,
      context: anchor.text || '', prompt: '', hints: [], explanation: '', media: '', mediaKind: 'image', allowAI: false };
    current.hubs.push(h); selected = h; setPlacement(null); save(); pins(); run(hub);
  }

  function pins() {
    const surface = q("#tw-page"); surface.querySelectorAll(".tw-pin,.tw-anchor-zone").forEach(p => p.remove());
    current!.hubs.filter(h => h.page === page).forEach(h => {
      h.anchor?.rects.forEach(rect => {
        const zone = document.createElement('button'); zone.className = `tw-anchor-zone tw-anchor-${h.anchor!.kind}`;
        zone.setAttribute('aria-label', `Open selected ${h.anchor!.kind}: ${h.title}`); zone.title = h.title; styleRect(zone, rect);
        zone.oncontextmenu = e => showRemove(e,h);
        zone.onclick = e => { e.stopPropagation(); selected = h; setPlacement(null); run(hub); }; surface.appendChild(zone);
      });
      const b = document.createElement("button"); b.className = "tw-pin"; b.textContent = String(current!.hubs.indexOf(h) + 1);
      b.style.left = `${h.x * 100}%`; b.style.top = `${h.y * 100}%`; b.title = h.title; b.setAttribute("aria-label", `Open marker: ${h.title}`);
      b.oncontextmenu = e => showRemove(e,h);
      b.onclick = e => { e.stopPropagation(); selected = h; setPlacement(null); run(hub); }; surface.appendChild(b);
    });
    q("#tw-marker-list").innerHTML = current!.hubs.map((h, i) => `<button class="tw-list-item" data-hub="${esc(h.id)}"><b>${i + 1}</b> ${esc(h.title)} <small>Page ${h.page}</small></button>`).join("");
    q("#tw-marker-list").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => run(async () => {
      selected = current!.hubs.find(h => h.id === b.dataset.hub)!;
      if (page !== selected.page) { page = selected.page; await drawPage(); }
      await hub();
    }));
  }
  function showRemove(e: MouseEvent, h: Hub) {
    if (preview) return;
    e.preventDefault(); e.stopPropagation(); root.querySelector('#tw-remove-menu')?.remove();
    const menu = document.createElement('div'); menu.id='tw-remove-menu'; menu.className='tw-remove-menu'; menu.setAttribute('role','dialog'); menu.setAttribute('aria-label','Remove marker?');
    menu.style.left=`${Math.min(e.clientX,innerWidth-240)}px`;menu.style.top=`${Math.min(e.clientY,innerHeight-130)}px`;
    menu.innerHTML='<b>Remove this marker?</b><p>The document stays unchanged.</p><button class="btn" data-remove>Remove marker</button><button class="btn" data-cancel>Cancel</button>';
    menu.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick=()=>menu.remove();
    menu.querySelector<HTMLButtonElement>('[data-remove]')!.onclick=()=>{
      const w = current!, originalIndex = w.hubs.findIndex(m=>m.id===h.id); w.hubs=w.hubs.filter(m=>m.id!==h.id);if(selected===h)closeHub();save();pins();menu.remove();
      root.querySelector('#tw-undo-remove')?.remove(); const undo=document.createElement('button');undo.id='tw-undo-remove';undo.className='btn';undo.textContent='Undo marker removal';q('.tw-toolbar').appendChild(undo);
      undo.onclick=()=>{if(current!==w){undo.remove();return;} w.hubs.splice(originalIndex,0,h);save();pins();undo.remove();};
    };
    root.appendChild(menu);menu.querySelector<HTMLButtonElement>('button')!.focus();
  }
  function showAnchor(pane: HTMLElement, h: Hub) {
    if (!h.anchor) return;
    const card = document.createElement('div'); card.className = 'tw-anchor-preview';
    const label = document.createElement('small'); label.textContent = `${h.anchor.kind === 'region' ? 'Selected region' : h.anchor.kind === 'image' ? 'Selected image / diagram' : 'Highlighted words'} · page ${h.page}`; card.appendChild(label);
    if (h.anchor.kind === 'text') { const quote = document.createElement('blockquote'); quote.textContent = h.anchor.text || h.context; card.appendChild(quote); }
    else if (h.page === page) {
      const source = root.querySelector<HTMLCanvasElement | HTMLImageElement>('#tw-page canvas, #tw-page .tw-source-image');
      if (source) {
        const rect = union(h.anchor.rects), width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth, height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
        if (width && height) {
          const crop = document.createElement('canvas'), scale = Math.min(1, 800/(width*rect.width), 800/(height*rect.height)); crop.width = Math.max(1,Math.round(width*rect.width*scale)); crop.height = Math.max(1,Math.round(height*rect.height*scale));
          crop.getContext('2d')!.drawImage(source, rect.x*width,rect.y*height,rect.width*width,rect.height*height,0,0,crop.width,crop.height);
          crop.setAttribute('aria-label', 'Selected document content'); card.appendChild(crop);
        }
      }
    }
    pane.prepend(card);
  }
  async function hub() {
    const h = selected, w = current; if (!h || !w) return;
    const pane = q("#tw-hub");
    q("#tw-hub-window").hidden = false;
    if (!preview) {
      pane.innerHTML = `<span class="tw-eyebrow">MARKER ${w.hubs.indexOf(h) + 1} / AUTHOR</span><h2>Build the interaction</h2><p>Everything here is student-visible. Save answer keys elsewhere.</p>
        <label>Marker name<input data-field="title" maxlength="200" value="${esc(h.title)}"></label>
        <label>Relevant passage or image description<textarea data-field="context" maxlength="5000" placeholder="Describe the exact concept at this point, especially for scanned pages.">${esc(h.context)}</textarea></label>
        <label>Question or exploration prompt<textarea data-field="prompt" maxlength="10000" placeholder="What should students predict, investigate, or explain?">${esc(h.prompt)}</textarea></label>
        <label>Progressive hints · one per line<textarea id="tw-hints" placeholder="Start with a small nudge…">${esc(h.hints.join("\n"))}</textarea></label>
        <label>Explanation · available after a response<textarea data-field="explanation" maxlength="10000">${esc(h.explanation)}</textarea></label>
        <label>Media type<select id="tw-media-kind"><option value="image" ${h.mediaKind === "image" ? "selected" : ""}>Image</option><option value="video" ${h.mediaKind === "video" ? "selected" : ""}>Video (direct file)</option></select></label>
        <label>Optional HTTPS media URL<input data-field="media" maxlength="2000" value="${esc(h.media)}" placeholder="https://…"></label><p class="tw-small">Use a direct image or video file. Media loads only when the student chooses to open it.</p>
        <label class="tw-check"><input id="tw-ai" type="checkbox" ${h.allowAI ? "checked" : ""}>Allow AI follow-up questions</label><p class="tw-small">Requires the existing AI server and sign-in setup. Selected context and questions are sent to that service; PDF images are not sent.</p><button class="btn" id="tw-delete">Remove marker</button><span class="tw-small">Changes save automatically on this device.</span>`;
      showAnchor(pane, h);
      pane.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]").forEach(input => input.oninput = () => {
        const field = input.dataset.field as "title" | "context" | "prompt" | "explanation" | "media";
        h[field] = input.value; save(); if (field === "title") pins();
      });
      q<HTMLTextAreaElement>("#tw-hints").oninput = e => { h.hints = (e.target as HTMLTextAreaElement).value.split("\n").filter(s => s.trim()).slice(0, 20).map(s => s.slice(0, 2000)); save(); };
      q<HTMLSelectElement>("#tw-media-kind").onchange = e => { h.mediaKind = (e.target as HTMLSelectElement).value as "image" | "video"; save(); };
      q<HTMLInputElement>("#tw-ai").onchange = e => { h.allowAI = (e.target as HTMLInputElement).checked; save(); };
      q("#tw-delete").onclick = () => { w.hubs = w.hubs.filter(x => x.id !== h.id); selected = null; save(); pins(); pane.innerHTML = "<p>Marker removed.</p>"; };
      return;
    }
    const responseId = `${w.id}:${h.id}`;
    const r: Response = await db.responses.get(responseId) || { id: responseId, answer: "", revealed: 0, explanation: false, thread: [] };
    if (!alive || selected !== h || current !== w || !preview) return;
    const persist = () => { run(async () => { await db.responses.put(structuredClone(r)); }); };
    pane.innerHTML = `<span class="tw-eyebrow">MARKER ${w.hubs.indexOf(h) + 1} / EXPLORE</span><h2>${esc(h.title)}</h2>${h.context ? `<blockquote>${esc(h.context)}</blockquote>` : ""}<div class="tw-markdown">${mdToHtml(h.prompt || "Your teacher hasn't added a prompt yet.")}</div>
      <label>Your thinking<textarea id="tw-answer" maxlength="10000" placeholder="Make a prediction, explain your reasoning, or describe what you notice…">${esc(r.answer)}</textarea></label><p class="tw-small">Practice response saved on this device. It is not submitted to a teacher.</p>
      <div id="tw-hint-content"></div><button class="btn" id="tw-hint" ${h.hints.length ? "" : "hidden"}>Reveal next hint</button>
      <button class="btn" id="tw-explain" ${h.explanation ? "" : "hidden"}>Explore the explanation</button><div id="tw-explanation"></div>
      ${mediaURL(h.media) ? `<button class="btn" id="tw-media">Open ${h.mediaKind}</button><p class="tw-small">Loads from ${esc(new URL(h.media).hostname)}.</p><div id="tw-media-content"></div>` : ""}
      ${h.allowAI ? `<hr><h3>Ask this marker</h3><p class="tw-small">Questions and this marker's context are sent to the configured AI service. AI replies can be wrong.</p><div id="tw-thread"></div><form id="tw-ask"><label>Follow-up question<input id="tw-question" maxlength="2000" required></label><button class="btn primary">Ask</button><p id="tw-ask-status" role="status"></p></form>` : ""}`;
    showAnchor(pane, h);
    function support() {
      q("#tw-hint-content").innerHTML = h!.hints.slice(0, r.revealed).map((hint, i) => `<div class="tw-hint"><b>Hint ${i + 1}</b>${mdToHtml(hint)}</div>`).join("");
      q<HTMLButtonElement>("#tw-hint").disabled = r.revealed >= h!.hints.length;
      q<HTMLButtonElement>("#tw-explain").disabled = !r.answer.trim();
      q("#tw-explanation").innerHTML = r.explanation && r.answer.trim() ? mdToHtml(h!.explanation) : "";
    }
    q<HTMLTextAreaElement>("#tw-answer").oninput = e => { r.answer = (e.target as HTMLTextAreaElement).value; persist(); support(); };
    q("#tw-hint").onclick = () => { r.revealed = Math.min(h.hints.length, r.revealed + 1); persist(); support(); };
    q("#tw-explain").onclick = () => { r.explanation = true; persist(); support(); };
    support();
    if (mediaURL(h.media)) q("#tw-media").onclick = () => {
      const box = q("#tw-media-content"); box.innerHTML = "";
      const el = document.createElement(h.mediaKind === "image" ? "img" : "video"); el.src = mediaURL(h.media)!;
      el.setAttribute("referrerpolicy", "no-referrer"); if (el instanceof HTMLVideoElement) el.controls = true; else el.alt = h.title;
      box.appendChild(el);
    };
    if (h.allowAI) {
      const showThread = () => { q("#tw-thread").innerHTML = r.thread.map(m => `<div class="tw-message"><b>${m.role === "user" ? "You" : "Marker"}</b>${mdToHtml(m.text)}</div>`).join(""); };
      showThread();
      q<HTMLFormElement>("#tw-ask").onsubmit = e => { e.preventDefault(); run(async () => {
        const input = q<HTMLInputElement>("#tw-question"), question = input.value.trim(); if (!question) return;
        const button = q<HTMLButtonElement>("#tw-ask button"); button.disabled = true;
        const context = h.context || pageContext;
        r.thread.push({ role: "user", text: question, at: Date.now() }); persist(); showThread(); input.value = "";
        try {
          const answer = await askMarker({ intent: question, passage: context.slice(0, 5000), before: "", after: "", note: `Teacher activity: ${h.prompt}\nStudent's thinking: ${r.answer}`.slice(0, 10000), title: w.title, course: "Worksheet", thread: r.thread.slice(-12) });
          r.thread.push({ role: "marker", text: answer.markdown, at: Date.now() }); persist();
          if (alive && selected === h && preview && pane.isConnected) { showThread(); q("#tw-ask-status").textContent = ""; }
        } catch (err) { if (alive && selected === h && preview && pane.isConnected) q("#tw-ask-status").textContent = (err as Error).message; }
        finally { button.disabled = false; }
      }); };
    }
  }
  q<HTMLSelectElement>("#tw-lessons").onchange = e => run(async () => {
    await writeQueue; const w = await db.worksheets.get((e.target as HTMLSelectElement).value); if (w && alive) await open(w);
  });
  q<HTMLInputElement>("#tw-upload").onchange = e => run(async () => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = ""; if (!f) return;
    if (f.size > 20 * 1024 * 1024) throw new Error("Choose a document under 20 MB.");
    const kind = /\.pdf$/i.test(f.name) ? "pdf" : /\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : /\.(txt|md)$/i.test(f.name) ? "text" : null;
    if (!kind) throw new Error("Choose PDF, PNG, JPEG, WebP, TXT, or Markdown.");
    const w: Worksheet = { id: uid(), title: f.name.replace(/\.[^.]+$/, "").slice(0, 200), instructions: "", source: f, sourceKind: kind, filename: f.name, hubs: [], updatedAt: Date.now() };
    await open(w); await db.worksheets.put(w); await list();
  });
  q<HTMLInputElement>("#tw-open").onchange = e => run(async () => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = ""; if (!f) return;
    if (f.size > 30 * 1024 * 1024) throw new Error("Lesson file is over 30 MB.");
    const w = unpackWorksheet(await f.text()); await open(w, true); await db.worksheets.put(w); await list();
  });
  run(async () => { await list(); if (initialId) { const w = await db.worksheets.get(initialId); if (w && alive) { await open(w); } } });
  return () => { document.removeEventListener('keydown', onKey); alive = false; releaseDocument(); void writeQueue.finally(() => db.close()); };
}

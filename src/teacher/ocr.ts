import type { OCRWord } from "./model";

/** English OCR runs entirely in a local worker with assets served by this app. */
export async function scanWords(source: HTMLCanvasElement | HTMLImageElement, status: (s: string) => void): Promise<OCRWord[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: new URL("/ocr/worker.min.js", location.href).href,
    corePath: new URL("/ocr/tesseract-core-lstm.wasm.js", location.href).href,
    langPath: new URL("/ocr", location.href).href, workerBlobURL: false,
    logger: m => status(`${m.status} · ${Math.round(m.progress * 100)}%`)
  });
  try {
    const result = await worker.recognize(source, {}, { blocks: true });
    const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    const words: OCRWord[] = [];
    for (const block of result.data.blocks || []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) for (const word of line.words) {
      const { x0,y0,x1,y1 } = word.bbox;
      if (word.text.trim() && x1 > x0 && y1 > y0) words.push({ text:word.text, x:x0/width, y:y0/height, width:(x1-x0)/width, height:(y1-y0)/height });
    }
    return words.slice(0, 20000);
  } finally { await worker.terminate(); }
}
export function ocrLayer(words: OCRWord[], surface: HTMLElement) {
  surface.querySelector(".tw-ocr-text")?.remove();
  const layer = document.createElement("div"); layer.className = "tw-ocr-text";
  for (const word of words) {
    const span = document.createElement("span"); span.textContent = word.text + " ";
    span.style.left = `${word.x*100}%`; span.style.top = `${word.y*100}%`; span.style.width = `${word.width*100}%`; span.style.height = `${word.height*100}%`;
    layer.appendChild(span);
  }
  surface.appendChild(layer);
  const resize = () => layer.querySelectorAll<HTMLSpanElement>("span").forEach((span,i) => { span.style.fontSize = `${Math.max(5,words[i].height*surface.clientHeight)}px`; });
  resize(); const observer = new ResizeObserver(resize); observer.observe(surface);
  return () => observer.disconnect();
}

import { esc, toast } from "./util";
import { mdToNoteHtml } from "./md";

/* Turn an uploaded lecture file into note HTML. */
export async function fileToHtml(file: File): Promise<{ title: string; html: string } | null> {
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Imported lecture";
  if (file.size > 40 * 1024 * 1024) { toast("That file is over 40 MB. Try a smaller export."); return null; }
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return { title, html: await pdfToHtml(file) };
  if (/\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown") return { title, html: mdToNoteHtml(await file.text()) };
  if (/\.txt$/i.test(file.name) || file.type.startsWith("text/")) return { title, html: textToHtml(await file.text()) };
  toast("Import a .pdf, .txt or .md file.");
  return null;
}

export function textToHtml(t: string) {
  return t.replace(/\r/g, "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, " ")}</p>`).join("") || "<p></p>";
}

async function pdfToHtml(file: File) {
  toast("Reading PDF…", 8000);
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(doc.numPages, 150);
  let html = "";
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Group text runs into lines by their vertical position, then lines into paragraphs by the gaps between them.
    const lines: { y: number; h: number; text: string }[] = [];
    for (const it of tc.items as { str: string; transform: number[]; height: number; hasEOL?: boolean }[]) {
      if (!("str" in it)) continue;
      const y = Math.round(it.transform[5]);
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < 3) last.text += (last.text.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
      else lines.push({ y, h: it.height || 12, text: it.str });
    }
    const clean = lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter(l => l.text);
    if (!clean.length) continue;
    html += `<h3>Page ${p}</h3>`;
    let para: string[] = [];
    const flush = () => { if (para.length) html += `<p>${esc(para.join(" ").replace(/- (\w)/g, "$1"))}</p>`; para = []; };
    clean.forEach((l, i) => {
      const prev = clean[i - 1];
      if (prev && prev.y - l.y > Math.max(prev.h, l.h) * 1.7) flush();
      if (/^[•●▪◦\-–]\s/.test(l.text)) { flush(); para.push(l.text.replace(/^[•●▪◦\-–]\s/, "• ")); flush(); return; }
      para.push(l.text);
    });
    flush();
  }
  if (doc.numPages > pages) html += `<p><em>Only the first ${pages} of ${doc.numPages} pages were imported.</em></p>`;
  if (!html) throw new Error("That PDF has no selectable text. Scanned PDFs need OCR, which LiveBoard doesn't do yet.");
  return html;
}

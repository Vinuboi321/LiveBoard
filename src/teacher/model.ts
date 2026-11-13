import Dexie, { type Table } from "dexie";
import { state } from "../store";

export interface AnchorRect { x: number; y: number; width: number; height: number }
export interface HubAnchor { kind: "region" | "text" | "image"; rects: AnchorRect[]; text?: string }
export interface Hub {
  id: string; page: number; x: number; y: number;
  title: string; context: string; prompt: string; hints: string[];
  explanation: string; media: string; mediaKind: "image" | "video"; allowAI: boolean;
  anchor?: HubAnchor;
}
export interface Worksheet {
  id: string; title: string; instructions: string; source: Blob;
  sourceKind: "pdf" | "text" | "image"; filename: string; hubs: Hub[]; updatedAt: number;
  markup?: PageMarkup[];
  ocr?: Record<string, OCRWord[]>;
}
export interface OCRWord { text: string; x: number; y: number; width: number; height: number }
export interface PageMarkup {
  id: string; page: number; kind: "highlight" | "pen" | "text" | "shape" | "image"; color: string;
  rects?: AnchorRect[]; points?: { x: number; y: number }[]; width?: number;
  x?: number; y?: number; text?: string; font?: string; size?: number; bold?: boolean; italic?: boolean;
  shape?: "rectangle" | "ellipse" | "line"; image?: string; opacity?: number;
}
export const NOTE_FONTS = ["Arial", "Georgia", "Courier New", "cursive"];
export function validateMarkup(value: unknown): PageMarkup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2000) throw new Error("Invalid annotations.");
  const unit = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return value.map(m => {
    if (!m || typeof m.id !== "string" || m.id.length > 100 || !Number.isInteger(m.page) || m.page < 1 || m.page > 150 || !/^#[0-9a-f]{6}$/i.test(m.color)) throw new Error("Invalid annotation.");
    const base = { id: m.id, page: m.page, color: m.color };
    if (m.kind === "pen" && Array.isArray(m.points) && m.points.length <= 10000 && m.points.length > 0 && m.points.every((p: {x: number;y: number}) => p && unit(p.x) && unit(p.y)) && Number.isFinite(m.width) && m.width >= 1 && m.width <= 30)
      return { ...base, kind: "pen", width: m.width, points: m.points.map((p: {x:number;y:number}) => ({ x:p.x,y:p.y })), ...(m.opacity === .3 ? {opacity:.3} : {}) };
    const validRect = Array.isArray(m.rects) && m.rects.length === 1 && m.rects.every((r:AnchorRect) => r && unit(r.x) && unit(r.y) && unit(r.width) && unit(r.height) && r.width > 0 && r.height > 0 && r.x+r.width <= 1.00001 && r.y+r.height <= 1.00001);
    if (m.kind === "shape" && validRect && ["rectangle","ellipse","line"].includes(m.shape) && Number.isFinite(m.width) && m.width >= 1 && m.width <= 30)
      return { ...base, kind:"shape", shape:m.shape,width:m.width,rects:m.rects.map((r:AnchorRect)=>({x:r.x,y:r.y,width:r.width,height:r.height})) };
    if (m.kind === "image" && validRect && typeof m.image === "string" && m.image.length <= 3_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.image))
      return { ...base, kind:"image",image:m.image,rects:m.rects.map((r:AnchorRect)=>({x:r.x,y:r.y,width:r.width,height:r.height})) };
    if (m.kind === "highlight" && Array.isArray(m.rects) && m.rects.length > 0 && m.rects.length <= 100 && m.rects.every((r: AnchorRect) => r && unit(r.x) && unit(r.y) && unit(r.width) && unit(r.height) && r.width > 0 && r.height > 0 && r.x+r.width <= 1.00001 && r.y+r.height <= 1.00001))
      return { ...base, kind: "highlight", rects: m.rects.map((r:AnchorRect)=>({x:r.x,y:r.y,width:r.width,height:r.height})) };
    if (m.kind === "text" && unit(m.x) && unit(m.y) && typeof m.text === "string" && m.text.length <= 10000 && NOTE_FONTS.includes(m.font) && Number.isFinite(m.size) && m.size >= 10 && m.size <= 72 && typeof m.bold === "boolean" && typeof m.italic === "boolean")
      return { ...base, kind: "text", x:m.x,y:m.y,text:m.text,font:m.font,size:m.size,bold:m.bold,italic:m.italic };
    throw new Error("Invalid annotation content.");
  });
}
export interface Response {
  id: string; answer: string; revealed: number; explanation: boolean;
  thread: { role: "user" | "marker"; text: string; at: number }[];
}
class TeacherDB extends Dexie {
  worksheets!: Table<Worksheet, string>;
  responses!: Table<Response, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ worksheets: "id,updatedAt", responses: "id" });
  }
}
// Keep local teacher documents isolated by the same account boundary as notes.
export function teacherDB() {
  return new TeacherDB(`liveboard-teacher-${state.owner || "signed-out"}`);
}
export function mediaURL(raw: string): string | null {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}

/** Portable lesson files contain only student-visible material, never student responses. */
export async function packWorksheet(w: Worksheet) {
  const bytes = new Uint8Array(await w.source.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const portable = { ...w }; delete portable.ocr;
  return JSON.stringify({ format: "liveboard-worksheet", version: 1, ...portable, source: btoa(binary) });
}
export function unpackWorksheet(raw: string): Worksheet {
  const v = JSON.parse(raw);
  const str = (s: unknown, max: number) => typeof s === "string" && s.length <= max;
  if (v.format !== "liveboard-worksheet" || v.version !== 1 || !str(v.title, 200) || !str(v.instructions, 10000)
    || !str(v.filename, 255) || !["pdf", "text", "image"].includes(v.sourceKind)
    || !str(v.source, 28_000_000) || !Array.isArray(v.hubs) || v.hubs.length > 200) throw new Error("Invalid worksheet file.");
  const hubs: Hub[] = v.hubs.map((h: Hub) => {
    if (!Number.isInteger(h.page) || h.page < 1 || h.page > 150 || !Number.isFinite(h.x) || h.x < 0 || h.x > 1
      || !Number.isFinite(h.y) || h.y < 0 || h.y > 1 || !str(h.title, 200) || !str(h.context, 5000)
      || !str(h.prompt, 10000) || !str(h.explanation, 10000) || !str(h.media, 2000)
      || !["image", "video"].includes(h.mediaKind) || typeof h.allowAI !== "boolean"
      || !Array.isArray(h.hints) || h.hints.length > 20 || !h.hints.every(s => str(s, 2000))) throw new Error("Invalid marker in worksheet.");
    let anchor: HubAnchor | undefined;
    if (h.anchor !== undefined) {
      const a = h.anchor;
      if (!a || !["region", "text", "image"].includes(a.kind) || !Array.isArray(a.rects) || !a.rects.length || a.rects.length > 100
        || (a.text !== undefined && !str(a.text, 5000))) throw new Error("Invalid marker selection.");
      const rects = a.rects.map(r => {
        if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0
          || r.x + r.width > 1.00001 || r.y + r.height > 1.00001) throw new Error("Invalid marker selection bounds.");
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      anchor = { kind: a.kind, rects, ...(a.text !== undefined ? { text: a.text } : {}) };
    }
    return { id: crypto.randomUUID(), page: h.page, x: h.x, y: h.y, title: h.title, context: h.context,
      prompt: h.prompt, hints: h.hints, explanation: h.explanation, media: mediaURL(h.media) || "", mediaKind: h.mediaKind, allowAI: h.allowAI, ...(anchor ? { anchor } : {}) };
  });
  const bytes = Uint8Array.from(atob(v.source), c => c.charCodeAt(0));
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Worksheet source is over 20 MB.");
  const mime = v.sourceKind === "pdf" ? "application/pdf" : v.sourceKind === "text" ? "text/plain" : "application/octet-stream";
  const markup = validateMarkup(v.markup);
  // OCR is a disposable cache; imported lessons rescan locally instead of trusting arbitrary text-layer geometry.
  return { id: crypto.randomUUID(), title: v.title, instructions: v.instructions, filename: v.filename,
    sourceKind: v.sourceKind, source: new Blob([bytes], { type: mime }), hubs, markup, updatedAt: Date.now() };
}

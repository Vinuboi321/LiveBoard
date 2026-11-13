import type { AnchorRect } from "./model";

export type PlacementMode = "region" | "text" | "image";
export function clamp(n: number) { return Math.max(0, Math.min(1, n)); }
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }): AnchorRect {
  return { x: clamp(Math.min(a.x, b.x)), y: clamp(Math.min(a.y, b.y)), width: Math.abs(clamp(a.x) - clamp(b.x)), height: Math.abs(clamp(a.y) - clamp(b.y)) };
}
export function union(rects: AnchorRect[]): AnchorRect {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
}
export function styleRect(el: HTMLElement, r: AnchorRect) {
  el.style.left = `${r.x * 100}%`; el.style.top = `${r.y * 100}%`;
  el.style.width = `${r.width * 100}%`; el.style.height = `${r.height * 100}%`;
}

type Matrix = number[];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
/** Use PDF drawing bounds, never the location of an arbitrary click, to anchor images/diagrams. */
export function graphicRects(list: { fnArray: number[]; argsArray: any[] }, ops: Record<string, number>, viewport: { transform: number[]; width: number; height: number }): AnchorRect[] {
  let matrix = [1,0,0,1,0,0]; const stack: Matrix[] = [], boxes: AnchorRect[] = [];
  const box = (bounds: number[]) => {
    const m = multiply(viewport.transform, matrix);
    const pts = [[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]].map(([x,y]) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
    const x = clamp(Math.min(...pts.map(p=>p[0])) / viewport.width), y = clamp(Math.min(...pts.map(p=>p[1])) / viewport.height);
    const right = clamp(Math.max(...pts.map(p=>p[0])) / viewport.width), bottom = clamp(Math.max(...pts.map(p=>p[1])) / viewport.height);
    const r = { x, y, width: right-x, height: bottom-y };
    if (r.width * viewport.width > 8 && r.height * viewport.height > 8 && r.width*r.height > .0002 && r.width*r.height < .98) boxes.push(r);
  };
  list.fnArray.forEach((op, i) => {
    const args = list.argsArray[i];
    if (op === ops.save) stack.push([...matrix]);
    else if (op === ops.restore) matrix = stack.pop() || [1,0,0,1,0,0];
    else if (op === ops.paintFormXObjectBegin) { stack.push([...matrix]); if (args?.[0]?.length === 6) matrix = multiply(matrix, args[0]); }
    else if (op === ops.paintFormXObjectEnd) matrix = stack.pop() || [1,0,0,1,0,0];
    else if (op === ops.transform && args?.length === 6) matrix = multiply(matrix, args);
    else if ([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject].includes(op)) box([0,0,1,1]);
    else if (op === ops.constructPath && args?.[2]?.length === 4 && args[2].every(Number.isFinite)) box(args[2]);
  });
  // Repeated vector rectangles (fraction bars, chart columns) on the same row form one diagram.
  const merged: AnchorRect[] = [];
  for (const r of boxes) {
    const existing = merged.find(b => Math.abs(b.y-r.y)<.004 && Math.abs(b.height-r.height)<.004 && r.x <= b.x+b.width+.006 && b.x <= r.x+r.width+.006);
    if (existing) Object.assign(existing, union([existing,r])); else merged.push({...r});
  }
  return merged.slice(0, 300);
}

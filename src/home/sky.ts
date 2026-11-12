import { courseColor, courseName, liveMarkers, note } from "../store";
import { isDue, recallable } from "../study";
import type { Marker } from "../types";
import { esc } from "../util";

/* The sky: every marker you've placed, drawn as a star. Markers in the same note join into a constellation, courses
   sit side by side, and the links you made between markers cross the sky as threads. A hollow star is one you're
   unsure of, a bright one is mastered, and a twinkling one is due for recall. Tap a star to open its marker. */

const MASTERY = ["Unsure", "Getting it", "Mastered"];
const MAX_STARS = 320;
const ros = new WeakMap<HTMLElement, ResizeObserver>(); // one per sky: the small chart and the full map can both be up

/** A repeatable random number generator from a string, so the sky looks the same every time it's drawn. */
function seeded(key: string) {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) { h = Math.imul(h ^ key.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/** `tall` draws the full-size map: it fills whatever height its box has, spreads constellations out and names more of them. */
export function renderSky(el: HTMLElement, open: (id: string) => void, opts: { tall?: boolean } = {}) {
  ros.get(el)?.disconnect();
  ros.delete(el);
  const tall = !!opts.tall;
  const all = liveMarkers().filter(m => !m.detachedAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STARS);
  if (all.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  let lastW = 0, lastH = 0;
  const draw = () => {
    const W = Math.round(el.clientWidth), Hb = Math.round(el.clientHeight);
    if (!W || (Math.abs(W - lastW) < 8 && (!tall || Math.abs(Hb - lastH) < 8))) return;
    lastW = W; lastH = Hb;
    paint(el, all, W, open, tall);
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  ros.set(el, ro);
}

function paint(el: HTMLElement, all: Marker[], W: number, open: (id: string) => void, tall: boolean) {
  const H = tall ? Math.max(280, Math.round(el.clientHeight)) : Math.round(Math.max(200, Math.min(300, W * 0.25)));
  const k = tall ? Math.min(1.9, Math.max(1.15, H / 300)) : 1; // how much the full map spreads things out
  const top = tall ? 46 : 30, bottom = H - (tall ? 56 : 40);
  // course → note → markers (oldest first, so a constellation grows in the order it was marked)
  const byCourse = new Map<string, Map<string, Marker[]>>();
  for (const m of [...all].sort((a, b) => a.createdAt - b.createdAt)) {
    const cid = note(m.noteId)?.courseId || "";
    if (!byCourse.has(cid)) byCourse.set(cid, new Map());
    const notes = byCourse.get(cid)!;
    notes.set(m.noteId, [...(notes.get(m.noteId) || []), m]);
  }
  const courses = [...byCourse].map(([cid, notes]) => ({ cid, notes, n: [...notes.values()].reduce((t, ms) => t + ms.length, 0) })).sort((a, b) => courseName(a.cid).localeCompare(courseName(b.cid)));
  const weights = courses.map(c => 1.4 + Math.sqrt(c.n)), total = weights.reduce((a, b) => a + b, 0);
  const pos = new Map<string, { x: number; y: number }>();
  const noteCount = courses.reduce((t, c) => t + c.notes.size, 0);
  const placed: { x: number; y: number; w: number }[] = []; // note names already drawn, so two never overlap
  let x0 = 0, body = "", labels = "";
  courses.forEach((c, ci) => {
    // neighbouring courses sit a little higher and lower, so the sky doesn't read as one straight row
    const slot = W * weights[ci] / total, cx = x0 + slot / 2, cy = (top + bottom) / 2 + (ci % 2 ? 1 : -1) * (bottom - top) * 0.16, color = courseColor(c.cid);
    const rx = Math.max(10, slot * 0.3), ry = (bottom - top) * (tall ? 0.3 : 0.26);
    const noteList = [...c.notes];
    noteList.forEach(([nid, ms], j) => {
      const rnd = seeded(nid);
      const ang = j * 2.399963 + rnd() * 6.283, rad = noteList.length === 1 ? 0.15 : Math.sqrt((j + 0.5) / noteList.length);
      let x = cx + Math.cos(ang) * rad * rx, y = cy + Math.sin(ang) * rad * ry, heading = rnd() * 6.283;
      const pts: [number, number][] = [];
      ms.forEach(m => {
        x = Math.min(Math.max(x, x0 + 10), x0 + slot - 10);
        y = Math.min(Math.max(y, top), bottom);
        pts.push([x, y]);
        pos.set(m.id, { x, y });
        heading += (rnd() - 0.5) * 1.9;
        const step = (24 + rnd() * 18) * k;
        x += Math.cos(heading) * step; y += Math.sin(heading) * step * 0.85;
      });
      const stars = ms.map((m, k) => {
        const [sx, sy] = pts[k], r = (4 + Math.min(3, m.thread.length * 0.5 + (m.links?.length || 0) * 0.4)) * (tall ? 1.35 : 1);
        const tick = m.closedAt ? `<path class="tick" d="M${(sx - r * 0.5).toFixed(1)} ${sy.toFixed(1)}l${(r * 0.38).toFixed(1)} ${(r * 0.42).toFixed(1)}l${(r * 0.68).toFixed(1)} -${(r * 0.85).toFixed(1)}"/>` : "";
        return `<g class="star${isDue(m) && recallable(m) ? " due" : ""}${m.closedAt ? " closed" : ""}" data-m="${m.id}" data-type="${m.type}" data-mastery="${m.mastery}" style="--tw:${(rnd() * 3).toFixed(2)}s"><circle class="hit" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="13"/><circle class="dot" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}"/>${tick}</g>`;
      }).join("");
      // the note's name sits under its lowest star; with a crowded sky it only shows for the constellation you point at
      const low = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), title = note(nid)?.title || "";
      const shown = title.length > 26 ? title.slice(0, 25) + "…" : title, lw = shown.length * (tall ? 6.6 : 5.6) + 10;
      const lx = Math.min(Math.max(low[0], lw / 2 + 4), W - lw / 2 - 4), ly = low[1] + (tall ? 26 : 20);
      const clash = noteCount > (tall ? 44 : 14) || placed.some(p => Math.abs(p.y - ly) < 14 && Math.abs(p.x - lx) < (p.w + lw) / 2);
      if (!clash) placed.push({ x: lx, y: ly, w: lw });
      const name = `<text class="${clash ? "quiet" : ""}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(shown)}</text>`;
      body += `<g class="con" data-n="${nid}" data-c="${esc(c.cid)}" style="--c:${color};--ci:${j + ci}">${pts.length > 1 ? `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}"/>` : ""}${name}${stars}</g>`;
    });
    if (slot > courseName(c.cid).length * 6.6 + 22) labels += `<span style="left:${(100 * cx / W).toFixed(2)}%;--c:${color}"><i></i>${esc(courseName(c.cid))}</span>`;
    x0 += slot;
  });
  // threads: links the student made between markers
  let threads = "";
  const seen = new Set<string>();
  for (const m of all) for (const oid of m.links || []) {
    const key = [m.id, oid].sort().join("|"), a = pos.get(m.id), b = pos.get(oid);
    if (seen.has(key) || !a || !b) continue;
    seen.add(key);
    const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - Math.min(46, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
    threads += `<path class="thread" data-a="${m.id}" data-b="${oid}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
  }
  // faint background stars
  const rnd = seeded("sky" + W);
  let dust = "";
  for (let i = 0; i < Math.round(W / 14); i++) dust += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${(0.4 + rnd() * 0.8).toFixed(1)}" opacity="${(0.12 + rnd() * 0.3).toFixed(2)}"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A map of your ${all.length} markers, grouped by course. The cards below list the most recent ones.">
      <g class="dust">${dust}</g><g class="threads">${threads}</g>${body}</svg>
    <div class="skylabels" aria-hidden="true">${labels}</div>
    <div class="skykey" aria-hidden="true"><span><i data-mastery="0"></i>unsure</span><span><i data-mastery="1"></i>getting it</span><span><i data-mastery="2"></i>mastered</span>${all.some(m => m.closedAt) ? `<span><i class="done"></i>closed out</span>` : ""}${threads ? `<span><i class="ln"></i>your links</span>` : ""}</div>
    <div class="skytip" id="skyTip" hidden></div>`;
  if (!tall) el.style.height = H + "px";

  const svg = el.querySelector("svg")!, tip = el.querySelector<HTMLElement>("#skyTip")!;
  const byId = new Map(all.map(m => [m.id, m]));
  const focus = (g: SVGGElement | null) => {
    svg.querySelectorAll(".on").forEach(x => x.classList.remove("on"));
    svg.classList.toggle("focus", !!g);
    tip.hidden = !g;
    if (!g) return;
    const m = byId.get(g.dataset.m!), p = pos.get(g.dataset.m!);
    if (!m || !p) return;
    g.closest(".con")?.classList.add("on");
    svg.querySelectorAll<SVGPathElement>(`.thread[data-a="${CSS.escape(m.id)}"], .thread[data-b="${CSS.escape(m.id)}"]`).forEach(t => {
      t.classList.add("on");
      const other = t.dataset.a === m.id ? t.dataset.b! : t.dataset.a!;
      svg.querySelector(`.star[data-m="${CSS.escape(other)}"]`)?.closest(".con")?.classList.add("on");
    });
    const n = note(m.noteId);
    tip.dataset.type = m.type;
    tip.innerHTML = `<b>${m.text ? esc(m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text) : "A blank point"}</b><small>${esc(n?.title || "")} · ${MASTERY[m.mastery]}${isDue(m) && recallable(m) ? " · due" : ""}</small>`;
    tip.style.left = Math.min(Math.max(p.x, 120), W - 120) + "px";
    tip.style.top = p.y + "px";
    tip.classList.toggle("below", p.y < 70);
  };
  svg.addEventListener("pointerover", e => focus((e.target as Element).closest<SVGGElement>(".star")));
  svg.addEventListener("pointerleave", () => focus(null));
  svg.addEventListener("click", e => {
    const g = (e.target as Element).closest<SVGGElement>(".star");
    if (g) open(g.dataset.m!);
  });
}

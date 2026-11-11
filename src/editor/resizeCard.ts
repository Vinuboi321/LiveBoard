/* Resizing the marker card. Pull any side or corner and the card behaves like something elastic rather than a window:

   - it chases your hand on a loose spring, so it lags a little, overshoots and settles;
   - while it's moving fast along one axis it thins along the other, and leans into a diagonal pull;
   - the corner you hold pinches tighter while the far corners round out, and the edge you hold glows and bows;
   - pulled past its smallest or largest size it keeps giving, less and less, then snaps back when you let go;
   - on release a ripple runs off the edge you pulled, and a small readout of the new size fades away.

   The size you settle on is remembered on this device. Arrow keys on a focused handle adjust it, and a double-click
   springs it back to the standard size. With reduced motion on, the card simply follows the pointer. */

type Box = { l: number; t: number; w: number; h: number };
const DEF_W = 500, DEF_H = 680, MIN_W = 320, MIN_H = 280, KEY = "lb-card-size";
const DIRS = ["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const;
const NAMES: Record<string, string> = { n: "top", e: "right", s: "bottom", w: "left", ne: "top right", se: "bottom right", sw: "bottom left", nw: "top left" };
const quiet = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let preferred: { width: number; height: number } | null = load();
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && v.width >= MIN_W && v.height >= MIN_H ? { width: v.width, height: v.height } : null; } catch { return null; }
}
function remember(size: { width: number; height: number } | null) {
  preferred = size && { width: Math.round(size.width), height: Math.round(size.height) };
  try { if (preferred) localStorage.setItem(KEY, JSON.stringify(preferred)); else localStorage.removeItem(KEY); } catch { /* private mode: lasts until reload */ }
}
/** The size the student last chose for the card, if any. */
export const markerSize = () => preferred;

/** Called on every frame the card's size changes, so the open tab can use the room (the Write box fills it). */
let sizeHook: (() => void) | null = null;
export const onCardSize = (fn: (() => void) | null) => { sizeHook = fn; };

// One pull at a time, kept outside bindResize because the card redraws (and rebinds) while a pull can still be settling.
let rz: { card: HTMLElement; dir: string; tgt: Box; cur: Box; vel: Box; down: boolean; raf: number; last: number; save: boolean; onResize: () => void } | null = null;

const room = () => ({ right: innerWidth - 8, bottom: Math.round(visualViewport?.height || innerHeight) - 8, left: 8, top: 64 });
/** The nearest allowed box: on screen, no smaller than the minimum, holding the side opposite the one being pulled. */
function fit(b: Box, dir: string): Box {
  const R = room(), minW = Math.min(MIN_W, R.right - R.left), minH = Math.min(MIN_H, R.bottom - R.top);
  let l = b.l, t = b.t, r = b.l + b.w, bt = b.t + b.h;
  if (dir.includes("e")) r = Math.min(R.right, Math.max(l + minW, r));
  if (dir.includes("w")) l = Math.max(R.left, Math.min(r - minW, l));
  if (dir.includes("s")) bt = Math.min(R.bottom, Math.max(t + minH, bt));
  if (dir.includes("n")) t = Math.max(R.top, Math.min(bt - minH, t));
  return { l, t, w: r - l, h: bt - t };
}
/** Past a limit the card still gives a little, less the further you pull (like the end of a scroll on a phone). */
const give = (over: number) => Math.sign(over) * 46 * (1 - Math.exp(-Math.abs(over) / 110));
function rubber(raw: Box, dir: string): Box {
  const ok = fit(raw, dir), out = { ...ok };
  if (quiet()) return out;
  const dr = give(raw.l + raw.w - (ok.l + ok.w)), db = give(raw.t + raw.h - (ok.t + ok.h)), dl = give(raw.l - ok.l), dt = give(raw.t - ok.t);
  if (dir.includes("e")) out.w += dr;
  if (dir.includes("s")) out.h += db;
  if (dir.includes("w")) { out.l += dl; out.w -= dl; }
  if (dir.includes("n")) { out.t += dt; out.h -= dt; }
  return out;
}
const boxOf = (card: HTMLElement): Box => { const r = card.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; };

function begin(card: HTMLElement, dir: string, tgt: Box, down: boolean, save: boolean, onResize: () => void) {
  const from = rz && rz.card === card ? { cur: rz.cur, vel: rz.vel } : { cur: boxOf(card), vel: { l: 0, t: 0, w: 0, h: 0 } };
  cancelAnimationFrame(rz?.raf ?? 0);
  rz = { card, dir, tgt, cur: { ...from.cur }, vel: { ...from.vel }, down, raf: 0, last: performance.now(), save, onResize };
  card.classList.add("resized", "resizing");
  card.dataset.rz = dir;
  // the far side stays put: stretch, squash and lean all happen away from it
  card.style.transformOrigin = `${dir.includes("w") ? "100%" : dir.includes("e") ? "0%" : "50%"} ${dir.includes("n") ? "100%" : dir.includes("s") ? "0%" : "50%"}`;
  rz.raf = requestAnimationFrame(frame);
}

/** One frame of the pull: a damped spring on each side of the box, plus the squash, lean and pinch that follow from how fast it's moving. */
function frame(now: number) {
  if (!rz) return;
  const { card, tgt, cur, vel, dir } = rz;
  if (!card.isConnected) { rz = null; return; }
  const dt = Math.min(0.032, (now - rz.last) / 1000) || 0.016;
  rz.last = now;
  const K = 250, C = 16.5; // stiffness and damping: slightly under-damped, so it overshoots once and settles
  let rest = !rz.down;
  if (quiet()) { Object.assign(cur, tgt); vel.l = vel.t = vel.w = vel.h = 0; }
  else for (const k of ["l", "t", "w", "h"] as const) {
    vel[k] += (K * (tgt[k] - cur[k]) - C * vel[k]) * dt;
    cur[k] += vel[k] * dt;
    if (Math.abs(tgt[k] - cur[k]) > 0.4 || Math.abs(vel[k]) > 6) rest = false;
  }
  const s = card.style;
  s.left = cur.l.toFixed(1) + "px"; s.top = cur.t.toFixed(1) + "px";
  s.width = Math.max(120, cur.w).toFixed(1) + "px"; s.height = Math.max(120, cur.h).toFixed(1) + "px";
  if (!quiet()) {
    // how fast each pulled side is travelling, signed so "growing" is positive
    const vx = dir.includes("w") ? -vel.l : dir.includes("e") ? vel.w : 0, vy = dir.includes("n") ? -vel.t : dir.includes("s") ? vel.h : 0;
    const thin = (v: number) => 1 - Math.min(0.04, Math.abs(v) / 24000);
    const lean = (v: number) => Math.max(-1.6, Math.min(1.6, v / 900));
    const sx = dir.includes("w") ? -1 : 1, sy = dir.includes("n") ? -1 : 1;
    const corner = dir.length === 2; // only a diagonal pull leans
    s.transform = `scale(${thin(vy).toFixed(4)}, ${thin(vx).toFixed(4)})${corner ? ` skew(${(lean(vx) * sy).toFixed(3)}deg, ${(lean(vy) * sx).toFixed(3)}deg)` : ""}`;
    const pull = Math.min(1, (Math.abs(vx) + Math.abs(vy)) / 1300), strain = Math.min(1, (Math.abs(tgt.w - cur.w) + Math.abs(tgt.h - cur.h) + Math.abs(tgt.l - cur.l) + Math.abs(tgt.t - cur.t)) / 90);
    s.setProperty("--pull", Math.max(pull, strain).toFixed(2));
  }
  let chip = card.querySelector<HTMLElement>(".wssize");
  if (!chip) { chip = document.createElement("span"); chip.className = "wssize"; chip.setAttribute("aria-hidden", "true"); card.appendChild(chip); }
  const shown = fit(tgt, dir);
  chip.textContent = `${Math.round(shown.w)} × ${Math.round(shown.h)}`;
  rz.onResize(); sizeHook?.();
  if (rest) {
    Object.assign(s, { left: Math.round(tgt.l) + "px", top: Math.round(tgt.t) + "px", width: Math.round(tgt.w) + "px", height: Math.round(tgt.h) + "px", transform: "" });
    s.removeProperty("--pull");
    card.classList.remove("resizing");
    if (rz.save) remember({ width: tgt.w, height: tgt.h });
    chip.classList.add("bye");
    setTimeout(() => chip?.remove(), 520);
    sizeHook?.();
    rz = null;
    return;
  }
  rz.raf = requestAnimationFrame(frame);
}

/** A ripple running off the side that was just let go. */
function ripple(card: HTMLElement, dir: string) {
  if (quiet()) return;
  card.querySelector(".wsripple")?.remove();
  const r = document.createElement("i");
  r.className = `wsripple wsripple-${dir}`;
  r.setAttribute("aria-hidden", "true");
  card.appendChild(r);
  setTimeout(() => r.remove(), 700);
}

export function bindResize(card: HTMLElement, onResize: () => void) {
  for (const edge of DIRS) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `wsresize wsresize-${edge}`;
    handle.setAttribute("aria-label", `Resize marker ${NAMES[edge]}`);
    handle.title = "Drag to resize · arrow keys to adjust · double-click to reset";
    handle.innerHTML = "<i></i>";
    card.append(handle);
    if (rz?.card === card && rz.down && rz.dir === edge) handle.classList.add("pulling"); // a redraw mid-pull keeps the edge lit

    handle.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const start = rz?.card === card ? { ...rz.tgt } : boxOf(card), x = e.clientX, y = e.clientY;
      const base = fit(start, edge);
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("pulling");
      begin(card, edge, base, true, true, onResize);
      handle.onpointermove = ev => {
        if (!rz) return;
        const dx = ev.clientX - x, dy = ev.clientY - y;
        rz.tgt = rubber({
          l: edge.includes("w") ? base.l + dx : base.l, t: edge.includes("n") ? base.t + dy : base.t,
          w: edge.includes("e") ? base.w + dx : edge.includes("w") ? base.w - dx : base.w,
          h: edge.includes("s") ? base.h + dy : edge.includes("n") ? base.h - dy : base.h
        }, edge);
      };
      const finish = () => {
        handle.onpointermove = null; handle.onpointerup = null; handle.onpointercancel = null; handle.onlostpointercapture = null;
        handle.classList.remove("pulling");
        if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        if (rz?.card === card) { rz.tgt = fit(rz.tgt, edge); rz.down = false; } // anything past the limit snaps back
        ripple(card, edge);
      };
      handle.onpointerup = finish; handle.onpointercancel = finish; handle.onlostpointercapture = finish;
    };
    handle.onkeydown = e => {
      const delta: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!delta[e.key]) return;
      e.preventDefault(); e.stopPropagation();
      const [dx, dy] = delta[e.key].map(v => v * (e.shiftKey ? 40 : 12)), b = rz?.card === card ? { ...rz.tgt } : boxOf(card);
      begin(card, edge, fit({
        l: edge.includes("w") ? b.l + dx : b.l, t: edge.includes("n") ? b.t + dy : b.t,
        w: edge.includes("e") ? b.w + dx : edge.includes("w") ? b.w - dx : b.w,
        h: edge.includes("s") ? b.h + dy : edge.includes("n") ? b.h - dy : b.h
      }, edge), false, true, onResize);
    };
    handle.ondblclick = e => {
      e.preventDefault();
      const R = room(), b = boxOf(card), w = Math.min(DEF_W, R.right - R.left), h = Math.min(DEF_H, R.bottom - R.top);
      // back to the standard size, staying where it is as far as the screen allows
      begin(card, "se", { l: Math.max(R.left, Math.min(b.l, R.right - w)), t: Math.max(R.top, Math.min(b.t, R.bottom - h)), w, h }, false, false, onResize);
      remember(null);
      ripple(card, "se");
    };
  }
}

/** Stop any pull in progress (the card is closing). */
export function endResize() {
  cancelAnimationFrame(rz?.raf ?? 0);
  rz = null; sizeHook = null;
}

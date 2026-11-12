/* The dial's life. The hub itself is calm now (neutral glass, one accent), so what makes it feel alive is motion,
   drawn here on one canvas that sits under the folders:

   - a bezel of fine ticks round the hub that turns with the dial. The ticks swell toward the pointer, a slow wave
     travels round them when nothing is happening, and when you spin the dial the swell leans back like a wake;
   - study sprites: small things from a student's week drifting along the dial's track at different depths (bits of
     maths and science, tiny graphs, an atom, a grade), with a little plain dust between them. The dial drags them
     with it when it turns, as if stirred, and the ones passing the pointer catch the accent colour;
   - a short arc of light on the hub's rim under the pointer, widening with speed;
   - a ring that runs outward from the hub each time a new note or folder comes under the pointer.

   Everything is drawn in the ink colour at low strength, with the selected item's colour only at the pointer.
   With reduced motion on, it draws once per change and nothing drifts. */

type Geo = { size: number; rF: number; hubR: number };
type Mote = { a: number; depth: number; speed: number; r: number; alpha: number; off: number; kind: number; tilt: number };

/* What the sprites are. Text ones are set in an italic serif like a textbook (grades in bold sans); the rest are
   drawn as a few strokes in a box of about ±1 unit. */
const WORDS = ["π", "∑", "∫", "√x", "Δx", "x²", "∞", "θ", "λ", "E=mc²", "a²+b²", "F=ma", "H₂O", "dy/dx", "sin θ", "A+", "A", "B+", "98%", "≈", "f(x)", "μ", "CO₂", "½"];
const GRADE = /^(A\+?|B\+|\d+%)$/;
type Draw = (g: CanvasRenderingContext2D, u: number) => void;
const SHAPES: Draw[] = [
  (g, u) => { // a sine curve on axes
    g.beginPath(); g.moveTo(-u, -u); g.lineTo(-u, u); g.lineTo(u, u); g.stroke();
    g.beginPath(); for (let i = 0; i <= 16; i++) { const x = -u + (i / 16) * 2 * u, y = Math.sin((i / 16) * Math.PI * 2) * u * 0.6; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  },
  (g, u) => { // a bar chart, rising
    g.beginPath(); g.moveTo(-u, u); g.lineTo(u, u); g.stroke();
    [0.5, 0.9, 1.3, 1.8].forEach((h, i) => g.fillRect(-u + 0.12 * u + i * 0.48 * u, u - h * u, 0.3 * u, h * u));
  },
  (g, u) => { // a parabola through its axes
    g.beginPath(); g.moveTo(-u, 0.55 * u); g.lineTo(u, 0.55 * u); g.moveTo(0, -u); g.lineTo(0, u); g.stroke();
    g.beginPath(); for (let i = 0; i <= 14; i++) { const k = -1 + (i / 14) * 2, x = k * u * 0.85, y = 0.55 * u - k * k * u * 1.4; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  },
  (g, u) => { // an atom
    for (const r of [0, Math.PI / 3, -Math.PI / 3]) { g.beginPath(); g.ellipse(0, 0, u * 1.1, u * 0.42, r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.arc(0, 0, u * 0.16, 0, Math.PI * 2); g.fill();
  },
  (g, u) => { // a scatter with its trend line
    g.beginPath(); g.moveTo(-u, -u); g.lineTo(-u, u); g.lineTo(u, u); g.stroke();
    for (const [x, y] of [[-0.6, 0.5], [-0.2, 0.1], [0.1, 0.25], [0.45, -0.3], [0.8, -0.6]]) { g.beginPath(); g.arc(x * u, y * u, u * 0.11, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(-0.8 * u, 0.62 * u); g.lineTo(0.9 * u, -0.7 * u); g.stroke();
  },
  (g, u) => { // a flask
    g.beginPath(); g.moveTo(-0.3 * u, -u); g.lineTo(-0.3 * u, -0.2 * u); g.lineTo(-0.9 * u, u); g.lineTo(0.9 * u, u); g.lineTo(0.3 * u, -0.2 * u); g.lineTo(0.3 * u, -u); g.moveTo(-0.45 * u, -u); g.lineTo(0.45 * u, -u); g.moveTo(-0.6 * u, 0.45 * u); g.lineTo(0.6 * u, 0.45 * u); g.stroke();
  },
  (g, u) => { // a right triangle with its square corner
    g.beginPath(); g.moveTo(-u, u); g.lineTo(u, u); g.lineTo(-u, -0.8 * u); g.closePath(); g.moveTo(-u, 0.65 * u); g.lineTo(-0.65 * u, 0.65 * u); g.lineTo(-0.65 * u, u); g.stroke();
  },
];

let cv: HTMLCanvasElement | null = null, g: CanvasRenderingContext2D | null = null;
let raf = 0, last = 0, t = 0, lastRot = 0, vel = 0, dpr = 1;
let getRot: () => number = () => 0, getGeo: () => Geo = () => ({ size: 0, rF: 0, hubR: 0 });
let ink = "200, 200, 220", accent = "120, 130, 255";
let motes: Mote[] = [];
let pulses: { at: number }[] = [];
const quiet = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Resolve any CSS colour (including var() and color-mix) to "r, g, b" by asking the browser. */
function rgb(host: HTMLElement, css: string, fallback: string) {
  const probe = document.createElement("i");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${css}`;
  host.appendChild(probe);
  const got = getComputedStyle(probe).color, m = got.match(/[\d.]+/g);
  probe.remove();
  if (!m || m.length < 3) return fallback;
  const k = got.startsWith("color(") ? 255 : 1; // color(srgb r g b) reports 0–1, rgb() reports 0–255
  return m.slice(0, 3).map(v => Math.round(Number(v) * k)).join(", ");
}

export function startBezel(dial: HTMLElement, rot: () => number, geo: () => Geo) {
  stopBezel();
  cv = document.createElement("canvas");
  cv.className = "bezel";
  cv.setAttribute("aria-hidden", "true");
  dial.insertBefore(cv, dial.querySelector(".hub"));
  g = cv.getContext("2d");
  getRot = rot; getGeo = geo;
  lastRot = rot(); vel = 0; last = performance.now();
  // a fixed scatter, so the dust looks the same each visit instead of reshuffling
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 30 sprites spread evenly round the track (each kind used about once), then 20 specks of plain dust (kind -1)
  const kinds = WORDS.length + SHAPES.length, start = Math.floor(rnd() * kinds);
  motes = Array.from({ length: 50 }, (_, i) => i < 30
    ? { a: i * 12 + rnd() * 7, depth: rnd(), speed: 0.5 + rnd() * 1.6, r: 1, alpha: 0.3 + rnd() * 0.3, off: (rnd() - 0.5) * 2, kind: (start + i * 7) % kinds, tilt: (rnd() - 0.5) * 0.5 }
    : { a: rnd() * 360, depth: rnd(), speed: 0.5 + rnd() * 2.2, r: 0.7 + rnd() * 1.3, alpha: 0.14 + rnd() * 0.3, off: (rnd() - 0.5) * 2, kind: -1, tilt: 0 });
  recolor(dial);
  if (quiet()) frame(performance.now());
  else raf = requestAnimationFrame(frame);
}
export function stopBezel() {
  cancelAnimationFrame(raf);
  raf = 0;
  cv?.remove();
  cv = null; g = null; pulses = [];
}
/** Re-read the ink and accent colours (the selection or the theme changed). */
export function recolor(dial: HTMLElement | null) {
  if (!dial) return;
  ink = rgb(dial, "var(--ink)", ink);
  accent = rgb(dial, "var(--hc)", accent);
  if (quiet() && cv) frame(performance.now());
}
/** Something new came under the pointer: send a ring out from the hub. */
export function pulse() {
  if (!cv || quiet()) return;
  pulses.push({ at: performance.now() });
  if (pulses.length > 4) pulses.shift();
}

function frame(now: number) {
  if (!cv || !g) return;
  if (!cv.isConnected) { stopBezel(); return; }
  const still = quiet();
  if (!still) raf = requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  const { size, rF, hubR } = getGeo();
  if (size < 40) return;
  const rot = getRot();
  // how fast the dial is turning, in degrees a second, smoothed so the wake eases in and out
  const inst = dt > 0 ? (rot - lastRot) / dt : 0;
  lastRot = rot;
  vel += (Math.max(-900, Math.min(900, inst)) - vel) * Math.min(1, dt * 9);

  const want = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(size * want) || dpr !== want) { dpr = want; cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = size + "px"; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const c = size / 2, speed = Math.min(1, Math.abs(vel) / 420);
  const wrap = (d: number) => ((d % 360) + 540) % 360 - 180; // signed degrees from the pointer (top)

  // ---- the bezel: ticks round the hub, turning with the dial ----
  const N = 120, r0 = hubR + 9, lean = -Math.sign(vel) * Math.min(34, Math.abs(vel) * 0.09); // the swell trails the direction of spin
  g.lineCap = "round";
  for (let i = 0; i < N; i++) {
    const deg = (i / N) * 360 + rot, d = wrap(deg);
    const near = Math.exp(-((d - lean) ** 2) / (2 * (15 + speed * 16) ** 2)); // 1 at the pointer, falling off either side
    const wave = still ? 0 : Math.sin((deg * 3 - t * 46) * Math.PI / 180) * 0.5 + 0.5;
    const major = i % 10 === 0;
    const len = (major ? 6.5 : 3.6) + wave * 1.7 + near * (9 + speed * 9);
    const a = (major ? 0.34 : 0.17) + wave * 0.06 + near * 0.5;
    const rad = (deg - 90) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    // near the pointer the ticks take the accent colour; everywhere else they are ink
    g.strokeStyle = near > 0.12 ? `rgba(${accent}, ${Math.min(1, a + near * 0.25).toFixed(3)})` : `rgba(${ink}, ${a.toFixed(3)})`;
    g.lineWidth = major ? 1.7 : 1.1 + near * 0.9;
    g.beginPath();
    g.moveTo(c + cos * r0, c + sin * r0);
    g.lineTo(c + cos * (r0 + len), c + sin * (r0 + len));
    g.stroke();
  }

  // ---- light on the hub's rim under the pointer, wider the faster it turns ----
  const half = (9 + speed * 26) * Math.PI / 180, mid = -Math.PI / 2 + lean * 0.4 * Math.PI / 180;
  const glow = g.createRadialGradient(c, c - hubR, 0, c, c - hubR, hubR * (0.5 + speed * 0.35));
  glow.addColorStop(0, `rgba(${accent}, ${(0.5 + speed * 0.3).toFixed(2)})`);
  glow.addColorStop(1, `rgba(${accent}, 0)`);
  g.strokeStyle = glow;
  g.lineWidth = 4.5;
  g.beginPath(); g.arc(c, c, hubR + 1.5, mid - half, mid + half); g.stroke();

  // ---- study sprites and dust on the track ----
  g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
  for (const m of motes) {
    if (!still) m.a += m.speed * dt * (1 + speed * 3) + vel * dt * (0.25 + m.depth * 0.5); // the dial drags them along, nearer ones more
    const d = wrap(m.a), rad = (m.a - 90) * Math.PI / 180;
    const sprite = m.kind >= 0;
    // sprites range from just outside the bezel to the dial's edge, so most float clear of the cards; dust keeps to the track
    const rr = (sprite ? hubR + 30 + (m.off * 0.5 + 0.5) * Math.max(20, size / 2 - hubR - 44) : rF + m.off * (10 + m.depth * 16)) + Math.sin(t * 0.7 + m.a) * 2;
    const near = Math.exp(-(d * d) / (2 * 22 * 22));
    const x = c + Math.cos(rad) * rr, y = c + Math.sin(rad) * rr + (sprite && !still ? Math.sin(t * 0.9 + m.off * 9) * 2.5 : 0);
    const col = near > 0.2 ? `rgba(${accent}, ${Math.min(0.95, m.alpha + near * 0.5).toFixed(3)})` : `rgba(${ink}, ${m.alpha.toFixed(3)})`;
    g.fillStyle = col; g.strokeStyle = col;
    if (!sprite) { g.beginPath(); g.arc(x, y, m.r * (0.8 + m.depth * 0.7) * (1 + near * 0.8), 0, Math.PI * 2); g.fill(); continue; }
    const scale = (0.8 + m.depth * 0.5) * (1 + near * 0.3);
    g.save();
    g.translate(x, y);
    g.rotate(m.tilt + (still ? 0 : Math.sin(t * 0.5 + m.off * 7) * 0.1)); // they stay upright and rock a little; they never spin with the ring
    if (m.kind < WORDS.length) {
      const w = WORDS[m.kind];
      g.font = GRADE.test(w) ? `800 ${(12 * scale).toFixed(1)}px Inter, system-ui, sans-serif` : `italic 600 ${((w.length > 3 ? 11.5 : 15) * scale).toFixed(1)}px Georgia, "Times New Roman", serif`;
      g.fillText(w, 0, 0);
    } else {
      g.lineWidth = 1.25; g.lineCap = "round";
      SHAPES[m.kind - WORDS.length](g, 7 * scale);
    }
    g.restore();
  }

  // ---- a ring runs outward when something new comes under the pointer ----
  pulses = pulses.filter(p => now - p.at < 620);
  for (const p of pulses) {
    const k = (now - p.at) / 620, ease = 1 - (1 - k) ** 3;
    g.strokeStyle = `rgba(${accent}, ${((1 - k) * 0.5).toFixed(3)})`;
    g.lineWidth = 2.2 * (1 - k) + 0.4;
    g.beginPath(); g.arc(c, c, hubR + 6 + ease * Math.min(70, size * 0.12), 0, Math.PI * 2); g.stroke();
  }
}

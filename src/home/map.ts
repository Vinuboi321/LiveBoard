import { courseColor, courseName, liveMarkers, note } from "../store";
import { forecast, isDue, recallable } from "../study";
import { $, DAY, esc, reducedMotion } from "../util";
import { renderSky } from "./sky";

/* The learning map: the sky from the home page, opened up to fill the screen. Every marker is a star, grouped into
   its note's constellation and its course's patch of sky, with one quiet column beside it that answers "how am I
   doing overall?": how much is learned, course by course, and what's coming up. Opens out of the small chart and
   folds back into it. */

let closing = false;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export const mapOpen = () => !!$("#mapView");

export function openMap(opts: { from: HTMLElement | null; openMarker: (id: string) => void; streak: number }) {
  if (mapOpen()) return;
  closing = false;
  const all = liveMarkers().filter(m => !m.detachedAt);
  const counts = [0, 0, 0];
  all.forEach(m => counts[m.mastery]++);
  const closed = all.filter(m => m.closedAt).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const pct = all.length ? Math.round(100 * (counts[1] * 0.5 + counts[2]) / all.length) : 0;
  const due = all.filter(m => isDue(m) && recallable(m)).length;
  const week = all.filter(m => m.createdAt > Date.now() - 7 * DAY).length;
  const ahead = forecast().reduce((t, d) => t + d.n, 0);
  // one row per course, biggest first
  const by = new Map<string, { n: number; c: [number, number, number]; due: number }>();
  for (const m of all) {
    const cid = note(m.noteId)?.courseId || "";
    const r = by.get(cid) || { n: 0, c: [0, 0, 0] as [number, number, number], due: 0 };
    r.n++; r.c[m.mastery]++; if (isDue(m) && recallable(m)) r.due++;
    by.set(cid, r);
  }
  const rows = [...by].sort((a, b) => b[1].n - a[1].n);
  const noteCount = new Set(all.map(m => m.noteId)).size;

  const el = document.createElement("div");
  el.id = "mapView";
  el.className = "mapview";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Your learning map");
  el.style.top = ($(".top")?.getBoundingClientRect().bottom ?? 0) + "px";
  el.innerHTML = `<header class="maphead"><div><h2>Your learning map</h2>
      <p>${all.length} marker${all.length === 1 ? "" : "s"} in ${noteCount} note${noteCount === 1 ? "" : "s"} · ${due ? `${due} due for recall` : "nothing due"}</p></div>
      <button class="mapclose" id="mapClose" aria-label="Close the map">Close<kbd>Esc</kbd></button></header>
    <div class="mapbody">
      <div class="sky big" id="skyBig"></div>
      <aside class="mapside" aria-label="How you're doing overall">
        <div class="mring" style="--p:${pct}"><div class="mringin"><b>${pct}%</b><small>learned</small></div></div>
        <div class="mlegend">${(["Unsure", "Getting it", "Mastered"] as const).map((l, i) => `<span><i data-mastery="${i}"></i><b>${counts[i]}</b>${l}</span>`).join("")}</div>
        <h3>By course</h3>
        <div class="mcourses">${rows.map(([cid, r]) => `<button class="mcourse" data-c="${esc(cid)}" style="--c:${courseColor(cid)}" aria-pressed="false" title="Show only ${esc(courseName(cid))} on the map">
            <span class="mcn"><i></i>${esc(courseName(cid))}</span><span class="mcc">${r.n}${r.due ? ` · <em>${r.due} due</em>` : ""}</span>
            <span class="mbar">${r.c.map((v, i) => (v ? `<u data-mastery="${i}" style="flex:${v}"></u>` : "")).join("")}</span></button>`).join("")}</div>
        ${closed.length ? `<h3>Closed out · ${closed.length} milestone${closed.length === 1 ? "" : "s"}</h3>
        <div class="mdone">${closed.slice(0, 6).map(m => `<button data-m="${m.id}" title="Open this marker"><i aria-hidden="true">✓</i><span>${esc((m.text || m.recallQ || note(m.noteId)?.title || "Marker").slice(0, 60))}</span><small>${new Date(m.closedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></button>`).join("")}${closed.length > 6 ? `<p>and ${closed.length - 6} more on the map</p>` : ""}</div>` : ""}
        <div class="mstats"><div><b>${opts.streak}</b><small>day streak</small></div><div><b>${week}</b><small>marked this week</small></div><div><b>${ahead}</b><small>due in 7 days</small></div></div>
      </aside></div>`;
  document.body.appendChild(el);

  const pick = (id: string) => { closeMap(true); opts.openMarker(id); };
  const sky = $("#skyBig", el)!;
  renderSky(sky, pick, { tall: true });
  el.querySelectorAll<HTMLButtonElement>(".mdone [data-m]").forEach(b => b.onclick = () => pick(b.dataset.m!));

  // tap a course to see only its part of the sky; tap again for everything
  el.querySelectorAll<HTMLButtonElement>(".mcourse").forEach(b => b.onclick = () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    el.querySelectorAll(".mcourse").forEach(x => x.setAttribute("aria-pressed", String(x === b && on)));
    const svg = sky.querySelector("svg");
    svg?.classList.toggle("pick", on);
    svg?.querySelectorAll<SVGGElement>(".con").forEach(g => g.classList.toggle("picked", on && g.dataset.c === b.dataset.c));
  });
  // the sky leans a little toward the pointer, so it reads as something with depth
  if (!reducedMotion()) {
    sky.addEventListener("pointermove", e => {
      if (e.pointerType === "touch") return;
      const r = sky.getBoundingClientRect();
      sky.style.setProperty("--sx", (-((e.clientY - r.top) / r.height - 0.5) * 3).toFixed(2) + "deg");
      sky.style.setProperty("--sy", (((e.clientX - r.left) / r.width - 0.5) * 4).toFixed(2) + "deg");
    });
    sky.addEventListener("pointerleave", () => { sky.style.removeProperty("--sx"); sky.style.removeProperty("--sy"); });
  }
  $("#mapClose", el)!.onclick = () => closeMap();
  escHandler = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMap(); } };
  document.addEventListener("keydown", escHandler, true);
  ($("#mapClose", el) as HTMLElement).focus({ preventScroll: true });

  // grow out of the small chart it was opened from
  const fr = opts.from?.getBoundingClientRect(), vr = el.getBoundingClientRect();
  if (fr && fr.width > 40 && !reducedMotion() && el.animate) {
    const s = Math.max(0.2, fr.width / vr.width);
    const dx = fr.left + fr.width / 2 - (vr.left + vr.width / 2), dy = fr.top + fr.height / 2 - (vr.top + vr.height / 2);
    el.dataset.from = `${dx.toFixed(0)},${dy.toFixed(0)},${s.toFixed(3)}`;
    el.animate([
      { opacity: 0, transform: `perspective(1600px) translate(${dx}px, ${dy}px) scale(${s}) rotateX(14deg)` },
      { opacity: 1, offset: 0.35 },
      { opacity: 1, transform: "perspective(1600px) translate(0, 0) scale(1) rotateX(0deg)" }
    ], { duration: 520, easing: "cubic-bezier(.2, .8, .2, 1)" });
  }
}

/** `now` skips the fold-back animation (used when a star is opening its note, or the home screen is going away). */
export function closeMap(now = false) {
  const el = $("#mapView");
  if (escHandler) { document.removeEventListener("keydown", escHandler, true); escHandler = null; }
  if (!el || closing) return;
  const from = el.dataset.from?.split(",").map(Number);
  const back = () => { el.remove(); closing = false; ($("#mapOpen") as HTMLElement | null)?.focus({ preventScroll: true }); };
  if (now || !from || reducedMotion() || !el.animate) { el.remove(); return; }
  closing = true;
  el.animate([{ opacity: 1, transform: "perspective(1600px) translate(0, 0) scale(1) rotateX(0deg)" }, { opacity: 0, transform: `perspective(1600px) translate(${from[0]}px, ${from[1]}px) scale(${from[2]}) rotateX(10deg)` }],
    { duration: 300, easing: "cubic-bezier(.5, 0, .8, .4)", fill: "forwards" }).finished.then(back, back);
}

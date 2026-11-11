import { liveMarkers } from "./store";
import { recallable } from "./study";
import { $ } from "./util";

/* A study session: set a timer, read and mark as usual, and when it ends LiveBoard offers an exit ticket, a quiz on
   exactly the markers you placed during the session. The timer lives in the header so it follows you between notes,
   and survives a reload. It never nags: no sound, no blocking dialog, and ending early is one tap. */

const KEY = "lb-session";
interface Session { start: number; end: number; mins: number }
let s: Session | null = null;
let tick = 0;
let exitTicket: (ids: string[]) => void = () => {};
let open = false;

const load = (): Session | null => { try { const v = JSON.parse(sessionStorage.getItem(KEY) || "null"); return v && v.end > v.start ? v : null; } catch { return null; } };
const save = () => { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* lasts until reload */ } };
/** Markers placed since the session began that can be quizzed. */
const placed = (since: number) => liveMarkers().filter(m => m.createdAt >= since && !m.detachedAt && recallable(m));
const clock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
export const sessionRunning = () => !!s;

export function initSession(opts: { exitTicket: (ids: string[]) => void }) {
  exitTicket = opts.exitTicket;
  const btn = $("#focusBtn"), pop = $("#focusPop");
  if (!btn || !pop) return;
  btn.onclick = e => { e.stopPropagation(); open = !open; draw(); };
  pop.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", () => { if (open) { open = false; draw(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && open) { open = false; draw(); btn.focus(); } });
  s = load();
  if (s) tick = window.setInterval(beat, 1000);
  draw();
  beat();
}

function start(mins: number) {
  s = { start: Date.now(), end: Date.now() + mins * 60000, mins };
  save();
  clearInterval(tick);
  tick = window.setInterval(beat, 1000);
  open = false;
  $(".sessiondone")?.remove();
  draw();
}
function finish(early = false) {
  if (!s) return;
  const done = s, ids = placed(done.start).map(m => m.id);
  s = null; save(); clearInterval(tick); open = false; draw();
  const mins = Math.max(1, Math.round((Math.min(Date.now(), done.end) - done.start) / 60000));
  $(".sessiondone")?.remove();
  const card = document.createElement("div");
  card.className = "sessiondone";
  card.setAttribute("role", "status");
  card.innerHTML = `<b>${early ? "Session ended" : "Time."}</b><span>${mins} minute${mins === 1 ? "" : "s"} · ${ids.length} marker${ids.length === 1 ? "" : "s"} placed</span>
    ${ids.length ? `<p>Before you go: can you recall what you just marked?</p><div class="sdrow"><button class="sdgo" id="sdGo">Exit ticket · ${ids.length}</button><button class="sdno" id="sdNo">Not now</button></div>`
      : `<p>Nothing was marked this time, so there's nothing to quiz. Next session, mark the lines you'd want to remember.</p><div class="sdrow"><button class="sdno" id="sdNo">Okay</button></div>`}`;
  document.body.appendChild(card);
  const bye = () => card.remove();
  ($("#sdNo", card) as HTMLElement).onclick = bye;
  const go = $("#sdGo", card);
  if (go) go.onclick = () => { bye(); exitTicket(ids); };
}
function beat() {
  if (!s) return;
  if (Date.now() >= s.end) return finish();
  draw();
}

function draw() {
  const btn = $("#focusBtn"), pop = $("#focusPop");
  if (!btn || !pop) return;
  btn.setAttribute("aria-expanded", String(open));
  if (s) {
    const left = s.end - Date.now(), n = placed(s.start).length, pct = Math.min(100, Math.max(0, 100 * (1 - left / (s.mins * 60000))));
    btn.classList.add("on");
    btn.style.setProperty("--p", pct.toFixed(1));
    btn.setAttribute("aria-label", `Study session, ${clock(left)} left`);
    $(".fbt", btn)!.textContent = clock(left);
    $(".fbn", btn)!.textContent = n ? String(n) : "";
    if (open && !pop.dataset.live) pop.dataset.live = "1", pop.innerHTML = `<h3>Study session</h3><div class="fbig" id="fBig"></div><p id="fLine"></p>
      <div class="frow"><button data-add="5">+5 min</button><button id="fEnd" class="pri">End session</button></div>`;
    if (open) {
      $("#fBig", pop)!.textContent = clock(left);
      $("#fLine", pop)!.textContent = n ? `${n} marker${n === 1 ? "" : "s"} placed so far. They become your exit ticket.` : "Mark the lines you'd want to remember. They become your exit ticket.";
      ($("#fEnd", pop) as HTMLElement).onclick = () => finish(true);
      ($("[data-add]", pop) as HTMLElement).onclick = () => { if (s) { s.end += 5 * 60000; s.mins += 5; save(); draw(); } };
    }
  } else {
    btn.classList.remove("on");
    btn.setAttribute("aria-label", "Start a study session");
    $(".fbt", btn)!.textContent = "Focus";
    $(".fbn", btn)!.textContent = "";
    delete pop.dataset.live;
    if (open) {
      pop.innerHTML = `<h3>Study session</h3><p>Set a timer, mark what matters as you read, and finish with a quiz on exactly what you marked.</p>
        <div class="fmins">${[15, 25, 45, 60].map(m => `<button data-min="${m}"><b>${m}</b>min</button>`).join("")}</div>`;
      pop.querySelectorAll<HTMLButtonElement>("[data-min]").forEach(b => b.onclick = () => start(Number(b.dataset.min)));
    }
  }
  if (!open) delete pop.dataset.live;
  pop.hidden = !open;
}

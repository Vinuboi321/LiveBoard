import { esc } from "./util";

/* Who is using LiveBoard on this device. Students get the notes app; teachers get the presentations side.
   Kept per device until accounts carry a role. A link carrying ?as=student or ?as=teacher (the presentations
   side uses it to send a teacher back to notes) sets it. */
export type Role = "student" | "teacher";
const KEY = "liveboard-role";
let memo: Role | null = null; // used when storage is blocked, so the choice still holds for this visit

export function getRole(): Role | null {
  try { const r = localStorage.getItem(KEY); if (r === "student" || r === "teacher") return r; } catch {}
  return memo;
}

export function setRole(r: Role) {
  memo = r;
  try { localStorage.setItem(KEY, r); } catch {}
  document.documentElement.dataset.role = r;
}

/** Reads ?as= from the address, saves it and removes it so a reload or bookmark doesn't repeat it. */
export function roleFromAddress() {
  const url = new URL(location.href);
  const as = url.searchParams.get("as");
  if (as !== "student" && as !== "teacher") return;
  setRole(as);
  url.searchParams.delete("as");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

/** The first-run choice. Resolves with the role picked. */
export function pickRole(): Promise<Role> {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "rolepick";
    wrap.innerHTML = `<div class="rolecard" role="dialog" aria-modal="true" aria-labelledby="roleTitle">
      <h1 id="roleTitle">Welcome to LiveBoard</h1>
      <p class="muted">Who's using it on this device?</p>
      <div class="rolechoices">
        <button class="rolechoice" data-role="student"><b>I'm a student</b><span>${esc("Notes with markers, the time dial and morning recall.")}</span></button>
        <button class="rolechoice" data-role="teacher"><b>I'm a teacher</b><span>${esc("Presentations, live classes students join by code, and worksheets.")}</span></button>
      </div>
      <p class="muted small">You can switch any time in Settings.</p>
    </div>`;
    document.body.appendChild(wrap);
    const card = wrap.querySelector<HTMLElement>(".rolecard")!;
    card.tabIndex = -1; card.focus(); // focus the dialog, not a choice, so neither looks picked already
    wrap.addEventListener("click", e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-role]");
      if (!b) return;
      const r = b.dataset.role as Role;
      setRole(r);
      wrap.remove();
      resolve(r);
    });
  });
}

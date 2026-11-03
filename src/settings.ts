import { aiHealth } from "./ai";
import { course, exportAll, importAll, liveCourses, putCourse, putMeta, state, wipeLocal } from "./store";
import { createClass, currentUser, joinClass, signIn, signOut, syncConfigured } from "./sync";
import { $, armButton, esc, toast } from "./util";

/* Settings: account, AI status, courses and classes, backup. */
let panel: HTMLElement | null = null;

export function closeSettings() { panel?.remove(); panel = null; }

export async function openSettings(section?: string, onChanged?: () => void) {
  closeSettings();
  panel = document.createElement("div");
  panel.className = "sheetwrap";
  panel.innerHTML = `<div class="sheet" role="dialog" aria-label="Settings" aria-modal="true"><div class="sheethead"><h2>Settings</h2><button class="mx" id="sClose" aria-label="Close settings">×</button></div><div class="sheetbody" id="sBody">Loading…</div></div>`;
  document.body.appendChild(panel);
  panel.addEventListener("pointerdown", e => { if (e.target === panel) closeSettings(); });
  $("#sClose", panel)!.onclick = closeSettings;
  const ai = await aiHealth();
  if (!panel) return;
  const user = currentUser();
  const courses = liveCourses();
  $("#sBody", panel)!.innerHTML = `
    <section><h3>Account</h3>
      ${!syncConfigured() ? `<p class="muted">Sync isn't set up on this server, so notes are saved on this device only. Export a backup below to move them.</p>`
        : user ? `<p>Signed in as <b>${esc(user.email)}</b>. Notes sync across your devices.</p><button class="btn" id="sOut">Sign out</button>`
        : `<p class="muted">Sign in to sync notes across devices, use AI markers and join a class.</p><form class="row" id="sIn"><input type="email" id="sEmail" required placeholder="you@school.edu" autocomplete="email"><button class="btn primary">Email me a link</button></form>`}
      <label class="field">Your name (shown on class leaderboards)<input id="sName" maxlength="40" value="${esc(state.meta.displayName)}" placeholder="First name"></label>
    </section>
    <section><h3>AI markers</h3>
      <p class="${ai.ai ? "" : "muted"}">${ai.ai ? `Connected${ai.model ? ` · ${esc(ai.model)}` : ""}.` : "Not connected on this server. Math, formatting, links and reminders still work; explaining, expanding and drafting need the AI. The setup guide in the README covers adding an Anthropic API key."}</p>
    </section>
    <section id="classes"><h3>Courses and classes</h3>
      <p class="muted">Share a course as a class to get a class leaderboard. Anyone with the code can join.</p>
      <div class="clist">${courses.map(c => `<div class="crow" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span><input class="cname" value="${esc(c.name)}" maxlength="32" aria-label="Course name">
        ${c.classCode ? `<span class="code" title="Class code">${esc(c.classCode)}</span>` : `<button class="btn small" data-share="${c.id}" ${user ? "" : "disabled title='Sign in first'"}>Share as class</button>`}</div>`).join("")}</div>
      <form class="row" id="sJoin"><input id="sCode" maxlength="8" placeholder="Class code" ${user ? "" : "disabled"}><select id="sJoinCourse" aria-label="Put this class on course" ${user ? "" : "disabled"}>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><button class="btn" ${user ? "" : "disabled"}>Join class</button></form>
      ${user ? "" : `<p class="muted small">${syncConfigured() ? "Sign in to share or join a class." : "Classes need accounts, which aren't set up on this server."}</p>`}
    </section>
    <section><h3>Backup</h3>
      <div class="row"><button class="btn" id="sExport">Download backup</button><label class="btn" for="sImport">Restore backup</label><input type="file" id="sImport" accept="application/json,.json" hidden></div>
      <button class="btn danger" id="sWipe">Delete everything on this device</button>
    </section>
    <p class="muted small">LiveBoard · notes are stored on your device${syncConfigured() ? " and, when signed in, in your account" : ""}.</p>`;

  const name = $("#sName", panel) as HTMLInputElement;
  name.onchange = () => putMeta({ displayName: name.value.trim() });
  $("#sOut", panel)?.addEventListener("click", async () => { await signOut(); toast("Signed out. Your notes stay on this device."); openSettings(); });
  ($("#sIn", panel) as HTMLFormElement | null)?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = ($("#sEmail", panel!) as HTMLInputElement).value.trim();
    try { await signIn(email); toast(`Check ${email} for a sign-in link.`, 5000); }
    catch (err) { toast((err as Error).message); }
  });
  panel.querySelectorAll<HTMLInputElement>(".cname").forEach(inp => inp.onchange = async () => {
    const c = course(inp.closest<HTMLElement>(".crow")!.dataset.id!);
    if (c && inp.value.trim()) { await putCourse({ ...c, name: inp.value.trim().toUpperCase() }); onChanged?.(); }
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-share]").forEach(b => b.onclick = async () => {
    const c = course(b.dataset.share!);
    if (!c) return;
    try {
      const r = await createClass(c.name, state.meta.displayName);
      await putCourse({ ...c, classId: r.id, classCode: r.code });
      toast(`Class created. Share the code ${r.code} with classmates.`, 6000);
      openSettings("classes", onChanged);
    } catch (err) { toast((err as Error).message); }
  });
  ($("#sJoin", panel) as HTMLFormElement).onsubmit = async e => {
    e.preventDefault();
    const code = ($("#sCode", panel!) as HTMLInputElement).value;
    const c = course(($("#sJoinCourse", panel!) as HTMLSelectElement).value);
    if (!code.trim() || !c) return;
    try {
      const r = await joinClass(code, state.meta.displayName);
      await putCourse({ ...c, classId: r.id, classCode: r.code });
      toast(`Joined ${r.name}.`);
      openSettings("classes", onChanged);
      onChanged?.();
    } catch (err) { toast((err as Error).message); }
  };
  $("#sExport", panel)!.onclick = async () => {
    const blob = new Blob([await exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liveboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  ($("#sImport", panel) as HTMLInputElement).onchange = async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { await importAll(await f.text()); toast("Backup restored."); onChanged?.(); closeSettings(); }
    catch (err) { toast((err as Error).message || "Couldn't read that backup."); }
  };
  armButton($("#sWipe", panel)!, "Delete everything on this device", "Tap again to delete all local notes", () => wipeLocal());
  if (section) $(`#${section}`, panel)?.scrollIntoView({ block: "start" });
}

document.addEventListener("keydown", e => { if (e.key === "Escape" && panel) closeSettings(); });

import { aiHealth } from "./ai";
import { course, exportAll, liveCourses, pendingCount, putCourse, putMeta, restoreBackup, state, wipeLocal } from "./store";
import { createClass, currentUser, deleteServerData, joinClass, signIn, signOut, syncConfigured, verifyCode } from "./sync";
import { MAX_BACKUP_BYTES, validateBackup } from "./backup";
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
        : user ? `<p>Signed in as <b>${esc(user.email)}</b>. Notes sync across your devices.${pendingCount() ? ` <span class="muted">${pendingCount()} change${pendingCount() === 1 ? "" : "s"} waiting to upload.</span>` : ""}</p>
          <div class="row"><button class="btn" id="sOut">Sign out</button><button class="btn" id="sOutRemove" title="Also delete this account's notes from this device once they're uploaded">Sign out and remove from this device</button></div>
          <p class="muted small">Signing out keeps a copy on this device for next time, unless you remove it. Someone else signing in here never sees it.</p>`
        : `<p class="muted">Sign in to sync notes across devices, use AI markers and join a class.</p><form class="row" id="sIn"><input type="email" id="sEmail" required placeholder="you@school.edu" autocomplete="email"><button class="btn primary">Email me a sign-in link</button></form>
          <form class="row" id="sCode" hidden><input id="sCodeIn" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="6-digit code" aria-label="Code from the email"><button class="btn primary">Sign in</button></form>
          <p class="muted small" id="sCodeHint" hidden>Tap the link in the email, or type the code from it here. On iPad, use the code if you added LiveBoard to your home screen.</p>`}
      <label class="field">Your name (shown on class leaderboards)<input id="sName" maxlength="40" value="${esc(state.meta.displayName)}" placeholder="First name"></label>
    </section>
    <section><h3>AI markers</h3>
      <p class="${ai.ai ? "" : "muted"}">${ai.ai ? `Connected${ai.model ? ` · ${esc(ai.model)}` : ""}.` : "Not connected on this server. Math, formatting, links and reminders still work; explaining, expanding and drafting need the AI. The setup guide in the README covers adding an Anthropic API key."}</p>
    </section>
    <section id="classes"><h3>Courses and classes</h3>
      <p class="muted">Share a course as a class to get a class leaderboard. Anyone with the code can join.</p>
      <div class="clist">${courses.map(c => `<div class="crow" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span><input class="cname" value="${esc(c.name)}" maxlength="32" aria-label="Course name">
        <label class="exam" title="Exam date, used by “remind me before the exam”"><span>Exam</span><input type="date" class="cexam" value="${esc(c.examDate || "")}" aria-label="Exam date for ${esc(c.name)}"></label>
        ${c.classCode ? `<span class="code" title="Class code">${esc(c.classCode)}</span>` : `<button class="btn small" data-share="${c.id}" ${user ? "" : "disabled title='Sign in first'"}>Share as class</button>`}</div>`).join("")}</div>
      <form class="row" id="sJoin"><input id="sCode" maxlength="8" placeholder="Class code" ${user ? "" : "disabled"}><select id="sJoinCourse" aria-label="Put this class on course" ${user ? "" : "disabled"}>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><button class="btn" ${user ? "" : "disabled"}>Join class</button></form>
      ${user ? "" : `<p class="muted small">${syncConfigured() ? "Sign in to share or join a class." : "Classes need accounts, which aren't set up on this server."}</p>`}
    </section>
    <section><h3>Backup</h3>
      ${import.meta.env.VITE_ARTIFACT ? `<p class="muted small">This is a preview filled with sample notes. Backups download from the installed app.</p><button class="btn" id="sDemo">Remove sample notes</button>` : `<div class="row"><button class="btn" id="sExport">Download backup</button><label class="btn" for="sImport">Restore backup</label><input type="file" id="sImport" accept="application/json,.json" hidden></div>`}
      <button class="btn danger" id="sWipe">Delete everything on this device</button>
      ${user ? `<button class="btn danger" id="sDelServer">Delete my data from LiveBoard's servers</button><p class="muted small">Removes everything this account stored online. To also remove the copy on this device, use the button above first.</p>` : ""}
    </section>
    <p class="muted small">LiveBoard · notes are stored on your device${syncConfigured() ? " and, when signed in, in your account" : ""}.</p>`;

  const name = $("#sName", panel) as HTMLInputElement;
  name.onchange = () => putMeta({ displayName: name.value.trim() });
  const out = async (removeDeviceCopy: boolean) => {
    try {
      const r = await signOut({ removeDeviceCopy });
      toast(removeDeviceCopy ? "Signed out and removed from this device. Your notes are in your account." : r.unsynced ? `Signed out. ${r.unsynced} change${r.unsynced === 1 ? " is" : "s are"} kept on this device and will upload when you sign in again.` : "Signed out. Your notes are in your account.", 5000);
      setTimeout(() => location.reload(), 900);
    } catch (err) { toast((err as Error).message, 7000); }
  };
  $("#sOut", panel)?.addEventListener("click", () => out(false));
  const outRm = $("#sOutRemove", panel);
  if (outRm) armButton(outRm, "Sign out and remove from this device", "Tap again to remove this device's copy", () => out(true));
  ($("#sIn", panel) as HTMLFormElement | null)?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = ($("#sEmail", panel!) as HTMLInputElement).value.trim();
    try {
      await signIn(email);
      toast(`Check ${email} for a sign-in email.`, 5000);
      $("#sCode", panel!)!.hidden = false; $("#sCodeHint", panel!)!.hidden = false;
      ($("#sCodeIn", panel!) as HTMLInputElement).focus();
    } catch (err) { toast((err as Error).message, 6000); }
  });
  ($("#sCode", panel) as HTMLFormElement | null)?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = ($("#sEmail", panel!) as HTMLInputElement).value.trim(), code = ($("#sCodeIn", panel!) as HTMLInputElement).value.trim();
    if (!code) return;
    try { await verifyCode(email, code); toast("Signed in."); }
    catch (err) { toast((err as Error).message, 6000); }
  });
  const delSrv = $("#sDelServer", panel);
  if (delSrv) armButton(delSrv, "Delete my data from LiveBoard's servers", "Tap again: this can't be undone", async () => {
    try {
      await deleteServerData();
      await signOut({ removeDeviceCopy: false }).catch(() => undefined);
      toast("Your notes, markers and class points were deleted from the server.", 7000);
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toast((err as Error).message, 7000); }
  });
  panel.querySelectorAll<HTMLInputElement>(".cname").forEach(inp => inp.onchange = async () => {
    const c = course(inp.closest<HTMLElement>(".crow")!.dataset.id!);
    if (c && inp.value.trim()) { await putCourse({ ...c, name: inp.value.trim().toUpperCase() }); onChanged?.(); }
  });
  panel.querySelectorAll<HTMLInputElement>(".cexam").forEach(inp => inp.onchange = async () => {
    const c = course(inp.closest<HTMLElement>(".crow")!.dataset.id!);
    if (c) await putCourse({ ...c, examDate: /^\d{4}-\d\d-\d\d$/.test(inp.value) ? inp.value : null });
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
  if ($("#sExport", panel)) $("#sExport", panel)!.onclick = async () => {
    const blob = new Blob([await exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liveboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  if ($("#sImport", panel)) ($("#sImport", panel) as HTMLInputElement).onchange = async e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = "";
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) { toast("That backup is too large to restore here."); return; }
    let b: ReturnType<typeof validateBackup>;
    try { b = validateBackup(await f.text()); }
    catch (err) { toast((err as Error).message || "Couldn't read that backup.", 6000); return; }
    // Show what will happen before anything changes.
    const box = document.createElement("div");
    box.className = "restorebox";
    const s = b.summary;
    box.innerHTML = `<p><b>Restore this backup?</b>${s.exportedAt ? ` <span class="muted small">Made ${esc(new Date(s.exportedAt).toLocaleString())}</span>` : ""}</p>
      <p>${s.notes} note${s.notes === 1 ? "" : "s"}, ${s.markers} marker${s.markers === 1 ? "" : "s"} and ${s.courses} course${s.courses === 1 ? "" : "s"} will be added.${s.replaces ? ` ${s.replaces} item${s.replaces === 1 ? "" : "s"} already here will be replaced by the backup's version.` : " Nothing here is replaced."}</p>
      <div class="row"><button class="btn primary" id="rGo">Restore</button><button class="btn" id="rSave">Download what's here first</button><button class="btn" id="rNo">Cancel</button></div>`;
    $("#sExport", panel!)!.closest("section")!.appendChild(box);
    $("#rNo", box)!.onclick = () => box.remove();
    $("#rSave", box)!.onclick = () => $("#sExport", panel!)!.click();
    $("#rGo", box)!.onclick = async () => {
      try { await restoreBackup(b); toast("Backup restored."); onChanged?.(); closeSettings(); }
      catch (err) { console.warn(err); toast("Couldn't restore that backup. Nothing was changed.", 6000); }
    };
  };
  const demoBtn = $("#sDemo", panel);
  if (demoBtn) armButton(demoBtn, "Remove sample notes", "Tap again to remove them", async () => {
    const { removeDemo } = await import("./demo");
    await removeDemo();
    toast("Sample notes removed.");
    closeSettings();
    onChanged?.();
  });
  armButton($("#sWipe", panel)!, "Delete everything on this device", "Tap again to delete all local notes", () => wipeLocal());
  if (section) $(`#${section}`, panel)?.scrollIntoView({ block: "start" });
}

document.addEventListener("keydown", e => { if (e.key === "Escape" && panel) closeSettings(); });

// Sync and account checks against a fake Supabase: offline edits survive restarts and sign-out, accounts stay separate,
// two devices editing one note keep both versions, and signed-out notes are only moved into an account when asked.
// Usage: npm run build:synctest && npx vite preview --outDir dist-synctest --port 4174 & node tests/sync.cjs
const { chromium } = require("playwright");
const { FakeSupabase } = require("./fake-supabase.cjs");
const BASE = process.env.SYNC_BASE || "http://localhost:4174";
const KEY = "sb-sb-auth-token"; // supabase-js storage key for http://sb.test
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", U3 = "33333333-3333-4333-8333-333333333333";

(async () => {
  const b = await chromium.launch();
  const fake = new FakeSupabase();
  const errs = [];
  const ok = (c, msg) => { if (c) console.log("ok  ", msg); else errs.push(msg); };

  async function device() {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 860 }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push("pageerror: " + e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
    await fake.attach(p);
    await p.goto(BASE);
    await p.waitForSelector("#dial");
    return p;
  }
  const signInAs = async (p, uid) => {
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(FakeSupabase.session(uid))]);
    await p.reload();
    await p.waitForSelector("#dial");
    await p.waitForTimeout(1200);
  };
  const signOut = async (p, remove = false) => {
    await p.click("#settingsBtn");
    await p.waitForSelector(remove ? "#sOutRemove" : "#sOut");
    if (remove) { await p.click("#sOutRemove"); await p.click("#sOutRemove"); }
    else await p.click("#sOut");
    let msg = "";
    for (let i = 0; i < 30 && !/Signed out|can't be removed|Couldn't/.test(msg); i++) { await p.waitForTimeout(100); msg = (await p.textContent("#toast").catch(() => "")) || ""; }
    if (!remove) { await p.waitForLoadState("load"); await p.waitForTimeout(1500); await p.waitForSelector("#dial"); }
    return msg || "";
  };
  const local = (p, dbName) => p.evaluate(name => new Promise(res => {
    const r = indexedDB.open(name);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("outbox")) { db.close(); return res({ outbox: 0, notes: [] }); }
      const tx = db.transaction(["outbox", "notes"]);
      const o = tx.objectStore("outbox").count(), n = tx.objectStore("notes").getAll();
      tx.oncomplete = () => { res({ outbox: o.result, notes: n.result.filter(x => !x.deleted).map(x => ({ title: x.title, plain: x.plain })) }); db.close(); };
    };
    r.onerror = () => res(null);
  }), dbName);
  const newNote = async (p, title, text) => {
    await p.click(".hbtn[data-act='blank']");
    await p.waitForSelector("#editor .ProseMirror");
    await p.fill("#ptitle", title);
    await p.click("#editor .ProseMirror");
    await p.keyboard.type(text);
    await p.waitForTimeout(900);
  };
  const openByTitle = async (p, title) => {
    await p.keyboard.press("Control+k");
    await p.fill("#qIn", title);
    await p.waitForTimeout(200);
    await p.click(".qrow2[data-note]");
    await p.waitForSelector("#editor .ProseMirror");
  };
  const appendText = async (p, text) => {
    await p.evaluate(() => {
      const ps = document.querySelectorAll("#editor p"), last = ps[ps.length - 1];
      const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.querySelector("#editor .ProseMirror").focus();
    });
    await p.keyboard.type(text);
    await p.waitForTimeout(900);
  };
  /** wait until this device has nothing left to upload (instead of guessing with a fixed delay) */
  const settled = async (p, uid, ms = 12000) => { for (let i = 0; i < ms / 250; i++) { if ((await local(p, `liveboard-u-${uid}`)).outbox === 0) return; await p.waitForTimeout(250); } };
  const serverNote = (uid, title) => fake.all("notes", uid).find(r => r.data.title === title && !r.deleted);
  const home = async p => { await p.evaluate(() => { location.hash = ""; }); await p.waitForSelector("#dial"); await p.waitForTimeout(300); };

  /* 1. Offline edits survive a restart and a sign-out */
  const A = await device();
  await signInAs(A, U1);
  await newNote(A, "Offline lecture", "Mitosis has four phases.");
  await settled(A, U1);
  ok(/four phases/.test(serverNote(U1, "Offline lecture")?.data.plain || ""), "a signed-in note uploads");
  fake.down = true;
  await appendText(A, " Prophase comes first.");
  await A.reload();
  await A.waitForSelector("#editor .ProseMirror");
  ok(/Prophase comes first/.test(await A.textContent("#editor")), "an edit made offline is still there after a restart");
  const before = await local(A, `liveboard-u-${U1}`);
  ok(before.outbox > 0, `the upload queue survives the restart (${before.outbox} waiting)`);
  await home(A);
  const refused = await signOut(A, true);
  ok(/can't be removed/.test(refused), "removing the device copy is refused while changes are waiting");
  await A.keyboard.press("Escape");
  const kept = await signOut(A);
  ok(/kept on this device/.test(kept), `signing out with waiting changes keeps them (and says so: “${kept.slice(0, 90)}”)`);
  ok(!(await A.textContent("#stage")).includes("Offline lecture"), "after signing out, that account's notes aren't shown");
  const after = await local(A, `liveboard-u-${U1}`);
  ok(after.outbox > 0 && after.notes.some(n => /Prophase/.test(n.plain)), "the waiting edit is still on the device after sign-out");
  fake.down = false;
  await signInAs(A, U1);
  await A.waitForTimeout(2500);
  ok(/Prophase comes first/.test(serverNote(U1, "Offline lecture")?.data.plain || ""), "signing back in uploads the offline edit");
  ok((await local(A, `liveboard-u-${U1}`)).outbox === 0, "the queue empties only after the server confirms");

  /* 2. Another account on the same device sees none of it */
  await signOut(A);
  await signInAs(A, U2);
  ok(!(await A.textContent("#stage")).includes("Offline lecture"), "a second account doesn't see the first account's notes");
  await A.keyboard.press("Control+k");
  await A.fill("#qIn", "Mitosis");
  await A.waitForTimeout(200);
  ok(!(await A.$(".qrow2[data-note]")), "search in the second account doesn't find them either");
  await A.keyboard.press("Escape");
  ok(fake.all("notes", U2).every(r => !/Mitosis/.test(r.data.plain || "")), "nothing from the first account is uploaded to the second");
  await signOut(A);
  await signInAs(A, U1);
  ok((await local(A, `liveboard-u-${U1}`)).notes.some(n => n.title === "Offline lecture"), "the first account's notes are back when it signs in again");

  /* 3. Two devices edit the same note: neither version is lost */
  const B = await device();
  await signInAs(B, U1);
  for (let i = 0; i < 48 && !(await local(B, `liveboard-u-${U1}`)).notes.some(n => n.title === "Offline lecture"); i++) await B.waitForTimeout(250);
  await openByTitle(B, "Offline lecture");
  // device B loses its connection and keeps editing
  await B.route("http://sb.test/**", r => r.abort("internetdisconnected"));
  await appendText(B, " Edited on B.");
  await openByTitle(A, "Offline lecture");
  await appendText(A, " Edited on A.");
  await settled(A, U1);
  ok(/Edited on A/.test(serverNote(U1, "Offline lecture")?.data.plain || ""), "device A's edit uploads");
  await B.unroute("http://sb.test/**");
  await fake.attach(B);
  await B.evaluate(() => dispatchEvent(new Event("online")));
  await B.waitForTimeout(3500);
  const main = serverNote(U1, "Offline lecture"), copy = fake.all("notes", U1).find(r => /Offline lecture \(from another device\)/.test(r.data.title) && !r.deleted);
  ok(/Edited on B/.test(main?.data.plain || ""), "the device that was offline keeps its version in place");
  ok(!!copy && /Edited on A/.test(JSON.stringify(copy.data.doc)), "the other device's version is saved as a copy, not overwritten");
  await A.evaluate(() => dispatchEvent(new Event("online")));
  await A.waitForTimeout(1500);
  ok(/Edited on B/.test(await A.textContent("#editor")), "the open editor on device A shows the merged result without a reload");

  /* 4. Notes made while signed out move into an account only when asked */
  const C = await device();
  await newNote(C, "Before sign in", "Written while signed out.");
  await home(C);
  await signInAs(C, U3);
  await C.waitForSelector(".claimbar", { timeout: 5000 }).catch(() => null);
  ok(!!(await C.$(".claimbar")), "signing in asks before adding signed-out notes to the account");
  ok(!fake.all("notes", U3).some(r => r.data.title === "Before sign in"), "nothing is uploaded before the student answers");
  await C.click("#clYes");
  await C.waitForTimeout(2500);
  ok(fake.all("notes", U3).some(r => r.data.title === "Before sign in"), "choosing Add uploads them to the account");
  ok((await C.textContent("#stage")).includes("Before sign in"), "and they show on the dial");

  /* 5. Signing in with the emailed code (what iPad home-screen apps need), then deleting server data */
  const D = await device();
  fake.codeUser = "44444444-4444-4444-8444-444444444444";
  await D.click("#settingsBtn");
  await D.fill("#sEmail", "student@test.edu");
  await D.click("#sIn button");
  await D.waitForSelector("#sCode:not([hidden])");
  await D.fill("#sCodeIn", "000000");
  await D.click("#sCode button");
  await D.waitForTimeout(600);
  ok(/wrong or has expired/.test((await D.textContent("#toast")) || ""), "a wrong code is refused clearly");
  await D.fill("#sCodeIn", "123 456");
  await D.click("#sCode button");
  await D.waitForLoadState("load");
  await D.waitForTimeout(2000);
  await D.waitForSelector("#dial");
  ok(await D.evaluate(k => !!localStorage.getItem(k), KEY), "the emailed code signs the student in, inside the app");
  await newNote(D, "Delete me", "Private thoughts.");
  await settled(D, fake.codeUser);
  ok(!!serverNote(fake.codeUser, "Delete me"), "their note uploads");
  await home(D);
  await D.click("#settingsBtn");
  await D.click("#sDelServer"); await D.click("#sDelServer");
  await D.waitForTimeout(2500);
  ok(fake.all("notes", fake.codeUser).length === 0, "deleting server data removes the account's notes from the server");
  ok(fake.all("notes", U1).length > 0, "and leaves other accounts alone");


  /* 6. A refused upload is never counted as saved (Codex release check #1) */
  const U5 = "55555555-5555-4555-8555-555555555555";
  const E = await device();
  await signInAs(E, U5);
  await E.route("http://sb.test/**", r => r.abort("internetdisconnected"));
  await newNote(E, "Refused note", "Only copy of this thought.");
  const refusedId = (await E.evaluate(() => location.hash)).replace("#note-", "");
  fake.refuse.add(refusedId); // e.g. the id already belongs to another account
  await E.unroute("http://sb.test/**"); await fake.attach(E);
  await E.evaluate(() => dispatchEvent(new Event("online")));
  await E.waitForTimeout(2500);
  ok(!serverNote(U5, "Refused note"), "the server refused the note");
  const eLocal = await local(E, `liveboard-u-${U5}`);
  ok(eLocal.outbox > 0, "a refused note stays in the upload queue instead of being marked saved");
  ok(/couldn't upload/.test((await E.textContent("#syncState")) || ""), "the sync line says something couldn't upload");
  await home(E);
  const refusedMsg = await signOut(E, true);
  ok(/can't be removed/.test(refusedMsg), "removing this device's copy is refused while a note is refused by the server");
  await E.keyboard.press("Escape").catch(() => {});
  await E.click("#settingsBtn");
  await E.waitForSelector("#sRekey");
  ok(/couldn't upload/.test(await E.textContent(".sheet")), "Settings explains the refused item and offers a backup");
  await E.click("#sRekey");
  await E.waitForTimeout(3000);
  const rekeyed = serverNote(U5, "Refused note");
  ok(!!rekeyed && rekeyed.id !== refusedId && /Only copy/.test(rekeyed.data.plain), "Upload as new copies saves it under a new id");
  ok((await local(E, `liveboard-u-${U5}`)).outbox === 0, "and the queue is then empty");
  await E.keyboard.press("Escape").catch(() => {});

  // a note too large for the server is blocked before sending, and also never counted as saved
  await home(E);
  await E.click(".hbtn[data-act='blank']"); await E.waitForSelector("#editor .ProseMirror");
  await E.fill("#ptitle", "Huge note");
  await E.click("#editor .ProseMirror");
  await E.evaluate(() => { const dt = new DataTransfer(); dt.setData("text/html", Array.from({ length: 2600 }, (_, i) => `<p>${i} ${"x".repeat(900)}</p>`).join("")); document.querySelector("#editor .ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
  await E.waitForTimeout(3500);
  ok(!serverNote(U5, "Huge note"), "a note over the server's size limit isn't sent");
  ok((await local(E, `liveboard-u-${U5}`)).outbox > 0 && /couldn't upload/.test((await E.textContent("#syncState")) || ""), "it stays queued and flagged as not uploaded");

  /* 7. Typing during an upload that comes back as a conflict keeps the latest words (Codex release check #2) */
  const U6 = "66666666-6666-4666-8666-666666666666";
  const F = await device();
  await signInAs(F, U6);
  await newNote(F, "Race note", "sent version");
  for (let i = 0; i < 40 && !serverNote(U6, "Race note"); i++) await F.waitForTimeout(250);
  const raceId = (await F.evaluate(() => location.hash)).replace("#note-", "");
  ok(!!serverNote(U6, "Race note"), "race note uploaded");
  fake.beforePush = async (kind, rows) => {
    if (kind !== "notes" || !rows.some(r => r.id === raceId)) return;
    // another device saves first...
    const row = fake.rows.notes.get(raceId);
    Object.assign(row, { data: { ...row.data, plain: "server version", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "server version" }] }] } }, rev: row.rev + 1, seq: ++fake.seq });
    // ...and the student keeps typing while this upload is still waiting for its answer
    await appendText(F, " LATEST UNSENT EDIT");
  };
  await appendText(F, " plus edit");
  for (let i = 0; i < 60 && !/LATEST UNSENT EDIT/.test(serverNote(U6, "Race note")?.data.plain || ""); i++) await F.waitForTimeout(250);
  await F.waitForTimeout(500);
  const raceLocal = await F.evaluate(([name, id]) => new Promise(res => { const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction("notes").objectStore("notes").get(id); g.onsuccess = () => res(g.result.plain); }; }), [`liveboard-u-${U6}`, raceId]);
  ok(/LATEST UNSENT EDIT/.test(raceLocal), `the edit typed during the upload is kept in place (“…${raceLocal.slice(-40)}”)`);
  ok(/LATEST UNSENT EDIT/.test(serverNote(U6, "Race note")?.data.plain || ""), "and it reaches the server");
  ok(fake.all("notes", U6).some(r => /from another device/.test(r.data.title) && /server version/.test(JSON.stringify(r.data.doc))), "the other device's version is kept as a copy");

  /* 8. Deleting account data with unsynced edits, and another device offline (Codex release check #3) */
  const U7 = "77777777-7777-4777-8777-777777777777";
  const G1 = await device(), G2 = await device();
  await signInAs(G1, U7);
  await newNote(G1, "Shared note", "on both devices");
  await settled(G1, U7);
  await signInAs(G2, U7);
  for (let i = 0; i < 48 && !(await local(G2, `liveboard-u-${U7}`)).notes.some(n => n.title === "Shared note"); i++) await G2.waitForTimeout(250);
  await openByTitle(G2, "Shared note");
  await G2.route("http://sb.test/**", r => r.abort("internetdisconnected")); // G2 goes offline and keeps editing
  await appendText(G2, " OFFLINE EDIT ON G2");
  await appendText(G1, " UNSYNCED EDIT ON G1");
  await G1.click("#settingsBtn");                 // delete right away, while G1's edit hasn't uploaded
  await G1.click("#sDelServer"); await G1.click("#sDelServer");
  await G1.waitForTimeout(4000);
  ok(fake.all("notes", U7).length === 0, "deleting removes the account's notes from the server");
  ok(!fake.all("notes", U7).some(r => /UNSYNCED EDIT/.test(r.data.plain || "")), "G1's unsynced edit is not uploaded during or after deletion");
  ok(!(await G1.evaluate(k => localStorage.getItem(k), KEY)), "G1 is signed out");
  const g1db = await G1.evaluate(name => indexedDB.databases().then(l => l.some(d => d.name === name)), `liveboard-u-${U7}`);
  ok(!g1db, "G1's copy of the account is removed from the device");
  await G2.unroute("http://sb.test/**"); await fake.attach(G2);
  await G2.evaluate(() => dispatchEvent(new Event("online")));
  await G2.waitForTimeout(3000);
  ok(fake.all("notes", U7).length === 0, "the offline device can't put the deleted notes back");
  ok(/online copy was deleted/.test((await G2.textContent("#syncState")) || ""), "the offline device says the account's online copy was deleted");
  ok((await local(G2, `liveboard-u-${U7}`)).notes.some(n => /OFFLINE EDIT/.test(n.plain)), "its own copy is kept on that device");
  await home(G2);
  await G2.click("#settingsBtn");
  await G2.click("#sReupload");
  await G2.waitForTimeout(3000);
  ok(fake.all("notes", U7).some(r => /OFFLINE EDIT/.test(r.data.plain || "")), "re-uploading only happens when the student chooses it");

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL SYNC CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

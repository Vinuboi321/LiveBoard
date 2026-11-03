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
  const serverNote = (uid, title) => fake.all("notes", uid).find(r => r.data.title === title && !r.deleted);
  const home = async p => { await p.evaluate(() => { location.hash = ""; }); await p.waitForSelector("#dial"); await p.waitForTimeout(300); };

  /* 1. Offline edits survive a restart and a sign-out */
  const A = await device();
  await signInAs(A, U1);
  await newNote(A, "Offline lecture", "Mitosis has four phases.");
  await A.waitForTimeout(2200);
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
  await openByTitle(B, "Offline lecture");
  // device B loses its connection and keeps editing
  await B.route("http://sb.test/**", r => r.abort("internetdisconnected"));
  await appendText(B, " Edited on B.");
  await openByTitle(A, "Offline lecture");
  await appendText(A, " Edited on A.");
  await A.waitForTimeout(2200);
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

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL SYNC CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

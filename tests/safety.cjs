// Checks for the reliability fixes: strict backup restore, markers that keep their thinking when their passage is deleted,
// exam-date reminders, the sandboxed calculator and the all-due recall default.
// Usage: npx vite preview --port 4173 & node tests/safety.cjs
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const BASE = process.env.BASE || "http://localhost:4173";

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ok = (c, msg) => { if (c) console.log("ok  ", msg); else errs.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
  const home = async () => { await p.evaluate(() => { location.hash = ""; }); await p.waitForSelector("#dial"); await p.waitForTimeout(300); };
  const toastText = async () => { for (let i = 0; i < 30; i++) { const t = (await p.textContent("#toast").catch(() => "")) || ""; if (t.trim()) return t; await p.waitForTimeout(100); } return ""; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
  const file = (name, body) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body)); return f; };
  const noteCount = () => p.evaluate(() => new Promise(res => { const r = indexedDB.open("liveboard"); r.onsuccess = () => { const q = r.result.transaction("notes").objectStore("notes").count(); q.onsuccess = () => { res(q.result); r.result.close(); }; }; }));

  await p.goto(BASE);
  await p.waitForSelector("#dial");
  await p.waitForTimeout(500);

  /* Recall defaults to everything due */
  ok((await p.getAttribute(".scope button[data-s='due']", "aria-pressed")) === "true", "recall starts on All due");

  /* Backups are checked before anything is written */
  const restore = async f => {
    await p.click("#settingsBtn");
    await p.waitForSelector("#sImport", { state: "attached" });
    await p.setInputFiles("#sImport", f);
    await p.waitForTimeout(300);
  };
  const n0 = await noteCount();
  await restore(file("bad.json", "{ this is not json"));
  ok(/isn't a LiveBoard backup/.test(await toastText()), "a damaged file is refused with a clear message");
  await p.keyboard.press("Escape");
  const courseId = "c1";
  const evil = { app: "liveboard", version: 2, courses: [{ id: courseId, name: "Bio", color: "red;background:url(x)", updatedAt: 1 }], notes: [{ id: "n1", courseId, title: "Hacked", kind: "blank", doc: { type: "doc", content: [{ type: "script", text: "x" }] }, plain: "", createdAt: 1, updatedAt: 1, openedAt: 1 }], markers: [] };
  await restore(file("evil.json", evil));
  ok(/doesn't recognise/.test(await toastText()), "unknown content in a note is refused");
  await p.keyboard.press("Escape");
  const orphan = { app: "liveboard", version: 2, courses: [], notes: [], markers: [{ id: "m1", noteId: "nowhere", type: "note", text: "x", thread: [], mastery: 0, due: 1, ivl: 1, createdAt: 1, updatedAt: 1 }] };
  await restore(file("orphan.json", orphan));
  ok(/isn't in the backup/.test(await toastText()), "a marker pointing at a missing note is refused");
  await p.keyboard.press("Escape");
  ok((await noteCount()) === n0, "refused backups change nothing");
  const good = { app: "liveboard", version: 2, courses: [{ id: courseId, name: "Chem", color: "javascript:alert(1)", updatedAt: 1 }], notes: [{ id: "n2", courseId, title: "Restored acids", kind: "blank", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Acids donate protons." }] }] }, plain: "Acids donate protons.", createdAt: 1, updatedAt: 1, openedAt: Date.now() }], markers: [] };
  await restore(file("good.json", good));
  await p.waitForSelector(".restorebox");
  ok(/1 note/.test(await p.textContent(".restorebox")), "a valid backup shows what it will add before restoring");
  await p.click("#rGo");
  await p.waitForTimeout(600);
  ok((await noteCount()) === n0 + 1, "restoring writes the backup");
  const color = await p.evaluate(() => new Promise(res => { const r = indexedDB.open("liveboard"); r.onsuccess = () => { const q = r.result.transaction("courses").objectStore("courses").get("c1"); q.onsuccess = () => { res(q.result?.color); r.result.close(); }; }; }));
  ok(color === "#8892A0", `unsafe course colors are replaced (${color})`);

  /* A marker keeps its thinking when its passage is deleted */
  await home();
  await p.click(".hbtn[data-act='blank']");
  await p.waitForSelector("#editor .ProseMirror");
  await p.fill("#ptitle", "Detach test");
  await p.click("#editor .ProseMirror");
  await p.keyboard.type("Enzymes lower activation energy.");
  await p.keyboard.press("Enter");
  await p.keyboard.type("Second line stays.");
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const t = document.querySelector("#editor p").firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 7);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector("#editor .ProseMirror").focus();
  });
  await p.waitForTimeout(200);
  await p.click(".floatbtn.place");
  await p.waitForSelector(".mws");
  await p.click("[data-tab='write']");
  await p.fill("#wDraft", "My own explanation of enzymes");
  await p.click("#wKeep");
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    const para = document.querySelector("#editor p");
    const r = document.createRange(); r.selectNodeContents(para);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector("#editor .ProseMirror").focus();
  });
  await p.keyboard.press("Backspace");
  await p.waitForTimeout(900);
  ok(!(await p.$("#editor .pin")), "deleting the passage removes its dot from the page");
  await p.waitForSelector("#lostBtn");
  ok(/1 lost its place/.test(await p.textContent("#mcount")), "the note says a marker lost its place");
  await p.click("#lostBtn");
  await p.waitForSelector(".mws .detached");
  await p.click("[data-tab='write']");
  ok(/My own explanation/.test(await p.textContent(".mws")), "the marker's writing is kept");
  await p.click("#mReattach");
  await p.waitForTimeout(400);
  ok(!!(await p.$("#editor .pin")) && !(await p.$(".mws .detached")), "the marker can be put back in the note");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);

  /* "Before the exam" asks for the exam date once */
  await p.locator("#editor .pin").first().click();
  await p.waitForSelector(".mws");
  await p.click("[data-tab='ask']");
  await p.fill("#mIn", "remind me before the exam");
  await p.click("#aGo");
  await p.waitForSelector("#examAsk");
  ok(true, "a reminder before the exam asks for the exam date");
  const d = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await p.fill("#examIn", d);
  await p.click("#examAsk button");
  await p.waitForTimeout(400);
  ok(/before your exam/.test(await p.textContent(".mws")), "the reminder is set from the real exam date");

  /* The calculator is sandboxed and bounded */
  await p.click("[data-tab='calc']");
  const calc = async expr => { await p.fill("#cIn", expr); await p.click("#cForm button"); await p.waitForTimeout(500); return ((await p.textContent("#cOut").catch(() => "")) || "") + " " + (await toastText()); };
  ok(/isn't available/.test(await calc("import({x: 1})")), "the calculator refuses to redefine itself");
  ok(/too large/.test(await calc("99999!")), "huge factorials are refused instead of freezing the page");
  ok(/= 1\b/.test(await calc("9007199254740993 - 9007199254740992")), "big-integer math stays exact in the worker");

  /* Two tabs editing the same note keep both edits */
  await p.keyboard.press("Escape");
  const noteHash = await p.evaluate(() => location.hash);
  const p2 = await ctx.newPage();
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p2.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
  await p2.goto(BASE + "/" + noteHash);
  await p2.waitForSelector("#editor .ProseMirror");
  const typeEnd = async (pg, txt) => { await pg.evaluate(() => { const ps = document.querySelectorAll("#editor p"), last = ps[ps.length - 1]; const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.querySelector("#editor .ProseMirror").focus(); }); await pg.keyboard.type(txt); await pg.waitForTimeout(900); };
  await typeEnd(p, " FROM-TAB-ONE");
  await typeEnd(p2, " FROM-TAB-TWO");
  await p.waitForTimeout(400);
  ok(/FROM-TAB-TWO/.test(await p.textContent("#editor")), "a note open in two tabs shows the other tab's edit");
  const plain = await p.evaluate(h => new Promise(res => { const r = indexedDB.open("liveboard"); r.onsuccess = () => { const q = r.result.transaction("notes").objectStore("notes").get(h.replace("#note-", "")); q.onsuccess = () => res(q.result.plain); }; }), noteHash);
  ok(/FROM-TAB-ONE/.test(plain) && /FROM-TAB-TWO/.test(plain), "and neither tab's edit is lost");
  await p2.close();

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL SAFETY CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

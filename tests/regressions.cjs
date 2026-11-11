// Regression checks for reported bugs and the marker features built on them.
// Usage: npx vite preview --port 4173 & node tests/regressions.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:4173";

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ok = (c, msg) => { if (c) console.log("ok  ", msg); else errs.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route("**/api/marker", r => r.request().method() === "GET"
    ? r.fulfill({ json: { ai: true, model: "mock" } })
    : r.fulfill({ json: { sources:[{field:"passage",quote:r.request().postDataJSON().passage}], kind: "insert", type: "explain", markdown: "Inserted explanation for testing.", recall: { q: "Mock question?", a: "Mock answer." } } }));
  const home = async () => { await p.evaluate(() => { location.hash = ""; }); await p.waitForSelector("#dial"); await p.waitForTimeout(400); };
  const select = async (re, chars = 16) => {
    await p.evaluate(({ src, n }) => {
      const r = new RegExp(src);
      const para = [...document.querySelectorAll("#editor p")].find(x => r.test(x.textContent) && !x.querySelector(".pin"));
      const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode();
      const range = document.createRange(); range.setStart(t, 0); range.setEnd(t, Math.min(n, t.length));
      const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      document.querySelector("#editor .ProseMirror").focus();
    }, { src: re.source, n: chars });
    await p.waitForTimeout(200);
  };

  await p.goto(BASE);
  await p.waitForSelector("#dial");
  await p.waitForTimeout(600);

  /* 1. A marker-only note survives leaving it */
  await p.click(".hbtn[data-act='blank']");
  await p.waitForSelector("#editor .ProseMirror");
  await p.click("#dropBtn");
  const wb = await p.locator("#ewrap").boundingBox();
  await p.mouse.click(wb.x + 120, wb.y + 60);
  await p.waitForSelector(".mws #wDraft");
  await p.fill("#wDraft", "Mitochondrial thought kept only inside a marker");
  await p.click("#wKeep");
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  await home();
  await p.keyboard.press("Control+k");
  await p.fill("#qIn", "kept only inside");
  await p.waitForTimeout(150);
  ok((await p.$$(".qrow2[data-m]")).length === 1, "1 · an untitled note with only marker writing is kept");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".mws");
  ok(true, "search opens the marker in its note");
  await p.keyboard.press("Escape");

  /* Set up a lecture-style note with two text markers */
  await home();
  await p.click(".hbtn[data-act='blank']");
  await p.waitForSelector("#editor .ProseMirror");
  await p.fill("#ptitle", "Regression lecture");
  await p.click("#editor .ProseMirror");
  await p.keyboard.type("The derivative of x^2 is 2x for every real x.");
  await p.keyboard.press("Enter");
  await p.keyboard.type("Glycolysis happens first, then the citric acid cycle.");
  await p.waitForTimeout(300);
  await select(/derivative/, 22);
  await p.click(".floatbtn.place");
  await p.waitForSelector(".mws");
  await p.fill('#mIn','Explain using my note'); await p.click('#aGo');
  await p.waitForSelector('.answer-sources');
  ok((await p.textContent('.answer-sources summary')).includes('Quoted from your note'),'AI response exposes its source quotes');
  const chips = await p.$$eval(".sugg button", bs => bs.map(x => x.textContent));
  ok(chips.includes("Show the steps"), `contextual actions fit math (${chips.slice(0, 3).join(", ")})`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await select(/Glycolysis/, 30);
  await p.click(".floatbtn.place");
  await p.waitForSelector(".mws");
  const chips2 = await p.$$eval(".sugg button", bs => bs.map(x => x.textContent));
  ok(chips2.includes("Turn into numbered steps"), `contextual actions fit a process (${chips2.slice(0, 2).join(", ")})`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);

  /* 2. Editing a marked passage updates the marker */
  await p.evaluate(() => {
    const mk = document.querySelector("#editor .mk");
    const t = mk.firstChild;
    const r = document.createRange(); r.setStart(t, 4); r.setEnd(t, 4);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector("#editor .ProseMirror").focus();
  });
  await p.keyboard.type("first ");
  await p.waitForTimeout(900);
  await p.locator("#editor .pin").first().click();
  await p.waitForSelector(".mws blockquote");
  const quote = await p.textContent(".mws .wsanchor blockquote");
  ok(/The first derivative/.test(quote), `marker follows edits to its passage (“${quote.trim().slice(0, 32)}…”)`);

  ok((await p.textContent('.answer-sources summary')).includes('Source changed'),'editing the source flags the older AI answer');

  /* 4. Delayed saves stay with their marker */
  await p.click("[data-tab='recall']");
  await p.fill("#rcQ", "Question typed into marker one");
  await p.locator("#editor .pin").nth(1).dispatchEvent("click"); // switch before the delayed save fires
  await p.waitForTimeout(700);
  await p.click("[data-tab='recall']");
  const q2 = await p.inputValue("#rcQ");
  ok(!/marker one/.test(q2), "a pending save doesn't leak into the next marker");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await p.locator("#editor .pin").first().click();
  await p.waitForSelector(".mws");
  await p.click("[data-tab='recall']");
  ok((await p.inputValue("#rcQ")) === "Question typed into marker one", "the pending save lands on the marker it was typed into");

  /* 5. Precise math */
  await p.click("[data-tab='calc']");
  await p.fill("#cIn", "9007199254740993 - 9007199254740992");
  await p.click("#cForm button");
  await p.waitForTimeout(300);
  ok(/=\s*1$/.test((await p.textContent("#cOut")).trim()), `large-integer subtraction is right (${(await p.textContent("#cOut")).trim()})`);

  /* Traceable writing: output reopens its marker and keeps versions */
  await p.click("[data-tab='ask']");
  await p.fill("#mIn", "explain this");
  await p.click("#aGo");
  await p.waitForSelector(".mout");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await p.click(".mout [data-act='keep']");
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const t = document.querySelector("#editor .mout .moutbody p").firstChild;
    const r = document.createRange(); r.setStart(t, t.length); r.setEnd(t, t.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector("#editor .ProseMirror").focus();
  });
  await p.keyboard.type(" Edited by me.");
  await p.waitForTimeout(1000);
  await p.hover("#editor .mout");
  await p.click("#editor .mout .moutsrc");
  await p.waitForSelector(".mws .written");
  ok(/2 versions/.test(await p.textContent(".mws .written")), "writing reopens its marker and keeps its versions");
  await p.click(".wrevs summary");
  await p.click("[data-restore]");
  await p.waitForTimeout(300);
  ok(!/Edited by me/.test(await p.textContent("#editor .mout")), "an earlier version can be restored");

  /* Multi-marker study guide */
  await p.click("[data-tab='related']");
  const opt = await p.$$eval("#rSel option", os => os.map(o => o.value).filter(Boolean));
  await p.selectOption("#rSel", opt[0]);
  await p.click("#rLink");
  await p.waitForSelector("#rGuide");
  await p.click("#rGuide");
  await p.waitForFunction(() => /Study guide/.test(document.querySelector("#ptitle")?.value || ""));
  await p.waitForTimeout(500);
  ok((await p.$$("#editor .pin")).length >= 2, "study guide gets a section per connected point");
  ok((await p.$$(".stringtag")).length >= 2, "each section links back to its point");

  // Light and dark: the header button flips the theme, the choice survives a reload, and Settings can hand it back to the device.
  const themeOf = () => p.evaluate(() => ({ attr: document.documentElement.getAttribute("data-theme"), desk: getComputedStyle(document.documentElement).getPropertyValue("--desk").trim() }));
  const before = await themeOf();
  await p.click("#themeBtn");
  const flipped = await themeOf();
  ok(flipped.attr && flipped.desk !== before.desk, `theme button switches light and dark (${before.desk} → ${flipped.desk})`);
  await p.reload(); await p.waitForSelector("#themeBtn");
  ok((await themeOf()).attr === flipped.attr, "the theme choice is remembered on this device");
  await p.click("#settingsBtn"); await p.waitForSelector('[data-theme-pick="system"]');
  await p.click('[data-theme-pick="system"]');
  ok((await themeOf()).attr === null, "Settings can set the theme back to match the device");

  // The morning line and the learning map: where to recall from is a word in the heading, and the chart under the dial
  // opens into a full map with an overall summary, then folds away again.
  await p.keyboard.press("Escape");
  await p.goto(BASE); await p.waitForSelector("#mapOpen");
  await p.waitForTimeout(2200); // the dial's 3D rise
  ok(!(await p.$("#dial.intro3d")), "the dial's opening animation finishes and hands back to the flat dial");
  await p.click("#scopeBtn"); await p.click(".scope button[data-s='week']");
  const scoped = await p.waitForFunction(() => /this week/.test(document.querySelector("#scopeBtn")?.textContent || ""), null, { timeout: 4000 }).then(() => true, () => false);
  ok(scoped, "the recall scope is chosen from the heading");
  await p.click("#scopeBtn"); await p.click(".scope button[data-s='due']");
  await p.click("#mapOpen"); await p.waitForSelector("#mapView #skyBig svg");
  ok((await p.$$("#skyBig .star")).length >= 2 && /%/.test(await p.textContent(".mringin b")) && (await p.$$(".mcourse")).length >= 1, "the chart opens into the learning map with every marker and an overall summary");
  await p.click(".mcourse");
  ok((await p.$$("#skyBig .con.picked")).length >= 1, "tapping a course shows only its part of the map");
  await p.keyboard.press("Escape");
  await p.waitForSelector("#mapView", { state: "detached" });
  ok(true, "Escape closes the map");
  await p.click("#mapOpen"); await p.waitForSelector("#skyBig .star");
  await p.waitForTimeout(900);
  await p.click("#skyBig .star .hit", { force: true });
  await p.waitForSelector(".mws");
  ok(!(await p.$("#mapView")), "a star on the map opens its marker in its note");

  // The marker's Write box is a real writing space (it used to collapse to a sliver), and the count under it follows along.
  ok((await p.evaluate(() => document.querySelector("#wDraft")?.getBoundingClientRect().height || 0)) >= 150 || (await p.click('.wstabs [data-tab="write"]').then(() => p.evaluate(() => document.querySelector("#wDraft").getBoundingClientRect().height))) >= 150, "the Write box is tall enough to write in");
  await p.click('.wstabs [data-tab="write"]');
  await p.fill("#wDraft", "three small words");
  ok(/3 words/.test(await p.textContent("#wCount")), "the Write box counts words as you type");
  await p.fill("#wDraft", "");
  await p.click('.wstabs [data-tab="recall"]');
  ok(await p.evaluate(() => !!document.querySelector(".wstabs .tabink") && document.querySelector('.wstabs [aria-selected="true"]').dataset.tab === "recall"), "switching tabs moves the highlight to the new tab");
  await p.keyboard.press("Escape");

  // Under the dial: resting on a marker card peeks inside it, and the peek opens the marker.
  await p.goto(BASE); await p.waitForSelector(".fcard"); await p.waitForTimeout(2200);
  await p.evaluate(() => document.querySelector(".fcards").scrollIntoView({ block: "center" }));
  await p.hover(".fcard");
  await p.waitForSelector("#fpeek");
  ok(/Open marker/.test(await p.textContent("#fpeek")), "hovering a marker card shows a peek of the marker");
  await p.click("#fpeek .ptop");
  await p.waitForSelector(".mws");
  ok(!(await p.$("#fpeek")) && /#note-/.test(await p.evaluate(() => location.hash)), "clicking the peek opens the marker in its note");
  await p.keyboard.press("Escape");

  // Capture confusion without leaving the lecture; keep a correction and compare across markers.
  await home();
  await p.click(".hbtn[data-act='blank']");
  await p.waitForSelector("#editor .ProseMirror");
  await p.click("#editor .ProseMirror");
  await p.keyboard.type("Velocity and acceleration are not the same.");
  await p.click("#captureLost");
  await p.waitForSelector("#editor .pin");
  ok(!(await p.$(".mws:not(.closing)")), "Lost me here captures a point without interrupting note taking");
  await p.click("#editor .pin");
  await p.click('[data-tab="journey"]');
  ok((await p.textContent(".thoughttrail")).includes("Lost me here"), "confusion appears in the marker journey");
  await p.fill("#thoughtBefore", "I thought a moving object always accelerates.");
  await p.fill("#thoughtAfter", "Acceleration changes velocity; constant velocity has zero acceleration.");
  await p.waitForFunction(() => document.querySelector('.mws .saved')?.textContent.includes('Journey draft saved'));
  await p.click('[data-understanding="working"]');
  await p.waitForFunction(()=>document.querySelector('[data-understanding="working"]')?.getAttribute('aria-pressed')==='true');
  await p.reload(); await p.waitForSelector("#editor .pin");
  await p.click("#editor .pin"); await p.click('[data-tab="journey"]');
  ok((await p.inputValue('#thoughtBefore')).includes('always accelerates') && (await p.inputValue('#thoughtAfter')).includes('zero acceleration'), 'unfinished Journey drafts survive a reload');
  ok(await p.getAttribute('[data-understanding="working"]','aria-pressed') === 'true', 'understanding progress survives a reload');
  await p.click('#journeyForm button');
  await p.waitForSelector(".thoughtshift");
  await p.reload(); await p.waitForSelector("#editor .pin");
  await p.click("#editor .pin"); await p.click('[data-tab="journey"]');
  ok(await p.getAttribute('[data-understanding="understood"]','aria-pressed') === 'true' && (await p.inputValue('#thoughtBefore')) === '', 'a breakthrough completes understanding and clears its durable draft');
  ok((await p.textContent(".thoughtshift")).includes("zero acceleration"), "both sides of a breakthrough survive a reload");
  await p.click("#mCompare");
  await p.selectOption("#comparePick", {index:1});
  ok((await p.textContent("#compareA")).includes("Velocity") && (await p.textContent("#compareB")).trim().length>0, "comparison shows two distinct markers");
  await p.keyboard.press("Escape");
  ok(!(await p.$(".compareveil")) && !!(await p.$(".mws:not(.closing)")), "Escape closes comparison and leaves the marker open");
  await p.keyboard.press("Escape");

  await p.keyboard.press('Control+k'); await p.fill('#qIn','Velocity');
  await p.check('#qUnresolved');
  ok(await p.locator('.qrow2[data-m]').count()===0,'unfinished filter excludes understood markers');
  await p.uncheck('#qUnresolved');
  ok(await p.locator('.qrow2[data-m]').count()===1,'all-marker search still finds the understood point');
  await p.keyboard.press('Escape');

  // Scale: a folder holding far more than the dial shows opens into a shelf of everything, searchable.
  await p.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("liveboard"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise(res => { const r = db.transaction("notes").objectStore("notes").getAll(); r.onsuccess = () => res(r.result); });
    const base = all.find(n => !n.deleted), now = Date.now(), tx = db.transaction("notes", "readwrite"), st = tx.objectStore("notes");
    for (let i = 0; i < 240; i++) { const at = now - (1.5 + (i % 50) / 10) * 864e5; st.put({ ...base, id: "bulk-" + i, title: (i === 7 ? "Needle in the stack" : "Bulk note " + i), openedAt: at, updatedAt: at, createdAt: at }); }
    await new Promise(res => { tx.oncomplete = res; });
  });
  await p.goto(BASE); await p.waitForSelector("#folders .folder:not(.loose)"); await p.waitForTimeout(2300);
  const dialItems = (await p.$$("#folders .folder")).length;
  ok(dialItems <= 8, `240 extra notes still make at most 8 things on the dial (${dialItems})`);
  const wk = await p.evaluate(() => [...document.querySelectorAll("#folders .folder:not(.loose)")].findIndex(f => /This week/.test(f.textContent)));
  { const bx = await (await p.$$("#folders .folder:not(.loose)"))[wk].boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height * 0.88); } // select the folder by its front, below its files
  await p.waitForTimeout(500);
  if (!(await p.$("#shelf"))) { // the click landed beside the folder's own See all pill: use the hub's instead
    await p.mouse.move(4, 300);
    await p.waitForSelector("#hubAll");
    await p.click("#hubAll");
  }
  await p.waitForSelector("#shelf .snote");
  ok(/24\d/.test(await p.textContent("#shelfN")) && (await p.$$("#shelf .snote")).length === 120, "See all opens a shelf of the whole folder, drawn a screenful at a time");
  await p.fill("#shelfQ", "needle");
  await p.waitForFunction(() => document.querySelectorAll("#shelf .snote").length === 1);
  await p.click("#shelf .snote");
  await p.waitForSelector("#ptitle");
  ok((await p.inputValue("#ptitle")) === "Needle in the stack" && !(await p.$("#shelf")), "searching the shelf finds one note among hundreds and opens it");

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL REGRESSIONS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

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
  await p.click("#moreBtn"); await p.click("#captureLost");
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

  // A study session: start the timer, mark something, end it, and the exit ticket quizzes exactly what was marked.
  await p.goto(BASE); await p.waitForSelector("#focusBtn"); await p.waitForTimeout(2300);
  await p.click("#focusBtn"); await p.click('[data-min="15"]');
  ok(/^1[45]:\d\d$/.test((await p.textContent("#focusBtn .fbt")).trim()), "starting a study session shows the countdown in the header");
  await p.click(".hbtn[data-act='blank']");
  await p.waitForSelector("#editor .ProseMirror");
  await p.fill("#ptitle", "Session note");
  await p.click("#editor .ProseMirror");
  await p.keyboard.type("Osmosis moves water across a membrane toward the side with more solute.");
  await p.waitForTimeout(300);
  await select(/Osmosis/, 20);
  await p.click(".floatbtn.place");
  await p.waitForSelector(".mws");
  await p.waitForTimeout(700);

  // The marker card resizes from its sides and corners, remembers the size, and springs back on a double-click.
  const cardBox = () => p.evaluate(() => { const r = document.querySelector(".mws").getBoundingClientRect(); return { x: r.left, y: r.top, w: Math.round(r.width), h: Math.round(r.height) }; });
  const b0 = await cardBox();
  const vw = await p.evaluate(() => innerWidth);
  const west = b0.x > vw - (b0.x + b0.w), grabX = west ? b0.x + 3 : b0.x + b0.w - 3, dirX = west ? -1 : 1; // pull whichever side has more room
  await p.mouse.move(grabX, b0.y + b0.h / 2); await p.mouse.down();
  await p.mouse.move(grabX + dirX * 90, b0.y + b0.h / 2, { steps: 5 });
  const mid = await p.evaluate(() => { const c = document.querySelector(".mws"); return { on: c.classList.contains("resizing"), lit: !!c.querySelector(".wsresize.pulling"), chip: c.querySelector(".wssize")?.textContent || "" }; });
  ok(mid.on && mid.lit && /\d+ × \d+/.test(mid.chip), `while pulling, the edge lights up and the card shows its size (${mid.chip})`);
  await p.mouse.up();
  await p.waitForFunction(() => !document.querySelector(".mws").classList.contains("resizing"), null, { timeout: 4000 });
  const b1 = await cardBox();
  ok(Math.abs(b1.w - (b0.w + 90)) <= 3, `pulling a side of the marker card resizes it (${b0.w} → ${b1.w})`);
  const kept = JSON.parse(await p.evaluate(() => localStorage.getItem("lb-card-size")) || "{}");
  ok(Math.abs((kept.width || 0) - b1.w) <= 1, `the card remembers its size on this device (${kept.width})`);
  // pulled far past its smallest size it gives a little, then snaps back to the smallest size on release
  const gx = west ? b1.x + 3 : b1.x + b1.w - 3;
  await p.mouse.move(gx, b1.y + b1.h / 2); await p.mouse.down();
  await p.mouse.move(gx - dirX * 900, b1.y + b1.h / 2, { steps: 6 }); await p.mouse.up();
  await p.waitForFunction(() => !document.querySelector(".mws").classList.contains("resizing"), null, { timeout: 4000 });
  ok((await cardBox()).w === 320, `the card can't be pulled smaller than its minimum (${(await cardBox()).w})`);
  await p.dblclick(".mws .wsresize-s");
  await p.waitForTimeout(150);
  await p.waitForFunction(() => !document.querySelector(".mws").classList.contains("resizing"), null, { timeout: 4000 });
  const b2 = await cardBox(), keptAfter = await p.evaluate(() => localStorage.getItem("lb-card-size"));
  ok(b2.w === b0.w && keptAfter === null, `double-clicking a side springs the card back to its standard size (${b2.w}, ${keptAfter})`);
  await p.keyboard.press("Escape");

  // The note's more menu exports the note as Markdown, without the app's own buttons in it.
  await p.click("#moreBtn");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#noteMenu [data-act="file"]')]);
  const mdText = require("fs").readFileSync(await dl.path(), "utf8");
  ok(/^# Session note/.test(mdText) && /Osmosis moves water across a membrane/.test(mdText) && !/↗|Keep|Remove/.test(mdText), "a note downloads as clean Markdown");

  await p.click("#focusBtn"); await p.click("#fEnd");
  await p.waitForSelector(".sessiondone #sdGo");
  ok(/1 marker placed/.test(await p.textContent(".sessiondone")), "ending the session counts the markers placed during it");
  await p.click("#sdGo");
  await p.waitForSelector("#dial.recall", { timeout: 8000 });
  ok(/Exit ticket 1 of 1/.test(await p.textContent("#info")), "the exit ticket quizzes exactly what was marked in the session");

  // Pictures: an image file becomes an inline picture in the note, shrunk on the device, resizable, captioned, and kept across a reload.
  await p.goto(BASE); await p.waitForSelector(".hbtn[data-act='blank']"); await p.waitForTimeout(2200);
  await p.click(".hbtn[data-act='blank']"); await p.waitForSelector("#ptitle");
  await p.fill("#ptitle", "Picture note");
  await p.click("#editor .ProseMirror"); await p.keyboard.type("Slide 4:");
  const png = await p.evaluate(async () => { const c = document.createElement("canvas"); c.width = 2400; c.height = 1500; const g = c.getContext("2d"); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7},70%,${30 + (i % 5) * 10}%)`; g.fillRect((i * 97) % 2400, (i * 61) % 1500, 260, 180); } return c.toDataURL("image/png").split(",")[1]; });
  await p.click("#moreBtn");
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click('#noteMenu [data-act="picture"]')]);
  await chooser.setFiles({ name: "slide.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p.waitForSelector("#editor figure.pic img[src^='data:image/']");
  const pic = await p.evaluate(() => { const i = document.querySelector("#editor figure.pic img"); return { len: i.src.length, kind: i.src.slice(5, 15) }; });
  ok(pic.len < 260000 && /webp|jpeg/.test(pic.kind), `a large picture is shrunk before it's stored (${Math.round(pic.len / 1024)} KB, ${pic.kind})`);
  await p.click("#editor figure.pic img");
  await p.click('#editor .picbar [data-w="l"]');
  ok((await p.getAttribute("#editor figure.pic", "data-w")) === "l", "a selected picture can be resized");
  await p.click("#editor figure.pic img");
  await p.click('#editor .picbar [data-do="cap"]'); await p.fill("#editor .picbar input", "Supply and demand curves"); await p.keyboard.press("Enter");
  ok(/Supply and demand curves/.test(await p.textContent("#editor figure.pic figcaption")), "a picture can be captioned");
  await p.waitForTimeout(900);
  await p.reload(); await p.waitForSelector("#editor figure.pic img[src^='data:image/']");
  ok((await p.getAttribute("#editor figure.pic", "data-w")) === "l" && /Slide 4/.test(await p.textContent("#editor")), "the picture, its size and the text around it survive a reload");
  await p.click("#editor .ProseMirror p");
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/html", '<p>pasted words</p><img src="https://example.com/track.png">');
    document.querySelector("#editor .ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForFunction(() => /pasted words/.test(document.querySelector("#editor").textContent));
  ok((await p.$$("#editor img")).length === 1 && !(await p.$("#editor img:not([src^='data:image/'])")), "pasting a web page keeps its words but never an image that loads from the web");

  // The note header: three tools on the page, everything else in the menu, which always opens fully on screen.
  ok((await p.$$(".big3 > .b3")).length === 2 && /Return to dial/.test((await p.textContent("#backBtn")).replace(/\u00a0/g, " ")) && (await p.$$("#moreBtn .bars u")).length === 3 && !(await p.isVisible("#delNote")), "the header has Return to dial and a three-bar Menu on the left, Marker and Format on the right; Delete lives in the menu");
  const aa = await p.evaluate(() => { const r = document.createRange(), b = document.querySelector("#toolsBtn b"), sp = document.querySelector("#toolsBtn span"); const base = el => { r.selectNodeContents(el); const rc = r.getBoundingClientRect(), fs = parseFloat(getComputedStyle(el).fontSize); return rc.bottom - (rc.height - fs) / 2; }; return Math.abs(base(b) - base(sp)); });
  ok(aa < 2.5, `"Aa" and "Format" sit on one line (${aa.toFixed(1)}px apart)`);
  for (const w of [1280, 700, 520, 380]) {
    await p.setViewportSize({ width: w, height: 760 });
    const orbAt = await p.evaluate(() => Math.round(document.querySelector("#moreBtn").getBoundingClientRect().left));
    await p.hover("#moreBtn"); await p.waitForTimeout(350);
    ok(orbAt === await p.evaluate(() => Math.round(document.querySelector("#moreBtn").getBoundingClientRect().left)) && (await p.evaluate(() => getComputedStyle(document.querySelector(".orblabel")).opacity)) > "0.5", `resting on the menu button says "Menu" without moving anything (${w}px)`);
    await p.click("#moreBtn"); await p.waitForSelector("#noteMenu:not([hidden])");
    await p.waitForTimeout(450);
    const box = await p.evaluate(() => { const r = document.querySelector("#noteMenu").getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight }; });
    ok(box.l >= 0 && box.r <= box.vw + 1 && box.b <= box.vh + 1, `the menu opens fully on screen at ${w}px wide (${Math.round(box.l)}–${Math.round(box.r)} of ${box.vw})`);
    await p.keyboard.press("Escape");
  }
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.click("#moreBtn");
  await p.click("#delNote");
  ok(/Tap again/.test(await p.textContent("#delNote")), "Delete asks for a second tap");
  await p.click("#noteMenuTop");
  ok((await p.textContent("#delNote")) === "Delete note", "tapping anywhere else cancels the delete");
  await p.click("#delNote"); await p.keyboard.press("Escape");
  ok(await p.evaluate(() => document.querySelector("#delNote").textContent === "Delete note") && !!(await p.$("#ptitle")), "Escape cancels it too, and the note is still there");

  // A marker's status is changed from its head, and a finished marker can be closed out instead of deleted.
  await p.goto(BASE); await p.waitForSelector(".hbtn[data-act='blank']"); await p.waitForTimeout(2200);
  await p.click(".hbtn[data-act='blank']"); await p.waitForSelector("#ptitle");
  await p.fill("#ptitle", "Closing note");
  await p.click("#editor .ProseMirror"); await p.keyboard.type("The four phases are prophase, metaphase, anaphase and quokkaphase.");
  await p.keyboard.down("Shift"); for (let i = 0; i < 30; i++) await p.keyboard.press("ArrowLeft"); await p.keyboard.up("Shift");
  await p.click(".floatbtn.place"); await p.waitForSelector(".mws");
  await p.click("#mMast"); await p.click('.mastpick [data-mast="1"]');
  await p.waitForSelector('#mMast[data-mastery="1"]');
  ok(/Getting it/.test(await p.textContent("#mMast")) && (await p.getAttribute("#editor .pin", "data-mastery")) === "1", "the status chip at the top of a marker changes how well you know it");
  await p.click("#mFinish");
  await p.waitForSelector(".mws", { state: "detached" });
  ok(await p.evaluate(() => document.querySelector("#editor .pin").classList.contains("closed")), "closing a marker out leaves it on the page, quietly");
  await p.click("#backBtn"); await p.waitForSelector("#dial");
  ok(!/quokkaphase/.test(await p.textContent("#follow .fcards").catch(() => "")), "a closed-out marker leaves the home page's cards");
  await p.waitForTimeout(600);
  if (await p.$("#mapOpen")) {
    await p.click("#mapOpen"); await p.waitForSelector("#mapView .mdone button");
    ok((await p.$$("#skyBig .star.closed")).length === 1 && /quokkaphase/.test(await p.textContent(".mdone")), "it is kept in the learning map as a milestone");
    await p.click(".mdone button"); await p.waitForSelector(".mws #mReopen");
    await p.click("#mReopen");
    await p.waitForFunction(() => !document.querySelector("#editor .pin.closed"));
    ok(!(await p.$(".closedout")) && !!(await p.$("#mFinish")), "a closed-out marker can be reopened from the map");
    await p.keyboard.press("Escape");
  }

  // cram without AI: extra questions are built on the device from the notes, and no request leaves for the model
  {
    const c2 = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    const q = await c2.newPage();
    q.on("pageerror", e => errs.push("pageerror: " + e.message));
    let posts = 0;
    await q.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await q.route("**/api/marker", r => { if (r.request().method() === "GET") return r.fulfill({ json: { ai: false } }); posts++; return r.fulfill({ status: 501, json: { error: "off" } }); });
    await q.goto(BASE); await q.waitForSelector(".hbtn[data-act='blank']"); await q.waitForTimeout(2300);
    await q.click(".hbtn[data-act='blank']"); await q.waitForSelector("#editor .ProseMirror");
    await q.fill("#ptitle", "Membranes");
    await q.click("#editor .ProseMirror");
    await q.keyboard.type("Osmosis moves water across a membrane toward the side with more dissolved solute. Diffusion spreads molecules from crowded regions into emptier regions without any energy. Active transport pushes molecules against their gradient and therefore spends energy from ATP. Aquaporins are channel proteins that let water cross the membrane quickly.");
    await q.waitForTimeout(900);
    await q.click("#settingsBtn"); await q.waitForSelector(".crow .exam input");
    const soon = new Date(Date.now() + 4 * 864e5), ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    await q.fill(".crow .exam input", ymd); await q.dispatchEvent(".crow .exam input", "change");
    await q.keyboard.press("Escape");
    await q.click("#backBtn"); await q.waitForSelector(".examchip");
    await q.click(".examchip"); await q.click(".exampop:not([hidden]) [data-cram]");
    await q.waitForSelector("#cram #crGen"); await q.waitForTimeout(300);
    await q.click("#crGen"); await q.waitForSelector(".crgq");
    const made = await q.$$eval(".crgqt", els => els.map(e => e.textContent));
    ok(made.length >= 2 && made.every(t => t.includes("_____")) && posts === 0, `with AI off, cram builds fill-in-the-blank questions from the notes on the device (${made.length}, ${posts} model requests)`);
    await q.click("#crStart"); await q.waitForSelector(".crcard");
    ok(!(await q.$("#crCheck")), "and never offers an AI check there");
    await q.keyboard.press("Escape"); await q.waitForTimeout(200); await q.keyboard.press("Escape");
    await q.waitForSelector("#cram", { state: "detached" });
    await c2.close();
  }

  // touch screens (iPad): hover styles are off, and what a mouse gets by resting has another way in
  {
    const { devices } = require("playwright");
    const c3 = await b.newContext({ ...devices["iPad Pro 11 landscape"], serviceWorkers: "block" });
    const t = await c3.newPage();
    t.on("pageerror", e => errs.push("pageerror: " + e.message));
    await t.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await t.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
    await t.goto(BASE); await t.waitForSelector(".fcard"); await t.waitForTimeout(2400);
    const look = await t.evaluate(() => {
      const hoverRules = [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } }).filter(r => r.selectorText && r.selectorText.includes(":hover")).length;
      return { hoverRules, touchHint: getComputedStyle(document.querySelector(".spinhint .tch")).display, mouseHint: getComputedStyle(document.querySelector(".spinhint .hov")).display };
    });
    ok(look.hoverRules === 0, `no :hover style sits outside a hover media query, so taps can't leave things stuck (${look.hoverRules} found)`);
    ok(look.touchHint !== "none" && look.mouseHint === "none", "the dial's hint is worded for touch");
    const cdp = await c3.newCDPSession(t);
    await t.evaluate(() => document.querySelector(".fcard").scrollIntoView({ block: "center" })); await t.waitForTimeout(300);
    const fb = await (await t.$(".fcard")).boundingBox(), pt = { x: Math.round(fb.x + fb.width / 2), y: Math.round(fb.y + fb.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
    await t.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await t.waitForTimeout(400);
    ok(!!(await t.$("#fpeek")) && !!(await t.$("#dial")), "press and hold on a marker card shows its peek without opening it");
    await t.touchscreen.tap(40, 300); await t.waitForTimeout(400);
    ok(!(await t.$("#fpeek")), "tapping elsewhere puts the peek away");
    await t.touchscreen.tap(pt.x, pt.y);
    await t.waitForSelector(".mws", { timeout: 6000 }).then(() => ok(true, "a plain tap still opens the marker"), () => ok(false, "a plain tap still opens the marker"));
    ok(await t.evaluate(() => [...document.querySelectorAll("kbd")].every(k => getComputedStyle(k).display === "none")), "keyboard hints are hidden on touch");
    await c3.close();
  }

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL REGRESSIONS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

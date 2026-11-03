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
    : r.fulfill({ json: { kind: "insert", type: "explain", markdown: "Inserted explanation for testing.", recall: { q: "Mock question?", a: "Mock answer." } } }));
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

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL REGRESSIONS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

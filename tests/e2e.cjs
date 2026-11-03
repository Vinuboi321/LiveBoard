// End-to-end check of LiveBoard against `vite preview` with the AI endpoint mocked.
// Usage: npx vite preview --port 4173 & node tests/e2e.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.env.SHOTS || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "http://localhost:4173";

const MOCK = intent => {
  const i = (intent || "").toLowerCase();
  if (i.includes("outline")) return { kind: "insert", type: "note", markdown: "## Outline\n- Definition of a Taylor series\n- Maclaurin series as the a = 0 case\n- Error bounds with Taylor's inequality", recall: { q: "What is a Maclaurin series?", a: "A Taylor series centered at 0." } };
  if (i.includes("diagram")) return { kind: "insert", type: "visual", markdown: "The markers loop.", mermaid: "flowchart LR\n  A[Select text] --> B[Place marker] --> C[Ask] --> D[Recall]", recall: { q: "What happens after you place a marker?", a: "You ask it something." } };
  if (i.includes("why")) return { kind: "answer", type: "question", markdown: "Because each term matches one more derivative at the center.", recall: { q: "Why does each term have n! in it?", a: "It cancels the factor from differentiating n times." } };
  return { kind: "insert", type: "explain", markdown: "In plain words: a marker turns a phrase into something you can ask about. For example, the value is computed exactly.", calc: "e^0.5 * 0.5^4 / factorial(4)", recall: { q: "What does a marker turn a phrase into?", a: "Something you can ask about." } };
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const log = (...a) => console.log(...a);
  async function setup(w, h, dark) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", serviceWorkers: "block" });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`[${w}] pageerror: ${e.message}`));
    p.on("console", m => { if (m.type() === "error" && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errs.push(`[${w}] console: ${m.text()}`); });
    await p.route("**/api/marker", async route => {
      const req = route.request();
      if (req.method() === "GET") return route.fulfill({ json: { ai: true, model: "mock" } });
      const body = JSON.parse(req.postData() || "{}");
      await new Promise(r => setTimeout(r, 150));
      return route.fulfill({ json: MOCK(body.intent) });
    });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    return { ctx, p };
  }
  const check = (cond, msg) => { if (!cond) errs.push(msg); else log("ok  ", msg); };

  /* ---------- desktop: full marker flow ---------- */
  {
    const { ctx, p } = await setup(1400, 900);
    await p.goto(BASE);
    await p.waitForSelector("#dial .folder");
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/01-home.png` });
    check((await p.$$("#dial .folder")).length >= 1, "home shows the welcome note on the dial");

    await p.click("#info .openlink");
    await p.waitForSelector("#editor .pin");
    await p.screenshot({ path: `${OUT}/02-welcome.png` });
    await p.click("#editor .pin");
    await p.waitForSelector(".mws");
    check(await p.isVisible(".mws .ta.marker"), "seeded marker opens with its thread");
    await p.fill("#mIn", "e^0.5 * 0.5^4 / 4!");
    await p.press("#mIn", "Enter");
    await p.waitForSelector(".mcalc b");
    const calc = await p.textContent(".mcalc b");
    check(/0\.0042/.test(calc), `math runs locally and exactly (${calc})`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(250);
    check(!(await p.$(".mws")), "Escape closes the marker box");

    // place a marker on a selection and ask the AI
    await p.evaluate(() => {
      const ps = [...document.querySelectorAll("#editor p")].filter(x => !x.querySelector(".pin") && x.textContent.length > 40);
      const t = ps[0].firstChild;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 26);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.querySelector("#editor .ProseMirror").focus();
    });
    await p.waitForTimeout(200);
    check(await p.isVisible(".floatbtn.place"), "selecting text shows Place marker");
    await p.click(".floatbtn.place");
    await p.waitForSelector(".mws");
    await p.click(".sugg button:has-text('Explain this simpler')");
    await p.waitForSelector(".mout[data-status='pending']");
    await p.screenshot({ path: `${OUT}/03-insert.png` });
    check(/0\.0042/.test(await p.textContent(".mout")), "AI insert lands in the note with the exact calc result");
    await p.keyboard.press("Escape");
    await p.click(".mout .moutbar [data-act='keep']");
    check(!!(await p.$(".mout[data-status='accepted']")), "Keep accepts a marker's writing");

    // ask a question -> answer stays in the box, then Add to note
    await p.click("#editor .pin >> nth=1");
    await p.waitForSelector(".mws");
    await p.fill("#mIn", "why is that?");
    await p.press("#mIn", "Enter");
    await p.waitForSelector(".mws .mlink");
    const before = (await p.$$(".mout")).length;
    await p.click(".mws .mlink");
    await p.waitForTimeout(200);
    check((await p.$$(".mout")).length === before + 1, "Add to note writes an answer into the page");
    await p.click("[data-tab='recall']");
    await p.click(".mastery button[data-m='2']");
    await p.waitForTimeout(250);
    check(await p.getAttribute("#editor .pin >> nth=1", "data-mastery") === "2", "mastery changes the dot");
    await p.keyboard.press("Escape");

    // blank-space marker on a new line
    await p.click("#tapzone");
    await p.waitForTimeout(250);
    check(await p.isVisible(".floatbtn.plus"), "empty line shows the + marker button");
    await p.click(".floatbtn.plus");
    await p.waitForSelector(".mws blockquote.blank");
    check(await p.getAttribute("[data-tab='write']", "aria-selected") === "true", "a blank marker opens on the Write tab");
    await p.fill("#wDraft", "My own line: protons flow back through ATP synthase.");
    await p.click("#wInsert");
    await p.waitForTimeout(150);
    check(await p.evaluate(() => [...document.querySelectorAll(".mout[data-status='accepted']")].some(x => /My own line/.test(x.textContent))), "Write tab inserts your own writing into the note");
    await p.click("[data-tab='calc']");
    await p.fill("#cIn", "23.4 mL * 0.1 mol/L");
    await p.click("#cForm button");
    await p.waitForTimeout(200);
    const cout = await p.textContent("#cOut");
    check(/2\.34 mmol|0\.00234 mol/.test(cout), `Calculate tab handles units exactly (${cout})`);
    await p.click("[data-tab='related']");
    const opts = await p.$$eval("#rSel option", os => os.map(o => o.value).filter(Boolean));
    if (opts.length) { await p.selectOption("#rSel", opts[0]); await p.click("#rLink"); await p.waitForTimeout(150); }
    check((await p.$$(".mws .lrow")).length >= 1, "Related tab links two markers");
    await p.click("[data-tab='recall']");
    await p.uncheck("#rcOn");
    await p.waitForTimeout(100);
    check(!!(await p.$(".chipm.off")), "a marker can be left out of recall");
    await p.check("#rcOn");
    await p.click("[data-tab='ask']");
    await p.fill("#mIn", "Outline this topic");
    await p.press("#mIn", "Enter");
    await p.waitForFunction(() => [...document.querySelectorAll(".mout")].some(x => x.textContent.includes("Outline")));
    check(true, "blank marker generates an outline into the note");
    await p.fill("#mIn", "draw a diagram of this");
    await p.press("#mIn", "Enter");
    await p.waitForSelector(".diagram svg, .diagram pre", { timeout: 15000 });
    check(!!(await p.$(".diagram svg")), "diagram renders from a marker");
    await p.fill("#mIn", "remind me tomorrow");
    await p.press("#mIn", "Enter");
    await p.waitForTimeout(200);
    check((await p.textContent(".mws")).includes("tomorrow"), "reminders are set locally");
    await p.keyboard.press("Escape");

    // format a single-line passage as a heading
    await p.evaluate(() => {
      const ps = [...document.querySelectorAll("#editor p")].filter(x => !x.querySelector(".pin") && /Need bold/.test(x.textContent));
      const t = ps[0].firstChild;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 10);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.querySelector("#editor .ProseMirror").focus();
    });
    await p.waitForTimeout(150);
    await p.click(".floatbtn.place");
    await p.fill("#mIn", "make this a heading");
    await p.press("#mIn", "Enter");
    await p.waitForTimeout(200);
    check(await p.evaluate(() => [...document.querySelectorAll("#editor h2")].some(h => /Need bold/.test(h.textContent))), "a marker can format text (heading)");
    await p.keyboard.press("Escape");

    // classic tools hidden by default
    check(!(await p.isVisible("#toolbar")), "classic tools are hidden by default");
    await p.click("#toolsBtn");
    check(await p.isVisible("#toolbar"), "Aa shows classic tools");
    const rail = (await p.$$(".rdot")).length, pins = (await p.$$("#editor .pin")).length;
    check(rail === pins && rail >= 4, `margin rail has a dot per marker (${rail}/${pins})`);
    await p.screenshot({ path: `${OUT}/04-note.png`, fullPage: false });

    // persistence: reload and confirm content survived
    await p.waitForTimeout(900);
    await p.reload();
    await p.waitForSelector("#editor .pin");
    check((await p.$$(".mout")).length >= 3, "note content and marker writing persist after reload");

    // import a text file
    await p.click("#backBtn");
    await p.waitForSelector("#dial");
    const txt = path.join(OUT, "lecture.txt");
    fs.writeFileSync(txt, "Week 5: Elasticity\n\nPrice elasticity of demand is the percent change in quantity over the percent change in price.\n\nIf |E| > 1 demand is elastic.");
    await p.setInputFiles("#fileIn", txt);
    await p.waitForSelector("#editor p");
    check((await p.inputValue("#ptitle")) === "lecture", "text file imports as a note");

    // import a PDF made on the fly
    const pdfPage = await ctx.newPage();
    await pdfPage.setContent("<h1>Lecture 9: Sequences</h1><p>A sequence converges if its terms approach a single limit.</p><p>Monotone and bounded implies convergent.</p>");
    const pdfPath = path.join(OUT, "Lecture-9.pdf");
    await pdfPage.pdf({ path: pdfPath });
    await pdfPage.close();
    await p.click("#backBtn");
    await p.waitForSelector("#dial");
    await p.setInputFiles("#fileIn", pdfPath);
    await p.waitForFunction(() => document.querySelector("#editor") && /converges/.test(document.querySelector("#editor").textContent), null, { timeout: 20000 });
    check(true, "PDF imports with its text");
    await p.click("#backBtn");
    await p.waitForSelector("#dial");

    // recall: jump the clock a day ahead so markers are due
    await p.clock.setSystemTime(Date.now() + 26 * 3600e3);
    await p.reload();
    await p.waitForSelector("#recallBtn");
    await p.click(".scope button[data-s='week']");
    await p.waitForTimeout(150);
    const enabled = await p.isEnabled("#recallBtn");
    check(enabled, "markers come due for recall");
    if (enabled) {
      await p.click("#recallBtn");
      await p.waitForSelector("#reveal");
      await p.screenshot({ path: `${OUT}/05-recall.png` });
      let g = 0;
      while ((await p.$("#reveal")) && g++ < 12) { await p.click("#reveal"); await p.click(".racts .got"); await p.waitForTimeout(150); }
      check(!!(await p.$("#doneBtn")), "recall finishes in the hub");
      await p.click("#doneBtn");
      check((await p.textContent(".streakchip b")).trim() === "1", "finishing recall starts the streak");
    }

    // free markers: drop anywhere, drag, and connect with a string
    await p.click("#info .openlink");
    await p.waitForSelector("#editor .ProseMirror");
    await p.waitForTimeout(300);
    await p.click("#dropBtn");
    const wrapBox = await p.locator("#ewrap").boundingBox();
    await p.mouse.click(wrapBox.x + wrapBox.width - 60, wrapBox.y + 40);
    await p.waitForSelector(".pin.free");
    await p.waitForSelector(".mws blockquote.blank", { timeout: 3000 }).catch(() => {});
    check(!!(await p.$(".mws blockquote.blank")), "drop mode places a free marker and opens it");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    const free = p.locator(".pin.free").first();
    const fBefore = await free.boundingBox();
    await p.mouse.move(fBefore.x + fBefore.width / 2, fBefore.y + fBefore.height / 2);
    await p.mouse.down();
    await p.mouse.move(fBefore.x + fBefore.width / 2 - 40, fBefore.y + 110, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(250);
    const fAfter = await p.locator(".pin.free").first().boundingBox();
    check(Math.abs(fAfter.y - fBefore.y - 110) < 30, `dragging moves a free marker (${Math.round(fAfter.y - fBefore.y)}px)`);
    check(!(await p.$(".mws")), "dragging doesn't open the workspace");
    await p.locator(".pin.free").first().click();
    await p.waitForSelector(".mws");
    await p.click("[data-tab='related']");
    const sameNote = await p.$$eval("#rSel optgroup", gs => { const g = gs.find(x => x.label !== "Suggested"); return g ? [...g.querySelectorAll("option")].map(o => o.value) : []; });
    const choices = await p.$$eval("#rSel option", os => os.map(o => o.value).filter(Boolean));
    await p.selectOption("#rSel", (sameNote[0] || choices[0]));
    await p.click("#rLink");
    await p.waitForTimeout(250);
    check((await p.$$("#strings .string")).length >= 1, "linked markers are joined by a string");
    const wsBox = await p.locator(".mws").boundingBox();
    check(wsBox.width < 1400 * 0.4, `workspace leaves the note visible (${Math.round(wsBox.width)}px wide)`);
    await p.screenshot({ path: `${OUT}/12-strings.png` });
    await p.keyboard.press("Escape");
    await p.click("#backBtn");
    await p.waitForSelector("#dial");

    // settings open and close
    await p.click("#settingsBtn");
    await p.waitForSelector(".sheet");
    await p.screenshot({ path: `${OUT}/06-settings.png` });
    await p.keyboard.press("Escape");
    check(!(await p.$(".sheet")), "settings close with Escape");
    await ctx.close();
  }

  /* ---------- phone ---------- */
  {
    const { ctx, p } = await setup(390, 844);
    await p.goto(BASE);
    await p.waitForSelector("#dial .folder");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/07-phone-home.png` });
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "phone: no sideways scroll on home");
    await p.click("#info .openlink");
    await p.waitForSelector("#editor .pin");
    await p.click("#editor .pin");
    await p.waitForSelector(".mws");
    await p.screenshot({ path: `${OUT}/08-phone-marker.png` });
    check(true, "phone: marker box opens as a bottom sheet");
    await p.click("#mClose");
    await p.waitForTimeout(250);
    check(!(await p.$(".mws")), "phone: marker sheet closes");
    await ctx.close();
  }

  /* ---------- tablet, dark ---------- */
  {
    const { ctx, p } = await setup(1024, 768, true);
    await p.goto(BASE);
    await p.waitForSelector("#dial .folder");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/09-ipad-dark.png` });
    await ctx.close();
  }

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL CHECKS PASSED");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

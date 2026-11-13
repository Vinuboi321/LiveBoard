/* A walk through the classroom app (marker-slides) in a real browser: the presentations home, the slides viewer, a live
   class with a student, what the teacher's deck remembers afterwards, and the student's take-home file.

   It needs the classroom app running with its database migrated (see marker-slides/README.md), then:
     SLIDES_URL=http://127.0.0.1:5173 node tests/slides-ui.cjs
   It is not part of `npm test`, because the classroom app has its own runtime and install. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const BASE = process.env.SLIDES_URL || "http://127.0.0.1:5173";
const OUT = process.env.SLIDES_SHOTS || "";
const errs = [];
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) errs.push(msg); };
(async () => {
  const b = await chromium.launch();
  const tctx = await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
  const t = await tctx.newPage();
  t.on("pageerror", e => errs.push("pageerror: " + e.message));
  const shot = async (p, name) => { if (OUT) await p.screenshot({ path: `${OUT}/${name}.png` }); };

  // --- the presentations home ---
  await t.goto(BASE + "/?view=library&theme=dark"); await t.waitForSelector(".deck-grid li");
  ok((await t.$$(".deck-grid li")).length === 3, "a new browser starts with three example decks, one per subject");
  ok(!(await t.$(".classroom-home")), "the home page has no button that only leads back to itself");
  ok(await t.$eval(".slide-thumb .slide-content h2", e => e.textContent.length > 0), "deck covers show the first slide, not an empty box");
  await t.fill(".library-search input", "calculus");
  ok((await t.$$(".deck-grid li")).length === 1, "search narrows by class as well as title");
  await t.fill(".library-search input", "");

  // --- the slides viewer: every slide, scrolled slowly ---
  await t.click(".deck-cover"); await t.waitForSelector(".viewer-scroll article");
  ok((await t.$$(".viewer-scroll article")).length === 3, "opening a cover shows every slide of the deck");
  await t.mouse.move(720, 480); await t.mouse.wheel(0, 600); await t.waitForTimeout(100);
  const early = await t.$eval(".viewer-scroll", e => e.scrollTop); await t.waitForTimeout(1700);
  const settled = await t.$eval(".viewer-scroll", e => e.scrollTop);
  ok(early > 0 && early < settled && settled < 400, `the wheel scrolls slowly and eases to rest (${Math.round(early)}px at once, ${Math.round(settled)}px settled, from a 600px turn)`);
  await t.keyboard.press("End"); await t.waitForTimeout(1900);
  ok((await t.textContent(".viewer-count")).trim().startsWith("3"), "keys step through the slides and the counter follows");
  ok(/slide=2/.test(await t.getAttribute(".viewer-head .primary", "href")), "the viewer opens the editor at the slide you are looking at");
  await shot(t, "viewer");
  await t.click(".viewer-head .primary"); await t.waitForSelector(".slide-rail .thumbnail.current");
  ok((await t.textContent(".thumbnail.current .slide-number")).trim() === "03", "and the editor opens on that slide");

  // --- the editor: one way home, and labels that belong to this deck ---
  ok(!(await t.$('[aria-label="Presentation library"]')) && !!(await t.$('a.brand[aria-label="All presentations"]')), "the editor has one way back to the presentations (the wordmark), not a second button");
  const rail = await t.textContent(".slide-rail h3"), crumb = await t.textContent(".lesson-heading .eyebrow");
  ok(/mass spectrum/i.test(rail) && /AP CHEMISTRY/.test(crumb) && !/equilibrium/i.test(rail), "the rail and breadcrumb name this deck and its class, not the chemistry sample");
  ok(!(await t.$("text=Find images")), "replies have no web image search");

  // --- a live class ---
  await t.click("text=Start live lesson"); await t.waitForSelector(".room-code");
  const code = (await t.textContent(".room-code")).trim();
  ok(/^[A-Z0-9]{8}$/.test(code), "starting a live lesson gives a room code");
  await t.click(".modal-close");
  const sctx = await b.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  const s = await sctx.newPage();
  s.on("pageerror", e => errs.push("student pageerror: " + e.message));
  await s.goto(BASE + "/?view=student&theme=dark"); await s.waitForSelector(".join-card");
  ok(!(await s.$(".drawing-space")), "the join page is a name and a code, with no sketch pad");
  await s.fill('.join-card input[placeholder*="nickname"]', "Maya"); await s.fill('.join-card input[placeholder*="code"]', code);
  await s.click(".join-card .primary"); await s.waitForSelector(".slide-canvas");
  await s.click(".place-button");
  const box = await (await s.$(".slide-canvas")).boundingBox();
  await s.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await s.waitForSelector(".composer textarea"); await s.fill(".composer textarea", "Why are there two peaks?");
  await s.click(".composer .primary"); await s.waitForSelector(".pin.free");
  ok(true, "a student joins by code and drops a marker on the slide");
  await t.waitForSelector(".marker-card", { timeout: 9000 });
  ok(/two peaks/.test(await t.textContent(".marker-list")), "the teacher sees the student's marker in the queue");
  ok((await t.textContent(".thumbnail.current .thumb-count").catch(() => "")).trim() === "1", "the slide rail counts the open markers on each slide");
  await t.click(".marker-card"); await t.fill("#reply", "One peak per isotope."); await t.click("text=Send response");
  await s.waitForSelector("text=Keep my questions", { timeout: 9000 });
  await s.click(".pin.free"); await s.waitForSelector(".teacher-reply", { timeout: 9000 });
  const [dl] = await Promise.all([s.waitForEvent("download"), s.click("text=Keep my questions")]);
  const md = fs.readFileSync(await dl.path(), "utf8");
  ok(/Why are there two peaks\?/.test(md) && /Teacher: One peak per isotope\./.test(md) && dl.suggestedFilename().endsWith(".md"), "a student can take their questions and the answers home as a file LiveBoard imports");
  await shot(t, "live");

  // --- after class ---
  await t.waitForTimeout(600);
  await t.click("text=End class"); await t.waitForSelector(".deck-session");
  ok(/1\s*question from class/.test(await t.textContent(".deck-session")), "ending class returns to the presentations, where the deck remembers what was asked");
  await t.click(".deck-session"); await t.waitForSelector(".class-review");
  const review = await t.textContent(".class-review");
  ok(/two peaks/.test(review) && /Maya/.test(review) && /One peak per isotope/.test(review), "Review class lists each question with who asked and what was answered");
  await shot(t, "review");
  const [qf] = await Promise.all([t.waitForEvent("download"), t.click("text=Save the questions")]);
  ok(/two peaks/.test(fs.readFileSync(await qf.path(), "utf8")), "and saves them as a file for planning");
  await t.keyboard.press("Escape");
  await shot(t, "library-after");

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL CLASSROOM UI CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

const assert = require("node:assert/strict");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const built = buildSync({ entryPoints: ["src/teacher/model.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = new Module("teacher-model", module); m.paths = module.paths; m._compile(built.outputFiles[0].text, "teacher-model.cjs");
const { mediaURL, packWorksheet, unpackWorksheet } = m.exports;
(async () => {
  const h = { id: "marker-1", page: 2, x: .3, y: .7, title: "Explore", context: "Fractions", prompt: "Compare", hints: ["Same whole", "Same units"], explanation: "Think about size", media: "https://example.com/image.png", mediaKind: "image", allowAI: false };
  const w = { id: "lesson-1", title: "Lesson", instructions: "Try each marker", source: new Blob(["original document bytes"]), sourceKind: "text", filename: "lesson.txt", hubs: [h], updatedAt: 1 };
  h.anchor = { kind: 'text', text: 'Fractions', rects: [{ x: .1, y: .2, width: .4, height: .03 }] };
  const raw = await packWorksheet(w), restored = unpackWorksheet(raw);
  assert.equal(await restored.source.text(), "original document bytes");
  assert.equal(restored.hubs[0].x, .3); assert.deepEqual(restored.hubs[0].hints, h.hints);
  assert.deepEqual(restored.hubs[0].anchor, h.anchor);
  assert.notEqual(restored.id, w.id); assert.notEqual(restored.hubs[0].id, h.id);
  for (const url of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://user:secret@example.com"]) assert.equal(mediaURL(url), null);
  const valid = JSON.parse(raw);
  for (const change of [h => h.x = 2, h => h.y = null, h => h.page = -1, h => h.page = 1.2, h => h.allowAI = "yes", h => h.hints = "bad", h => h.prompt = "x".repeat(10001)]) {
    const v = structuredClone(valid); change(v.hubs[0]); assert.throws(() => unpackWorksheet(JSON.stringify(v)));
  }
  const injected = structuredClone(valid); injected.responses = [{ answer: "private" }]; injected.hubs[0].privateAnswer = "hidden";
  const clean = unpackWorksheet(JSON.stringify(injected)); assert(!("responses" in clean)); assert(!("privateAnswer" in clean.hubs[0]));
  for (const change of [a => a.kind = 'bad', a => a.rects[0].width = 2, a => a.rects[0].x = -1, a => a.rects = [], a => a.rects[0].height = 0, a => a.text = 'x'.repeat(5001)]) {
    const v = structuredClone(valid); change(v.hubs[0].anchor); assert.throws(() => unpackWorksheet(JSON.stringify(v)));
  }
  assert.throws(() => unpackWorksheet('{"format":"wrong"}'));
  console.log("PASS: portable worksheet round-trip, source bytes, independent response identities, strict marker validation, safe URLs, unknown-field stripping.");
})().catch(e => { console.error(e); process.exit(1); });

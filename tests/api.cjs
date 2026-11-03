// Checks that /api/marker fails closed: no verified sign-in, no working quota check, or a malformed request means no model call.
// Usage: node tests/api.cjs   (no server needed; the handler runs here with a fake fetch)
const path = require("path");
const { buildSync } = require("esbuild");

const out = buildSync({ entryPoints: [path.join(__dirname, "../api/marker.ts")], bundle: true, platform: "node", format: "cjs", write: false, target: "node20" });
const load = () => { const m = { exports: {} }; new Function("module", "exports", "require", "process", out.outputFiles[0].text)(m, m.exports, require, process); return m.exports.default; };
const handler = load();

const BASE_ENV = { ANTHROPIC_API_KEY: "sk-test", SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", VERCEL_ENV: "production" };
const GOOD_BODY = { intent: "explain this", passage: "Glycolysis splits glucose.", before: "", after: "", note: "Glycolysis splits glucose.", title: "Bio", course: "BIO", thread: [] };
const MODEL_OK = { content: [{ type: "tool_use", name: "marker_result", input: { kind: "answer", type: "explain", markdown: "It breaks glucose into two pyruvate.", recall: { q: "What does glycolysis make?", a: "Two pyruvate." } } }] };

async function call({ env = {}, method = "POST", body = GOOD_BODY, headers = { authorization: "Bearer good" }, auth = "ok", quota = { allowed: true, used: 1 }, model = "ok" } = {}) {
  const saved = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "VERCEL_ENV", "AI_DISABLED", "ALLOW_ANONYMOUS_AI"]) delete process.env[k];
  Object.assign(process.env, BASE_ENV, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  let modelCalls = 0;
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith("/auth/v1/user")) {
      if (auth === "down") throw new TypeError("fetch failed");
      if (auth === "bad") return new Response(JSON.stringify({ msg: "invalid" }), { status: 401 });
      if (auth === "500") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    }
    if (url.includes("/rpc/begin_ai_request")) {
      if (quota === "down") throw new TypeError("fetch failed");
      if (quota === "500") return new Response(JSON.stringify({ message: "function missing" }), { status: 404 });
      return new Response(typeof quota === "string" ? quota : JSON.stringify(quota), { status: 200 });
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      modelCalls++;
      if (model === "timeout") { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }
      if (model === "500") return new Response("{}", { status: 500 });
      if (model === "notool") return new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 });
      return new Response(JSON.stringify(MODEL_OK), { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  };
  let status = 0, json = null;
  const res = { status(c) { status = c; return res; }, json(b) { json = b; return res; }, setHeader() {} };
  const origLog = console.log, origErr = console.error;
  console.log = () => {}; console.error = () => {};
  try { await handler({ method, headers, body }, res); }
  finally { console.log = origLog; console.error = origErr; global.fetch = realFetch; process.env = saved; }
  return { status, json, modelCalls };
}

(async () => {
  const errs = [];
  const expect = async (name, opts, status, calls) => {
    const r = await call(opts);
    if (r.status === status && r.modelCalls === calls) console.log("ok  ", name, `(${status})`);
    else errs.push(`${name}: got ${r.status} with ${r.modelCalls} model call(s), wanted ${status} with ${calls}. ${JSON.stringify(r.json)}`);
  };
  await expect("signed-in request with quota left reaches the model once", {}, 200, 1);
  await expect("missing sign-in configuration refuses", { env: { SUPABASE_URL: undefined } }, 503, 0);
  await expect("missing anon key refuses", { env: { SUPABASE_ANON_KEY: undefined } }, 503, 0);
  await expect("no token refuses", { headers: {} }, 401, 0);
  await expect("invalid token refuses", { auth: "bad" }, 401, 0);
  await expect("sign-in service down refuses", { auth: "down" }, 503, 0);
  await expect("sign-in service error refuses", { auth: "500" }, 503, 0);
  await expect("quota check down refuses", { quota: "down" }, 503, 0);
  await expect("quota function missing refuses", { quota: "500" }, 503, 0);
  await expect("malformed quota answer refuses", { quota: "{}" }, 503, 0);
  await expect("non-JSON quota answer refuses", { quota: "<html>" }, 503, 0);
  await expect("daily limit refuses", { quota: { allowed: false, reason: "daily" } }, 429, 0);
  await expect("per-minute limit refuses", { quota: { allowed: false, reason: "minute" } }, 429, 0);
  await expect("app-wide daily cap refuses", { quota: { allowed: false, reason: "global" } }, 429, 0);
  await expect("kill switch refuses", { env: { AI_DISABLED: "true" } }, 503, 0);
  await expect("no API key refuses", { env: { ANTHROPIC_API_KEY: undefined } }, 501, 0);
  await expect("anonymous dev flag is ignored in production", { env: { ALLOW_ANONYMOUS_AI: "true" }, headers: {} }, 401, 0);
  await expect("anonymous dev flag is ignored on preview deploys", { env: { ALLOW_ANONYMOUS_AI: "true", VERCEL_ENV: "preview" }, headers: {} }, 401, 0);
  await expect("anonymous dev flag is ignored off Vercel", { env: { ALLOW_ANONYMOUS_AI: "true", VERCEL_ENV: undefined }, headers: {} }, 401, 0);
  await expect("anonymous dev flag works outside production", { env: { ALLOW_ANONYMOUS_AI: "true", VERCEL_ENV: "development" }, headers: {} }, 200, 1);
  await expect("a raw JSON buffer is accepted", { body: Buffer.from(JSON.stringify(GOOD_BODY)) }, 200, 1);
  await expect("malformed JSON is a 400", { body: "{not json" }, 400, 0);
  await expect("non-object body is a 400", { body: "[1,2]" }, 400, 0);
  await expect("oversized body is a 413", { body: JSON.stringify({ ...GOOD_BODY, note: "x".repeat(70000) }) }, 413, 0);
  await expect("bad thread item is a 400", { body: { ...GOOD_BODY, thread: [null] } }, 400, 0);
  await expect("empty intent is a 400", { body: { ...GOOD_BODY, intent: "  " } }, 400, 0);
  await expect("wrong field type is a 400", { body: { ...GOOD_BODY, passage: { x: 1 } } }, 400, 0);
  await expect("model timeout is a 504", { model: "timeout" }, 504, 1);
  await expect("model error is a 502", { model: "500" }, 502, 1);
  await expect("unusable model reply is a 502", { model: "notool" }, 502, 1);
  await expect("other methods are refused", { method: "DELETE" }, 405, 0);
  const health = await call({ method: "GET", env: { SUPABASE_URL: undefined } });
  if (health.status === 200 && health.json.ai === false) console.log("ok   health check reports AI off when sign-in checks are missing");
  else errs.push("health check should report ai:false without Supabase config: " + JSON.stringify(health.json));
  const good = await call({});
  const shape = good.json && typeof good.json.markdown === "string" && ["insert", "answer"].includes(good.json.kind) && good.json.recall?.q;
  if (shape) console.log("ok   successful replies are validated and shaped"); else errs.push("reply shape: " + JSON.stringify(good.json));
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL API CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})();

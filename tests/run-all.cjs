// Builds the app (plus a sync-test build), serves both, and runs every check. Exit code is non-zero if anything fails.
// Usage: npm test            (set SKIP_BUILD=1 to reuse existing builds; SQL checks run when psql/createdb are available)
const { spawn, spawnSync } = require("child_process");
const run = (cmd, args, env = {}) => { const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" }); return r.status === 0; };
const wait = async url => { for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); } throw new Error("server didn't start: " + url); };

(async () => {
  if (!process.env.SKIP_BUILD) {
    if (!run("npm", ["run", "build"])) process.exit(1);
    if (!run("npm", ["run", "build:synctest"])) process.exit(1);
  }
  const servers = [
    spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" }),
    spawn("npx", ["vite", "preview", "--outDir", "dist-synctest", "--port", "4174", "--strictPort"], { stdio: "ignore" })
  ];
  const stop = () => servers.forEach(s => s.kill());
  process.on("exit", stop);
  await wait("http://localhost:4173");
  await wait("http://localhost:4174");
  const suites = ["tests/api.cjs", "tests/e2e.cjs", "tests/regressions.cjs", "tests/safety.cjs", "tests/sync.cjs"];
  const failed = suites.filter(s => { console.log(`\n=== ${s} ===`); return !run("node", [s]); });
  if (spawnSync("createdb", ["--version"]).status === 0) { console.log("\n=== tests/sql/run.sh ==="); if (!run("bash", ["tests/sql/run.sh"])) failed.push("tests/sql/run.sh"); }
  else console.log("\n(skipping SQL checks: no local Postgres)");
  stop();
  console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : "\nEVERYTHING PASSES");
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

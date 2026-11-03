// Folds the single-file build (dist-artifact/) into one HTML page that can be published as a claude.ai artifact.
// Usage: ARTIFACT=1 npx vite build && node scripts-artifact.mjs <out.html>
import fs from "node:fs";
import path from "node:path";

const dir = "dist-artifact";
const read = p => fs.readFileSync(path.join(dir, p.replace(/^\//, "")), "utf8");
let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

// Pull the bundle tags out first, so nothing inside the bundle can confuse the parsing below.
const css = [], js = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>\s*/g, (_, h) => { css.push(read(h)); return ""; });
html = html.replace(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"[^>]*><\/script>\s*/g, (_, s) => { js.push(read(s)); return ""; });

// The artifact host supplies the document shell (doctype, charset, viewport); keep only what goes inside it.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, "")
  .replace(/<meta name="viewport"[^>]*>\s*/, "")
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\s*/g, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>.*?<\/title>/)[0];

const out = [
  title,
  `<meta name="claude:viewport-fit-sides" content="cover">`,
  head.replace(title, "").trim(),
  ...css.map(c => `<style>${c}</style>`),
  body.trim(),
  ...js.map(j => `<script type="module">${j.replace(/<\/script/gi, "<\\/script")}</script>`)
].join("\n");
fs.writeFileSync(process.argv[2], out);
console.log("wrote", process.argv[2], (Buffer.byteLength(out) / 1048576).toFixed(2), "MB");

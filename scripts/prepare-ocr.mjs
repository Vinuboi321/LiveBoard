import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const output = new URL('../public/ocr/', import.meta.url);
await mkdir(output, { recursive: true });
const worker = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const language = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
// Self-host matching worker, WASM, and language assets. No runtime CDN requests.
for (const [source, target] of [
  [join(worker, 'dist/worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(core, 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [join(language, '4.0.0/eng.traineddata.gz'), 'eng.traineddata.gz'],
]) await copyFile(source, new URL(target, output));

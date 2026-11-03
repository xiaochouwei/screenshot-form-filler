import { build } from 'esbuild';
import { mkdir, cp, copyFile, readdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
const entries = ['content', 'background', 'panel', 'region', 'processor', 'setup', 'inbox'];
for (const name of entries) await build({ entryPoints: [path.join(root, `src/${name}.js`)], bundle: true, outfile: path.join(dist, `${name}.js`), format: 'iife', platform: 'browser', target: 'chrome120', minify: false });
await build({entryPoints:[path.join(root,'src/ocr-sandbox.js')],bundle:true,outfile:path.join(dist,'ocr-sandbox.js'),format:'iife',platform:'browser',target:'chrome120',alias:{'onnxruntime-web':'onnxruntime-web/wasm'},external:['fs','path']});
await copyFile(path.join(root,'src/ocr-sandbox.html'),path.join(dist,'ocr-sandbox.html'));
for (const name of ['manifest.json', 'panel.html', 'panel.css', 'processor.html', 'setup.html', 'inbox.html', 'inbox.css']) await copyFile(path.join(root, 'src', name), path.join(dist, name));
const vendor = path.join(dist, 'vendor');
const expected = JSON.parse(await readFile(path.join(root, 'model-sha256.json'), 'utf8'));
const hashes = {};
await mkdir(path.join(vendor,'ort'),{recursive:true});
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) await copyFile(path.join(root,'node_modules/onnxruntime-web/dist',name),path.join(vendor,'ort',name));
await mkdir(path.join(vendor,'paddle'),{recursive:true});
for (const [name,hash] of Object.entries(expected.paddle)) {
  const file=path.join(root,'node_modules/@gutenye/ocr-models/assets',name);
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash) throw new Error(`PaddleOCR checksum mismatch: ${name}`);
  await copyFile(file,path.join(vendor,'paddle',name));
  hashes[name]=hash;
}
await rm(path.join(vendor,'paddle/ch_ppocr_mobile_v2.0_cls_infer.onnx'),{force:true});
await mkdir(path.join(vendor, 'core'), { recursive: true });
await mkdir(path.join(vendor, 'lang'), { recursive: true });
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(vendor, 'worker.min.js'));
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), path.join(vendor, 'worker.min.js.LICENSE.txt'));
for (const name of await readdir(path.join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(name)) await copyFile(path.join(root, 'node_modules/tesseract.js-core', name), path.join(vendor, 'core', name));
}
const cache = path.join(root, '.model-cache');
await mkdir(cache, { recursive: true });
for (const lang of ['eng', 'chi_sim']) {
  const quality = 'fast';
  const file = path.join(cache, `${lang}.traineddata.gz`);
  try { await stat(file); } catch {
    console.log(`Downloading build-time OCR model: ${lang}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_${quality}/main/${lang}.traineddata`, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length < 100000) throw new Error('Invalid model download');
        await writeFile(file, gzipSync(data));
        break;
      } catch (error) { if (attempt === 2) throw error; console.log(`Retrying OCR model download: ${lang}`); }
    }
  }
  const compressed = await readFile(file);
  const rawHash = createHash('sha256').update(gunzipSync(compressed)).digest('hex');
  if (rawHash !== expected[lang]) throw new Error(`OCR model checksum mismatch: ${lang}`);
  hashes[lang] = createHash('sha256').update(compressed).digest('hex');
  await copyFile(file, path.join(vendor, 'lang', `${lang}.traineddata.gz`));
}
await writeFile(path.join(dist, 'model-checksums.json'), JSON.stringify(hashes, null, 2));
const licenses = path.join(dist, 'licenses');
await mkdir(licenses, { recursive: true });
await cp(path.join(root,'licenses'),licenses,{recursive:true});
await copyFile(path.join(root,'node_modules/@techstark/opencv-js/LICENSE'),path.join(licenses,'PaddleOCR-Apache-2.0.txt'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [packagePath, metadata] of Object.entries(lock.packages)) {
  if (!packagePath || metadata.dev) continue;
  const dir = path.join(root, packagePath);
  const pkg = packagePath.replaceAll('node_modules/', '').replaceAll('/', '-');
  const license = (await readdir(dir)).find(n => /^licen[sc]e/i.test(n));
  if (license) await copyFile(path.join(dir, license), path.join(licenses, `${pkg}.txt`));
}
await writeFile(path.join(licenses, 'models.txt'), 'PP-OCRv4 detection, recognition, dictionary from @gutenye/ocr-models 1.4.2\nSource: https://github.com/PaddlePaddle/PaddleOCR\nLicense: Apache-2.0 (see PaddleOCR-Apache-2.0.txt)\n\nTesseract tessdata_fast eng and chi_sim models\nSource: https://github.com/tesseract-ocr/tessdata_fast\nLicense: Apache-2.0 (see tesseract.js-core.txt)\nModel SHA-256 checksums are listed in model-checksums.json.\n');
console.log(`Built offline extension: ${dist}`);

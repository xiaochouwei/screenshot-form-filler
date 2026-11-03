import '@gutenye/ocr-browser';
import {Detection, Recognition} from '../node_modules/@gutenye/ocr-common/build/models/index.js';
import {env} from 'onnxruntime-web';

const root = new URL('.', location.href).href;
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = `${root}vendor/ort/`;

// This page has no extension APIs. Only its parent may supply an image port.
let running = false;
addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'LOCAL_OCR' || event.ports.length !== 1 || running) return;
  running = true;
  const port = event.ports[0];
  try {
    const {width, height, pixels} = event.data;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2200000 || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) throw new Error('Invalid OCR image');
    port.postMessage({type:'progress', progress:0});
    const options = {
      models: {
        detectionPath: `${root}vendor/paddle/ch_PP-OCRv4_det_infer.onnx`,
        recognitionPath: `${root}vendor/paddle/ch_PP-OCRv4_rec_infer.onnx`,
        dictionaryPath: `${root}vendor/paddle/ppocr_keys_v1.txt`,
      },
      onnxOptions: {executionProviders:['wasm'], graphOptimizationLevel:'all'},
    };
    const detection = await Detection.create(options);
    const recognition = await Recognition.create(options);
    const detected = await detection.run({data:new Uint8ClampedArray(pixels), width, height});
    if (detected.lineImages.length > 400) throw new Error('Too many text regions');
    const words = [];
    for (let index = 0; index < detected.lineImages.length; index++) {
      // The upstream whole-page recognition merges adjacent fields into a line.
      // Recognize each detected region separately to retain its own coordinates.
      const result = await recognition.run([detected.lineImages[index]]);
      for (const line of result) {
        if (!line.text?.trim() || !Number.isFinite(line.mean) || !line.box) continue;
        const points = line.box.map(([x,y]) => [x * width / detected.resizedImageWidth, y * height / detected.resizedImageHeight]);
        words.push({text:line.text.trim(), confidence:line.mean * 100, bbox:{x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))}});
      }
      port.postMessage({type:'progress', progress:(index + 1) / detected.lineImages.length});
    }
    words.sort((a,b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    port.postMessage({type:'result', result:{words, text:words.map(word=>word.text).join('\n'), engine:'PaddleOCR v4'}});
  } catch {
    port.postMessage({type:'error'});
  } finally {
    port.close();
  }
});

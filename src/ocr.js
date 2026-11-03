import { createWorker, OEM, PSM } from 'tesseract.js';
import { detectTextBands, detectColumnSplit, detectInputBoxes } from './core.js';

// Providers return only transcription evidence. Matching never delegates to a model.
export const cloudProvider = Object.freeze({ available: false, async recognize() { throw new Error('云端识别尚未启用'); } });

const tesseractProvider = {
  available: true,
  async recognize(image, { signal, onProgress = () => {}, singleLine = false } = {}) {
    let worker;
    let finished = false;
    const url = path => chrome.runtime.getURL(path);
    const init = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
      workerPath: url('vendor/worker.min.js'), corePath: url('vendor/core'), langPath: url('vendor/lang'),
      workerBlobURL: false, cacheMethod: 'none', gzip: true,
      logger: event => { if (!finished && !signal?.aborted) onProgress(event); },
      errorHandler: () => {},
    });
    let abort;
    const aborted = new Promise((_, reject) => {
      abort = () => reject(new DOMException('已取消识别', 'AbortError'));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    const job = (async () => {
      worker = await init;
      if (finished || signal?.aborted) throw new DOMException('已取消识别', 'AbortError');
      const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height);
      const bands = detectTextBands(pixels.data, image.width, image.height);
      const segments = !singleLine && bands.length >= 2 && bands.length <= 60 ? bands : [{ top: 0, bottom: image.height - 1 }];
      await worker.setParameters({ tessedit_pageseg_mode: singleLine || segments.length > 1 ? PSM.SINGLE_LINE : PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const words = [];
      const text = [];
      for (let index = 0; index < segments.length; index++) {
        if (finished || signal?.aborted) throw new DOMException('已取消识别', 'AbortError');
        const band = segments[index];
        const columns = segments.length > 1 ? detectColumnSplit(pixels.data, image.width, image.height, band) : null;
        const parts = [];
        for (const column of columns || [{ left: 0, right: image.width - 1 }]) {
          const canvas = document.createElement('canvas');
          canvas.width = column.right - column.left + 1; canvas.height = band.bottom - band.top + 1;
          canvas.getContext('2d').drawImage(image, column.left, band.top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
          try {
            const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
            parts.push(data.text.trim());
            const recognized = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
            words.push(...recognized.map(w => ({ text: w.text, confidence: w.confidence, transcript:data.text.trim(),segment:`${index}-${column.left}`,segmentWordCount:recognized.length, bbox: { ...w.bbox, x0: w.bbox.x0 + column.left, x1: w.bbox.x1 + column.left, y0: w.bbox.y0 + band.top, y1: w.bbox.y1 + band.top } })));
          } finally { canvas.width = canvas.height = 0; }
        }
        text.push(parts.join('    '));
        onProgress({ status: 'recognizing text', progress: (index + 1) / segments.length });
      }
      return { text: text.join('\n'), words, boxes:detectInputBoxes(pixels.data,image.width,image.height) };
    })();
    try { return await Promise.race([job, aborted]); }
    finally {
      finished = true;
      signal?.removeEventListener('abort', abort);
      if (worker) await worker.terminate().catch(() => {});
      else init.then(w => w.terminate()).catch(() => {});
    }
  },
};

export const localProvider = {
  available: true,
  async recognize(image, {signal, onProgress = () => {}} = {}) {
    if (signal?.aborted) throw new DOMException('已取消识别', 'AbortError');
    const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height);
    const boxes = detectInputBoxes(pixels.data, image.width, image.height);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.src = chrome.runtime.getURL('ocr-sandbox.html');
    const channel = new MessageChannel();
    let abort;
    let timer;
    let result;
    let failure;
    try {
      result = await new Promise((resolve, reject) => {
        abort = () => reject(new DOMException('已取消识别', 'AbortError'));
        signal?.addEventListener('abort', abort, {once:true});
        timer = setTimeout(() => reject(new Error('本地 OCR 启动超时')), 90000);
        channel.port1.onmessage = ({data}) => {
          if (data?.type === 'progress') onProgress({status:'recognizing text', progress:data.progress});
          else if (data?.type === 'result' && Array.isArray(data.result?.words)) resolve({...data.result, boxes});
          else if (data?.type === 'error') reject(new Error('本地 OCR 引擎失败'));
        };
        frame.onerror = () => reject(new Error('无法加载本地 OCR'));
        frame.onload = () => frame.contentWindow.postMessage({type:'LOCAL_OCR', width:image.width, height:image.height, pixels:pixels.data.buffer}, '*', [channel.port2, pixels.data.buffer]);
        document.body.append(frame);
      });
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw error;
      failure = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      channel.port1.close(); channel.port2.close(); frame.remove();
    }
    if (failure) {
      onProgress({status:'fallback',progress:0});
      return await tesseractProvider.recognize(image,{signal,onProgress});
    }
    const captions = result.words.filter(word => /[\u3400-\u9fff]/.test(word.text) && /[a-z]/i.test(word.text) && !boxes.some(box => {
      const x=(word.bbox.x0+word.bbox.x1)/2,y=(word.bbox.y0+word.bbox.y1)/2;
      return x>box.left && x<box.right && y>box.top && y<box.bottom;
    })).slice(0,12);
    for (const word of captions) {
      if(signal?.aborted) throw new DOMException('已取消识别','AbortError');
      const b=word.bbox,left=Math.max(0,Math.floor(b.x0)-3),top=Math.max(0,Math.floor(b.y0)-3);
      const width=Math.min(image.width-left,Math.ceil(b.x1)-left+3),height=Math.min(image.height-top,Math.ceil(b.y1)-top+3);
      const crop=document.createElement('canvas');crop.width=width*3;crop.height=height*3;
      const ctx=crop.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(image,left,top,width,height,0,0,crop.width,crop.height);
      const gray=ctx.getImageData(0,0,crop.width,crop.height);
      for(let i=0;i<gray.data.length;i+=4) {
        const value=Math.max(0,Math.min(255,(gray.data[i]*.299+gray.data[i+1]*.587+gray.data[i+2]*.114-100)*1.65));
        gray.data[i]=gray.data[i+1]=gray.data[i+2]=value;
      }
      ctx.putImageData(gray,0,0);
      try {
        onProgress({status:'verifying captions',progress:1});
        const evidence=await tesseractProvider.recognize(crop,{signal,singleLine:true});
        const text=evidence.text.trim();
        // This only re-transcribes image spacing; target names are never used.
        if (text && text.replace(/\s/g,'') === word.text.replace(/\s/g,'')) word.text=text;
        else word.confidence=Math.min(word.confidence,79);
      } catch(error) {
        if(error.name==='AbortError' || signal?.aborted) throw error;
        word.confidence=Math.min(word.confidence,79);
      } finally {crop.width=crop.height=0;}
    }
    return result;
  },
};

export async function prepareImage(blob) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(blob.type)) throw new Error('请选择 PNG、JPG、WebP 或 BMP 图片');
  if (!blob.size || blob.size > 12 * 1024 * 1024) throw new Error('图片大小须在 12 MB 以内');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 16000000 || Math.max(bitmap.width, bitmap.height) > 12000) throw new Error('图片尺寸过大，请裁剪后导入');
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height), Math.sqrt(2000000 / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { canvas, width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

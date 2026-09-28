/**
 * Fuente 3a: OCR con tesseract.js (idioma spa), motor OCR principal. Carga perezosa: un PDF digital
 * nunca descarga el motor ni el modelo.
 *
 * tesseract.js levanta su propio worker; este módulo corre dentro del worker del
 * extractor (worker anidado) y reutiliza una única instancia.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';
import type { PageText, TextItem } from '../text/layout';
import type { AssetPaths } from '../types';

let workerPromise: Promise<TesseractWorker> | null = null;
let progressListener: ((p: number, status: string) => void) | null = null;

async function getWorker(assets: AssetPaths): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = `${assets.vendorBaseUrl}tesseract/`;
    return createWorker('spa', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core/`,
      langPath: `${base}lang/`,
      gzip: true,
      workerBlobURL: false,
      logger: (m) => progressListener?.(m.progress, m.status),
    });
  })();
  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    throw err;
  }
}

export async function tesseractOcr(
  image: OffscreenCanvas,
  assets: AssetPaths,
  onProgress?: (p: number, status: string) => void,
): Promise<PageText> {
  const worker = await getWorker(assets);
  progressListener = onProgress ?? null;
  try {
    const { data } = await worker.recognize(image, { rotateAuto: true }, { blocks: true, text: false });
    const items: TextItem[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            if (!word.text.trim()) continue;
            const { x0, y0, x1, y1 } = word.bbox;
            items.push({ str: word.text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, conf: word.confidence / 100 });
          }
        }
      }
    }
    return { width: image.width, height: image.height, items, wordLevel: true };
  } finally {
    progressListener = null;
  }
}

export async function disposeTesseract(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) await (await pending).terminate();
}

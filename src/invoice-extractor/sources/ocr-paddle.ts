/**
 * Fuente 3b: OCR con PaddleOCR PP-OCRv6 small (soporta español), respaldo de Tesseract
 * cuando la lectura sale con baja confianza. Carga perezosa: solo se descarga
 * (~31 MB de modelos + OpenCV.js + ONNX Runtime) la primera vez que hace falta.
 *
 * Se usa el modo worker del SDK (worker anidado dentro del worker del extractor): su modo
 * directo necesita el DOM (document.createElement('canvas')), que no existe en un worker.
 * Ese worker trae ONNX Runtime 1.24.3 empaquetado: sus binarios se sirven desde
 * vendor/ort-paddle/ (ver scripts/copy-static-assets.mjs).
 */
import type { PageText, TextItem } from '../text/layout';
import type { AssetPaths } from '../types';

const DET_MODEL = 'PP-OCRv6_small_det';
const REC_MODEL = 'PP-OCRv6_small_rec';

type PaddleInstance = Awaited<ReturnType<(typeof import('@paddleocr/paddleocr-js'))['PaddleOCR']['create']>>;

let enginePromise: Promise<PaddleInstance> | null = null;

async function getEngine(assets: AssetPaths): Promise<PaddleInstance> {
  enginePromise ??= (async () => {
    const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
    const models = `${assets.modelsBaseUrl}paddleocr/`;
    return PaddleOCR.create({
      worker: true,
      textDetectionModelName: DET_MODEL,
      textDetectionModelAsset: { url: `${models}${DET_MODEL}.tar` },
      textRecognitionModelName: REC_MODEL,
      textRecognitionModelAsset: { url: `${models}${REC_MODEL}.tar` },
      ortOptions: {
        backend: 'auto',
        wasmPaths: `${assets.vendorBaseUrl}ort-paddle/`,
        // Varios hilos solo con aislamiento cross-origin (cabeceras COOP/COEP).
        numThreads: self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1,
      },
    });
  })();
  try {
    return await enginePromise;
  } catch (err) {
    enginePromise = null;
    throw err;
  }
}

/** Precarga el motor (descarga de modelos) sin procesar nada. */
export async function warmupPaddle(assets: AssetPaths): Promise<void> {
  await getEngine(assets);
}

/** OCR de una imagen. Devuelve un item por tramo de texto detectado (no por palabra). */
export async function paddleOcr(image: ImageData, assets: AssetPaths): Promise<PageText> {
  const engine = await getEngine(assets);
  // En modo worker el SDK acepta ImageBitmap sin tocar el DOM (y lo transfiere sin copiar).
  const bitmap = await createImageBitmap(image);
  const [result] = await engine.predict(bitmap);
  const items: TextItem[] = [];
  for (const it of result?.items ?? []) {
    if (!it.text.trim()) continue;
    const xs = it.poly.map((p) => p[0]);
    const ys = it.poly.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    items.push({ str: it.text, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, conf: it.score });
  }
  return { width: image.width, height: image.height, items };
}

export async function disposePaddle(): Promise<void> {
  const pending = enginePromise;
  enginePromise = null;
  if (pending) await (await pending).dispose();
}

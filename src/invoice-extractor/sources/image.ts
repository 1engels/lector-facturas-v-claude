/**
 * Decodificación y preproceso de imágenes con OffscreenCanvas (corre en el worker).
 * Suficiente para escaneos; las fotos torcidas quedan para fase 2 (jscanify + OpenCV).
 */

/** Lado mayor máximo al decodificar: evita imágenes de 48 MP que agotan memoria en móviles. */
const MAX_LONG_SIDE = 3200;
/** Lado menor mínimo para OCR: por debajo, Tesseract pierde caracteres pequeños. */
const MIN_SHORT_SIDE_OCR = 1600;

function newCanvas(w: number, h: number) {
  const canvas = new OffscreenCanvas(Math.round(w), Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

/** Decodifica un archivo de imagen respetando la orientación EXIF. */
export async function decodeImage(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const { ctx } = newCanvas(bitmap.width * scale, bitmap.height * scale);
  ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
  bitmap.close();
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Escala de grises + estiramiento de contraste (percentiles 1–99) + reescalado.
 * Tesseract binariza internamente (Otsu); aquí solo se le da una entrada limpia.
 */
export function preprocessForOcr(src: ImageData): OffscreenCanvas {
  const { width, height, data } = src;
  const gray = new Uint8ClampedArray(width * height);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    const g = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
    gray[p] = g;
    hist[gray[p]!]!++;
  }

  const [lo, hi] = percentiles(hist, gray.length, 0.01, 0.99);
  const range = Math.max(hi - lo, 1);

  const { canvas: base, ctx } = newCanvas(width, height);
  const out = ctx.createImageData(width, height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const v = ((gray[p]! - lo) * 255) / range;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  const scale = Math.max(1, MIN_SHORT_SIDE_OCR / Math.min(width, height));
  if (scale === 1) return base;
  const { canvas, ctx: scaled } = newCanvas(width * scale, height * scale);
  scaled.imageSmoothingQuality = 'high';
  scaled.drawImage(base, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function percentiles(hist: Uint32Array, total: number, pLo: number, pHi: number): [number, number] {
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc <= total * pLo) lo = v;
    if (acc < total * pHi) hi = v + 1;
  }
  return [lo, Math.min(hi, 255)];
}

/** Reduce una imagen a la mitad (segundo intento de lectura de QR en imágenes enormes). */
export function downscale(src: ImageData, factor = 0.5): ImageData {
  const { canvas, ctx } = newCanvas(src.width, src.height);
  ctx.putImageData(src, 0, 0);
  const small = newCanvas(src.width * factor, src.height * factor);
  small.ctx.drawImage(canvas, 0, 0, small.canvas.width, small.canvas.height);
  return small.ctx.getImageData(0, 0, small.canvas.width, small.canvas.height);
}

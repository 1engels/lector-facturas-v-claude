/**
 * Fuente 2: QR SUNAT con zxing-wasm (corre en el worker).
 * El .wasm lo empaqueta Vite y se sirve desde el propio sitio (sin CDN).
 */
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { parseSunatQr, type SunatQrData } from '../extract/sunat-qr';
import { downscale } from './image';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
  },
});

const OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  maxNumberOfSymbols: 4,
};

export interface QrScan {
  /** Primer QR con formato SUNAT válido. */
  data: SunatQrData | null;
  /** Textos de todos los QR leídos (útil para depurar QRs con URL u otro formato). */
  rawTexts: string[];
}

/** Busca el QR SUNAT en las imágenes dadas (en orden); prueba también a media escala. */
export async function scanSunatQr(images: ImageData[]): Promise<QrScan> {
  const rawTexts: string[] = [];
  for (const image of images) {
    const attempts = [image, ...(Math.max(image.width, image.height) > 1600 ? [() => downscale(image)] : [])];
    for (const attempt of attempts) {
      const input = typeof attempt === 'function' ? attempt() : attempt;
      const results = await readBarcodes(input, OPTIONS);
      for (const r of results) {
        if (!r.isValid || !r.text) continue;
        rawTexts.push(r.text);
        const data = parseSunatQr(r.text);
        if (data) return { data, rawTexts };
      }
      if (results.length) break; // se leyó algún QR (no SUNAT): no insistir con esta imagen
    }
  }
  return { data: null, rawTexts };
}

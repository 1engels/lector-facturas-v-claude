/**
 * API pública del extractor de comprobantes.
 *
 *   const result = await extractInvoice(file, { onProgress, onPreview, engine: 'ocr' | 'vlm' });
 *   await preloadEngine('vlm', { onProgress });   // opcional: descarga el modelo por adelantado
 *
 * Todo corre en el navegador: el archivo nunca se envía a un servidor.
 * Agnóstico de framework: se puede mover tal cual a otro proyecto Vite.
 */
import * as Comlink from 'comlink';
import type { InvoiceResult } from './schema';
import type { AssetPaths, ExtractionContext, ExtractionEngine, ExtractionProgress, ProgressFn, WorkerInput } from './types';
import type { ExtractorWorkerApi } from './worker';

export * from './schema';
export {
  validateInvoice,
  isValidRuc,
  checkAmounts,
  checkBuyer,
  buyerMismatchMessage,
  type BuyerCheck,
} from './extract/validate';
export type { ExtractionEngine, ExtractionProgress, ExtractionStage } from './types';

export interface AssetOptions {
  /**
   * URL de la carpeta con los assets self-hosted (tesseract/, pdfjs/, ort-*).
   * Por defecto `${import.meta.env.BASE_URL}vendor/`.
   */
  vendorBaseUrl?: string;
  /**
   * URL de la carpeta con los modelos de IA (paddleocr/, onnx-community/).
   * Por defecto `${import.meta.env.BASE_URL}models/`.
   */
  modelsBaseUrl?: string;
}

export interface ExtractOptions extends AssetOptions {
  onProgress?: (p: ExtractionProgress) => void;
  /** Recibe una imagen de la primera página (solo PDFs), útil para la vista previa. */
  onPreview?: (image: Blob) => void;
  /** Motor para imágenes y PDFs escaneados (ver ExtractionEngine). Por defecto 'ocr'. */
  engine?: ExtractionEngine;
  /**
   * RUC de la empresa a la que deben ir dirigidos los comprobantes. Mejora la extracción
   * (ese RUC nunca es el emisor) y llena meta.buyerCheck.
   */
  buyerRuc?: string;
}

export type FileKind = 'pdf' | 'image' | 'xml';

/** Formatos de imagen soportados: JPG, PNG y BMP (decodificables en todos los navegadores). */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/x-ms-bmp']);
const IMAGE_EXT_RE = /\.(jpe?g|png|bmp)$/;

export const ACCEPTED_TYPES =
  'application/pdf,.pdf,image/jpeg,image/png,image/bmp,.jpg,.jpeg,.png,.bmp,text/xml,application/xml,.xml';

const UNSUPPORTED_FORMAT_MESSAGE = 'Formato no soportado. Usa PDF, imagen JPG, PNG o BMP, o XML de SUNAT.';

export function detectFileKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  // Por tipo MIME; por extensión solo si el navegador no informó un tipo de imagen.
  if (IMAGE_TYPES.has(file.type) || (!file.type.startsWith('image/') && IMAGE_EXT_RE.test(name))) return 'image';
  if (file.type === 'text/xml' || file.type === 'application/xml' || name.endsWith('.xml')) return 'xml';
  return null;
}

let worker: Worker | null = null;
let remote: Comlink.Remote<ExtractorWorkerApi> | null = null;

function getRemote(): Comlink.Remote<ExtractorWorkerApi> {
  if (!remote) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'invoice-extractor' });
    remote = Comlink.wrap<ExtractorWorkerApi>(worker);
  }
  return remote;
}

/** Libera el worker y los motores cargados (OCR, PaddleOCR, IA). */
export async function disposeExtractor(): Promise<void> {
  if (!remote) return;
  await remote.dispose().catch(() => undefined);
  remote[Comlink.releaseProxy]();
  worker?.terminate();
  worker = null;
  remote = null;
}

const resolveAssets = (opts: AssetOptions): AssetPaths => ({
  vendorBaseUrl: new URL(opts.vendorBaseUrl ?? `${import.meta.env.BASE_URL}vendor/`, location.href).href,
  modelsBaseUrl: new URL(opts.modelsBaseUrl ?? `${import.meta.env.BASE_URL}models/`, location.href).href,
});

export interface PreloadProgress {
  /** 0..1 */
  progress: number;
  loadedMb: number;
  totalMb: number;
}

export interface PreloadOptions extends AssetOptions {
  onProgress?: (p: PreloadProgress) => void;
}

/**
 * Descarga e inicializa el motor por adelantado (p. ej. al abrir la app en escritorio),
 * para que el primer comprobante no espere. Queda en la caché del navegador.
 * Devuelve ready=false (con el motivo) si el motor no puede usarse, p. ej. sin WebGPU.
 */
export async function preloadEngine(
  engine: ExtractionEngine,
  options: PreloadOptions = {},
): Promise<{ ready: boolean; reason?: string }> {
  const onProgress = Comlink.proxy((p: PreloadProgress) => options.onProgress?.(p));
  return getRemote().warmup(engine, resolveAssets(options), onProgress);
}

export async function extractInvoice(file: File, options: ExtractOptions = {}): Promise<InvoiceResult> {
  const kind = detectFileKind(file);
  if (!kind) throw new Error(UNSUPPORTED_FORMAT_MESSAGE);

  const assets = resolveAssets(options);
  const onProgress: ProgressFn = (p) => options.onProgress?.(p);
  const progressProxy = Comlink.proxy(onProgress);
  const timings: Record<string, number> = {};
  const context: ExtractionContext = { buyerRuc: options.buyerRuc, engine: options.engine ?? 'ocr' };

  let input: WorkerInput;
  let transfer: Transferable[] = [];

  if (kind === 'xml') {
    input = { kind, text: await file.text(), timings, context };
  } else if (kind === 'image') {
    input = { kind, file, timings, assets, context };
  } else {
    onProgress({ stage: 'pdf', message: 'Leyendo PDF' });
    const t0 = performance.now();
    const pdfSource = await import('./sources/pdf-text');
    const pdf = await pdfSource.loadPdf(await file.arrayBuffer(), assets);
    try {
      const pages = await pdfSource.extractPdfText(pdf);
      timings.pdfText = Math.round(performance.now() - t0);

      // Primera y última página: el QR suele ir al pie de la última.
      const t1 = performance.now();
      const pageNumbers = [...new Set([1, pdf.numPages])];
      const canvases = [];
      for (const n of pageNumbers) canvases.push(await pdfSource.renderPage(pdf, n));
      timings.render = Math.round(performance.now() - t1);

      if (options.onPreview) canvases[0]!.toBlob((b) => b && options.onPreview?.(b), 'image/png');
      const images = canvases.map(pdfSource.canvasToImageData);
      transfer = images.map((img) => img.data.buffer);
      input = { kind, pages, images, timings, assets, context };
    } finally {
      void pdf.loadingTask.destroy();
    }
  }

  const result = await getRemote().analyze(Comlink.transfer(input, transfer), progressProxy);
  onProgress({ stage: 'done', message: 'Listo' });
  return result;
}

/**
 * Web Worker del extractor (expuesto con comlink).
 *
 * Cascada:
 *   XML UBL → exacto, fin.
 *   PDF digital → capa de texto + QR SUNAT.
 *   Imagen / PDF escaneado → QR SUNAT + motor de lectura:
 *     - engine 'vlm' (escritorio): Qwen3.5-0.8B; si falla o deja campos débiles, se completa con OCR.
 *     - engine 'ocr' (celulares): Tesseract; si la confianza es baja, PaddleOCR como respaldo.
 *   → reglas + validación cruzada. Nada sale del navegador.
 */
import * as Comlink from 'comlink';
import { bestOf, needsFallback, ocrFactor, tagExtraction, weakFields } from './extract/combine';
import { extractFromText, type TextExtraction } from './extract/fields';
import { mergeResult } from './extract/merge';
import type { SunatQrData } from './extract/sunat-qr';
import { VLM_PROMPT, VLM_PROMPT_TEXT_ONLY, parseVlmJson, vlmToExtraction } from './extract/vlm-response';
import type { InvoiceResult } from './schema';
import { decodeImage, preprocessForOcr } from './sources/image';
import { disposePaddle, paddleOcr } from './sources/ocr-paddle';
import { disposeTesseract, tesseractOcr } from './sources/ocr-tesseract';
import { scanSunatQr } from './sources/qr';
import { VLM_ENGINE_NAME, disposeVlm, isWebGpuAvailable, runVlm, warmupVlm, type VlmProgress } from './sources/vlm';
import { buildDocText, meaningfulChars, type PageText } from './text/layout';
import type { AssetPaths, ExtractionEngine, ProgressFn, WorkerInput } from './types';

/** Menos caracteres que esto en la capa de texto ⇒ PDF escaneado. */
const MIN_TEXT_CHARS = 40;

type Timings = Record<string, number>;

async function timed<T>(timings: Timings, key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings[key] = Math.round(performance.now() - t0);
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface ReadContext {
  images: ImageData[];
  qr: SunatQrData | null;
  assets: AssetPaths;
  buyerRuc?: string;
  timings: Timings;
  warnings: string[];
  onProgress?: ProgressFn;
}

interface ReadResult {
  text: TextExtraction;
  engines: string[];
  ocrConfidence: number | null;
}

// ─── Motores ─────────────────────────────────────────────────────────────────

/** Tesseract y, si la confianza es baja o quedan campos débiles, PaddleOCR como respaldo. */
async function readWithOcr(ctx: ReadContext): Promise<ReadResult> {
  const { images, assets, timings, onProgress } = ctx;
  const multi = (i: number) => (images.length > 1 ? ` (página ${i + 1}/${images.length})` : '');

  const tessPages: PageText[] = [];
  await timed(timings, 'tesseract', async () => {
    for (const [i, image] of images.entries()) {
      onProgress?.({ stage: 'ocr', progress: 0, message: `Preparando OCR${multi(i)}` });
      tessPages.push(
        await tesseractOcr(preprocessForOcr(image), assets, (p, status) =>
          onProgress?.({ stage: 'ocr', progress: p, message: `${tesseractStatus(status)}${multi(i)}` }),
        ),
      );
    }
  });
  const tessDoc = buildDocText(tessPages);
  let text = tagExtraction(extractFromText(tessDoc, { buyerRuc: ctx.buyerRuc }), 'ocr', ocrFactor(tessDoc.meanConf));
  const engines = ['tesseract'];
  let ocrConfidence = tessDoc.meanConf;

  if (needsFallback(tessDoc.meanConf, weakFields(text, ctx.qr))) {
    try {
      onProgress?.({ stage: 'ocr', message: 'Confianza baja: reintentando con PaddleOCR' });
      const paddlePages = await timed(timings, 'paddleocr', async () => {
        const pages: PageText[] = [];
        for (const image of images) pages.push(await paddleOcr(image, assets));
        return pages;
      });
      const paddleDoc = buildDocText(paddlePages);
      const paddleText = tagExtraction(extractFromText(paddleDoc, { buyerRuc: ctx.buyerRuc }), 'ocr', ocrFactor(paddleDoc.meanConf));
      text = bestOf(text, paddleText);
      engines.push('paddleocr');
      ocrConfidence = Math.max(ocrConfidence, paddleDoc.meanConf);
    } catch (err) {
      console.error(err);
      ctx.warnings.push(`El OCR de respaldo (PaddleOCR) no está disponible: ${errorMessage(err)}`);
    }
  }
  return { text, engines, ocrConfidence };
}

/** Modelo de visión sobre la primera página. Lanza error si no hay WebGPU o el modelo no carga. */
async function readWithVlm(ctx: ReadContext): Promise<TextExtraction> {
  const { onProgress } = ctx;
  const progress: VlmProgress = (p) =>
    onProgress?.({ stage: 'ia', progress: p.progress, message: `Cargando modelo IA (${Math.round(p.loadedMb)} / ${Math.round(p.totalMb)} MB)` });
  onProgress?.({ stage: 'ia', message: 'Analizando con IA' });
  const output = await timed(ctx.timings, 'vlm', async () => {
    // Con QR, el modelo solo lee lo que el QR no trae (razón social y descripción).
    return runVlm(ctx.images[0]!, ctx.qr ? VLM_PROMPT_TEXT_ONLY : VLM_PROMPT, ctx.assets, progress);
  });
  const raw = parseVlmJson(output);
  if (!raw) throw new Error('la respuesta del modelo no es un JSON válido');
  return vlmToExtraction(raw, { buyerRuc: ctx.buyerRuc });
}

// ─── API ─────────────────────────────────────────────────────────────────────

const api = {
  async analyze(input: WorkerInput, onProgress?: ProgressFn): Promise<InvoiceResult> {
    const timings: Timings = { ...input.timings };
    const buyerRuc = input.context.buyerRuc;

    if (input.kind === 'xml') {
      onProgress?.({ stage: 'extract', message: 'Leyendo XML UBL' });
      const { parseUblXml } = await import('./sources/xml');
      const result = await timed(timings, 'xml', async () => parseUblXml(input.text, timings, buyerRuc));
      if (!result) throw new Error('El XML no es un comprobante UBL de SUNAT (Invoice/CreditNote/DebitNote).');
      return result;
    }

    const images = input.kind === 'image' ? [await timed(timings, 'decode', () => decodeImage(input.file))] : input.images;

    onProgress?.({ stage: 'qr', message: 'Buscando QR SUNAT' });
    const qrScan = await timed(timings, 'qr', () => scanSunatQr(images));
    const qr = qrScan.data;
    const warnings: string[] = [];
    if (!qr && qrScan.rawTexts.length) warnings.push('Se leyó un QR pero no tiene el formato SUNAT; se usa solo el texto.');
    const engines = qr ? ['qr'] : [];

    // PDF digital: la capa de texto es exacta y rápida; no hace falta OCR ni IA.
    if (input.kind === 'pdf') {
      const pdfDoc = buildDocText(input.pages);
      if (meaningfulChars(pdfDoc) >= MIN_TEXT_CHARS) {
        onProgress?.({ stage: 'extract', message: 'Extrayendo campos' });
        const text = tagExtraction(extractFromText(pdfDoc, { buyerRuc }), 'pdf-text');
        return mergeResult({ inputKind: 'pdf-digital', qr, text, engines: [...engines, 'pdf-text'], timings, warnings, buyerRuc });
      }
    }

    // Imagen o PDF escaneado.
    const ctx: ReadContext = { images, qr, assets: input.assets, buyerRuc, timings, warnings, onProgress };
    let text: TextExtraction | null = null;
    let ocrConfidence: number | null = null;

    if (input.context.engine === 'vlm') {
      try {
        text = await readWithVlm(ctx);
        engines.push(VLM_ENGINE_NAME);
      } catch (err) {
        console.error(err);
        warnings.push(`El motor de IA no está disponible (${errorMessage(err)}); se usó OCR.`);
      }
    }

    // OCR: motor principal en celulares, o para completar lo que la IA no resolvió bien.
    if (!text || weakFields(text, qr).length > 0) {
      const ocr = await readWithOcr(ctx);
      text = text ? bestOf(text, ocr.text) : ocr.text;
      engines.push(...ocr.engines);
      ocrConfidence = ocr.ocrConfidence;
    }

    onProgress?.({ stage: 'extract', message: 'Validando campos' });
    const inputKind = input.kind === 'image' ? 'image' : 'pdf-scan';
    return mergeResult({ inputKind, qr, text, engines, ocrConfidence, timings, warnings, buyerRuc });
  },

  /** Precarga el motor (descarga del modelo) para que el primer comprobante no espere. */
  async warmup(engine: ExtractionEngine, assets: AssetPaths, onProgress?: VlmProgress): Promise<{ ready: boolean; reason?: string }> {
    if (engine !== 'vlm') return { ready: true };
    if (!(await isWebGpuAvailable())) return { ready: false, reason: 'WebGPU no está disponible en este navegador' };
    try {
      await warmupVlm(assets, onProgress);
      return { ready: true };
    } catch (err) {
      console.error(err);
      return { ready: false, reason: errorMessage(err) };
    }
  },

  async dispose(): Promise<void> {
    await Promise.allSettled([disposeTesseract(), disposePaddle(), disposeVlm()]);
  },
};

function tesseractStatus(status: string): string {
  if (status.includes('loading tesseract core')) return 'Cargando motor OCR';
  if (status.includes('language') || status.includes('traineddata')) return 'Cargando modelo de español';
  if (status.includes('initializ')) return 'Inicializando OCR';
  if (status.includes('recognizing')) return 'Reconociendo texto';
  return 'OCR';
}

export type ExtractorWorkerApi = typeof api;

Comlink.expose(api);

/**
 * Tipos internos del pipeline (contrato entre el hilo principal y el worker).
 */
import type { PageText } from './text/layout';

export type ExtractionStage = 'read' | 'pdf' | 'qr' | 'ocr' | 'ia' | 'extract' | 'done';

export interface ExtractionProgress {
  stage: ExtractionStage;
  /** 0..1 dentro de la etapa, si se conoce. */
  progress?: number;
  message: string;
}

export type ProgressFn = (p: ExtractionProgress) => void;

/** Rutas de los assets self-hosted. */
export interface AssetPaths {
  /** URL absoluta de public/vendor/ (tesseract/, pdfjs/, ort-*): scripts/copy-static-assets.mjs. */
  vendorBaseUrl: string;
  /** URL absoluta de public/models/ (paddleocr/, onnx-community/): scripts/fetch-models.mjs. */
  modelsBaseUrl: string;
}

/**
 * Motor para leer imágenes y PDFs escaneados:
 * - 'ocr': Tesseract, con PaddleOCR como respaldo si la confianza es baja (celulares).
 * - 'vlm': modelo de visión Qwen3.5-0.8B con WebGPU (escritorio); si no está disponible
 *   o deja campos vacíos, se completa con 'ocr'.
 */
export type ExtractionEngine = 'ocr' | 'vlm';

/** Datos del contexto de negocio que ayudan a extraer y validar. */
export interface ExtractionContext {
  /** RUC de la empresa a la que deben ir dirigidos los comprobantes. */
  buyerRuc?: string;
  engine: ExtractionEngine;
}

export type WorkerInput =
  | {
      kind: 'pdf';
      /** Texto de la capa del PDF, por página. */
      pages: PageText[];
      /** Páginas renderizadas (primera y última) para QR/OCR. */
      images: ImageData[];
      timings: Record<string, number>;
      assets: AssetPaths;
      context: ExtractionContext;
    }
  | { kind: 'image'; file: Blob; timings: Record<string, number>; assets: AssetPaths; context: ExtractionContext }
  | { kind: 'xml'; text: string; timings: Record<string, number>; context: ExtractionContext };

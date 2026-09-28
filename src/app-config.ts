import { isValidRuc, type ExtractionEngine } from '@/invoice-extractor';
import { chooseCameraStrategy, defaultEngine, detectDevice } from '@/platform/device';

/** Configuración de la aplicación: variables de entorno (.env) + dispositivo detectado. */
function readBuyerRuc(): string | undefined {
  const ruc = import.meta.env.VITE_BUYER_RUC?.trim();
  if (!ruc) return undefined;
  if (!isValidRuc(ruc)) {
    console.error(`VITE_BUYER_RUC="${ruc}" no es un RUC válido; se desactiva la validación del adquirente.`);
    return undefined;
  }
  return ruc;
}

const device = detectDevice();

export const appConfig = {
  /** RUC de la empresa a la que deben estar dirigidos los comprobantes. */
  buyerRuc: readBuyerRuc(),
  device,
  /** Escritorio: modelo de visión (Qwen3.5-0.8B). Celulares: OCR (Tesseract + PaddleOCR). */
  engine: defaultEngine(device) as ExtractionEngine,
  /** En escritorio no se ofrece cámara: las webcams no sirven para fotografiar documentos. */
  cameraEnabled: chooseCameraStrategy(device, true) !== 'none',
} as const;

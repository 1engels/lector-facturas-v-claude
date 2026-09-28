/**
 * Combinación de motores de lectura (Tesseract, PaddleOCR, VLM): cuándo hace falta
 * un motor de respaldo y cómo quedarse con el mejor valor de cada campo.
 */
import type { Candidate, TextExtraction, TextSource } from './fields';
import type { SunatQrData } from './sunat-qr';

/** Confianza media del OCR por debajo de la cual se intenta el motor de respaldo. */
export const LOW_OCR_CONFIDENCE = 0.8;
/** Un campo con menos confianza que esto se considera débil. */
export const WEAK_FIELD_CONFIDENCE = 0.6;

const CANDIDATE_KEYS = [
  'razonSocial',
  'ruc',
  'rucAdquirente',
  'correlativo',
  'fechaEmision',
  'montoTotal',
  'igv',
  'descripcion',
] as const;
type CandidateKey = (typeof CANDIDATE_KEYS)[number];

/** Campos que el QR SUNAT resuelve con exactitud: si hay QR, no dependen del texto. */
const QR_KEYS: Partial<Record<CandidateKey, keyof SunatQrData>> = {
  ruc: 'ruc',
  rucAdquirente: 'docAdquirente',
  correlativo: 'correlativo',
  fechaEmision: 'fechaEmision',
  montoTotal: 'montoTotal',
  igv: 'igv',
};

/** El OCR arrastra errores de lectura: su confianza escala con la del motor (0.6..1). */
export const ocrFactor = (meanConf: number): number => 0.6 + 0.4 * Math.max(0, Math.min(1, meanConf));

/** Marca cada candidato con su fuente y escala su confianza. */
export function tagExtraction(text: TextExtraction, source: TextSource, factor = 1): TextExtraction {
  const out = { ...text };
  for (const key of CANDIDATE_KEYS) {
    const c = text[key] as Candidate<unknown> | null;
    (out[key] as Candidate<unknown> | null) = c
      ? { ...c, source, confidence: Math.round(c.confidence * factor * 100) / 100 }
      : null;
  }
  return out;
}

/**
 * Campos que ni el QR ni el texto resolvieron con confianza suficiente.
 * En boletas, que falte el adquirente es normal (suelen ir a consumidor final): no cuenta
 * como débil, porque otro motor no lo va a encontrar; ya lo señala la validación del destinatario.
 */
export function weakFields(text: TextExtraction | null, qr: SunatQrData | null): CandidateKey[] {
  const isBoleta = (qr?.tipoComprobante ?? text?.tipoComprobante) === '03';
  return CANDIDATE_KEYS.filter((key) => {
    if (key === 'rucAdquirente' && isBoleta && !text?.rucAdquirente) return false;
    const qrKey = QR_KEYS[key];
    if (qr && qrKey && qr[qrKey] != null) return false;
    const c = text?.[key] as Candidate<unknown> | null | undefined;
    return !c || c.confidence < WEAK_FIELD_CONFIDENCE;
  });
}

/** ¿Vale la pena correr el motor de respaldo? Baja confianza global o campos sin resolver. */
export function needsFallback(meanConf: number, weak: readonly string[]): boolean {
  return meanConf < LOW_OCR_CONFIDENCE || weak.length > 0;
}

/** Dos motores independientes que leen lo mismo refuerzan el valor (y frenan alucinaciones del VLM). */
const AGREEMENT_BONUS = 0.1;
const AGREEMENT_CAP = 0.95;

/**
 * Mejor valor de cada campo entre dos extracciones (mayor confianza; en empate gana `a`).
 * Si ambas coinciden, se sube la confianza. Los datos auxiliares (base imponible, moneda,
 * tipo) se toman de `a` y se completan con `b`.
 */
export function bestOf(a: TextExtraction, b: TextExtraction | null): TextExtraction {
  if (!b) return a;
  const out: TextExtraction = {
    ...a,
    baseImponible: a.baseImponible ?? b.baseImponible,
    moneda: a.moneda ?? b.moneda,
    tipoComprobante: a.tipoComprobante ?? b.tipoComprobante,
  };
  for (const key of CANDIDATE_KEYS) {
    const ca = a[key] as Candidate<unknown> | null;
    const cb = b[key] as Candidate<unknown> | null;
    if (ca && cb && ca.value === cb.value) {
      const best = cb.confidence > ca.confidence ? cb : ca;
      const confidence = Math.min(Math.max(ca.confidence, cb.confidence) + AGREEMENT_BONUS, AGREEMENT_CAP);
      (out[key] as Candidate<unknown>) = { ...best, confidence: Math.max(best.confidence, confidence) };
      continue;
    }
    (out[key] as Candidate<unknown> | null) = !ca ? cb : !cb ? ca : cb.confidence > ca.confidence ? cb : ca;
  }
  return out;
}

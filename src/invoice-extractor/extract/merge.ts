/**
 * Fusiona las fuentes (QR SUNAT + texto) en un InvoiceResult y ajusta la
 * confianza de cada campo con las validaciones cruzadas.
 */
import type { InputKind, InvoiceFieldName, InvoiceFields, InvoiceResult } from '../schema';
import type { Candidate, TextExtraction } from './fields';
import type { SunatQrData } from './sunat-qr';
import { checkAmounts, checkBuyer, isPlausibleIsoDate, isValidRuc, roundMoney } from './validate';

export interface MergeInput {
  inputKind: InputKind;
  qr: SunatQrData | null;
  /** Candidatos con su fuente y confianza ya ajustadas (ver extract/combine.ts). */
  text: TextExtraction | null;
  /** Motores que intervinieron, en orden. */
  engines: string[];
  /** Confianza media del OCR usado; null si no hubo OCR. */
  ocrConfidence?: number | null;
  timings: Record<string, number>;
  warnings?: string[];
  /** RUC de la empresa compradora, si se configuró. */
  buyerRuc?: string;
}

const QR_CONFIDENCE = 0.97;
const emptyField = { value: null, source: null, confidence: 0 } as const;
const clamp = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

type FieldValue<K extends InvoiceFieldName> = NonNullable<InvoiceFields[K]['value']>;

export function mergeResult(input: MergeInput): InvoiceResult {
  const { qr, text } = input;
  const warnings = [...(input.warnings ?? [])];

  const fromText = <K extends InvoiceFieldName>(cand: Candidate<FieldValue<K>> | null | undefined) =>
    cand
      ? { value: cand.value, source: cand.source ?? ('pdf-text' as const), confidence: clamp(cand.confidence) }
      : { ...emptyField };

  /** Campo que el QR puede resolver: QR primero, texto como respaldo y verificación. */
  const pick = <K extends InvoiceFieldName>(
    label: string,
    qrValue: FieldValue<K> | null | undefined,
    cand: Candidate<FieldValue<K>> | null | undefined,
  ) => {
    if (qrValue == null) return fromText<K>(cand);
    const agrees = cand?.value === qrValue;
    if (cand && !agrees) warnings.push(`${label}: el QR indica "${qrValue}" pero el texto "${cand.value}". Se usa el QR.`);
    return { value: qrValue, source: 'qr' as const, confidence: agrees ? 1 : QR_CONFIDENCE };
  };

  const fields: InvoiceFields = {
    razonSocial: fromText<'razonSocial'>(text?.razonSocial),
    ruc: pick<'ruc'>('RUC emisor', qr?.ruc, text?.ruc),
    rucAdquirente: pick<'rucAdquirente'>('RUC adquirente', qr?.docAdquirente, text?.rucAdquirente),
    correlativo: pick<'correlativo'>('Correlativo', qr?.correlativo, text?.correlativo),
    fechaEmision: pick<'fechaEmision'>('Fecha de emisión', qr?.fechaEmision, text?.fechaEmision),
    montoTotal: pick<'montoTotal'>('Monto total', qr?.montoTotal, text?.montoTotal),
    igv: pick<'igv'>('IGV', qr?.igv, text?.igv),
    descripcion: fromText<'descripcion'>(text?.descripcion),
  };

  // ── Validación cruzada ──
  if (fields.ruc.value && !isValidRuc(fields.ruc.value)) {
    fields.ruc.confidence = Math.min(fields.ruc.confidence, 0.3);
    warnings.push('El RUC emisor no pasa el dígito verificador.');
  }
  if (fields.fechaEmision.value && !isPlausibleIsoDate(fields.fechaEmision.value)) {
    fields.fechaEmision.confidence = Math.min(fields.fechaEmision.confidence, 0.3);
    warnings.push('La fecha de emisión no parece válida.');
  }

  // Si la base no cuadra pero total e IGV sí (con una tasa vigente), la base se leyó mal: se recalcula.
  let baseImponible = text?.baseImponible ?? null;
  let amounts = checkAmounts({ base: baseImponible, igv: fields.igv.value, total: fields.montoTotal.value });
  if (amounts.consistent === false && baseImponible != null) {
    const withoutBase = checkAmounts({ igv: fields.igv.value, total: fields.montoTotal.value });
    if (withoutBase.consistent) {
      amounts = withoutBase;
      baseImponible = null;
    }
  }
  // Sin base leída (o descartada) pero con total e IGV coherentes: base = total − IGV.
  if (baseImponible == null && amounts.consistent && fields.montoTotal.value != null && fields.igv.value != null) {
    baseImponible = roundMoney(fields.montoTotal.value - fields.igv.value);
  }
  for (const key of ['montoTotal', 'igv'] as const) {
    const f = fields[key];
    if (f.value == null || f.source === 'qr') continue;
    if (amounts.consistent === true) f.confidence = clamp(Math.min(f.confidence + 0.1, 0.95));
    if (amounts.consistent === false) f.confidence = clamp(f.confidence * 0.7);
  }
  if (amounts.consistent === false) warnings.push('El IGV no cuadra con el total: revisar montos.');

  return {
    fields,
    meta: {
      inputKind: input.inputKind,
      tipoComprobante: qr?.tipoComprobante ?? text?.tipoComprobante ?? null,
      moneda: text?.moneda ?? null,
      buyerCheck: input.buyerRuc ? checkBuyer(fields.rucAdquirente.value, input.buyerRuc) : null,
      baseImponible,
      qrFound: qr !== null,
      engines: input.engines,
      ocrConfidence: input.ocrConfidence ?? null,
      timings: input.timings,
      warnings,
    },
  };
}

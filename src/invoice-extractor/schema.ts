/**
 * Esquemas compartidos entre cliente y backend.
 *
 * Este archivo NO debe depender del DOM ni de librerías de navegador: el backend
 * Node lo importa tal cual para revalidar lo que envía el cliente.
 */
import { z } from 'zod';
import { buyerMismatchMessage, isValidRuc } from './extract/validate';

/** De dónde salió el valor de un campo. */
export const FieldSource = z.enum(['xml', 'qr', 'pdf-text', 'ocr', 'ia', 'manual']);
export type FieldSource = z.infer<typeof FieldSource>;

/** Tipo de entrada detectado para el documento. */
export const InputKind = z.enum(['pdf-digital', 'pdf-scan', 'image', 'xml']);
export type InputKind = z.infer<typeof InputKind>;

/** Nombres de los campos que se extraen. El orden define el orden en la UI. */
export const INVOICE_FIELDS = [
  'razonSocial',
  'ruc',
  'rucAdquirente',
  'correlativo',
  'fechaEmision',
  'montoTotal',
  'igv',
  'descripcion',
] as const;
export type InvoiceFieldName = (typeof INVOICE_FIELDS)[number];

const Ruc = z.string().regex(/^(10|15|17|20)\d{9}$/, 'RUC inválido').refine(isValidRuc, 'Dígito verificador del RUC inválido');
const Correlativo = z.string().regex(/^[A-Z0-9]{4}-\d{1,8}$/, 'Formato esperado: SERIE-NÚMERO (p. ej. F001-123)');
const Monto = z.number().nonnegative().multipleOf(0.01);

/** Comprobante final (lo que se envía al backend). */
export const Invoice = z.object({
  razonSocial: z.string().trim().min(1),
  /** RUC del emisor. */
  ruc: Ruc,
  /** RUC del adquirente (la empresa a la que va dirigido el comprobante). */
  rucAdquirente: Ruc,
  correlativo: Correlativo,
  fechaEmision: z.iso.date(),
  montoTotal: Monto,
  igv: Monto,
  descripcion: z.string().trim().min(1),
});
export type Invoice = z.infer<typeof Invoice>;

/**
 * Esquema que además exige que el comprobante esté dirigido a la empresa indicada.
 * Usar en cliente y backend con el mismo RUC (VITE_BUYER_RUC / BUYER_RUC).
 */
export const invoiceSchemaFor = (buyerRuc: string) =>
  Invoice.superRefine((inv, ctx) => {
    const message = buyerMismatchMessage(inv.rucAdquirente, buyerRuc);
    if (message) ctx.addIssue({ code: 'custom', path: ['rucAdquirente'], message });
  });

/** Valor extraído + trazabilidad, para que la UI marque los dudosos. */
const extractedField = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    source: FieldSource.nullable(),
    /** 0..1. Heurística, no probabilidad calibrada. */
    confidence: z.number().min(0).max(1),
  });

export const InvoiceFields = z.object({
  razonSocial: extractedField(z.string()),
  ruc: extractedField(z.string()),
  rucAdquirente: extractedField(z.string()),
  correlativo: extractedField(z.string()),
  fechaEmision: extractedField(z.string()),
  montoTotal: extractedField(z.number()),
  igv: extractedField(z.number()),
  descripcion: extractedField(z.string()),
});
export type InvoiceFields = z.infer<typeof InvoiceFields>;
export type ExtractedField<K extends InvoiceFieldName> = InvoiceFields[K];

/** Datos adicionales útiles para validar o depurar (no forman parte del Invoice). */
export const InvoiceMeta = z.object({
  inputKind: InputKind,
  /** Código SUNAT: 01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito. */
  tipoComprobante: z.string().nullable(),
  moneda: z.string().nullable(),
  /** ¿Dirigido a la empresa configurada? null si no se configuró un RUC comprador. */
  buyerCheck: z.enum(['match', 'mismatch', 'missing']).nullable(),
  baseImponible: z.number().nullable(),
  qrFound: z.boolean(),
  /** Motores que intervinieron, en orden (p. ej. ['qr', 'tesseract', 'paddleocr']). */
  engines: z.array(z.string()),
  /** Confianza media del OCR usado (0..1); null si no hubo OCR. */
  ocrConfidence: z.number().nullable(),
  /** Duración de cada etapa en ms. */
  timings: z.record(z.string(), z.number()),
  warnings: z.array(z.string()),
});
export type InvoiceMeta = z.infer<typeof InvoiceMeta>;

export const InvoiceResult = z.object({
  fields: InvoiceFields,
  meta: InvoiceMeta,
});
export type InvoiceResult = z.infer<typeof InvoiceResult>;

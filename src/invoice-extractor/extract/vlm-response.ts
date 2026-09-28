/**
 * Interpretación de la respuesta del modelo de visión (VLM) y prompt que la produce.
 *
 * El modelo puede equivocarse o inventar valores plausibles: aquí solo se *proponen*
 * candidatos con confianza moderada. Los validadores (dígito verificador del RUC,
 * cuadre del IGV, formato del correlativo) y el QR SUNAT tienen la última palabra.
 */
import type { Candidate, TextExtraction } from './fields';
import { normalizeCorrelativo, parseAmount, parseDate } from './parse';
import { isValidRuc } from './validate';

export const VLM_PROMPT = `Eres un extractor de datos de comprobantes de pago peruanos (SUNAT).
Lee la imagen y responde SOLO con un objeto JSON, sin texto adicional, con estas claves:
{
  "razon_social_emisor": "nombre de la empresa que EMITE el comprobante (cabecera)",
  "ruc_emisor": "11 dígitos del RUC del emisor",
  "ruc_adquirente": "RUC o DNI del cliente (Señor(es) / Cliente)",
  "serie": "serie, p. ej. F001",
  "numero": "número correlativo",
  "fecha_emision": "YYYY-MM-DD",
  "moneda": "PEN o USD",
  "subtotal": "base imponible / op. gravada",
  "igv": "monto del IGV",
  "total": "importe total",
  "descripcion": "descripción de cada ítem, separados por '; '"
}
Copia los números exactamente como aparecen. Usa null si un dato no aparece. No inventes valores.`;

/**
 * Prompt corto cuando el QR SUNAT ya dio RUCs, correlativo, fecha y montos: el modelo solo
 * lee lo que el QR no trae. Menos texto generado ⇒ bastante más rápido, y sin riesgo de
 * leer mal los números (que el modelo pequeño a veces confunde).
 */
export const VLM_PROMPT_TEXT_ONLY = `Eres un extractor de datos de comprobantes de pago peruanos (SUNAT).
Lee la imagen y responde SOLO con un objeto JSON, sin texto adicional, con estas claves:
{
  "razon_social_emisor": "nombre de la empresa que EMITE el comprobante (cabecera)",
  "moneda": "PEN o USD",
  "descripcion": "descripción de cada ítem, separados por '; '"
}
Usa null si un dato no aparece. No inventes valores.`;

/** Confianza base de un valor propuesto por el VLM (antes de validar). */
const VLM_CONFIDENCE = 0.7;

type Raw = Record<string, unknown>;

/** Extrae el primer objeto JSON de la respuesta (tolera ```json, texto alrededor y comas finales). */
export function parseVlmJson(output: string): Raw | null {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = output.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Raw) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && !/^(null|n\/a|none|-)$/i.test(s) ? s : null;
};

const cand = <T>(value: T | null, confidence = VLM_CONFIDENCE): Candidate<T> | null =>
  value == null ? null : { value, confidence, source: 'ia' };

function rucCandidate(v: unknown, buyerRuc?: string): Candidate<string> | null {
  const digits = str(v)?.replace(/\D/g, '') ?? null;
  if (!digits) return null;
  if (digits.length === 11) {
    if (buyerRuc && digits === buyerRuc) return cand(digits, 0.85);
    return cand(digits, isValidRuc(digits) ? VLM_CONFIDENCE : 0.25);
  }
  return cand(digits, 0.4); // DNI u otro documento
}

function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = str(v);
  return s ? parseAmount(s) : null;
}

/** Convierte la respuesta del VLM en candidatos, con el mismo formato que la extracción por texto. */
export function vlmToExtraction(raw: Raw, options: { buyerRuc?: string } = {}): TextExtraction {
  const serie = str(raw.serie)?.toUpperCase().replace(/\s/g, '') ?? null;
  const numero = str(raw.numero);
  // A veces devuelve "F001-123" completo en uno de los dos campos.
  const joined = [serie, numero].filter(Boolean).join('-');
  const m = /([FBE][A-Z0-9]{3})\s*-?\s*(\d{1,8})/.exec(joined);
  const correlativo = m ? normalizeCorrelativo(m[1]!, m[2]!) : null;

  const fecha = str(raw.fecha_emision);
  const moneda = str(raw.moneda)?.toUpperCase() ?? null;

  const ruc = rucCandidate(raw.ruc_emisor);
  const rucAdquirente = rucCandidate(raw.ruc_adquirente, options.buyerRuc);

  return {
    razonSocial: cand(str(raw.razon_social_emisor)),
    ruc,
    rucAdquirente: rucAdquirente && rucAdquirente.value === ruc?.value ? null : rucAdquirente,
    correlativo: cand(correlativo),
    fechaEmision: cand(fecha ? parseDate(fecha) : null),
    montoTotal: cand(amount(raw.total)),
    igv: cand(amount(raw.igv)),
    descripcion: cand(str(raw.descripcion)?.slice(0, 500) ?? null, 0.6),
    baseImponible: amount(raw.subtotal),
    moneda: moneda === 'PEN' || moneda === 'USD' ? moneda : moneda?.includes('SOL') ? 'PEN' : null,
    tipoComprobante: correlativo?.startsWith('B') ? '03' : correlativo?.startsWith('F') ? '01' : null,
  };
}

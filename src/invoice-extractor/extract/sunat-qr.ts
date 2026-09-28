/**
 * Parser del QR de comprobantes electrónicos SUNAT.
 *
 * Formato (separado por "|"):
 *   RUC emisor | tipo | serie | número | IGV | total | fecha emisión | tipo doc. adquirente | nro. doc. adquirente | hash |
 *
 * Algunos emisores ponen una URL u otro contenido: en ese caso se devuelve null
 * y el pipeline sigue con texto/OCR.
 */
import { normalizeCorrelativo, parseAmount, parseDate } from './parse';
import { isValidRuc } from './validate';

export interface SunatQrData {
  ruc: string;
  tipoComprobante: string;
  correlativo: string;
  igv: number | null;
  montoTotal: number | null;
  fechaEmision: string | null;
  docAdquirente: string | null;
  raw: string;
}

export function parseSunatQr(raw: string): SunatQrData | null {
  const parts = raw.trim().split('|').map((p) => p.trim());
  if (parts.length < 7) return null;

  const [ruc, tipo, serie, numero, igvRaw, totalRaw, fechaRaw, , docAdq] = parts;
  if (!ruc || !/^\d{11}$/.test(ruc) || !isValidRuc(ruc)) return null;
  if (!tipo || !/^\d{2}$/.test(tipo)) return null;

  const correlativo = normalizeCorrelativo(serie ?? '', numero ?? '');
  if (!correlativo) return null;

  return {
    ruc,
    tipoComprobante: tipo,
    correlativo,
    igv: igvRaw ? parseAmount(igvRaw) : null,
    montoTotal: totalRaw ? parseAmount(totalRaw) : null,
    fechaEmision: fechaRaw ? parseDate(fechaRaw) : null,
    docAdquirente: docAdq && /^\d{8,11}$/.test(docAdq) ? docAdq : null,
    raw,
  };
}

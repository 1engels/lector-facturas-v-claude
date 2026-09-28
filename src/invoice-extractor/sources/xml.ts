/**
 * Atajo: XML UBL 2.1 de SUNAT. Si el usuario tiene el XML, todos los campos
 * salen con exactitud total, sin QR ni OCR.
 */
import { XMLParser } from 'fast-xml-parser';
import type { InvoiceResult } from '../schema';
import { normalizeCorrelativo, parseAmount } from '../extract/parse';
import { checkAmounts, checkBuyer, isValidRuc } from '../extract/validate';

type Node = Record<string, unknown>;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseTagValue: false,
  isArray: (name) => ['InvoiceLine', 'CreditNoteLine', 'DebitNoteLine', 'Description', 'TaxTotal'].includes(name),
});

/** Texto de un nodo que puede venir como string o como { '#text': ... } (con atributos). */
const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as Node)) return text((v as Node)['#text']);
  return null;
};

const path = (node: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((acc, k) => {
    const cur = Array.isArray(acc) ? acc[0] : acc;
    return cur && typeof cur === 'object' ? (cur as Node)[k] : undefined;
  }, node);

const DOC_TYPES: Record<string, string> = { Invoice: '01', CreditNote: '07', DebitNote: '08' };

export function parseUblXml(xml: string, timings: Record<string, number> = {}, buyerRuc?: string): InvoiceResult | null {
  const doc = parser.parse(xml) as Node;
  const rootName = Object.keys(DOC_TYPES).find((k) => k in doc);
  if (!rootName) return null;
  const root = doc[rootName] as Node;

  const supplierParty = path(root, 'AccountingSupplierParty', 'Party');
  const ruc = text(path(supplierParty, 'PartyIdentification', 'ID'));
  const razonSocial =
    text(path(supplierParty, 'PartyLegalEntity', 'RegistrationName')) ?? text(path(supplierParty, 'PartyName', 'Name'));
  const [serie, numero] = (text(root.ID) ?? '').split('-');
  const correlativo = serie && numero ? normalizeCorrelativo(serie, numero) : null;
  const fecha = text(root.IssueDate);
  const total = parseAmount(text(path(root, 'LegalMonetaryTotal', 'PayableAmount')) ?? '');
  const igv = parseAmount(text(path(root, 'TaxTotal', 'TaxAmount')) ?? '');
  const base = parseAmount(text(path(root, 'LegalMonetaryTotal', 'LineExtensionAmount')) ?? '');
  const lineKey = { Invoice: 'InvoiceLine', CreditNote: 'CreditNoteLine', DebitNote: 'DebitNoteLine' }[rootName]!;
  const lines = (root[lineKey] as Node[] | undefined) ?? [];
  const descripcion = lines
    .flatMap((l) => ((path(l, 'Item') as Node | undefined)?.Description as unknown[] | undefined) ?? [])
    .map(text)
    .filter(Boolean)
    .join('; ');

  const rucAdquirente = text(path(root, 'AccountingCustomerParty', 'Party', 'PartyIdentification', 'ID'));
  const tipo = text(root.InvoiceTypeCode) ?? DOC_TYPES[rootName]!;
  const field = <T>(value: T | null) => ({ value, source: value == null ? null : ('xml' as const), confidence: value == null ? 0 : 1 });
  const warnings: string[] = [];
  if (ruc && !isValidRuc(ruc)) warnings.push('El RUC del XML no pasa el dígito verificador.');
  if (checkAmounts({ base, igv, total }).consistent === false) warnings.push('Los montos del XML no cuadran (puede haber exonerados/ICBPER).');

  return {
    fields: {
      razonSocial: field(razonSocial),
      ruc: field(ruc),
      rucAdquirente: field(rucAdquirente),
      correlativo: field(correlativo),
      fechaEmision: field(fecha),
      montoTotal: field(total),
      igv: field(igv),
      descripcion: field(descripcion || null),
    },
    meta: {
      inputKind: 'xml',
      tipoComprobante: tipo,
      moneda: text(root.DocumentCurrencyCode),
      buyerCheck: buyerRuc ? checkBuyer(rucAdquirente, buyerRuc) : null,
      baseImponible: base,
      qrFound: false,
      engines: ['xml'],
      ocrConfidence: null,
      timings,
      warnings,
    },
  };
}

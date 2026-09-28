/**
 * Extracción de campos a partir de texto con coordenadas (pdf.js u OCR).
 * Regex + heurísticas por posición. Funciones puras: se testean con fixtures de texto.
 */
import type { DocText, TextItem, TextLine } from '../text/layout';
import { CORRELATIVO_RE, findAmounts, findDates, normalizeCorrelativo } from './parse';
import { isValidRuc } from './validate';

/** Fuentes de texto: capa del PDF, OCR o modelo de visión. */
export type TextSource = 'pdf-text' | 'ocr' | 'ia';

export interface Candidate<T> {
  value: T;
  /** Confianza 0..1 (el pipeline la ajusta por fuente y validaciones). */
  confidence: number;
  /** De dónde salió; lo asigna el pipeline al combinar motores. */
  source?: TextSource;
}

export interface ExtractOptions {
  /** RUC de la empresa compradora: si aparece, se sabe que es el adquirente. */
  buyerRuc?: string;
}

export interface TextExtraction {
  razonSocial: Candidate<string> | null;
  ruc: Candidate<string> | null;
  correlativo: Candidate<string> | null;
  fechaEmision: Candidate<string> | null;
  montoTotal: Candidate<number> | null;
  igv: Candidate<number> | null;
  descripcion: Candidate<string> | null;
  baseImponible: number | null;
  rucAdquirente: Candidate<string> | null;
  moneda: string | null;
  tipoComprobante: string | null;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Mayúsculas y sin tildes, para comparar etiquetas. */
export const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Palabras que indican que la línea habla del cliente, no del emisor. */
const CLIENT_RE = /SENOR|CLIENTE|ADQUIR|DESTINATARIO|USUARIO|NOMBRE\s*\/?\s*RAZON|DATOS DEL COMPRADOR|D\.?N\.?I/;

const lineHeightMedian = (lines: TextLine[]): number => {
  const hs = lines.map((l) => l.h).sort((a, b) => a - b);
  return hs[hs.length >> 1] ?? 1;
};

/** Siguiente línea de la misma página, si está razonablemente cerca. */
function nextLine(lines: TextLine[], i: number): TextLine | undefined {
  const cur = lines[i];
  const nxt = lines[i + 1];
  if (!cur || !nxt || nxt.page !== cur.page) return undefined;
  return nxt.y - (cur.y + cur.h) < cur.h * 3 ? nxt : undefined;
}

// ─── RUC ─────────────────────────────────────────────────────────────────────

interface RucCandidate {
  ruc: string;
  valid: boolean;
  client: boolean;
  line: number;
  relY: number;
  page: number;
}

function findRucCandidates(lines: TextLine[]): RucCandidate[] {
  const out: RucCandidate[] = [];
  lines.forEach((line, i) => {
    // OCR suele partir el número con espacios: "20 123456789".
    const compact = line.text.replace(/(\d)[\s.](?=\d)/g, '$1');
    const context = norm(`${lines[i - 1]?.text ?? ''} ${line.text}`);
    for (const m of compact.matchAll(/(?<!\d)((?:10|15|17|20)\d{9})(?!\d)/g)) {
      out.push({
        ruc: m[1]!,
        valid: isValidRuc(m[1]!),
        client: CLIENT_RE.test(context),
        line: i,
        relY: line.relY,
        page: line.page,
      });
    }
  });
  return out;
}

interface RucExtraction {
  emisor: Candidate<string> | null;
  adquirente: Candidate<string> | null;
  /** Línea del RUC emisor (ancla para la razón social). */
  emisorLine: number;
  /** Línea del RUC adquirente (su bloque se excluye de la razón social). */
  adquirenteLine: number;
}

/**
 * Separa RUC emisor y adquirente. Si se conoce el RUC del comprador (`buyerRuc`),
 * cualquier aparición suya es el adquirente y nunca puede ser el emisor.
 */
function extractRuc(lines: TextLine[], buyerRuc?: string): RucExtraction {
  const cands = findRucCandidates(lines);
  const buyerHit = buyerRuc ? cands.find((c) => c.ruc === buyerRuc) : undefined;
  const emisorCands = buyerRuc ? cands.filter((c) => c.ruc !== buyerRuc) : cands;

  const score = (c: RucCandidate) => (c.valid ? 2 : 0) + (c.client ? -1.5 : 0) - c.page - c.relY;
  const best = [...emisorCands].sort((a, b) => score(b) - score(a))[0];
  const emisor = best ? { value: best.ruc, confidence: !best.valid ? 0.3 : best.client ? 0.5 : 0.85 } : null;

  // Adquirente: el RUC esperado si aparece; si no, el mejor candidato con etiqueta de cliente.
  const others = cands.filter((c) => c.ruc !== best?.ruc && c.valid);
  const adqCand = buyerHit ?? others.find((c) => c.client) ?? others[0];
  const adquirente = adqCand
    ? { value: adqCand.ruc, confidence: adqCand === buyerHit ? 0.9 : adqCand.client ? 0.7 : 0.45 }
    : null;

  return { emisor, adquirente, emisorLine: best?.line ?? -1, adquirenteLine: adqCand?.line ?? -1 };
}

// ─── Correlativo ─────────────────────────────────────────────────────────────

function extractCorrelativo(lines: TextLine[]): Candidate<string> | null {
  for (const [i, line] of lines.entries()) {
    const text = norm(line.text);
    for (const m of text.matchAll(CORRELATIVO_RE)) {
      const value = normalizeCorrelativo(m[1]!, m[2]!);
      if (!value) continue;
      const context = `${norm(lines[i - 1]?.text ?? '')} ${text}`;
      const labeled = /FACTURA|BOLETA|NOTA DE|N[°º.O]|NRO|NUMERO|ELECTRONICA/.test(context);
      return { value, confidence: labeled && line.relY < 0.4 ? 0.85 : 0.65 };
    }
  }
  return null;
}

// ─── Fecha de emisión ────────────────────────────────────────────────────────

function extractFecha(lines: TextLine[]): Candidate<string> | null {
  const labelRe = /FECHA\s*(?:DE\s*)?EMISION|F\.\s*EMISION|FECHA\s*EMIS/;
  for (const [i, line] of lines.entries()) {
    const text = norm(line.text);
    const m = labelRe.exec(text);
    if (!m) continue;
    const after = line.text.slice(m.index + m[0].length);
    const date = findDates(after)[0] ?? findDates(nextLine(lines, i)?.text ?? '')[0];
    if (date) return { value: date, confidence: 0.9 };
  }
  // Etiqueta genérica "Fecha" (evitando vencimiento).
  for (const line of lines) {
    const text = norm(line.text);
    if (/FECHA/.test(text) && !/VENC|PAGO|CUOTA/.test(text)) {
      const date = findDates(line.text)[0];
      if (date) return { value: date, confidence: 0.7 };
    }
  }
  const first = findDates(lines.map((l) => l.text).join('\n'))[0];
  return first ? { value: first, confidence: 0.5 } : null;
}

// ─── Montos ──────────────────────────────────────────────────────────────────

/** Monto más a la derecha tras la etiqueta, o en la línea siguiente. */
function amountAfterLabel(lines: TextLine[], i: number, labelEnd: number): number | null {
  const line = lines[i]!;
  const same = findAmounts(line.text.slice(labelEnd));
  if (same.length) return same.at(-1)!;
  const nxt = nextLine(lines, i);
  if (nxt && !/[A-Z]{4,}/.test(norm(nxt.text).replace(/SOLES|S\/|US\$|USD|PEN/g, ''))) {
    const next = findAmounts(nxt.text);
    if (next.length) return next.at(-1)!;
  }
  return null;
}

function findLabeledAmounts(lines: TextLine[], labelRe: RegExp, excludeRe?: RegExp): number[] {
  const out: number[] = [];
  for (const [i, line] of lines.entries()) {
    const text = norm(line.text);
    const m = labelRe.exec(text);
    if (!m || excludeRe?.test(text)) continue;
    const n = amountAfterLabel(lines, i, m.index + m[0].length);
    if (n !== null) out.push(n);
  }
  return out;
}

const TOTAL_STRONG_RE = /IMPORTE\s*TOTAL|TOTAL\s*A\s*PAGAR|MONTO\s*TOTAL|TOTAL\s*(?:DE\s*LA\s*)?VENTA|TOTAL\s*PRECIO\s*DE\s*VENTA|TOTAL\s*FACTURA/;
const TOTAL_WEAK_RE = /\bTOTAL\b/;
const TOTAL_EXCLUDE_RE =
  /SUB\s*-?\s*TOTAL|GRAVAD|EXONERAD|INAFECT|GRATUIT|DESCUENTO|ANTICIPO|VALOR|I\.?G\.?V|ISC|ICBPER|OTROS|PERCEP|DETRAC|RETENC|CANT|ITEM|PESO|NETO\s*PENDIENTE|CUOTA/;
// El OCR confunde la I con 1, L o |.
const IGV_RE = /(?<![A-Z0-9])[I1L|]\.?\s?G\.?\s?V\.?(?![A-Z])|IMPUESTO\s*GENERAL/;
const IGV_EXCLUDE_RE = /INCLUYE|INC\.|INCLUIDO|AFECTO|SIN\s*IGV|TOTAL\s*A\s*PAGAR|IMPORTE\s*TOTAL/;
const BASE_RE = /OP\.?\s*GRAVADAS?|OPERACI\w*\s*GRAVADAS?|TOTAL\s*GRAVADO|VALOR\s*(?:DE\s*)?VENTA|SUB\s*-?\s*TOTAL/;

function extractAmounts(lines: TextLine[]) {
  const strong = findLabeledAmounts(lines, TOTAL_STRONG_RE);
  const weak = findLabeledAmounts(lines, TOTAL_WEAK_RE, TOTAL_EXCLUDE_RE);
  const total: Candidate<number> | null = strong.length
    ? { value: strong.at(-1)!, confidence: 0.85 }
    : weak.length
      ? { value: Math.max(...weak), confidence: 0.65 }
      : null;

  const igvs = findLabeledAmounts(lines, IGV_RE, IGV_EXCLUDE_RE).filter((n) => !total || n < total.value);
  const igv: Candidate<number> | null = igvs.length ? { value: igvs.at(-1)!, confidence: 0.75 } : null;

  const bases = findLabeledAmounts(lines, BASE_RE).filter((n) => n > 0 && (!total || n <= total.value));
  return { total, igv, base: bases.at(-1) ?? null };
}

// ─── Razón social ────────────────────────────────────────────────────────────

const COMPANY_SUFFIX_RE =
  /(?:^|\s)(S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?\s?A\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?C\.?\s?R\.?\s?L\.?|S\.?\s?A\.?|SOCIEDAD ANONIMA(?: CERRADA)?|EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA)(?=$|[\s\-–,(])/;
const NOT_NAME_RE =
  /FACTURA|BOLETA|NOTA DE|ELECTRONICA|R\.?\s?U\.?\s?C|DIRECCION|DOMICILIO|TELEF|CEL\b|AV\.|AVENIDA|JR\.|JIRON|CALLE|MZ|LOTE|URB\.|WWW|HTTP|@|E-?MAIL|CORREO|FECHA|PAGINA|SUNAT|REPRESENTACION|IMPRESA|AUTORIZAD|RESOLUCION|SEDE|SUCURSAL|PRINCIPAL|LIMA|PERU|OFICINA|DEPARTAMENTO/;

function cleanName(s: string): string {
  return s
    .replace(/\b(?:R\.?\s?U\.?\s?C\.?|RUC)\b.*$/i, '')
    .replace(/^(?:EMISOR|RAZ[OÓ]N SOCIAL)\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRazonSocial(lines: TextLine[], emisorRucLine: number, adquirenteLine: number): Candidate<string> | null {
  const header = lines.filter((l) => l.page === 0 && l.relY < 0.4);
  if (!header.length) return null;
  const medianH = lineHeightMedian(header);

  let best: { value: string; score: number; suffix: boolean } | null = null;
  for (const line of header) {
    const idx = lines.indexOf(line);
    const text = norm(line.text);
    const prev = norm(lines[idx - 1]?.text ?? '');
    const value = cleanName(line.text);
    const letters = value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').length;
    if (letters < 4 || value.length > 120 || letters / value.length < 0.6) continue;
    if (CLIENT_RE.test(text) || /^(SENOR|CLIENTE)/.test(prev)) continue;
    // Bloque del adquirente: su nombre suele ir en la línea del RUC o justo encima.
    if (adquirenteLine >= 0 && idx <= adquirenteLine && adquirenteLine - idx <= 1) continue;

    const suffix = COMPANY_SUFFIX_RE.test(norm(value));
    let score = 0;
    if (suffix) score += 2;
    if (NOT_NAME_RE.test(norm(value))) score -= 3;
    score += Math.min(line.h / medianH - 1, 2);
    score += (0.4 - line.relY) * 2;
    if (emisorRucLine >= 0 && idx < emisorRucLine && emisorRucLine - idx <= 5) score += 0.5;

    if (!best || score > best.score) best = { value, score, suffix };
  }
  if (!best || best.score < 0) return null;
  return { value: best.value, confidence: best.suffix ? 0.8 : 0.55 };
}

// ─── Descripción ─────────────────────────────────────────────────────────────

const DESC_HEADER_RE = /DESCRIPCI/;
const COLUMN_WORDS_RE = /CANT|UNID|U\.?\s?M\b|P\.?\s?UNIT|PRECIO|IMPORTE|VALOR|TOTAL|COD|ITEM|MEDIDA/;
const TABLE_END_RE =
  /^(?:SON\b|SON:|SUB\s*-?\s*TOTAL|TOTAL|OP\.?\s*GRAV|OP\.?\s*EXON|OP\.?\s*INAF|OPERACI|IMPORTE\s*TOTAL|OBSERVACI|I\.?G\.?V|VALOR\s*(?:DE\s*)?VENTA|DESCUENTO|OTROS\s*CARGOS|CUOTA|FORMA\s*DE\s*PAGO|MONTO\s*NETO|INFORMACI|CONDICI|REPRESENTACI|ANTICIPO|GRAVAD|EXONERAD|INAFECT)/;
const UNIT_RE = /^(?:\d+(?:[.,]\d+)?\s+)?(?:(?:UND|UNID|UNIDAD(?:ES)?|NIU|ZZ|KGM?|LTR?|GLN|SERV(?:ICIO)?|H87|BX|PK|DOC|MTR|M)\b\.?\s+)?/i;

/** Quita cantidades/unidades iniciales y montos finales de una fila sin columnas claras. */
const TRAILING_AMOUNTS_RE = /(?:\s+(?:S\/\.?\s*)?\d[\d,]*[.,]\d{2})+\s*$/;
const DECIMAL_AMOUNT_RE = /\d[.,]\d{2}\b/g;

function stripNumbers(s: string): string {
  let out = s.replace(UNIT_RE, '').replace(/^\d{1,3}\s+(?=[A-Za-zÁÉÍÓÚÑ])/, '');
  const trailing = TRAILING_AMOUNTS_RE.exec(out)?.[0] ?? '';
  out = out.slice(0, out.length - trailing.length);
  // Un solo monto al final (ticket: "PRODUCTO 2 7.00"): el entero previo es la cantidad.
  // Con precio + importe, la cantidad va al inicio y un número final es parte del nombre ("IdeaPad 15").
  if ((trailing.match(DECIMAL_AMOUNT_RE) ?? []).length === 1) out = out.replace(/\s+\d{1,4}\s*$/, '');
  return out.trim();
}

const hasLetters = (s: string) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(s);

function extractDescripcion(lines: TextLine[]): Candidate<string> | null {
  const headerIdx = lines.findIndex(
    (l) => DESC_HEADER_RE.test(norm(l.text)) && COLUMN_WORDS_RE.test(norm(l.text).replace(/DESCRIPCI\w*/, '')),
  );
  const idx = headerIdx >= 0 ? headerIdx : lines.findIndex((l) => DESC_HEADER_RE.test(norm(l.text)));
  if (idx < 0) return extractDescripcionSinCabecera(lines);
  const header = lines[idx]!;

  // Límites de la columna: entre el item anterior y el siguiente de la cabecera.
  const descPos = header.items.findIndex((it) => DESC_HEADER_RE.test(norm(it.str)));
  const descItem = header.items[descPos];
  const isOwnColumn = descItem !== undefined && !COLUMN_WORDS_RE.test(norm(descItem.str).replace(/DESCRIPCI\w*/, ''));
  const prev = header.items[descPos - 1];
  const next = header.items[descPos + 1];
  const bounds = isOwnColumn
    ? { left: prev ? prev.x + prev.w : -Infinity, right: next ? next.x : Infinity }
    : null;

  const inColumn = (it: TextItem) => {
    if (!bounds) return false;
    const cx = it.x + it.w / 2;
    return cx > bounds.left && cx < bounds.right;
  };

  const entries: string[] = [];
  const medianH = lineHeightMedian(lines);
  let lastBottom = header.y + header.h;
  for (let i = idx + 1; i < lines.length && i <= idx + 40; i++) {
    const row = lines[i]!;
    if (row.page !== header.page) break;
    if (row.y - lastBottom > medianH * 4) break;
    if (TABLE_END_RE.test(norm(row.text))) break;
    lastBottom = row.y + row.h;

    let text: string;
    let otherCols: boolean;
    // Un item que empieza en la columna y termina muy a la derecha es una fila entera en un
    // solo item (pdf.js). Montos alineados a la derecha que apenas rozan el borde no cuentan.
    const width = bounds ? bounds.right - bounds.left : 0;
    const spansColumns =
      bounds && row.items.some((it) => it.x < bounds.right && it.x + it.w > bounds.right + width * 0.25);
    if (bounds && !spansColumns) {
      text = row.items.filter(inColumn).map((it) => it.str).join(' ').trim();
      otherCols = row.items.some((it) => !inColumn(it) && /\d/.test(it.str));
    } else {
      text = stripNumbers(row.text);
      otherCols = /\d/.test(row.text.replace(text, ''));
    }
    if (!hasLetters(text)) continue;

    if (otherCols || entries.length === 0) entries.push(text);
    else entries[entries.length - 1] += ` ${text}`;
  }

  if (!entries.length) return null;
  const value = entries.join('; ').replace(/\s+/g, ' ').slice(0, 500);
  return { value, confidence: bounds ? 0.75 : 0.6 };
}

/**
 * Respaldo cuando no se encuentra la cabecera "Descripción" (el OCR a veces omite la
 * fila de cabecera dentro de un recuadro): los ítems son las filas con montos que están
 * justo encima de los totales; las líneas sin montos debajo de un ítem son su continuación.
 */
function extractDescripcionSinCabecera(lines: TextLine[]): Candidate<string> | null {
  const endIdx = lines.findIndex((l) => l.relY > 0.15 && TABLE_END_RE.test(norm(l.text)));
  if (endIdx < 1) return null;
  const medianH = lineHeightMedian(lines);

  const entries: string[] = [];
  let pending: string[] = [];
  let below = lines[endIdx]!;
  for (let i = endIdx - 1; i >= 0; i--) {
    const row = lines[i]!;
    const gap = below.y - (row.y + row.h);
    if (row.page !== below.page || gap > medianH * (entries.length ? 3 : 6)) break;
    const hasAmount = /\d[.,]\d{2}\b/.test(row.text);
    const text = stripNumbers(row.text);
    if (hasAmount && hasLetters(text)) {
      entries.unshift([text, ...pending].join(' '));
      pending = [];
    } else if (!hasAmount && hasLetters(row.text) && !row.text.includes(':')) {
      pending.unshift(row.text.trim());
    } else {
      break;
    }
    below = row;
  }

  if (!entries.length) return null;
  return { value: entries.join('; ').replace(/\s+/g, ' ').slice(0, 500), confidence: 0.45 };
}

// ─── Otros ───────────────────────────────────────────────────────────────────

function detectTipo(text: string): string | null {
  if (/NOTA\s*DE\s*CREDITO/.test(text)) return '07';
  if (/NOTA\s*DE\s*DEBITO/.test(text)) return '08';
  if (/FACTURA/.test(text)) return '01';
  if (/BOLETA/.test(text)) return '03';
  return null;
}

function detectMoneda(text: string): string | null {
  if (/DOLARES|US\$|\bUSD\b/.test(text)) return 'USD';
  if (/SOLES|S\/|\bPEN\b/.test(text)) return 'PEN';
  return null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export function extractFromText(doc: DocText, options: ExtractOptions = {}): TextExtraction {
  const { lines } = doc;
  const upper = norm(doc.fullText);
  const ruc = extractRuc(lines, options.buyerRuc);
  const amounts = extractAmounts(lines);

  return {
    razonSocial: extractRazonSocial(lines, ruc.emisorLine, ruc.adquirenteLine),
    ruc: ruc.emisor,
    correlativo: extractCorrelativo(lines),
    fechaEmision: extractFecha(lines),
    montoTotal: amounts.total,
    igv: amounts.igv,
    descripcion: extractDescripcion(lines),
    baseImponible: amounts.base,
    rucAdquirente: ruc.adquirente,
    moneda: detectMoneda(upper),
    tipoComprobante: detectTipo(upper),
  };
}

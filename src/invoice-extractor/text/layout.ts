/**
 * Modelo de texto con posición, común a pdf.js y OCR, y agrupación en líneas.
 * Coordenadas en píxeles de página, origen arriba-izquierda (y crece hacia abajo).
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Confianza 0..1 (OCR). pdf.js siempre 1. */
  conf: number;
}

export interface PageText {
  width: number;
  height: number;
  items: TextItem[];
  /** Cada item es una palabra completa (OCR): se unen siempre con espacio. */
  wordLevel?: boolean;
}

export interface TextLine {
  text: string;
  items: TextItem[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Índice de página (0-based). */
  page: number;
  /** Posición vertical relativa en su página, 0 (arriba) .. 1 (abajo). */
  relY: number;
}

export interface DocText {
  lines: TextLine[];
  /** Texto completo, una línea por renglón. */
  fullText: string;
  /** Confianza media del texto (OCR); 1 para pdf.js. */
  meanConf: number;
}

/** Une los items de una línea: sin espacio si están pegados (pdf.js corta palabras), salvo en OCR. */
function joinItems(items: TextItem[], wordLevel = false): string {
  if (wordLevel) return items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
  let out = '';
  let prev: TextItem | undefined;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const glue = gap > Math.min(prev.h, it.h) * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ');
      if (glue) out += ' ';
    }
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Agrupa items en líneas por solapamiento vertical de su centro.
 * Robusto a pequeñas inclinaciones y a items de distinto tamaño de fuente.
 */
export function groupLines(page: PageText, pageIndex = 0): TextLine[] {
  const items = page.items.filter((it) => it.str.trim() !== '').sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));

  const buckets: TextItem[][] = [];
  for (const it of items) {
    const cy = it.y + it.h / 2;
    const bucket = buckets.at(-1);
    const ref = bucket ? median(bucket.map((b) => b.y + b.h / 2)) : Number.NaN;
    const refH = bucket ? median(bucket.map((b) => b.h)) : 0;
    if (bucket && Math.abs(cy - ref) <= Math.max(refH, it.h) * 0.5) bucket.push(it);
    else buckets.push([it]);
  }

  return buckets.map((bucket) => {
    const sorted = [...bucket].sort((a, b) => a.x - b.x);
    const x = Math.min(...sorted.map((i) => i.x));
    const y = Math.min(...sorted.map((i) => i.y));
    const right = Math.max(...sorted.map((i) => i.x + i.w));
    const bottom = Math.max(...sorted.map((i) => i.y + i.h));
    return {
      text: joinItems(sorted, page.wordLevel),
      items: sorted,
      x,
      y,
      w: right - x,
      h: bottom - y,
      page: pageIndex,
      relY: page.height > 0 ? y / page.height : 0,
    };
  });
}

export function buildDocText(pages: PageText[]): DocText {
  const lines = pages.flatMap((p, i) => groupLines(p, i));
  const allItems = pages.flatMap((p) => p.items);
  const meanConf = allItems.length ? allItems.reduce((a, it) => a + it.conf, 0) / allItems.length : 0;
  return { lines, fullText: lines.map((l) => l.text).join('\n'), meanConf };
}

/** Cantidad de caracteres útiles: decide si un PDF tiene capa de texto real. */
export const meaningfulChars = (doc: DocText): number => doc.fullText.replace(/[\s\W_]/g, '').length;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

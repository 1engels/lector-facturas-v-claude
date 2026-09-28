/**
 * Parsers de valores sueltos (montos, fechas, correlativos). Puros y testeables.
 */

/** Texto que parece un monto: 1,234.56 · 1.234,56 · 1234.5 · S/ 45.00 */
export const AMOUNT_RE = /(?<![\d.,])(?:S\/\.?|US\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d%])/g;

/** Convierte un monto impreso a número, detectando el separador decimal. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decimalPos = Math.max(lastDot, lastComma);
  const decimals = decimalPos >= 0 ? s.length - decimalPos - 1 : 0;

  if (decimalPos >= 0 && decimals > 0 && decimals <= 2) {
    const intPart = s.slice(0, decimalPos).replace(/[.,]/g, '');
    s = `${intPart}.${s.slice(decimalPos + 1)}`;
  } else {
    // Sin parte decimal: los separadores son de miles (o sobra el separador final).
    s = s.replace(/[.,]/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Todos los montos de un texto (ignora porcentajes y números pegados a letras). */
export function findAmounts(text: string): number[] {
  const out: number[] = [];
  // Los porcentajes ("IGV 18.00%") no son montos.
  const clean = text.replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
  for (const m of clean.matchAll(AMOUNT_RE)) {
    const n = parseAmount(m[1]!);
    if (n !== null) out.push(n);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Fechas reconocidas: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, "26 de setiembre de 2026", "26-SET-2026". */
export const DATE_RE =
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b|\b(\d{1,2})(?:\s+de\s+|[\s/-])([a-záéíóú]{3,10})\.?(?:\s+del?\s+|[\s/-])(\d{4})\b/gi;

export function parseDateMatch(m: RegExpMatchArray): string | null {
  if (m[1]) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (m[4]) return toIso(Number(m[6]), Number(m[5]), Number(m[4]));
  if (m[7]) {
    const month = MONTHS[m[8]!.slice(0, 3).toLowerCase()];
    return month ? toIso(Number(m[9]), month, Number(m[7])) : null;
  }
  return null;
}

export function findDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const iso = parseDateMatch(m);
    if (iso) out.push(iso);
  }
  return out;
}

export const parseDate = (text: string): string | null => findDates(text)[0] ?? null;

/** Serie (F/B/E + 3 alfanuméricos) - número. Tolera espacios y guiones largos. */
export const CORRELATIVO_RE = /\b([FBE][A-Z0-9]{3})\s*[-–—]\s*(\d{1,8})\b/g;

/** Normaliza a SERIE-NÚMERO, sin ceros a la izquierda en el número. */
export function normalizeCorrelativo(serie: string, numero: string): string | null {
  const s = serie.toUpperCase().replace(/(?<=^[FBE].*)O/g, '0');
  const n = numero.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!/^[A-Z0-9]{4}$/.test(s) || !/^\d{1,8}$/.test(n)) return null;
  return `${s}-${n}`;
}

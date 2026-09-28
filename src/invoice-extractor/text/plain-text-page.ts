import type { PageText, TextItem } from './layout';

/**
 * Construye un PageText a partir de texto plano con columnas alineadas por espacios.
 * Pensado para tests: cada bloque separado por 2+ espacios es un item.
 */
export function pageFromPlainText(text: string, charW = 6, lineH = 12): PageText {
  const rows = text.split('\n');
  const items: TextItem[] = [];
  rows.forEach((row, r) => {
    for (const m of row.matchAll(/\S+(?: \S+)*/g)) {
      items.push({ str: m[0], x: m.index * charW, y: r * lineH * 1.5, w: m[0].length * charW, h: lineH, conf: 1 });
    }
  });
  return { width: 120 * charW, height: rows.length * lineH * 1.5, items };
}

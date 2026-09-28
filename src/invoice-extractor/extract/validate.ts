/**
 * Validaciones de dominio (SUNAT). Funciones puras, sin DOM ni dependencias:
 * se reutilizan en el cliente (confianza de campos, UI) y en el backend.
 */

const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Tasas de IGV vigentes: general 18% y 10% (MYPE restaurantes/hoteles, Ley 31556). */
export const IGV_RATES = [0.18, 0.1] as const;

/** Tolerancia de redondeo para montos (céntimos). */
const AMOUNT_TOLERANCE = 0.02;

/** RUC: prefijo válido + dígito verificador módulo 11. */
export function isValidRuc(ruc: string): boolean {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  const digits = [...ruc].map(Number);
  const sum = RUC_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  const check = (11 - (sum % 11)) % 10;
  return check === digits[10];
}

export const roundMoney = (n: number): number => Math.round(n * 100) / 100;

export const nearlyEqual = (a: number, b: number, tolerance = AMOUNT_TOLERANCE): boolean =>
  Math.abs(a - b) <= tolerance;

export interface AmountsCheck {
  /** true: cuadran; false: no cuadran; null: no hay datos suficientes. */
  consistent: boolean | null;
  /** Tasa de IGV inferida, si coincide con una tasa vigente. */
  rate: number | null;
}

/**
 * Cruza base imponible, IGV y total.
 * - Con base: base + IGV ≈ total (si no, puede haber exonerados/ICBPER: se reporta como no consistente).
 * - Sin base: se infiere la base como total − IGV y se busca una tasa vigente.
 */
export function checkAmounts(input: { base?: number | null; igv?: number | null; total?: number | null }): AmountsCheck {
  const { igv, total } = input;
  if (igv == null || total == null) return { consistent: null, rate: null };
  if (igv > total) return { consistent: false, rate: null };
  if (igv === 0) return { consistent: true, rate: 0 }; // exonerado / inafecto / RUS

  const base = input.base ?? roundMoney(total - igv);
  const sumOk = nearlyEqual(base + igv, total);
  const rate = IGV_RATES.find((r) => nearlyEqual(base * r, igv, Math.max(AMOUNT_TOLERANCE, base * 0.0005))) ?? null;

  return { consistent: sumOk && rate !== null, rate };
}

/** Fecha ISO (YYYY-MM-DD) real, no futura y posterior a 2000. */
export function isPlausibleIsoDate(iso: string, today = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  const tomorrow = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return y >= 2000 && date.getTime() <= tomorrow;
}

// ─── Adquirente ──────────────────────────────────────────────────────────────

export type BuyerCheck = 'match' | 'mismatch' | 'missing';

/** ¿El comprobante está dirigido a la empresa esperada? */
export function checkBuyer(rucAdquirente: string | null | undefined, expectedRuc: string): BuyerCheck {
  const doc = rucAdquirente?.replace(/\s/g, '');
  if (!doc) return 'missing';
  return doc === expectedRuc ? 'match' : 'mismatch';
}

/** Mensaje de error si el adquirente no es la empresa esperada; null si coincide. */
export function buyerMismatchMessage(rucAdquirente: string | null | undefined, expectedRuc: string): string | null {
  switch (checkBuyer(rucAdquirente, expectedRuc)) {
    case 'match':
      return null;
    case 'missing':
      return `El comprobante no indica el RUC del adquirente; debe estar dirigido al RUC ${expectedRuc}.`;
    case 'mismatch': {
      const kind = /^\d{11}$/.test(rucAdquirente!) ? 'RUC' : 'documento';
      return `El comprobante está dirigido al ${kind} ${rucAdquirente}, no al RUC ${expectedRuc}.`;
    }
  }
}

export interface InvoiceLike {
  ruc?: string | null;
  rucAdquirente?: string | null;
  fechaEmision?: string | null;
  montoTotal?: number | null;
  igv?: number | null;
  baseImponible?: number | null;
}

export interface ValidateOptions {
  /** RUC de la empresa a la que deben estar dirigidos los comprobantes. */
  expectedBuyerRuc?: string;
  today?: Date;
}

/**
 * Reglas de negocio que van más allá del formato (el esquema zod cubre el formato).
 * Devuelve mensajes legibles; lista vacía = sin observaciones.
 */
export function validateInvoice(inv: InvoiceLike, options: ValidateOptions = {}): string[] {
  const { expectedBuyerRuc, today = new Date() } = options;
  const issues: string[] = [];
  if (inv.ruc && !isValidRuc(inv.ruc)) issues.push('El RUC del emisor no pasa el dígito verificador.');
  if (expectedBuyerRuc) {
    const buyer = buyerMismatchMessage(inv.rucAdquirente, expectedBuyerRuc);
    if (buyer) issues.push(buyer);
    if (inv.ruc && inv.ruc === expectedBuyerRuc) issues.push('El RUC emisor es el de tu empresa: el comprobante lo emitió tu empresa, no un proveedor.');
  }
  if (inv.fechaEmision && !isPlausibleIsoDate(inv.fechaEmision, today)) {
    issues.push('La fecha de emisión no es válida o está en el futuro.');
  }
  const amounts = checkAmounts({ base: inv.baseImponible, igv: inv.igv, total: inv.montoTotal });
  if (amounts.consistent === false) {
    issues.push('El IGV no cuadra con el total (revisar montos, o puede haber operaciones exoneradas/inafectas).');
  }
  return issues;
}

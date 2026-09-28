import { describe, expect, it } from 'vitest';
import { buyerMismatchMessage, checkAmounts, checkBuyer, isPlausibleIsoDate, isValidRuc, validateInvoice } from './validate';

describe('isValidRuc', () => {
  it.each(['20131312955', '20601234565', '10456789124', '20500000008'])('acepta %s', (ruc) => {
    expect(isValidRuc(ruc)).toBe(true);
  });

  it.each([
    ['dígito verificador errado', '20131312954'],
    ['prefijo inválido', '30131312955'],
    ['longitud', '2013131295'],
    ['no numérico', '2013131295A'],
  ])('rechaza %s', (_, ruc) => {
    expect(isValidRuc(ruc)).toBe(false);
  });
});

describe('checkAmounts', () => {
  it('cuadra con IGV 18%', () => {
    expect(checkAmounts({ base: 100, igv: 18, total: 118 })).toEqual({ consistent: true, rate: 0.18 });
  });

  it('cuadra con IGV 10% (MYPE restaurantes/hoteles)', () => {
    expect(checkAmounts({ igv: 10, total: 110 })).toEqual({ consistent: true, rate: 0.1 });
  });

  it('tolera redondeo de céntimos', () => {
    expect(checkAmounts({ igv: 7.63, total: 50 }).consistent).toBe(true);
  });

  it('detecta montos inconsistentes', () => {
    expect(checkAmounts({ base: 100, igv: 18, total: 150 }).consistent).toBe(false);
    expect(checkAmounts({ igv: 200, total: 100 }).consistent).toBe(false);
  });

  it('sin datos devuelve null', () => {
    expect(checkAmounts({ total: 100 }).consistent).toBeNull();
  });

  it('IGV 0 (exonerado) es consistente', () => {
    expect(checkAmounts({ igv: 0, total: 80 }).consistent).toBe(true);
  });
});

describe('isPlausibleIsoDate', () => {
  const today = new Date(2026, 8, 26);
  it('acepta fechas reales pasadas', () => expect(isPlausibleIsoDate('2026-02-28', today)).toBe(true));
  it('rechaza fechas imposibles', () => expect(isPlausibleIsoDate('2026-02-30', today)).toBe(false));
  it('rechaza fechas futuras', () => expect(isPlausibleIsoDate('2027-01-01', today)).toBe(false));
});

describe('validateInvoice', () => {
  it('sin observaciones para datos coherentes', () => {
    expect(validateInvoice({ ruc: '20131312955', fechaEmision: '2026-01-15', montoTotal: 118, igv: 18 })).toEqual([]);
  });

  it('reporta RUC y montos', () => {
    expect(validateInvoice({ ruc: '20131312954', montoTotal: 100, igv: 50 })).toHaveLength(2);
  });
});

describe('adquirente (empresa compradora)', () => {
  const BUYER = '20601932246';

  it('checkBuyer', () => {
    expect(checkBuyer(BUYER, BUYER)).toBe('match');
    expect(checkBuyer('20601 932246', BUYER)).toBe('match');
    expect(checkBuyer('20131312955', BUYER)).toBe('mismatch');
    expect(checkBuyer('45678912', BUYER)).toBe('mismatch');
    expect(checkBuyer(null, BUYER)).toBe('missing');
  });

  it('mensajes', () => {
    expect(buyerMismatchMessage(BUYER, BUYER)).toBeNull();
    expect(buyerMismatchMessage('20131312955', BUYER)).toContain('RUC 20131312955');
    expect(buyerMismatchMessage('45678912', BUYER)).toContain('documento 45678912');
  });

  it('validateInvoice exige el adquirente y detecta comprobantes emitidos por la propia empresa', () => {
    const base = { ruc: '20601234565', fechaEmision: '2026-01-15', montoTotal: 118, igv: 18 };
    expect(validateInvoice({ ...base, rucAdquirente: BUYER }, { expectedBuyerRuc: BUYER })).toEqual([]);
    expect(validateInvoice({ ...base, rucAdquirente: '20131312955' }, { expectedBuyerRuc: BUYER })).toHaveLength(1);
    expect(validateInvoice({ ...base, ruc: BUYER, rucAdquirente: BUYER }, { expectedBuyerRuc: BUYER })).toHaveLength(1);
  });
});

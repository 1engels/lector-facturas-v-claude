import { describe, expect, it } from 'vitest';
import { findAmounts, findDates, normalizeCorrelativo, parseAmount } from './parse';

describe('parseAmount', () => {
  it.each([
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['S/ 45.00', 45],
    ['118', 118],
    ['12,5', 12.5],
    ['1,234', 1234],
    ['1.234.567,8', 1234567.8],
  ])('%s → %d', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it('devuelve null sin dígitos', () => expect(parseAmount('S/')).toBeNull());
});

describe('findAmounts', () => {
  it('ignora porcentajes', () => {
    expect(findAmounts('IGV (18.00%) S/ 36.00')).toEqual([36]);
    expect(findAmounts('IGV 18% 36.00')).toEqual([36]);
  });

  it('no une cantidad y precio separados por espacio', () => {
    expect(findAmounts('1 180.00')).toEqual([1, 180]);
  });
});

describe('findDates', () => {
  it.each([
    ['Fecha: 26/09/2026', '2026-09-26'],
    ['26-09-2026', '2026-09-26'],
    ['2026-09-26', '2026-09-26'],
    ['5/1/26', '2026-01-05'],
    ['26 de setiembre de 2026', '2026-09-26'],
    ['26-SET-2026', '2026-09-26'],
  ])('%s', (text, iso) => {
    expect(findDates(text)[0]).toBe(iso);
  });
});

describe('normalizeCorrelativo', () => {
  it('quita ceros a la izquierda', () => expect(normalizeCorrelativo('F001', '00000123')).toBe('F001-123'));
  it('corrige O por 0 en la serie (OCR)', () => expect(normalizeCorrelativo('FOO1', '5')).toBe('F001-5'));
  it('rechaza series inválidas', () => expect(normalizeCorrelativo('F01', '5')).toBeNull());
});

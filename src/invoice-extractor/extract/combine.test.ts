import { describe, expect, it } from 'vitest';
import { bestOf, LOW_OCR_CONFIDENCE, needsFallback, ocrFactor, tagExtraction, weakFields } from './combine';
import type { TextExtraction } from './fields';
import { parseSunatQr } from './sunat-qr';

const empty: TextExtraction = {
  razonSocial: null,
  ruc: null,
  rucAdquirente: null,
  correlativo: null,
  fechaEmision: null,
  montoTotal: null,
  igv: null,
  descripcion: null,
  baseImponible: null,
  moneda: null,
  tipoComprobante: null,
};

const qr = parseSunatQr('20601234565|01|F001|123|36.00|236.00|2026-09-20|6|20601932246|h|');

describe('tagExtraction', () => {
  it('marca la fuente y escala la confianza', () => {
    const t = tagExtraction({ ...empty, ruc: { value: '20601234565', confidence: 0.8 } }, 'ocr', 0.5);
    expect(t.ruc).toEqual({ value: '20601234565', confidence: 0.4, source: 'ocr' });
  });

  it('ocrFactor va de 0.6 (confianza 0) a 1 (confianza 1)', () => {
    expect(ocrFactor(0)).toBe(0.6);
    expect(ocrFactor(1)).toBe(1);
  });
});

describe('weakFields / needsFallback', () => {
  it('con QR solo quedan como débiles la razón social y la descripción', () => {
    expect(weakFields(empty, qr)).toEqual(['razonSocial', 'descripcion']);
  });

  it('sin QR, todo lo vacío o con baja confianza es débil', () => {
    const t = { ...empty, razonSocial: { value: 'X S.A.C.', confidence: 0.9 }, descripcion: { value: 'Y', confidence: 0.4 } };
    expect(weakFields(t, null)).toContain('descripcion');
    expect(weakFields(t, null)).not.toContain('razonSocial');
  });

  it('en boletas, la falta de adquirente no es un campo débil', () => {
    const strong = { value: 'x', confidence: 0.9 };
    const boleta = {
      ...empty,
      razonSocial: strong,
      ruc: { value: '20500000008', confidence: 0.9 },
      correlativo: { value: 'B001-1', confidence: 0.9 },
      fechaEmision: strong,
      montoTotal: { value: 8.5, confidence: 0.9 },
      igv: { value: 1.3, confidence: 0.9 },
      descripcion: strong,
      tipoComprobante: '03',
    };
    expect(weakFields(boleta, null)).toEqual([]);
    expect(weakFields({ ...boleta, tipoComprobante: '01' }, null)).toEqual(['rucAdquirente']);
  });

  it('respaldo si la confianza global es baja o hay campos débiles', () => {
    expect(needsFallback(LOW_OCR_CONFIDENCE - 0.01, [])).toBe(true);
    expect(needsFallback(0.95, ['descripcion'])).toBe(true);
    expect(needsFallback(0.95, [])).toBe(false);
  });
});

describe('bestOf', () => {
  it('toma el candidato de mayor confianza por campo y completa huecos', () => {
    const a = { ...empty, razonSocial: { value: 'A S.A.C.', confidence: 0.5 }, moneda: 'PEN' };
    const b = { ...empty, razonSocial: { value: 'B S.A.C.', confidence: 0.7 }, descripcion: { value: 'Laptop', confidence: 0.6 } };
    const r = bestOf(a, b);
    expect(r.razonSocial?.value).toBe('B S.A.C.');
    expect(r.descripcion?.value).toBe('Laptop');
    expect(r.moneda).toBe('PEN');
  });

  it('si dos motores coinciden, sube la confianza (tope 0.95)', () => {
    const a = { ...empty, ruc: { value: '20601234565', confidence: 0.7, source: 'ia' as const } };
    const b = { ...empty, ruc: { value: '20601234565', confidence: 0.75, source: 'ocr' as const } };
    expect(bestOf(a, b).ruc).toEqual({ value: '20601234565', confidence: 0.85, source: 'ocr' });
    const c = { ...empty, ruc: { value: '20601234565', confidence: 0.9 } };
    expect(bestOf(c, c).ruc?.confidence).toBe(0.95);
  });
});

import { describe, expect, it } from 'vitest';
import { ocrFactor, tagExtraction } from './combine';
import type { TextExtraction } from './fields';
import { mergeResult } from './merge';
import { parseSunatQr } from './sunat-qr';

const raw: TextExtraction = {
  razonSocial: { value: 'COMERCIAL ANDINA S.A.C.', confidence: 0.8 },
  ruc: { value: '20601234565', confidence: 0.85 },
  correlativo: { value: 'F001-124', confidence: 0.85 },
  fechaEmision: { value: '2026-09-20', confidence: 0.9 },
  montoTotal: { value: 236, confidence: 0.85 },
  igv: { value: 36, confidence: 0.75 },
  descripcion: { value: 'Laptop', confidence: 0.75 },
  baseImponible: 200,
  rucAdquirente: { value: '20131312955', confidence: 0.7 },
  moneda: 'PEN',
  tipoComprobante: '01',
};
const pdfText = tagExtraction(raw, 'pdf-text');

const qr = parseSunatQr('20601234565|01|F001|123|36.00|236.00|2026-09-20|6|20131312955|h|');
const base = { inputKind: 'pdf-digital' as const, timings: {}, engines: ['qr', 'pdf-text'] };

describe('mergeResult', () => {
  it('QR tiene prioridad y se confirma con el texto', () => {
    const r = mergeResult({ ...base, qr, text: pdfText });
    expect(r.fields.ruc).toEqual({ value: '20601234565', source: 'qr', confidence: 1 });
    expect(r.fields.razonSocial.source).toBe('pdf-text');
    expect(r.fields.rucAdquirente).toEqual({ value: '20131312955', source: 'qr', confidence: 1 });
    expect(r.meta.buyerCheck).toBeNull();
    expect(r.meta.engines).toEqual(['qr', 'pdf-text']);
  });

  it('avisa cuando QR y texto discrepan', () => {
    const r = mergeResult({ ...base, qr, text: pdfText });
    expect(r.fields.correlativo.value).toBe('F001-123');
    expect(r.fields.correlativo.confidence).toBeLessThan(1);
    expect(r.meta.warnings.some((w) => w.includes('Correlativo'))).toBe(true);
  });

  it('respeta la fuente y la confianza de cada candidato; los montos coherentes la suben', () => {
    const ocr = tagExtraction(raw, 'ocr', ocrFactor(0.5));
    const r = mergeResult({ ...base, inputKind: 'image', qr: null, text: ocr, ocrConfidence: 0.5 });
    expect(r.fields.ruc.source).toBe('ocr');
    expect(r.fields.ruc.confidence).toBeCloseTo(0.85 * 0.8, 2);
    expect(r.fields.igv.confidence).toBeGreaterThan(0.75 * 0.8);
    expect(r.meta.ocrConfidence).toBe(0.5);
  });

  it('campos no encontrados quedan vacíos', () => {
    const r = mergeResult({ ...base, inputKind: 'image', qr: null, text: null });
    expect(r.fields.montoTotal).toEqual({ value: null, source: null, confidence: 0 });
  });
});

describe('mergeResult — adquirente', () => {
  const BUYER = '20601932246';
  const qrBuyer = parseSunatQr(`20601234565|01|F001|123|36.00|236.00|2026-09-20|6|${BUYER}|h|`);

  it('buyerCheck match / mismatch / missing', () => {
    const b = { ...base, text: null, buyerRuc: BUYER };
    expect(mergeResult({ ...b, qr: qrBuyer }).meta.buyerCheck).toBe('match');
    expect(mergeResult({ ...b, qr }).meta.buyerCheck).toBe('mismatch');
    expect(mergeResult({ ...b, qr: null }).meta.buyerCheck).toBe('missing');
  });
});

describe('mergeResult — base imponible mal leída', () => {
  it('si total e IGV cuadran sin la base, se recalcula la base y no se alerta', () => {
    const text = { ...pdfText, baseImponible: 236 }; // el motor confundió el total con la base
    const r = mergeResult({ ...base, inputKind: 'image', qr, text });
    expect(r.meta.baseImponible).toBe(200);
    expect(r.meta.warnings.some((w) => w.includes('IGV no cuadra'))).toBe(false);
  });
});

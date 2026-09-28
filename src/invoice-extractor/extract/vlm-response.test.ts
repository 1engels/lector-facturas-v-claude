import { describe, expect, it } from 'vitest';
import { parseVlmJson, vlmToExtraction } from './vlm-response';

const BUYER = '20601932246';

describe('parseVlmJson', () => {
  it('tolera bloques ```json, texto alrededor y comas finales', () => {
    const out = 'Aquí está:\n```json\n{ "ruc_emisor": "20601234565", "total": 236.00, }\n```';
    expect(parseVlmJson(out)).toEqual({ ruc_emisor: '20601234565', total: 236 });
  });

  it('devuelve null si no hay JSON', () => {
    expect(parseVlmJson('No puedo leer la imagen.')).toBeNull();
    expect(parseVlmJson('{ roto')).toBeNull();
  });
});

describe('vlmToExtraction', () => {
  const raw = {
    razon_social_emisor: 'COMERCIAL ANDINA S.A.C.',
    ruc_emisor: '20601234565',
    ruc_adquirente: BUYER,
    serie: 'F001',
    numero: '00000123',
    fecha_emision: '20/09/2026',
    moneda: 'Soles',
    subtotal: '200.00',
    igv: 'S/ 36.00',
    total: 236,
    descripcion: 'Laptop Lenovo; Instalación',
  };

  it('normaliza los valores y los marca con fuente IA', () => {
    const t = vlmToExtraction(raw, { buyerRuc: BUYER });
    expect(t.razonSocial).toEqual({ value: 'COMERCIAL ANDINA S.A.C.', confidence: 0.7, source: 'ia' });
    expect(t.correlativo?.value).toBe('F001-123');
    expect(t.fechaEmision?.value).toBe('2026-09-20');
    expect(t.igv?.value).toBe(36);
    expect(t.montoTotal?.value).toBe(236);
    expect(t.baseImponible).toBe(200);
    expect(t.moneda).toBe('PEN');
    expect(t.tipoComprobante).toBe('01');
    expect(t.rucAdquirente).toEqual({ value: BUYER, confidence: 0.85, source: 'ia' });
  });

  it('baja la confianza de un RUC inventado (dígito verificador inválido)', () => {
    expect(vlmToExtraction({ ruc_emisor: '20601234564' }).ruc?.confidence).toBe(0.25);
  });

  it('acepta el correlativo completo en un solo campo y descarta nulos', () => {
    const t = vlmToExtraction({ serie: 'F001-77', numero: null, razon_social_emisor: 'null', total: 'N/A' });
    expect(t.correlativo?.value).toBe('F001-77');
    expect(t.razonSocial).toBeNull();
    expect(t.montoTotal).toBeNull();
  });

  it('no repite el emisor como adquirente', () => {
    expect(vlmToExtraction({ ruc_emisor: '20601234565', ruc_adquirente: '20601234565' }).rucAdquirente).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { parseSunatQr } from './sunat-qr';

describe('parseSunatQr', () => {
  it('parsea el formato SUNAT', () => {
    const qr = parseSunatQr('20601234565|01|F001|00000123|36.00|236.00|2026-09-20|6|20131312955|abc123hash=|');
    expect(qr).toMatchObject({
      ruc: '20601234565',
      tipoComprobante: '01',
      correlativo: 'F001-123',
      igv: 36,
      montoTotal: 236,
      fechaEmision: '2026-09-20',
      docAdquirente: '20131312955',
    });
  });

  it('acepta fecha dd/mm/yyyy y boleta con DNI', () => {
    const qr = parseSunatQr('10456789124|03|B002|45|0.00|25.50|20/09/2026|1|45678912|');
    expect(qr).toMatchObject({ correlativo: 'B002-45', fechaEmision: '2026-09-20', igv: 0, docAdquirente: '45678912' });
  });

  it('ignora URLs y contenido ajeno', () => {
    expect(parseSunatQr('https://emisor.example.com/cpe/F001-123')).toBeNull();
  });

  it('rechaza RUC con dígito verificador errado', () => {
    expect(parseSunatQr('20601234564|01|F001|123|18.00|118.00|2026-09-20|6|20131312955|')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { Invoice, invoiceSchemaFor } from './schema';

const BUYER = '20601932246';
const invoice = {
  razonSocial: 'COMERCIAL ANDINA S.A.C.',
  ruc: '20601234565',
  rucAdquirente: BUYER,
  correlativo: 'F001-123',
  fechaEmision: '2026-09-20',
  montoTotal: 236,
  igv: 36,
  descripcion: 'Laptop',
};

describe('invoiceSchemaFor', () => {
  it('acepta comprobantes dirigidos a la empresa', () => {
    expect(invoiceSchemaFor(BUYER).safeParse(invoice).success).toBe(true);
  });

  it('rechaza otro adquirente con el error en rucAdquirente', () => {
    const r = invoiceSchemaFor(BUYER).safeParse({ ...invoice, rucAdquirente: '20131312955' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['rucAdquirente']);
  });

  it('el esquema base solo valida formato', () => {
    expect(Invoice.safeParse({ ...invoice, rucAdquirente: '20131312955' }).success).toBe(true);
    expect(Invoice.safeParse({ ...invoice, rucAdquirente: '45678912' }).success).toBe(false);
  });
});

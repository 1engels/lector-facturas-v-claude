import { describe, expect, it } from 'vitest';
import { InvoiceResult } from '../schema';
import { parseUblXml } from './xml';

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F001-00000123</cbc:ID>
  <cbc:IssueDate>2026-09-20</cbc:IssueDate>
  <cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20601234565</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[COMERCIAL ANDINA S.A.C.]]></cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20131312955</cbc:ID></cac:PartyIdentification>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">36.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">200.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">236.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cac:Item><cbc:Description><![CDATA[Laptop Lenovo]]></cbc:Description></cac:Item></cac:InvoiceLine>
  <cac:InvoiceLine><cac:Item><cbc:Description>Instalación</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;

describe('parseUblXml', () => {
  it('extrae todos los campos con confianza 1', () => {
    const r = parseUblXml(UBL)!;
    expect(InvoiceResult.safeParse(r).success).toBe(true);
    expect(r.fields).toMatchObject({
      razonSocial: { value: 'COMERCIAL ANDINA S.A.C.', source: 'xml', confidence: 1 },
      ruc: { value: '20601234565' },
      correlativo: { value: 'F001-123' },
      fechaEmision: { value: '2026-09-20' },
      montoTotal: { value: 236 },
      igv: { value: 36 },
      descripcion: { value: 'Laptop Lenovo; Instalación' },
    });
    expect(r.meta).toMatchObject({ tipoComprobante: '01', moneda: 'PEN', buyerCheck: null, warnings: [] });
    expect(r.fields.rucAdquirente).toEqual({ value: '20131312955', source: 'xml', confidence: 1 });
  });

  it('devuelve null si no es UBL', () => {
    expect(parseUblXml('<foo/>')).toBeNull();
  });
});

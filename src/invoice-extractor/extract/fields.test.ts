import { describe, expect, it } from 'vitest';
import { buildDocText } from '../text/layout';
import { pageFromPlainText } from '../text/plain-text-page';
import { extractFromText } from './fields';

const doc = (text: string) => buildDocText([pageFromPlainText(text)]);

// Factura electrónica típica (PDF digital). Columnas alineadas con 2+ espacios.
const FACTURA = `
COMERCIAL ANDINA S.A.C.                                  R.U.C. N° 20601234565
AV. LOS PINOS 123 - MIRAFLORES - LIMA                    FACTURA ELECTRÓNICA
Telf: 01-4445555                                         F001 - 00000123

Fecha de Emisión:  20/09/2026
Señor(es):  DISTRIBUIDORA DEL SUR S.A.
RUC:  20131312955
Moneda:  SOLES

Cant.  Unidad  Descripción                        P. Unit.  Importe
2      NIU     Laptop Lenovo IdeaPad 15           80.00     160.00
               color gris, 16GB RAM
1      ZZ      Servicio de instalación            40.00     40.00

Op. Gravada  S/  200.00
IGV 18%  S/  36.00
Importe Total  S/  236.00
SON: DOSCIENTOS TREINTA Y SEIS CON 00/100 SOLES
`;

describe('extractFromText — factura digital', () => {
  const r = extractFromText(doc(FACTURA));

  it('RUC del emisor, no del adquirente', () => {
    expect(r.ruc?.value).toBe('20601234565');
    expect(r.rucAdquirente?.value).toBe('20131312955');
  });

  it('razón social del emisor', () => {
    expect(r.razonSocial?.value).toBe('COMERCIAL ANDINA S.A.C.');
  });

  it('correlativo normalizado', () => expect(r.correlativo?.value).toBe('F001-123'));
  it('fecha de emisión', () => expect(r.fechaEmision?.value).toBe('2026-09-20'));

  it('montos', () => {
    expect(r.montoTotal?.value).toBe(236);
    expect(r.igv?.value).toBe(36);
    expect(r.baseImponible).toBe(200);
  });

  it('descripción por columna, uniendo líneas de continuación', () => {
    expect(r.descripcion?.value).toBe('Laptop Lenovo IdeaPad 15 color gris, 16GB RAM; Servicio de instalación');
  });

  it('metadatos', () => {
    expect(r.tipoComprobante).toBe('01');
    expect(r.moneda).toBe('PEN');
  });
});

// Boleta de ticketera: sin columnas claras y descripción como línea completa.
const BOLETA = `
BODEGA DON PEPE E.I.R.L.
RUC 20500000008
BOLETA DE VENTA ELECTRONICA
B001-4521
FECHA: 05/08/2026 10:32
DESCRIPCION CANT TOTAL
INCA KOLA 500ML 2 7.00
GALLETAS SODA 1 1.50
TOTAL S/ 8.50
`;

describe('extractFromText — boleta de ticketera', () => {
  const r = extractFromText(doc(BOLETA));

  it('campos principales', () => {
    expect(r.razonSocial?.value).toBe('BODEGA DON PEPE E.I.R.L.');
    expect(r.ruc?.value).toBe('20500000008');
    expect(r.correlativo?.value).toBe('B001-4521');
    expect(r.fechaEmision?.value).toBe('2026-08-05');
    expect(r.montoTotal?.value).toBe(8.5);
    expect(r.tipoComprobante).toBe('03');
  });

  it('descripción sin columnas: quita cantidades y montos', () => {
    expect(r.descripcion?.value).toBe('INCA KOLA 500ML; GALLETAS SODA');
  });
});

describe('extractFromText — ruido de OCR', () => {
  // Palabras sueltas con bbox, como las devuelve Tesseract (tomado de factura-foto.jpg).
  const word = (str: string, x: number, y: number, w = str.length * 11) => ({ str, x, y, w, h: 24, conf: 0.9 });
  const ocrPage = {
    width: 1300,
    height: 1800,
    wordLevel: true,
    items: [
      ...[['Cant.', 143], ['Unidad', 241], ['Descripción', 370], ['P.', 1116], ['Unit.', 1144], ['Importe', 1308]].map(
        ([s, x]) => word(s as string, x as number, 560),
      ),
      ...[['2', 143], ['NIU', 241], ['Laptop', 370], ['Lenovo', 447], ['IdeaPad', 530], ['15', 623]].map(([s, x]) =>
        word(s as string, x as number, 595),
      ),
      word('80.00', 1111, 595, 65), // empieza 5 px antes de la cabecera "P."
      word('160.00', 1310, 595, 68),
      word('1GV', 1013, 817),
      word('18%', 1065, 817),
      word('36.00', 1301, 817),
    ],
  };

  it('montos alineados a la derecha no rompen la columna de descripción; "1GV" se lee como IGV', () => {
    const r = extractFromText(buildDocText([ocrPage]));
    expect(r.descripcion?.value).toBe('Laptop Lenovo IdeaPad 15');
    expect(r.igv?.value).toBe(36);
  });

  it('RUC partido por espacios y total sin etiqueta fuerte', () => {
    const r = extractFromText(doc('FERRETERIA EL MARTILLO S.R.L.\nRUC 20 601234565\nF0O1-77\nSUB TOTAL 50.00\nIGV 9.00\nTOTAL 59.00'));
    expect(r.ruc?.value).toBe('20601234565');
    expect(r.correlativo?.value).toBe('F001-77');
    expect(r.montoTotal?.value).toBe(59);
    expect(r.igv?.value).toBe(9);
  });
});

describe('extractFromText — con RUC comprador conocido', () => {
  const BUYER = '20601932246';
  // Layout donde el bloque del cliente aparece ANTES que el RUC del emisor y sin etiquetas claras.
  const TEXT = `
EMPRESA COMPRADORA S.A.C.  ${BUYER}
FERRETERIA EL MARTILLO S.R.L.
RUC 20601234565
FACTURA ELECTRONICA F001-88
TOTAL 118.00
`;

  it('sin buyerRuc la heurística de posición se equivoca', () => {
    expect(extractFromText(doc(TEXT)).ruc?.value).toBe(BUYER);
  });

  it('con buyerRuc: ese RUC es el adquirente y nunca el emisor', () => {
    const r = extractFromText(doc(TEXT), { buyerRuc: BUYER });
    expect(r.ruc?.value).toBe('20601234565');
    expect(r.rucAdquirente).toEqual({ value: BUYER, confidence: 0.9 });
    expect(r.razonSocial?.value).toBe('FERRETERIA EL MARTILLO S.R.L.');
  });
});

describe('extractFromText — tabla sin cabecera (el OCR omitió la fila "Descripción")', () => {
  // Líneas reales del OCR de una foto tomada con la cámara (x@posición, y por línea).
  const rows: Array<[number, Array<[string, number]>]> = [
    [399, [['Señor(es):', 134], ['MI', 395], ['EMPRESA', 428], ['COMPRADORA', 546], ['S.A.C.', 722]]],
    [435, [['RUC:', 138], ['20601932246', 395]]],
    [471, [['Moneda:', 134], ['SOLES', 395]]],
    [594, [['2', 143], ['NIU', 241], ['Laptop', 370], ['Lenovo', 447], ['IdeaPad', 530], ['15', 623], ['80.00', 1111], ['160.00', 1310]]],
    [637, [['color', 369], ['gris,', 425], ['16GB', 478], ['RAM', 542]]],
    [672, [['1', 145], ['ZZ', 236], ['Servicio', 369], ['de', 457], ['instalación', 490], ['40.00', 1111], ['40.00', 1308]]],
    [776, [['Op.', 1012], ['Gravada', 1062], ['S/', 1270], ['200.00', 1301]]],
    [817, [['1GV', 1013], ['18%', 1065], ['S/', 1270], ['36.00', 1301]]],
  ];
  const page = {
    width: 1300,
    height: 1800,
    wordLevel: true,
    items: rows.flatMap(([y, words]) => words.map(([str, x]) => ({ str, x, y, w: str.length * 11, h: 28, conf: 0.9 }))),
  };

  it('reconstruye los ítems desde las filas con montos sobre los totales', () => {
    const r = extractFromText(buildDocText([page]));
    expect(r.descripcion?.value).toBe('Laptop Lenovo IdeaPad 15 color gris, 16GB RAM; Servicio de instalación');
    expect(r.descripcion?.confidence).toBeLessThan(0.6);
  });
});

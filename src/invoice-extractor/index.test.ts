import { describe, expect, it } from 'vitest';
import { detectFileKind } from './index';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('detectFileKind', () => {
  it.each([
    ['factura.pdf', 'application/pdf', 'pdf'],
    ['foto.jpg', 'image/jpeg', 'image'],
    ['foto.jpeg', '', 'image'],
    ['scan.png', 'image/png', 'image'],
    ['scan.bmp', 'image/bmp', 'image'],
    ['factura.xml', 'text/xml', 'xml'],
  ] as const)('%s → %s', (name, type, kind) => {
    expect(detectFileKind(file(name, type))).toBe(kind);
  });

  it.each([
    ['IMG_0001.HEIC', 'image/heic'],
    ['foto.webp', 'image/webp'],
    ['foto.gif', 'image/gif'],
    ['notas.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('rechaza %s', (name, type) => {
    expect(detectFileKind(file(name, type))).toBeNull();
  });
});

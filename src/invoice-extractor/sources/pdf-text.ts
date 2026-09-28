/**
 * Fuente 1: capa de texto del PDF (pdf.js) + render de páginas para QR/OCR.
 *
 * Corre en el hilo principal: pdf.js ya delega el parseo a su propio worker y
 * el render necesita un canvas del DOM.
 */
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText, TextItem } from '../text/layout';
import type { AssetPaths } from '../types';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Lado mayor del render en px (~250 DPI en A4): suficiente para QR y OCR. */
const RENDER_LONG_SIDE = 2800;

export async function loadPdf(data: ArrayBuffer, assets: AssetPaths): Promise<PDFDocumentProxy> {
  const base = `${assets.vendorBaseUrl}pdfjs/`;
  return getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  }).promise;
}

/** Texto con posición de las primeras `maxPages` páginas. */
export async function extractPdfText(pdf: PDFDocumentProxy, maxPages = 3): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      const it = raw as PdfTextItem;
      const tx = Util.transform(viewport.transform, it.transform);
      const h = Math.hypot(tx[2]!, tx[3]!);
      items.push({ str: it.str, x: tx[4]!, y: tx[5]! - h, w: it.width * viewport.scale, h, conf: 1 });
    }
    pages.push({ width: viewport.width, height: viewport.height, items });
    page.cleanup();
  }
  return pages;
}

/** Renderiza una página (1-based) a un canvas del DOM. */
export async function renderPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = RENDER_LONG_SIDE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print': sin requestAnimationFrame, así el render no se congela si la pestaña pasa a segundo plano.
  await page.render({ canvas, canvasContext: ctx, viewport, background: '#fff', intent: 'print' }).promise;
  page.cleanup();
  return canvas;
}

export const canvasToImageData = (canvas: HTMLCanvasElement): ImageData =>
  canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);

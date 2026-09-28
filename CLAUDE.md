# Stack open source: extractor de datos de comprobantes de pago (100% en el cliente)

## Contexto

Se necesita un MVP web que reciba un comprobante (PDF o imagen) y extraiga **razón social, RUC, monto, IGV, descripción, correlativo y fecha de emisión**, con todo el procesamiento en el navegador (el archivo no sale del equipo del usuario). Luego el módulo debe integrarse en un proyecto existente con **Vite + backend Node.js**.

Supuestos (por RUC/IGV): comprobantes peruanos (SUNAT), mezcla de PDFs digitales, escaneos y fotos.

**Emisor y adquirente**: la razón social, el RUC y los demás campos son los del **emisor** (el proveedor). Además, se valida que el comprobante esté **dirigido a nuestra empresa: RUC adquirente `20601932246`**. Un comprobante con otro adquirente, o sin RUC de adquirente, no se acepta. El RUC se configura en `.env` (`VITE_BUYER_RUC`) y el backend debe revalidarlo con el mismo valor. Saber de antemano el RUC del adquirente también mejora la extracción: si ese RUC aparece en el documento, nunca se toma como emisor.

**Motores por dispositivo** (decisión posterior al plan inicial):
- **Celulares** (el iPhone 13 es el dispositivo de captura): Tesseract, con **PaddleOCR PP-OCRv6** como respaldo si la confianza del OCR es baja. Cámara nativa en iOS; visor en la página en Android.
- **Escritorio (PC/macOS)**: **Qwen3.5-0.8B** (Transformers.js + WebGPU) como motor por defecto, precargado al abrir la app, con OCR para completar. **Sin cámara**: las webcams no sirven para documentos.
- El QR SUNAT siempre tiene prioridad sobre IA y OCR. Detalles y tiempos medidos en README.md.

## Idea central: pipeline en cascada

No todo documento necesita OCR. Se intenta primero la fuente más barata y precisa, y solo se cae a la siguiente si faltan campos:

1. **Capa de texto del PDF** → la mayoría de facturas electrónicas son PDFs digitales; el texto se lee directo, sin OCR, con coordenadas.
2. **Código QR SUNAT** → los comprobantes electrónicos llevan un QR con campos separados por `|`: RUC emisor, tipo, serie, número, IGV, total, fecha de emisión, doc. del adquirente, hash. Resuelve 5 de los 7 campos con precisión casi total.
3. **OCR** → solo para escaneos/fotos sin capa de texto.
4. **Reglas + validación cruzada** → regex, heurísticas por posición y checks matemáticos.
5. **(Fase 2, opcional) modelo en el navegador** → solo para los campos difíciles (descripción, razón social) cuando las reglas no alcancen.

## Stack recomendado

| Capa | Librería | Licencia | Rol |
|---|---|---|---|
| PDF | `pdfjs-dist` | Apache-2.0 | `getTextContent()` (texto + posición + tamaño de fuente) y render de página a canvas para QR/OCR |
| QR | `zxing-wasm` | MIT | Decodificar el QR SUNAT desde el canvas/imagen. (`BarcodeDetector` nativo no sirve como base: soporte incompleto en escritorio) |
| OCR | `tesseract.js` (idioma `spa`) | Apache-2.0 | OCR con bounding boxes por palabra; WASM, corre en Web Worker |
| Preproceso imagen | Canvas API (escala de grises, contraste, reescalado a ~300 DPI) | — | Suficiente para escaneos. Solo si hay fotos de celular torcidas: `jscanify` + `@techstark/opencv-js` (pesa ~8 MB, cargar bajo demanda) |
| Extracción | Código propio (regex + heurísticas) | — | Ver mapa de campos abajo |
| Validación / esquema | `zod` | MIT | Esquema `Invoice` compartido entre cliente y backend |
| Workers | `comlink` | Apache-2.0 | RPC sencillo con el Web Worker para no bloquear la UI |
| XML (atajo opcional) | `fast-xml-parser` | MIT | Si el usuario también tiene el XML UBL 2.1 de SUNAT, se obtienen todos los campos con 100% de exactitud |

### Mejoras para fase 2 (solo si la precisión del MVP no alcanza)

- **OCR más preciso en fotos**: modelos PaddleOCR (PP-OCR) sobre `onnxruntime-web` (p. ej. `@gutenye/ocr-browser`). Mejor que Tesseract en fotos, más pesado de integrar.
- **Extracción semántica**: `@huggingface/transformers` (Transformers.js, WebGPU) o `@mlc-ai/web-llm` con un modelo pequeño que reciba el texto OCR y devuelva JSON. Costo: descarga de 300 MB–2 GB, requiere WebGPU, lento en equipos modestos. Por eso queda como fallback opcional, no como base.

### Descartados

- `scribe.js-ocr`: mejor precisión que Tesseract.js, pero licencia **AGPL-3.0** (obliga a abrir el código de la plataforma).
- `jsQR`: sin mantenimiento; `zxing-wasm` lee mejor QRs pequeños o degradados.

## Mapa campo → fuente

| Campo | Fuente primaria | Fallback / validación |
|---|---|---|
| RUC emisor | QR | Regex `\b(10|15|17|20)\d{9}\b` + dígito verificador (módulo 11); distinguir emisor vs. adquirente por posición y etiquetas |
| RUC adquirente | QR (campo 9: doc. del adquirente) | Aparición literal del RUC configurado; si no, RUC con etiqueta Señor(es)/Cliente/Adquiriente. Debe ser igual a `VITE_BUYER_RUC` |
| Correlativo | QR (serie + número) | Regex `\b[FBE][A-Z0-9]{3}\s*-\s*\d{1,8}\b` |
| Fecha de emisión | QR | Regex de fecha cerca de "Fecha de emisión" |
| Monto total | QR | Regex cerca de "Importe total" / "Total" |
| IGV | QR | Validar `base + IGV ≈ total`; no fijar 18% (existe tasa 10% para MYPE de restaurantes/hoteles) |
| Razón social | Texto (pdf.js u OCR) | Línea próxima al RUC emisor, sufijos S.A.C./S.A./E.I.R.L./S.R.L., mayor tamaño de fuente en la cabecera |
| Descripción | Texto con coordenadas | Reconstruir filas de la tabla bajo la cabecera "Descripción" agrupando por `y` y cortando por columnas `x` |

Cada campo se devuelve con `value`, `source` (`qr` | `pdf-text` | `ocr`) y `confidence`, para que la UI marque los dudosos y el usuario los corrija antes de enviar.

Nota: el QR no siempre cumple el formato (algunos emisores ponen una URL). Si no parsea a los campos esperados, se ignora y se sigue con texto/OCR.

## Arquitectura del MVP

Módulo agnóstico de framework, para moverlo tal cual al proyecto final:

```
invoice-extractor/
  index.ts            # extractInvoice(file: File): Promise<InvoiceResult>
  worker.ts           # pipeline completo dentro de un Web Worker (comlink)
  sources/pdfText.ts  # pdfjs-dist: texto + posiciones, render a canvas
  sources/qr.ts       # zxing-wasm + parser del QR SUNAT
  sources/ocr.ts      # tesseract.js (spa), carga perezosa
  extract/fields.ts   # regex + heurísticas por campo
  extract/validate.ts # checksum RUC, base + IGV = total, fechas
  schema.ts           # zod: Invoice, InvoiceResult
```

UI mínima del MVP: drop zone → vista previa → formulario con los campos extraídos y editables.

## Integración con Vite + Node

- **Workers**: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
- **pdf.js**: `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` y asignarlo a `GlobalWorkerOptions.workerSrc`.
- **Tesseract / zxing**: servir `.wasm` y `spa.traineddata` desde `public/` (self-hosted, sin CDN) configurando `workerPath`, `corePath`, `langPath`; añadir los paquetes WASM a `optimizeDeps.exclude` si Vite los rompe al pre-empaquetar.
- **Carga perezosa**: OCR y OpenCV con `import()` dinámico; un PDF digital con QR no debería descargar ninguno de los dos.
- **Backend Node**: solo recibe el JSON ya extraído (y opcionalmente el archivo para archivarlo). Revalida con el mismo esquema `zod` y repite los checks (checksum RUC, montos): nunca confiar en lo que manda el cliente. Opcional: contrastar RUC ↔ razón social contra el padrón reducido de SUNAT.

## Verificación

1. Armar un set de 20–30 comprobantes reales: PDF digital, PDF escaneado, foto de celular, boletas y facturas de distintos emisores.
2. Tests unitarios (`vitest`) de `extract/` y del parser de QR con fixtures de texto.
3. Medir por campo: % de aciertos y tiempo por documento, separando por tipo de entrada. Esto decide si hace falta la fase 2.
4. Probar en Chrome, Edge, Firefox y un celular Android de gama media (memoria y tiempo del OCR).
5. Confirmar en la pestaña Network que el archivo no se sube a ningún servidor durante la extracción.


## Reglas del developer

1. Usar PNPM
2. Instalar las últimas versiones de las librerías, respetando el minimumReleaseAge de pnpm.
3. Al usar Vuejs3 optar por Composition API.
4. Usar la convención de Todo en Minúscula y separado por guiones "-" para los nombres de los archivos creados por Claude en este proyecto.
5. Optar por el orden antes de la funcionalidad. Dejando siempre espacio para mejoras futuras (escalabilidad y mantenibilidad).


Haré una aclaración,  lo que se busca es tener los valores del emisor de la factura, validando a su vez, que el comprobante está dirigido a mi empresa con RUC 20601932246 y Razón social "PTSYS S.A.C."
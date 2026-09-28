# Lector de comprobantes (SUNAT)

MVP web que extrae los datos del **emisor** (razón social, RUC, correlativo, fecha de emisión, monto total, IGV y descripción) de facturas y boletas peruanas (PDF digital, PDF escaneado, foto JPG/PNG/BMP o XML UBL) y **valida que el comprobante esté dirigido a nuestra empresa** (RUC adquirente configurado en `.env`). Todo el procesamiento ocurre en el navegador: el archivo no se sube a ningún servidor.

El plan técnico completo está en [CLAUDE.md](CLAUDE.md).

## Uso

```bash
pnpm install        # también copia WASM, fuentes y el modelo de Tesseract a public/vendor/ (postinstall)
pnpm fetch-models   # descarga PaddleOCR (~31 MB) y Qwen3.5-0.8B (~870 MB) a public/models/
pnpm dev            # http://localhost:5173
pnpm test           # tests unitarios (vitest)
pnpm build          # typecheck + build de producción
```

- `pnpm fetch-models paddle` o `pnpm fetch-models qwen` descarga solo uno. Los archivos ya descargados se omiten.
- Si `public/vendor/` falta (p. ej. tras limpiar), ejecuta `pnpm copy-assets`.
- Sin `pnpm fetch-models` la app funciona igual, con Tesseract: los motores que faltan se reportan como "no disponible".

## Configuración

`.env`:

```
VITE_BUYER_RUC=20601932246   # RUC al que deben ir dirigidos los comprobantes
```

Con este valor:
- el RUC adquirente se extrae (QR → texto) y se compara; la UI muestra si está dirigido o no a la empresa y **no genera el JSON** si no coincide;
- la extracción mejora: si ese RUC aparece en el documento, nunca se toma como emisor, y su bloque no se usa para la razón social;
- `result.meta.buyerCheck` vale `match` | `mismatch` | `missing` (o `null` sin RUC configurado).

Si falta o es inválido, la app funciona sin esta validación.

## Motores de lectura por dispositivo

Se elige según el dispositivo (`src/platform/device.ts`):

| | Celular (iPhone / Android) | Escritorio (PC / macOS) |
|---|---|---|
| Motor para fotos y PDFs escaneados | **Tesseract**; si la confianza es baja, **PaddleOCR** como respaldo | **Qwen3.5-0.8B** (modelo de visión, WebGPU); si falla o deja campos dudosos, se completa con OCR |
| Cámara | Sí (ver abajo) | **No**: las webcams de laptop no sirven para fotografiar documentos |
| Precarga | — | El modelo se descarga al abrir la app (indicador en la cabecera) y queda en la caché del navegador |

En todos los casos:
- **XML UBL**: todos los campos exactos, sin IA ni OCR.
- **PDF digital**: capa de texto + QR (exactos y rápidos), sin IA ni OCR.
- **QR SUNAT**: siempre tiene prioridad sobre la IA y el OCR en RUCs, correlativo, fecha y montos. Si hay QR, al modelo de visión solo se le pide lo que el QR no trae (razón social, descripción y moneda): es más rápido y evita que lea mal los números.

### Cuándo entra PaddleOCR (respaldo)

Si la confianza media de Tesseract es menor a **80 %**, o si queda algún campo sin resolver (o por debajo de 60 %) que el QR no cubra. En boletas, que falte el adquirente no cuenta, porque suele ir a consumidor final. Se queda con el mejor valor de cada campo entre ambos motores; si coinciden, sube la confianza.

### Modelo de visión (Qwen3.5-0.8B)

- Requiere **WebGPU** (Chrome/Edge de escritorio). Sin WebGPU se usa OCR automáticamente y la cabecera lo indica.
- Puede leer mal o inventar valores: sus propuestas entran con confianza moderada (70 %) y se validan con el dígito verificador del RUC, el cuadre del IGV y el QR. Un RUC con dígito verificador inválido baja a 25 %.
- Todo es local: los pesos se sirven desde `public/models/` y el comprobante nunca sale del equipo.

## Formatos aceptados

PDF, imágenes **JPG, PNG y BMP**, y XML UBL de SUNAT. Otros formatos (HEIC, WebP, GIF…) se rechazan con un mensaje claro. Las fotos del iPhone que llegan desde la nube en HEIC deben descargarse como JPG (en iCloud: *Más compatible*), o se puede configurar el iPhone en *Ajustes › Cámara › Formatos › Más compatible*.

## Tomar foto con la cámara (solo celulares)

| Dispositivo | Vía | Por qué |
|---|---|---|
| **iPhone / iPad** | Cámara nativa (`<input capture="environment">`) | Safari no tiene `ImageCapture`: el visor solo podría tomar un cuadro del video. La cámara nativa entrega la foto de 12 MP ya procesada (HDR, enfoque) en JPG. No requiere HTTPS. |
| **Android** | Visor dentro de la página (`getUserMedia`) | Al abrir la app de cámara, Android puede descartar la pestaña por falta de memoria y la foto se pierde. El visor no cambia de app. Requiere HTTPS; sin él, cámara nativa. |

- Si la página se recarga al volver de la cámara nativa, se muestra un aviso explicando lo ocurrido.
- Un iPad en "modo escritorio" se identifica como Mac; se detecta por su pantalla táctil.

### Probar desde el celular (misma red)

```bash
pnpm dev:lan   # HTTPS con certificado autofirmado, expuesto en la red
```

Abrir en el celular la URL `https://<IP-del-PC>:5173` que muestra la consola y aceptar la advertencia del certificado.

## Pipeline

| Paso | Dónde corre | Cuándo |
|---|---|---|
| XML UBL 2.1 (`fast-xml-parser`) | worker | archivo `.xml` → fin |
| Capa de texto (`pdfjs-dist`) | hilo principal (pdf.js usa su propio worker) | siempre en PDFs |
| QR SUNAT (`zxing-wasm`) | worker | siempre en PDF/imagen (primera y última página) |
| Modelo de visión (`@huggingface/transformers` + Qwen3.5-0.8B) | worker (WebGPU) | escritorio, imágenes y PDFs escaneados |
| OCR (`tesseract.js`, `spa`) | worker (worker anidado) | celulares, o para completar lo que la IA no resolvió |
| OCR de respaldo (`@paddleocr/paddleocr-js`, PP-OCRv6 small) | worker anidado del SDK | confianza baja o campos sin resolver |
| Reglas + validación cruzada | worker | siempre |

Cada campo devuelve `{ value, source, confidence }` (`source`: `xml`, `qr`, `pdf-text`, `ocr`, `ia`, `manual`). La UI colorea los dudosos (verde ≥ 85 %, ámbar ≥ 60 %, rojo menor o vacío) y permite corregirlos antes de generar el JSON. `meta.engines` indica qué motores intervinieron.

## Estructura

```
src/
  invoice-extractor/          # módulo agnóstico de framework (se copia tal cual al proyecto final)
    index.ts                  # extractInvoice(file, opts), preloadEngine(engine), disposeExtractor()
    worker.ts                 # orquestación de motores (comlink)
    schema.ts                 # zod: Invoice, InvoiceResult (compartido con el backend)
    types.ts                  # contrato hilo principal ↔ worker
    sources/
      pdf-text.ts             # pdf.js: texto con coordenadas + render a canvas
      qr.ts                   # zxing-wasm: lectura del QR
      ocr-tesseract.ts        # tesseract.js con carga perezosa
      ocr-paddle.ts           # PaddleOCR (respaldo) con carga perezosa
      vlm.ts                  # Qwen3.5-0.8B con Transformers.js + WebGPU
      image.ts                # decodificación y preproceso (OffscreenCanvas)
      xml.ts                  # atajo XML UBL
    extract/
      fields.ts               # regex + heurísticas por campo
      vlm-response.ts         # prompts del modelo de visión y lectura de su JSON
      combine.ts              # cuándo usar el respaldo y mejor valor por campo entre motores
      sunat-qr.ts             # parser del QR SUNAT
      parse.ts                # montos, fechas, correlativos
      merge.ts                # fusión con el QR y ajuste de confianza
      validate.ts             # checksum RUC, base + IGV ≈ total, fechas, adquirente (puro, reutilizable en Node)
    text/
      layout.ts               # modelo de texto posicionado y agrupación en líneas
      plain-text-page.ts      # helper de tests: texto plano → items con coordenadas
  components/                 # drop-zone, camera-capture, engine-status, file-preview, invoice-form, extraction-summary
  composables/                # use-invoice-extraction, use-camera, use-engine-preload
  platform/device.ts          # detección de dispositivo, estrategia de cámara y motor por defecto
  app-config.ts               # .env + dispositivo
scripts/
  copy-static-assets.mjs      # WASM, fuentes, Tesseract y ONNX Runtime → public/vendor/ (postinstall)
  fetch-models.mjs            # PaddleOCR y Qwen3.5-0.8B → public/models/ (manual; revisiones fijadas)
fixtures/samples/             # comprobantes sintéticos para pruebas manuales
```

## Integración en el proyecto final (Vite + Node)

1. Copiar `src/invoice-extractor/`, `src/platform/` y los dos scripts; añadir `copy-static-assets` como `postinstall` y ejecutar `fetch-models` en el despliegue.
2. En `vite.config.ts`: `worker.format: 'es'`, y las opciones de `optimizeDeps` y el plugin `uncompressedModelWeights` de este repo.
3. **Servidor de archivos estáticos**: servir `/models/` y `/vendor/` **sin compresión gzip/brotli y con `Content-Length`**. La compresión al vuelo de archivos de cientos de MB hace fallar la descarga en el navegador. Opcional: cabeceras `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` para que ONNX Runtime use varios hilos.
4. Si los assets se sirven en otra ruta, pasar `vendorBaseUrl` / `modelsBaseUrl` a `extractInvoice` y `preloadEngine`.
5. Backend: importar `invoiceSchemaFor(BUYER_RUC)` de `schema.ts` y `validateInvoice(inv, { expectedBuyerRuc })` de `extract/validate.ts` (no dependen del DOM) para revalidar lo que llega del cliente con el mismo RUC comprador.

## Decisiones y desviaciones del plan

- **pdf.js corre en el hilo principal**, no dentro del worker del extractor: ya parsea en su propio worker y el render necesita un canvas del DOM.
- **Render con `intent: 'print'`**: con el intent por defecto pdf.js usa `requestAnimationFrame`, y el render se congelaba si la pestaña pasaba a segundo plano.
- **PaddleOCR en modo worker del SDK**: su modo directo necesita el DOM. Ese worker trae ONNX Runtime 1.24.3 empaquetado, por eso sus binarios vienen del alias `onnxruntime-web-paddleocr` y no de la versión 1.30 que usa el resto del paquete.
- **Modelos de PaddleOCR desde Hugging Face**: el CDN de Baidu que usa el SDK por defecto daba timeouts. `fetch-models` descarga los ONNX oficiales de PaddlePaddle y arma el `.tar` que exige el SDK.
- **Transformers.js con `localModelPath` como ruta** (`/models/`), no como URL absoluta: con URL, la versión 4.3 no encuentra los archivos locales.
- **TypeScript fijado en 6.0.x**: TypeScript 7 (nativo) no expone la API JS que usa `vue-tsc`.
- **Nombres de archivo en kebab-case**, según las reglas del proyecto.
- **Correlativo normalizado** a `SERIE-NÚMERO` sin ceros a la izquierda (`F001-00000123` → `F001-123`).
- `pnpm-workspace.yaml` fija `minimumReleaseAge: 1440` y bloquea el script de instalación de `tesseract.js`.

## Estado de la verificación

- 102 tests unitarios (`extract/`, parser QR, fusión, combinación de motores, respuesta del modelo de visión, XML, esquema, dispositivo).
- Probado en Chromium (panel del escritorio, GPU integrada Intel Iris Xe) con las muestras de `fixtures/samples/`. En la pestaña Network solo aparecen GET a localhost.

| Caso | Motores | Tiempo medido |
|---|---|---|
| PDF digital | QR + texto | ≈ 0,35 s |
| Foto con QR, celular | QR + Tesseract | ≈ 3,5 s |
| Foto borrosa, celular | Tesseract (70 %) + PaddleOCR | ≈ 4 s con PaddleOCR ya cargado; ≈ 20 s la primera vez |
| Foto con QR, escritorio | QR + Qwen3.5-0.8B | **17–46 s** según la corrida, en esta GPU integrada |
| Boleta sin QR, escritorio | Qwen3.5-0.8B + Tesseract | ≈ 47 s |
| Carga del modelo de IA | — | ≈ 17 s la primera vez (red local); 1–8 s desde la caché |

- **Pendiente**: set de 20–30 comprobantes reales, medición de aciertos por campo, tiempos del modelo de visión en una PC con GPU dedicada, y pruebas en un iPhone 13 y un Android reales.

// Copia a public/vendor/ los assets estáticos (WASM, modelos de Tesseract, fuentes) de las
// librerías del extractor para servirlos desde el propio sitio, sin CDN.
// Se ejecuta en postinstall; public/vendor/ está en .gitignore.
// Los modelos grandes de IA van aparte: scripts/fetch-models.mjs → public/models/.
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

/**
 * Carpeta de una dependencia tal como la ve otro paquete (pnpm aísla versiones:
 * PaddleOCR y Transformers.js traen cada uno su propio onnxruntime-web).
 */
function depDirOf(consumer, dep) {
  let dir = realpathSync(join(root, 'node_modules', ...consumer.split('/')));
  while (!dir.endsWith('node_modules')) dir = dirname(dir);
  const found = join(dir, dep);
  if (!existsSync(found)) throw new Error(`No se encontró ${dep} para ${consumer}`);
  return found;
}

/** Binarios WASM de ONNX Runtime (variantes CPU/SIMD y WebGPU), sin el resto del paquete. */
const ortRuntimeFiles = (pkgRoot, destDir) => {
  const dist = join(pkgRoot, 'dist');
  return readdirSync(dist)
    .filter((f) => /^ort-wasm-simd-threaded.*.(mjs|wasm)$/.test(f))
    .map((f) => [join(dist, f), `${destDir}/${f}`]);
};

// Tesseract: solo variantes LSTM (OEM 1, el modo por defecto de tesseract.js).
const TESSERACT_CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

/** [origen, destino] — archivos o carpetas completas. */
const copies = [
  // tesseract.js
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'tesseract/worker.min.js'],
  ...TESSERACT_CORE_FILES.map((f) => [join(pkgDir('tesseract.js-core'), f), `tesseract/core/${f}`]),
  [
    join(pkgDir('@tesseract.js-data/spa'), '4.0.0_best_int', 'spa.traineddata.gz'),
    'tesseract/lang/spa.traineddata.gz',
  ],
  // pdf.js: fuentes estándar, cmaps y decodificadores WASM (JBIG2/JPX de PDFs escaneados)
  [join(pkgDir('pdfjs-dist'), 'standard_fonts'), 'pdfjs/standard_fonts'],
  [join(pkgDir('pdfjs-dist'), 'cmaps'), 'pdfjs/cmaps'],
  [join(pkgDir('pdfjs-dist'), 'iccs'), 'pdfjs/iccs'],
  [join(pkgDir('pdfjs-dist'), 'wasm'), 'pdfjs/wasm'],
  // ONNX Runtime Web: la versión exacta que usa cada consumidor.
  // - El worker de PaddleOCR trae ORT 1.24.3 empaquetado: sus binarios vienen del alias
  //   onnxruntime-web-paddleocr (devDependency), no del onnxruntime-web del paquete.
  ...ortRuntimeFiles(realpathSync(join(root, 'node_modules', 'onnxruntime-web-paddleocr')), 'ort-paddle'),
  ...ortRuntimeFiles(depDirOf('@huggingface/transformers', 'onnxruntime-web'), 'ort-transformers'),
];

rmSync(outDir, { recursive: true, force: true });
for (const [from, rel] of copies) {
  const to = join(outDir, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}
console.log(`[copy-static-assets] ${copies.length} entradas copiadas a public/vendor/`);

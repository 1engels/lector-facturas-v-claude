import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import basicSsl from '@vitejs/plugin-basic-ssl';
import type { Connect, Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Los pesos de los modelos (.onnx, .onnx_data, .tar, .wasm) se sirven sin comprimir:
 * gzip al vuelo sobre cientos de MB quita el Content-Length, rompe el progreso y hace
 * fallar la descarga en el navegador (además, los pesos casi no comprimen).
 * El servidor de producción debe hacer lo mismo con /models/ y /vendor/.
 */
function uncompressedModelWeights(): Plugin {
  const WEIGHTS_RE = /\.(onnx|onnx_data|tar|wasm)(\?|$)/;
  const middleware: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url && WEIGHTS_RE.test(req.url)) req.headers['accept-encoding'] = 'identity';
    next();
  };
  return {
    name: 'uncompressed-model-weights',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig(({ mode }) => ({
  // `--mode https` (pnpm dev:lan): certificado autofirmado para probar desde el celular.
  // La cámara dentro de la página (getUserMedia) solo funciona en HTTPS o localhost.
  plugins: [vue(), uncompressedModelWeights(), ...(mode === 'https' ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // zxing-wasm resuelve su .wasm relativo al módulo: el pre-empaquetado rompería esa ruta.
    // tesseract.js es CommonJS: se pre-empaqueta explícitamente (se importa con import() dinámico en el worker).
    // @paddleocr/paddleocr-js crea su worker con new URL('./assets/…', import.meta.url):
    // pre-empaquetado, esa ruta se rompe. Sus dependencias CommonJS sí se pre-empaquetan.
    exclude: ['zxing-wasm', '@paddleocr/paddleocr-js'],
    include: [
      'tesseract.js',
      '@paddleocr/paddleocr-js > js-yaml',
      '@paddleocr/paddleocr-js > clipper-lib',
      '@paddleocr/paddleocr-js > @techstark/opencv-js',
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));

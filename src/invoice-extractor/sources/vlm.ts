/**
 * Fuente 4: modelo de visión Qwen3.5-0.8B (Transformers.js + WebGPU), motor por
 * defecto en escritorio. Lee la imagen completa y devuelve los campos en JSON.
 *
 * Los pesos (~870 MB) se sirven desde public/models/ (scripts/fetch-models.mjs) y
 * quedan en la caché del navegador tras la primera descarga. Sin WebGPU no se usa:
 * en CPU sería demasiado lento.
 */
import type { AssetPaths } from '../types';

export const VLM_MODEL_ID = 'onnx-community/Qwen3.5-0.8B-ONNX-OPT';
export const VLM_ENGINE_NAME = 'qwen3.5-0.8b';

/** Lado mayor de la imagen que ve el modelo: ~1100 tokens visuales para una hoja A4. */
const VLM_IMAGE_LONG_SIDE = 1280;
const MAX_NEW_TOKENS = 400;

export type VlmProgress = (p: { progress: number; loadedMb: number; totalMb: number; file?: string }) => void;

type Transformers = typeof import('@huggingface/transformers');
interface VlmRuntime {
  tf: Transformers;
  processor: Awaited<ReturnType<Transformers['AutoProcessor']['from_pretrained']>>;
  model: Awaited<ReturnType<Transformers['Qwen3_5ForConditionalGeneration']['from_pretrained']>>;
}

let runtimePromise: Promise<VlmRuntime> | null = null;
let progressListener: VlmProgress | null = null;

/** ¿Hay una GPU utilizable por WebGPU en este contexto? */
export async function isWebGpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

function loadRuntime(assets: AssetPaths): Promise<VlmRuntime> {
  runtimePromise ??= (async () => {
    if (!(await isWebGpuAvailable())) throw new Error('WebGPU no está disponible en este navegador.');
    const tf = await import('@huggingface/transformers');
    tf.env.allowRemoteModels = false;
    tf.env.allowLocalModels = true;
    // Transformers.js 4.x solo busca modelos locales si es una ruta, no una URL absoluta.
    tf.env.localModelPath = new URL(assets.modelsBaseUrl).pathname;
    tf.env.useBrowserCache = true;
    const onnx = tf.env.backends.onnx as { wasm?: { wasmPaths?: string } };
    if (onnx.wasm) onnx.wasm.wasmPaths = `${assets.vendorBaseUrl}ort-transformers/`;

    // Progreso agregado de todos los archivos del modelo.
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status !== 'progress' || !info.file) return;
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      progressListener?.({ progress: total ? loaded / total : 0, loadedMb: loaded / 1e6, totalMb: total / 1e6, file: info.file });
    };

    const processor = await tf.AutoProcessor.from_pretrained(VLM_MODEL_ID, { progress_callback });
    const model = await tf.Qwen3_5ForConditionalGeneration.from_pretrained(VLM_MODEL_ID, {
      // Combinación recomendada por la tarjeta del modelo (ver fetch-models.mjs).
      dtype: { embed_tokens: 'q4', vision_encoder: 'fp16', decoder_model_merged: 'q4' },
      device: 'webgpu',
      progress_callback,
    });
    return { tf, processor, model };
  })();
  return runtimePromise.catch((err) => {
    runtimePromise = null;
    throw err;
  });
}

/** Descarga e inicializa el modelo sin procesar nada (se llama al abrir la app en escritorio). */
export async function warmupVlm(assets: AssetPaths, onProgress?: VlmProgress): Promise<void> {
  progressListener = onProgress ?? null;
  try {
    await loadRuntime(assets);
  } finally {
    progressListener = null;
  }
}

/** Envía la imagen del comprobante al modelo y devuelve su respuesta en texto (se espera JSON). */
export async function runVlm(image: ImageData, prompt: string, assets: AssetPaths, onProgress?: VlmProgress): Promise<string> {
  progressListener = onProgress ?? null;
  let runtime: VlmRuntime;
  try {
    runtime = await loadRuntime(assets);
  } finally {
    progressListener = null;
  }
  const { tf, processor, model } = runtime;

  const scale = Math.min(1, VLM_IMAGE_LONG_SIDE / Math.max(image.width, image.height));
  let raw = new tf.RawImage(image.data, image.width, image.height, 4);
  if (scale < 1) raw = await raw.resize(Math.round(image.width * scale), Math.round(image.height * scale));
  raw = raw.rgb();

  const conversation = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }];
  const text = processor.apply_chat_template(conversation, { add_generation_prompt: true });
  const inputs = await processor(text, raw);
  const outputs = (await model.generate({ ...inputs, max_new_tokens: MAX_NEW_TOKENS, do_sample: false })) as {
    slice: (...args: unknown[]) => unknown;
  };
  const promptLength = (inputs.input_ids as { dims: number[] }).dims.at(-1)!;
  const decoded = processor.batch_decode(outputs.slice(null, [promptLength, null]) as never, {
    skip_special_tokens: true,
  }) as string[];
  return decoded[0] ?? '';
}

export async function disposeVlm(): Promise<void> {
  const pending = runtimePromise;
  runtimePromise = null;
  if (pending) await (await pending.catch(() => null))?.model.dispose();
}

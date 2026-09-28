import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { appConfig } from '@/app-config';
import { extractInvoice, type ExtractionProgress, type InvoiceResult } from '@/invoice-extractor';

export type ExtractionStatus = 'idle' | 'working' | 'done' | 'error';

/** Estado reactivo de una extracción: archivo, vista previa, progreso y resultado. */
export function useInvoiceExtraction() {
  const status = ref<ExtractionStatus>('idle');
  const file = shallowRef<File | null>(null);
  const previewUrl = ref<string | null>(null);
  const progress = ref<ExtractionProgress | null>(null);
  const result = shallowRef<InvoiceResult | null>(null);
  const error = ref<string | null>(null);
  const elapsedMs = ref(0);

  let runId = 0;

  const setPreview = (blob: Blob | null) => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = blob ? URL.createObjectURL(blob) : null;
  };

  async function run(newFile: File) {
    const id = ++runId;
    file.value = newFile;
    result.value = null;
    error.value = null;
    progress.value = null;
    status.value = 'working';
    setPreview(newFile.type.startsWith('image/') ? newFile : null);

    const t0 = performance.now();
    try {
      const res = await extractInvoice(newFile, {
        buyerRuc: appConfig.buyerRuc,
        engine: appConfig.engine,
        onProgress: (p) => id === runId && (progress.value = p),
        onPreview: (blob) => id === runId && setPreview(blob),
      });
      if (id !== runId) return;
      result.value = res;
      status.value = 'done';
    } catch (err) {
      if (id !== runId) return;
      console.error(err);
      error.value = err instanceof Error ? err.message : String(err);
      status.value = 'error';
    } finally {
      if (id === runId) elapsedMs.value = Math.round(performance.now() - t0);
    }
  }

  function reset() {
    runId++;
    status.value = 'idle';
    file.value = null;
    result.value = null;
    error.value = null;
    progress.value = null;
    setPreview(null);
  }

  onBeforeUnmount(() => setPreview(null));

  return { status, file, previewUrl, progress, result, error, elapsedMs, run, reset };
}

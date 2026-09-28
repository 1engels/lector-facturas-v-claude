import { onMounted, ref } from 'vue';
import { appConfig } from '@/app-config';
import { preloadEngine, type PreloadProgress } from '@/invoice-extractor';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Precarga del motor de IA en escritorio: descarga el modelo (~870 MB la primera vez;
 * después sale de la caché del navegador) al abrir la app, para que el primer
 * comprobante no espere. En celulares no hace nada (se usa OCR).
 */
export function useEnginePreload() {
  const status = ref<EngineStatus>(appConfig.engine === 'vlm' ? 'loading' : 'idle');
  const progress = ref<PreloadProgress | null>(null);
  const reason = ref<string | null>(null);

  onMounted(async () => {
    if (appConfig.engine !== 'vlm') return;
    const result = await preloadEngine('vlm', { onProgress: (p) => (progress.value = p) });
    status.value = result.ready ? 'ready' : 'unavailable';
    reason.value = result.reason ?? null;
  });

  return { status, progress, reason };
}

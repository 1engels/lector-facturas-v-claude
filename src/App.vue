<script setup lang="ts">
import { computed, ref } from 'vue';
import { appConfig } from '@/app-config';
import CameraCapture from '@/components/camera-capture.vue';
import DropZone from '@/components/drop-zone.vue';
import EngineStatus from '@/components/engine-status.vue';
import ExtractionSummary from '@/components/extraction-summary.vue';
import FilePreview from '@/components/file-preview.vue';
import InvoiceForm from '@/components/invoice-form.vue';
import { useInvoiceExtraction } from '@/composables/use-invoice-extraction';

const { cameraEnabled } = appConfig;
const { status, file, previewUrl, progress, result, error, elapsedMs, run } = useInvoiceExtraction();

/** Aviso: el navegador recargó la página al volver de la app de cámara (poca memoria). */
const cameraInterrupted = ref(false);

function onFile(f: File) {
  cameraInterrupted.value = false;
  void run(f);
}

const progressPct = computed(() =>
  progress.value?.progress != null ? Math.round(progress.value.progress * 100) : null,
);
</script>

<template>
  <header class="app-header">
    <h1>Lector de comprobantes</h1>
    <p>Extrae los datos del emisor de facturas y boletas SUNAT y verifica que estén dirigidas a tu empresa.</p>
    <EngineStatus />
  </header>

  <main>
    <div v-if="!file" class="start">
      <p v-if="cameraInterrupted" class="notice" role="alert">
        El navegador recargó la página al volver de la cámara (suele pasar en celulares con poca memoria) y la foto
        se perdió. Vuelve a intentarlo o toma la foto con la app de cámara y luego elígela desde la galería.
      </p>
      <DropZone @file="onFile" />
      <div v-if="cameraEnabled" class="start-alt">
        <span>o</span>
        <CameraCapture @file="onFile" @interrupted="cameraInterrupted = true" />
      </div>
    </div>

    <div v-else class="workspace">
      <aside class="left">
        <div class="source-bar" :class="{ 'no-camera': !cameraEnabled }">
          <DropZone compact @file="onFile" />
          <CameraCapture v-if="cameraEnabled" compact @file="onFile" />
        </div>
        <FilePreview :file="file" :preview-url="previewUrl" />
      </aside>

      <section class="right">
        <div v-if="status === 'working'" class="status" role="status">
          <div class="spinner" aria-hidden="true" />
          <div>
            <strong>{{ progress?.message ?? 'Procesando' }}</strong>
            <div v-if="progressPct !== null" class="bar"><span :style="{ width: `${progressPct}%` }" /></div>
          </div>
        </div>

        <div v-else-if="status === 'error'" class="status error" role="alert">
          <strong>No se pudo procesar el archivo.</strong>
          <span>{{ error }}</span>
        </div>

        <template v-else-if="result">
          <ExtractionSummary :result="result" :elapsed-ms="elapsedMs" />
          <InvoiceForm :result="result" />
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.app-header {
  margin-bottom: 1.5rem;
}
h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.app-header p {
  margin: 0;
  color: var(--text-muted);
}
.start {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.notice {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  font-size: 0.9rem;
}
.start-alt {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  color: var(--text-muted);
}
.source-bar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.6rem;
}
.source-bar.no-camera {
  grid-template-columns: 1fr;
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 1.5rem;
  align-items: start;
}
.left,
.right {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
@media (max-width: 820px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
.status {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.status > div {
  flex: 1;
}
.status.error {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  border-color: var(--bad);
}
.spinner {
  width: 1.4rem;
  height: 1.4rem;
  flex: 0 0 auto;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.bar {
  height: 6px;
  margin-top: 0.5rem;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}
</style>

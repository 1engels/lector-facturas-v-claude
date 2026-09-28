<script setup lang="ts">
import { ref } from 'vue';
import { ACCEPTED_TYPES } from '@/invoice-extractor';

defineProps<{ compact?: boolean }>();
const emit = defineEmits<{ file: [file: File] }>();

const dragging = ref(false);

function pick(files: FileList | null | undefined) {
  const file = files?.[0];
  if (file) emit('file', file);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  pick(e.dataTransfer?.files);
}

function onChange(e: Event) {
  const target = e.target as HTMLInputElement;
  pick(target.files);
  target.value = '';
}
</script>

<template>
  <label
    class="drop-zone"
    :class="{ dragging, compact }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input type="file" :accept="ACCEPTED_TYPES" hidden @change="onChange" />
    <template v-if="compact">
      <span class="drop-title">Cambiar comprobante</span>
    </template>
    <template v-else>
      <svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <span class="drop-title">Arrastra un comprobante o haz clic para elegirlo</span>
      <span class="drop-hint">PDF, foto/escaneo (JPG, PNG, BMP) o XML de SUNAT</span>
      <span class="drop-hint">Se procesa en tu navegador: el archivo no se sube a ningún servidor.</span>
    </template>
  </label>
</template>

<style scoped>
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1.5rem;
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.drop-zone.compact {
  flex-direction: row;
  padding: 0.6rem 1rem;
  border-width: 1px;
}
.drop-icon {
  width: 2.5rem;
  height: 2.5rem;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.drop-title {
  font-weight: 600;
}
.drop-hint {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>

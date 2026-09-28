<script setup lang="ts">
import { computed } from 'vue';
import { useEnginePreload } from '@/composables/use-engine-preload';

/** Estado del motor de IA (solo escritorio): descarga, listo o no disponible. */
const { status, progress, reason } = useEnginePreload();

const text = computed(() => {
  switch (status.value) {
    case 'loading': {
      const p = progress.value;
      if (!p || !p.totalMb) return 'Preparando motor de IA…';
      if (p.progress >= 0.999) return 'Inicializando motor de IA en la GPU…';
      return `Descargando motor de IA: ${Math.round(p.progress * 100)}% (${Math.round(p.loadedMb)} / ${Math.round(p.totalMb)} MB)`;
    }
    case 'ready':
      return 'Motor de IA listo (Qwen3.5-0.8B, local)';
    case 'unavailable':
      return `Motor de IA no disponible (${reason.value}). Se usará OCR.`;
    default:
      return '';
  }
});
</script>

<template>
  <p v-if="status !== 'idle'" class="engine-status" :class="`engine-${status}`" role="status">
    <span class="dot" aria-hidden="true" />
    <span>{{ text }}</span>
    <span v-if="status === 'loading' && progress?.totalMb" class="bar" aria-hidden="true">
      <span :style="{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }" />
    </span>
  </p>
</template>

<style scoped>
.engine-status {
  --tone: var(--accent);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.engine-ready {
  --tone: var(--ok);
}
.engine-unavailable {
  --tone: var(--warn);
}
.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tone);
}
.engine-loading .dot {
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
.bar {
  flex: 0 0 8rem;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--tone);
  transition: width 0.3s;
}
</style>

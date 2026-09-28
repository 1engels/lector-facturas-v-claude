<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ file: File; previewUrl: string | null }>();

const sizeLabel = computed(() => {
  const kb = props.file.size / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
});
</script>

<template>
  <figure class="preview">
    <img v-if="previewUrl" :src="previewUrl" :alt="`Vista previa de ${file.name}`" />
    <div v-else class="placeholder">Sin vista previa</div>
    <figcaption>
      <span class="name" :title="file.name">{{ file.name }}</span>
      <span class="size">{{ sizeLabel }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.preview {
  margin: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
img {
  display: block;
  width: 100%;
  max-height: 75vh;
  object-fit: contain;
  object-position: top;
  background: #fff;
}
.placeholder {
  display: grid;
  place-items: center;
  min-height: 12rem;
  color: var(--text-muted);
}
figcaption {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0.9rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { InvoiceResult } from '@/invoice-extractor';

const props = defineProps<{ result: InvoiceResult; elapsedMs: number }>();

const INPUT_LABEL = {
  'pdf-digital': 'PDF digital',
  'pdf-scan': 'PDF escaneado',
  image: 'Imagen',
  xml: 'XML UBL',
} as const;

const ENGINE_LABEL: Record<string, string> = {
  qr: 'QR',
  'pdf-text': 'Texto PDF',
  xml: 'XML',
  tesseract: 'Tesseract',
  paddleocr: 'PaddleOCR',
  'qwen3.5-0.8b': 'IA (Qwen3.5-0.8B)',
};

const TIPO_LABEL: Record<string, string> = {
  '01': 'Factura',
  '03': 'Boleta',
  '07': 'Nota de crédito',
  '08': 'Nota de débito',
};

const rows = computed(() => {
  const m = props.result.meta;
  return [
    ['Entrada', INPUT_LABEL[m.inputKind]],
    ['Tipo', m.tipoComprobante ? (TIPO_LABEL[m.tipoComprobante] ?? m.tipoComprobante) : '—'],
    ['QR SUNAT', m.qrFound ? 'Leído' : 'No encontrado'],
    ['Motores', m.engines.map((e) => ENGINE_LABEL[e] ?? e).join(' → ') || '—'],
    ...(m.ocrConfidence != null ? ([['Confianza OCR', `${Math.round(m.ocrConfidence * 100)}%`]] as const) : []),
    ['Moneda', m.moneda ?? '—'],
    ['Base imponible', m.baseImponible?.toFixed(2) ?? '—'],
    ['Tiempo total', `${(props.elapsedMs / 1000).toFixed(2)} s`],
  ] as const;
});

const timings = computed(() =>
  Object.entries(props.result.meta.timings)
    .map(([k, v]) => `${k} ${v} ms`)
    .join(' · '),
);
</script>

<template>
  <section class="summary">
    <dl>
      <template v-for="[label, value] in rows" :key="label">
        <dt>{{ label }}</dt>
        <dd>{{ value }}</dd>
      </template>
    </dl>
    <p v-if="timings" class="timings">{{ timings }}</p>
    <ul v-if="result.meta.warnings.length" class="warnings">
      <li v-for="w in result.meta.warnings" :key="w">{{ w }}</li>
    </ul>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 0.875rem;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}
dt {
  color: var(--text-muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.timings {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.warnings {
  margin: 0;
  padding-left: 1.2rem;
  color: color-mix(in srgb, var(--warn) 70%, var(--text));
}
</style>

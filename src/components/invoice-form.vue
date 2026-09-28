<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { appConfig } from '@/app-config';
import {
  INVOICE_FIELDS,
  Invoice,
  buyerMismatchMessage,
  checkBuyer,
  invoiceSchemaFor,
  validateInvoice,
  type FieldSource,
  type InvoiceFieldName,
  type InvoiceResult,
} from '@/invoice-extractor';

const props = defineProps<{ result: InvoiceResult }>();

interface FieldConfig {
  label: string;
  input: 'text' | 'date' | 'money' | 'textarea';
  placeholder?: string;
}

const CONFIG: Record<InvoiceFieldName, FieldConfig> = {
  razonSocial: { label: 'Razón social emisor', input: 'text' },
  ruc: { label: 'RUC emisor', input: 'text', placeholder: '20XXXXXXXXX' },
  rucAdquirente: { label: 'RUC adquirente', input: 'text', placeholder: appConfig.buyerRuc ?? '20XXXXXXXXX' },
  correlativo: { label: 'Correlativo', input: 'text', placeholder: 'F001-123' },
  fechaEmision: { label: 'Fecha de emisión', input: 'date' },
  montoTotal: { label: 'Monto total', input: 'money', placeholder: '0.00' },
  igv: { label: 'IGV', input: 'money', placeholder: '0.00' },
  descripcion: { label: 'Descripción', input: 'textarea' },
};

const SOURCE_LABEL: Record<FieldSource, string> = {
  xml: 'XML',
  qr: 'QR',
  'pdf-text': 'Texto PDF',
  ocr: 'OCR',
  ia: 'IA',
  manual: 'Manual',
};

const values = reactive({} as Record<InvoiceFieldName, string>);
const edited = reactive(new Set<InvoiceFieldName>());
const errors = ref<Partial<Record<InvoiceFieldName, string>>>({});
const output = ref<string | null>(null);
const copied = ref(false);

watch(
  () => props.result,
  (res) => {
    for (const key of INVOICE_FIELDS) {
      const v = res.fields[key].value;
      values[key] = v == null ? '' : typeof v === 'number' ? v.toFixed(2) : v;
    }
    edited.clear();
    errors.value = {};
    output.value = null;
  },
  { immediate: true },
);

function onInput(key: InvoiceFieldName) {
  edited.add(key);
  delete errors.value[key];
  output.value = null;
}

type Level = 'ok' | 'check' | 'review' | 'missing' | 'manual';

function level(key: InvoiceFieldName): Level {
  if (edited.has(key)) return 'manual';
  const f = props.result.fields[key];
  if (f.value == null) return 'missing';
  if (f.confidence >= 0.85) return 'ok';
  if (f.confidence >= 0.6) return 'check';
  return 'review';
}

function badge(key: InvoiceFieldName): string {
  if (edited.has(key)) return SOURCE_LABEL.manual;
  const f = props.result.fields[key];
  if (!f.source) return 'No encontrado';
  return `${SOURCE_LABEL[f.source]} · ${Math.round(f.confidence * 100)}%`;
}

const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

function candidate() {
  return {
    razonSocial: values.razonSocial,
    ruc: values.ruc.replace(/\s/g, ''),
    rucAdquirente: values.rucAdquirente.replace(/\s/g, ''),
    correlativo: values.correlativo.trim().toUpperCase(),
    fechaEmision: values.fechaEmision,
    montoTotal: toNumber(values.montoTotal),
    igv: toNumber(values.igv),
    descripcion: values.descripcion,
  };
}

/** Destinatario: ¿el comprobante va dirigido a nuestra empresa? Se recalcula al editar. */
const buyerStatus = computed(() => {
  const expected = appConfig.buyerRuc;
  if (!expected) return null;
  const adq = candidate().rucAdquirente;
  const check = checkBuyer(adq, expected);
  const text =
    check === 'match'
      ? `Dirigido a tu empresa (RUC ${expected}).`
      : (buyerMismatchMessage(adq, expected) ?? '');
  return { check, text };
});

/** Observaciones de negocio en vivo (checksum RUC, montos, fecha, emisor = tu empresa). */
const businessIssues = computed(() => {
  const c = candidate();
  const issues = validateInvoice(
    {
      ruc: c.ruc || null,
      rucAdquirente: c.rucAdquirente || null,
      fechaEmision: c.fechaEmision || null,
      montoTotal: Number.isNaN(c.montoTotal) ? null : c.montoTotal,
      igv: Number.isNaN(c.igv) ? null : c.igv,
      baseImponible: props.result.meta.baseImponible,
    },
    { expectedBuyerRuc: appConfig.buyerRuc },
  );
  // El destinatario ya se muestra en su propio aviso.
  return issues.filter((msg) => msg !== buyerStatus.value?.text);
});

/** Con RUC comprador configurado, el JSON solo se genera si el comprobante va dirigido a él. */
const schema = appConfig.buyerRuc ? invoiceSchemaFor(appConfig.buyerRuc) : Invoice;

function submit() {
  const data = candidate();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const next: Partial<Record<InvoiceFieldName, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as InvoiceFieldName;
      const empty = issue.code === 'invalid_type' || data[key] === '';
      next[key] ??= empty ? 'Campo obligatorio' : issue.message;
    }
    errors.value = next;
    output.value = null;
    return;
  }
  errors.value = {};
  output.value = JSON.stringify(parsed.data, null, 2);
}

async function copy() {
  if (!output.value) return;
  await navigator.clipboard.writeText(output.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <form class="invoice-form" novalidate @submit.prevent="submit">
    <p v-if="buyerStatus" class="buyer" :class="`buyer-${buyerStatus.check}`" role="status">
      <span class="buyer-icon" aria-hidden="true">{{ buyerStatus.check === 'match' ? '✓' : '✕' }}</span>
      {{ buyerStatus.text }}
    </p>

    <div v-for="key in INVOICE_FIELDS" :key="key" class="field" :class="[`level-${level(key)}`, { invalid: errors[key] }]">
      <div class="field-head">
        <label :for="`f-${key}`">{{ CONFIG[key].label }}</label>
        <span class="badge">{{ badge(key) }}</span>
      </div>
      <textarea
        v-if="CONFIG[key].input === 'textarea'"
        :id="`f-${key}`"
        v-model="values[key]"
        rows="3"
        @input="onInput(key)"
      />
      <input
        v-else
        :id="`f-${key}`"
        v-model="values[key]"
        :type="CONFIG[key].input === 'date' ? 'date' : 'text'"
        :inputmode="CONFIG[key].input === 'money' ? 'decimal' : undefined"
        :placeholder="CONFIG[key].placeholder"
        autocomplete="off"
        @input="onInput(key)"
      />
      <p v-if="errors[key]" class="error">{{ errors[key] }}</p>
    </div>

    <ul v-if="businessIssues.length" class="issues">
      <li v-for="msg in businessIssues" :key="msg">{{ msg }}</li>
    </ul>

    <div class="actions">
      <button type="submit" class="primary">Validar y generar JSON</button>
    </div>

    <div v-if="output" class="output">
      <div class="output-head">
        <span>Listo para enviar al backend</span>
        <button type="button" @click="copy">{{ copied ? 'Copiado' : 'Copiar' }}</button>
      </div>
      <pre>{{ output }}</pre>
    </div>
  </form>
</template>

<style scoped>
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.buyer {
  --tone: var(--bad);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
  padding: 0.7rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  font-weight: 600;
  font-size: 0.9rem;
}
.buyer-match {
  --tone: var(--ok);
}
.buyer-icon {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tone);
  color: #fff;
  font-size: 0.8rem;
}
.field {
  --level: var(--border-strong);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
label {
  font-weight: 600;
  font-size: 0.9rem;
}
.badge {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--level) 16%, transparent);
  color: color-mix(in srgb, var(--level) 75%, var(--text));
  white-space: nowrap;
}
input,
textarea {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border-strong);
  border-left: 4px solid var(--level);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  resize: vertical;
}
input:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.level-ok {
  --level: var(--ok);
}
.level-check {
  --level: var(--warn);
}
.level-review,
.level-missing {
  --level: var(--bad);
}
.level-manual {
  --level: var(--accent);
}
.invalid input,
.invalid textarea {
  border-color: var(--bad);
}
.error {
  margin: 0;
  color: var(--bad);
  font-size: 0.8rem;
}
.issues {
  margin: 0;
  padding: 0.7rem 0.9rem 0.7rem 2rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  font-size: 0.875rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
.output {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.output-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.4rem 0.4rem 0.8rem;
  background: var(--surface-2);
  font-size: 0.85rem;
}
pre {
  margin: 0;
  padding: 0.8rem;
  overflow-x: auto;
  font-size: 0.8rem;
}
</style>

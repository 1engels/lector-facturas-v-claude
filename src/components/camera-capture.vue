<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { isCameraApiAvailable, useCamera } from '@/composables/use-camera';
import { chooseCameraStrategy, detectDevice } from '@/platform/device';

defineProps<{ compact?: boolean }>();
const emit = defineEmits<{
  file: [file: File];
  /** La página se recargó mientras la app de cámara nativa estaba abierta (pestaña descartada). */
  interrupted: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const nativeInput = ref<HTMLInputElement | null>(null);
const shot = ref<{ blob: Blob; url: string } | null>(null);
const busy = ref(false);

const camera = useCamera(video);

// ─── Cámara nativa (iOS, o respaldo sin HTTPS) ───────────────────────────────
// Mientras la cámara nativa está abierta el sistema puede descartar la pestaña (sobre
// todo en Android con poca memoria); al volver, la página se recarga y la foto se
// pierde. Se marca la captura en curso para poder avisar al usuario si eso ocurre.

const PENDING_KEY = 'camera-capture:native-pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

function setPending(pending: boolean) {
  try {
    if (pending) sessionStorage.setItem(PENDING_KEY, String(Date.now()));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // sessionStorage no disponible (modo privado estricto): solo se pierde el aviso.
  }
}

function openNative() {
  setPending(true);
  nativeInput.value?.click();
}

onMounted(() => {
  let since = 0;
  try {
    since = Number(sessionStorage.getItem(PENDING_KEY));
  } catch {
    since = 0;
  }
  setPending(false);
  if (since > 0 && Date.now() - since < PENDING_TTL_MS) emit('interrupted');
});

// ─── Elección según el dispositivo ───────────────────────────────────────────

/** Se decide al pulsar (no al montar): el mismo build se abre en iPhone, Android o PC. */
function open() {
  const strategy = chooseCameraStrategy(detectDevice(), isCameraApiAvailable());
  if (strategy === 'none') return;
  if (strategy === 'native') {
    openNative();
    return;
  }
  dialog.value?.showModal();
  void camera.start();
}

function close() {
  camera.stop();
  discardShot();
  dialog.value?.close();
}

async function takePhoto() {
  busy.value = true;
  try {
    const blob = await camera.capture();
    shot.value = { blob, url: URL.createObjectURL(blob) };
    camera.stop();
  } catch (err) {
    camera.error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function discardShot() {
  if (shot.value) URL.revokeObjectURL(shot.value.url);
  shot.value = null;
}

function retake() {
  discardShot();
  void camera.start();
}

function usePhoto() {
  if (!shot.value) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const type = shot.value.blob.type || 'image/jpeg';
  const file = new File([shot.value.blob], `foto-${stamp}.${type.split('/')[1] ?? 'jpg'}`, { type });
  close();
  emit('file', file);
}

/** Respaldo cuando getUserMedia falla (permiso denegado, sin cámara): selector nativo. */
function useNativeFallback() {
  close();
  openNative();
}

function onNativeChange(e: Event) {
  setPending(false);
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('file', file);
}

onBeforeUnmount(discardShot);
</script>

<template>
  <button type="button" class="camera-button" :class="{ compact }" @click="open">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .8.4L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
    <span>Tomar foto</span>
  </button>

  <input ref="nativeInput" type="file" accept="image/*" capture="environment" hidden @change="onNativeChange" @cancel="setPending(false)" />

  <dialog ref="dialog" class="camera-dialog" @cancel.prevent="close">
    <div class="viewer">
      <img v-if="shot" :src="shot.url" alt="Foto capturada" />
      <video v-show="!shot" ref="video" autoplay muted playsinline />
      <div v-if="!shot && camera.status.value === 'live'" class="guide" aria-hidden="true" />

      <p v-if="camera.status.value === 'starting'" class="overlay">Abriendo cámara…</p>
      <div v-else-if="camera.status.value === 'error'" class="overlay error">
        <p>{{ camera.error.value }}</p>
        <button type="button" @click="useNativeFallback">Elegir una imagen</button>
      </div>
    </div>

    <p v-if="!shot && camera.status.value === 'live'" class="hint">
      Encuadra el comprobante completo, con buena luz y sin reflejos.
    </p>

    <div class="controls">
      <button type="button" @click="close">Cancelar</button>
      <template v-if="shot">
        <button type="button" @click="retake">Repetir</button>
        <button type="button" class="primary" @click="usePhoto">Usar foto</button>
      </template>
      <template v-else>
        <button v-if="camera.devices.value.length > 1" type="button" @click="camera.switchCamera">Cambiar cámara</button>
        <button type="button" class="primary" :disabled="camera.status.value !== 'live' || busy" @click="takePhoto">
          Capturar
        </button>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.camera-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.7rem 1.1rem;
  font-weight: 600;
}
.camera-button.compact {
  padding: 0.6rem 1rem;
}
.camera-button svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linejoin: round;
}
.camera-dialog {
  width: min(960px, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}
.camera-dialog::backdrop {
  background: rgb(0 0 0 / 0.6);
}
.viewer {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 16rem;
  border-radius: 8px;
  background: #000;
  overflow: hidden;
}
video,
img {
  display: block;
  width: 100%;
  max-height: 70dvh;
  object-fit: contain;
}
.guide {
  position: absolute;
  inset: 6%;
  border: 2px dashed rgb(255 255 255 / 0.55);
  border-radius: 8px;
  pointer-events: none;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  margin: 0;
  padding: 1rem;
  color: #fff;
  text-align: center;
}
.overlay p {
  margin: 0;
}
.hint {
  margin: 0.6rem 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.8rem;
}
/* Celular: visor a pantalla completa. */
@media (max-width: 600px) {
  .camera-dialog {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0.75rem;
    border: 0;
    border-radius: 0;
  }
  .viewer {
    height: calc(100dvh - 8.5rem);
  }
  video,
  img {
    height: 100%;
    max-height: none;
  }
  .controls button {
    flex: 1;
    padding: 0.8rem;
  }
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';

/** Resolución pedida: la más alta posible para que el OCR lea texto pequeño. */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 3840 },
  height: { ideal: 2160 },
};

/** ¿El navegador permite abrir la cámara desde la página? (requiere contexto seguro: https o localhost). */
export const isCameraApiAvailable = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Se denegó el permiso para usar la cámara.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara disponible.';
    case 'NotReadableError':
      return 'La cámara está siendo usada por otra aplicación.';
    default:
      return 'No se pudo abrir la cámara.';
  }
}

/**
 * Stream de cámara con getUserMedia: iniciar, cambiar de cámara, capturar y detener.
 * El stream se detiene siempre al desmontar el componente.
 */
export function useCamera(video: Ref<HTMLVideoElement | null>) {
  const status = ref<CameraStatus>('idle');
  const error = ref<string | null>(null);
  const devices = ref<MediaDeviceInfo[]>([]);
  const stream = shallowRef<MediaStream | null>(null);
  let deviceIndex = -1;

  async function start(deviceId?: string) {
    stop();
    status.value = 'starting';
    error.value = null;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { ...VIDEO_CONSTRAINTS, facingMode: undefined, deviceId: { exact: deviceId } } : VIDEO_CONSTRAINTS,
      });
      stream.value = media;
      if (video.value) {
        video.value.srcObject = media;
        await video.value.play();
      }
      // Las etiquetas de los dispositivos solo están disponibles tras conceder el permiso.
      devices.value = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const currentId = media.getVideoTracks()[0]?.getSettings().deviceId;
      deviceIndex = devices.value.findIndex((d) => d.deviceId === currentId);
      status.value = 'live';
    } catch (err) {
      console.error(err);
      error.value = describeError(err);
      status.value = 'error';
    }
  }

  /** Pasa a la siguiente cámara (frontal ↔ trasera, o entre webcams). */
  async function switchCamera() {
    if (devices.value.length < 2) return;
    deviceIndex = (deviceIndex + 1) % devices.value.length;
    await start(devices.value[deviceIndex]!.deviceId);
  }

  /** Foto a máxima resolución (ImageCapture) o, si no está disponible, el cuadro actual del video. */
  async function capture(): Promise<Blob> {
    const track = stream.value?.getVideoTracks()[0];
    if (track && 'ImageCapture' in window) {
      try {
        const ImageCaptureCtor = (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
        return await new ImageCaptureCtor(track).takePhoto();
      } catch {
        // Algunas cámaras/navegadores no soportan takePhoto: se usa el cuadro del video.
      }
    }
    const el = video.value;
    if (!el || !el.videoWidth) throw new Error('La cámara aún no está lista.');
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d')!.drawImage(el, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo capturar la imagen.'))), 'image/jpeg', 0.92),
    );
  }

  function stop() {
    stream.value?.getTracks().forEach((t) => t.stop());
    stream.value = null;
    if (video.value) video.value.srcObject = null;
    if (status.value !== 'error') status.value = 'idle';
  }

  onBeforeUnmount(stop);

  return { status, error, devices, start, switchCamera, capture, stop };
}

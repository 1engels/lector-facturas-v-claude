/**
 * Detección del tipo de dispositivo, para elegir cómo capturar fotos.
 * Funciones puras (reciben las pistas del navegador) para poder testearlas.
 */

export type DeviceKind = 'ios' | 'android' | 'desktop';

export interface DeviceHints {
  userAgent: string;
  /** navigator.platform: obsoleto, pero es la única forma de distinguir un iPad en "modo escritorio". */
  platform?: string;
  maxTouchPoints?: number;
}

export function currentDeviceHints(): DeviceHints {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

export function detectDevice(hints: DeviceHints = currentDeviceHints()): DeviceKind {
  const ua = hints.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ se presenta como Mac de escritorio; se delata por tener pantalla táctil.
  if (/Macintosh|MacIntel/i.test(`${ua} ${hints.platform ?? ''}`) && (hints.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export type CameraStrategy = 'native' | 'in-page' | 'none';

/**
 * Cómo tomar la foto según el dispositivo:
 * - iOS: cámara nativa. Safari no tiene ImageCapture, así que el visor solo podría tomar
 *   un cuadro del video; la cámara nativa entrega la foto de 12 MP ya procesada (HDR,
 *   enfoque) y se abre sobre Safari sin descartar la pestaña.
 * - Android: visor dentro de la página. Abrir la app de cámara puede hacer que el sistema
 *   descarte la pestaña y la foto se pierda. Sin API de cámara (sin HTTPS): cámara nativa.
 * - Escritorio (PC/macOS): sin cámara. Las webcams de laptop no sirven para fotografiar
 *   documentos; en escritorio se cargan archivos (PDF o fotos tomadas con el celular).
 */
export function chooseCameraStrategy(device: DeviceKind, cameraApiAvailable: boolean): CameraStrategy {
  if (device === 'desktop') return 'none';
  if (device === 'ios') return 'native';
  return cameraApiAvailable ? 'in-page' : 'native';
}

/**
 * Motor de lectura por defecto: en escritorio, el modelo de visión (Qwen3.5-0.8B con
 * WebGPU); en celulares, OCR (Tesseract + PaddleOCR), que es liviano en memoria.
 */
export const defaultEngine = (device: DeviceKind): 'vlm' | 'ocr' => (device === 'desktop' ? 'vlm' : 'ocr');

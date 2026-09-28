import { describe, expect, it } from 'vitest';
import { chooseCameraStrategy, defaultEngine, detectDevice } from './device';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  // iPadOS en "modo escritorio": idéntico a Safari de Mac.
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

describe('detectDevice', () => {
  it('iPhone con Safari o Chrome (ambos WebKit)', () => {
    expect(detectDevice({ userAgent: UA.iphoneSafari })).toBe('ios');
    expect(detectDevice({ userAgent: UA.iphoneChrome })).toBe('ios');
  });

  it('iPad en modo escritorio se detecta por la pantalla táctil', () => {
    expect(detectDevice({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
  });

  it('Mac de escritorio no es iOS', () => {
    expect(detectDevice({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop');
  });

  it('Android y Windows', () => {
    expect(detectDevice({ userAgent: UA.android, maxTouchPoints: 5 })).toBe('android');
    expect(detectDevice({ userAgent: UA.windows, platform: 'Win32', maxTouchPoints: 0 })).toBe('desktop');
  });
});

describe('chooseCameraStrategy', () => {
  it('iOS siempre usa la cámara nativa', () => {
    expect(chooseCameraStrategy('ios', true)).toBe('native');
  });

  it('Android usa el visor si hay API de cámara (HTTPS); si no, la cámara nativa', () => {
    expect(chooseCameraStrategy('android', true)).toBe('in-page');
    expect(chooseCameraStrategy('android', false)).toBe('native');
  });

  it('escritorio no ofrece cámara (webcams no sirven para documentos)', () => {
    expect(chooseCameraStrategy('desktop', true)).toBe('none');
    expect(chooseCameraStrategy('desktop', false)).toBe('none');
  });
});

describe('defaultEngine', () => {
  it('escritorio usa el modelo de visión; celulares, OCR', () => {
    expect(defaultEngine('desktop')).toBe('vlm');
    expect(defaultEngine('ios')).toBe('ocr');
    expect(defaultEngine('android')).toBe('ocr');
  });
});

// ============================================================================
// QR decoding, abstracted over two very different implementations.
//
// The gate is used on whatever device the guard has. That splits cleanly in two:
//
//   BarcodeDetector — native, hardware-accelerated, zero bytes to download.
//                     Chrome/Edge on Android and desktop. Preferred whenever it
//                     exists AND actually advertises qr_code support.
//   jsQR            — pure JS fallback, lazy-loaded only when the native path is
//                     missing. This is the iOS/Safari path, which has no
//                     BarcodeDetector at all — i.e. every iPhone and iPad.
//
// Both are reduced to the same one-method interface so QrScanner.tsx contains no
// branching on which one is live. Picking the decoder is a decision made once,
// here; the component only ever asks "did you see a code in this frame?".
// ============================================================================

/** Minimal shape of the native API — it is not in TypeScript's DOM lib. */
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface QrDecoder {
  /** The decoder's name, surfaced in the UI only as a debug affordance. */
  readonly kind: 'native' | 'jsqr';
  /** Returns the decoded text, or null when this frame held no readable code. */
  detect(video: HTMLVideoElement): Promise<string | null>;
}

function nativeCtor(): NativeBarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Reused across frames rather than reallocated 10x/second. A fresh canvas per
 * frame is the classic way to make a scanner feel sluggish on a cheap Android
 * phone — allocation and GC cost more than the decode does.
 */
function createFrameGrabber() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return function grab(video: HTMLVideoElement): ImageData | null {
    const w = video.videoWidth;
    const h = video.videoHeight;
    // Guard against the first frames, before metadata has landed — drawImage
    // with a zero-sized source throws.
    if (!ctx || w === 0 || h === 0) return null;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    try {
      return ctx.getImageData(0, 0, w, h);
    } catch {
      // Tainted canvas. Cannot happen with a getUserMedia stream, but a throw
      // here would kill the scan loop, and a dropped frame is recoverable.
      return null;
    }
  };
}

/**
 * Chooses the best decoder available on this device.
 *
 * Native support is confirmed via getSupportedFormats() rather than assumed from
 * the constructor existing: some builds ship BarcodeDetector without the
 * qr_code format, and constructing one for a format it cannot read fails at
 * detect() time — i.e. as a scanner that silently never finds anything.
 */
export async function createDecoder(): Promise<QrDecoder> {
  const Ctor = nativeCtor();
  if (Ctor) {
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? [];
      if (formats.includes('qr_code')) {
        const detector = new Ctor({ formats: ['qr_code'] });
        return {
          kind: 'native',
          async detect(video) {
            try {
              const found = await detector.detect(video);
              return found[0]?.rawValue?.trim() || null;
            } catch {
              // Detect can throw transiently while the video is still settling.
              return null;
            }
          },
        };
      }
    } catch {
      // Fall through to jsQR — a broken native path is not worth diagnosing
      // at a gate.
    }
  }

  // Lazy: this chunk is only fetched on devices that actually need it, so the
  // native path costs nothing.
  const { default: jsQR } = await import('jsqr');
  const grab = createFrameGrabber();

  return {
    kind: 'jsqr',
    async detect(video) {
      const frame = grab(video);
      if (!frame) return null;
      // `attemptBoth` handles codes printed light-on-dark as well as the usual
      // dark-on-light — a photocopied slip can come out either way.
      const result = jsQR(frame.data, frame.width, frame.height, {
        inversionAttempts: 'attemptBoth',
      });
      return result?.data?.trim() || null;
    },
  };
}

/**
 * Why a scan can fail before decoding ever starts. Kept as a discriminated set
 * so the UI can give a specific instruction instead of "camera error" — a guard
 * who denied the permission prompt needs different advice from one whose device
 * has no camera.
 */
export type CameraFailure = 'denied' | 'not-found' | 'insecure-context' | 'unsupported' | 'unknown';

export function classifyCameraError(err: unknown): CameraFailure {
  // getUserMedia is absent entirely on http:// origins other than localhost.
  // This is the single most likely failure in a real deployment: the app served
  // over plain HTTP on the site LAN, where the camera API simply does not exist.
  if (!globalThis.isSecureContext) return 'insecure-context';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';

  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not-found';
  return 'unknown';
}

export const CAMERA_FAILURE_MESSAGE: Record<CameraFailure, string> = {
  denied:
    'Camera access was blocked. Allow it for this site in your browser settings, then try again — or type the pass number below.',
  'not-found': 'No camera was found on this device. Type the pass number below instead.',
  'insecure-context':
    'The camera only works over HTTPS. Open this site with https:// (or use localhost during development), then try again.',
  unsupported:
    'This browser cannot use the camera. Try Chrome or Safari, or type the pass number below.',
  unknown: 'The camera could not be started. Type the pass number below instead.',
};

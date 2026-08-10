// ============================================================================
// Camera QR scanner for the gate console.
//
// Deliberately NOT a modal: a guard is standing at a gate holding a phone in one
// hand with a truck waiting. It mounts inline, fills the width, and can be shut
// with one large button. The typed-entry field stays visible underneath it at
// all times — see GateConsole — because a smudged, torn or rain-soaked slip is a
// normal Tuesday and the camera must never become the only way in.
//
// Decoding lives in src/lib/qrDecode.ts, which picks the native BarcodeDetector
// or lazy-loads jsQR. This file owns only the camera, the loop, and teardown.
// ============================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAMERA_FAILURE_MESSAGE,
  classifyCameraError,
  createDecoder,
  type CameraFailure,
  type QrDecoder,
} from '../lib/qrDecode';

interface QrScannerProps {
  /** Called once with the decoded text. The scanner stops itself first. */
  onScan: (value: string) => void;
  /** Called when the guard closes the scanner without a result. */
  onClose: () => void;
}

/** ~8 scans/second. Fast enough to feel instant, slow enough that a budget
 *  Android phone does not heat up or drain battery holding a viewfinder open. */
const SCAN_INTERVAL_MS = 120;

export default function QrScanner({ onScan, onClose }: QrScannerProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const decoderRef = useRef<QrDecoder | null>(null);
  /** Latches on first hit so a code held in frame cannot fire onScan repeatedly
   *  — which would otherwise re-navigate mid-transition. */
  const doneRef = useRef(false);

  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [starting, setStarting] = useState(true);

  /** Idempotent: called on unmount, on a hit, and on error. Leaving a track live
   *  keeps the phone's camera light on, which reads as the app spying. */
  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
      } catch {
        // Detached node — nothing to release.
      }
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Already ended.
        }
      }
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');

        // `environment` asks for the rear camera. It is a preference, not a
        // constraint (`ideal`, not `exact`) so a laptop with only a front
        // webcam still works rather than failing outright.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        // The component may have unmounted while the permission prompt was up.
        // Without this the stream leaks and the camera light stays on.
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // playsInline stops iOS Safari from hijacking into fullscreen video.
          video.setAttribute('playsinline', 'true');
          await video.play().catch(() => {
            // Autoplay rejection: the frames still arrive, the loop still reads
            // them. Not worth failing the whole scanner over.
          });
        }

        decoderRef.current = await createDecoder();
        if (cancelled) return;
        setStarting(false);

        timerRef.current = window.setInterval(async () => {
          if (doneRef.current) return;
          const el = videoRef.current;
          const decoder = decoderRef.current;
          if (!el || !decoder || el.readyState < 2) return;

          const value = await decoder.detect(el);
          if (!value || doneRef.current || cancelled) return;

          doneRef.current = true;
          stop();
          onScan(value);
        }, SCAN_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setFailure(classifyCameraError(err));
        setStarting(false);
        stop();
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onScan, stop]);

  if (failure) {
    return (
      <div className="rounded-xl border border-flagged-200 bg-flagged-50 p-4">
        <p className="font-semibold text-flagged-800">Camera unavailable</p>
        <p className="mt-1 text-sm text-flagged-700">{CAMERA_FAILURE_MESSAGE[failure]}</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={onClose}>
          Close scanner
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-navy-200 bg-black overflow-hidden">
      <div className="relative">
        {/* Deliberately bg-black, not a navy-* token: this is a camera
            viewfinder, always dark regardless of theme. navy-950 inverts to
            near-white under `.dark` — the app's shipped default — which would
            put the white "Starting camera…" text (below) on a near-white
            panel, invisible by default. */}
        <video
          ref={videoRef}
          className="w-full max-h-[60vh] object-cover bg-black"
          muted
          playsInline
          aria-label="Camera viewfinder for scanning a gate pass QR code"
        />

        {/* Aiming frame. Purely decorative, hence aria-hidden — it tells a
            sighted guard where to hold the slip and nothing more. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-48 w-48 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>

        {starting && (
          <div className="absolute inset-0 grid place-items-center bg-black/70">
            <p className="text-white text-sm font-medium">Starting camera…</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 p-3">
        <p className="text-sm text-white/80" role="status">
          {starting ? 'Preparing…' : 'Hold the QR code inside the frame.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

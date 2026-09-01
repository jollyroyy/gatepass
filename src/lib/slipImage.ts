// THE PRINTED SLIP, AS A PICTURE A CHAT CAN CARRY (client, 2026-09-01: "the
// same exact print pass page should be sent out to the vendor using the
// WhatsApp as well").
//
// WhatsApp takes text and it takes files; it does not take a web page, and a
// link to one is useless here — the vendor has no account on this portal and
// every route is behind RLS. So the slip is RASTERISED: the very same
// `PassSlip` component `/pass/:id/print` renders is mounted off-screen, turned
// into a PNG, and handed to the share sheet as an attachment. One component,
// one layout, one QR — the paper and the message cannot disagree, which is the
// whole reason the markup was lifted out of `PassPrint` rather than copied.
//
// `html-to-image` is loaded LAZILY. It is only ever needed the moment somebody
// presses Send to Vendor, and it is not worth a byte on the guard's first
// paint at the gate.
import type { GatePassView } from '../types';

/** The attachment's name, which is what the vendor sees in their chat and what
 *  lands in their phone's gallery — the pass number and nothing else. */
export function slipFileName(pass: Pick<GatePassView, 'pass_number'>): string {
  return `${pass.pass_number}.png`;
}

/** `data:image/png;base64,…` → a real `File`, without `fetch`: a data URL is
 *  already the bytes, and routing them through the network stack only adds a
 *  way to fail. */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const type = meta.slice(5).split(';')[0] || 'image/png';
  const binary = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type });
}

/**
 * Waits for every `<img>` inside the slip to have finished loading.
 *
 * THE QR CODE IS DRAWN ASYNCHRONOUSLY (`QrPass` generates it in an effect) and
 * an approver's signature comes over the network, so capturing the instant the
 * node mounts would hand the vendor a slip with an empty QR box — the one
 * thing on it the gate actually scans. A stuck image is not worth blocking on
 * for ever, so this resolves on a timeout too: a slip missing a signature is
 * still a readable pass, and the alternative is a button that never returns.
 */
export function waitForImages(node: HTMLElement, timeoutMs = 5000): Promise<void> {
  const images = Array.from(node.querySelectorAll('img'));
  const pending = images.filter((img) => !img.complete || img.naturalWidth === 0);
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const timer = setTimeout(resolve, timeoutMs);
    const done = () => {
      left -= 1;
      if (left <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    pending.forEach((img) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  });
}

/**
 * The slip node as a PNG file.
 *
 * `pixelRatio: 2` because the vendor reads this on a phone and a 1x capture of
 * an A5 sheet makes the item table unreadable — and because the QR has to
 * survive being scanned off a screen at the gate.
 *
 * `backgroundColor` is white on purpose: the app ships dark, the slip itself is
 * black-on-white, and a transparent PNG dropped into a dark chat would render
 * black text on black.
 */
export async function renderSlipPng(node: HTMLElement, fileName: string): Promise<File> {
  await waitForImages(node);
  const { toPng } = await import('html-to-image');
  const options = {
    pixelRatio: 2,
    backgroundColor: 'white',
    // A SIGNATURE LIVES IN SUPABASE STORAGE, i.e. on another origin, and an
    // <img> it cannot read is silently dropped from the capture — empty
    // signature boxes on the message while the paper shows them. `cacheBust`
    // forces a CORS-mode fetch rather than reusing a cached opaque response.
    cacheBust: true,
    fetchRequestInit: { mode: 'cors' as RequestMode, credentials: 'omit' as RequestCredentials },
  };
  let dataUrl: string;
  try {
    dataUrl = await toPng(node, options);
  } catch {
    // THE WORDMARK'S WEBFONT IS NOT WORTH THE WHOLE SLIP. By default the
    // library inlines every @font-face it can find, which means fetching
    // Google's stylesheet — one flaky network call standing between an HOD and
    // a pass they need to send. Retried without fonts, the sheet renders in the
    // system faces it already uses everywhere but the lockup.
    dataUrl = await toPng(node, { ...options, skipFonts: true });
  }
  return dataUrlToFile(dataUrl, fileName);
}

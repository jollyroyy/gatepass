// SENDING THE PASS TO THE VENDOR — which of the two ways this device has.
//
// NOTHING IS SENT BY THIS APP, in either branch. There is no WhatsApp Business
// account here and no message is delivered on anybody's behalf: the HOD picks
// the chat and presses send themselves. What changes between branches is only
// how the slip gets into that chat.
//
//   SHARE SHEET — a phone. `navigator.share` with a file hands WhatsApp the
//   printed slip AND the text in one action, which is what the client asked
//   for. This is the path that actually matters: an HOD forwarding a pass to a
//   vendor is doing it from their phone.
//
//   DOWNLOAD + `wa.me` — a desktop browser, which has no file share. The slip
//   is saved and the chat opens with the text prepared, so the HOD attaches
//   the PNG themselves. Worse, and still better than a message with no pass on
//   it.
//
// A CANCELLED SHARE IS NOT A FAILURE. `navigator.share` rejects with
// `AbortError` when the user backs out of the sheet, and falling back to a
// download at that moment would drop a file on somebody who just said no.
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export interface ShareEnv {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
  /** Saves the slip under its own name. Injected so this is testable and so
   *  the DOM trick lives in exactly one place. */
  download: (file: File) => void;
  openUrl: (url: string) => void;
}

/** The browser's own share sheet, or nothing when this device has none.
 *  `canShare({ files })` is the ONLY reliable test — Chrome on Windows has
 *  `navigator.share` and refuses files. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    canShare: nav?.canShare?.bind(nav),
    share: nav?.share?.bind(nav),
    download: (file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    openUrl: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
  };
}

function aborted(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * Puts `file` and `message` in front of the HOD by the best means this device
 * has. `file` may be null — a capture that failed still leaves a message worth
 * sending, and a vendor with the pass number can be told the rest by phone.
 */
export async function sendToVendor(
  file: File | null,
  message: string,
  waHref: string,
  env: ShareEnv,
): Promise<ShareOutcome> {
  if (file && env.share && env.canShare?.({ files: [file] })) {
    try {
      await env.share({ files: [file], text: message });
      return 'shared';
    } catch (err) {
      if (aborted(err)) return 'cancelled';
      // Anything else — a share sheet that refused the file type, a browser
      // that lied about canShare — falls through to the download path rather
      // than telling the HOD "it failed" with no pass sent.
    }
  }
  if (file) env.download(file);
  env.openUrl(waHref);
  return 'downloaded';
}

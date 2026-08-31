import React, { useCallback, useEffect, useState } from 'react';
import {
  dismissInstall,
  getInstallPrompt,
  installDismissed,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '../lib/installPrompt';

// The offer to install, and the only place in the app that makes one.
//
// A PHONE SHOWS NO INSTALL BUTTON UNLESS THE SITE DRAWS ONE. Everything a
// browser checks was already in place here — manifest, icons, standalone
// display, a service worker with a fetch handler, HTTPS — and the result on a
// handset was still nothing, because Chrome has not offered an automatic
// install bar since 2019. It fires `beforeinstallprompt` at the page and waits
// to be asked. This is the asking.
//
// TWO PLATFORMS, TWO ANSWERS, AND THEY ARE NOT INTERCHANGEABLE:
//   Chrome/Edge  — a real button. `promptInstall()` opens the browser's own
//                  dialog, which is the only thing that can install anything;
//                  no page can do it directly.
//   iOS Safari   — a sentence. WebKit fires no event and exposes no API, and
//                  every browser on iOS is WebKit, so Chrome on an iPhone
//                  cannot install this either. Share → Add to Home Screen is
//                  the whole mechanism, and it is invisible until described.
//
// It renders NOTHING inside the installed app, and nothing once dismissed. A
// banner on every screen that cannot be got rid of is an advertisement.

const IosShareIcon = (
  <svg className="w-5 h-5 shrink-0 mt-0.5 text-accent-600" fill="none" viewBox="0 0 24 24"
    stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3m0 0L8.25 6.75M12 3l3.75 3.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75v5.25A2.25 2.25 0 0 0 6.75 20.25h10.5A2.25 2.25 0 0 0 19.5 18v-5.25" />
  </svg>
);

const InstallIcon = (
  <svg className="w-5 h-5 shrink-0 mt-0.5 text-accent-600" fill="none" viewBox="0 0 24 24"
    stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 3.75-3.75M12 15l-3.75-3.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75V18a2.25 2.25 0 0 0 2.25 2.25h10.5A2.25 2.25 0 0 0 19.5 18v-2.25" />
  </svg>
);

export default function InstallAppBanner(): React.ReactElement | null {
  // Not derived state: the event can arrive at any moment after mount, and on
  // iOS it never arrives at all.
  const [canPrompt, setCanPrompt] = useState<boolean>(() => getInstallPrompt() !== null);
  const [hidden, setHidden] = useState<boolean>(() => installDismissed());

  useEffect(() => subscribeInstallPrompt(() => setCanPrompt(getInstallPrompt() !== null)), []);

  const install = useCallback(async () => {
    const outcome = await promptInstall();
    // Accepted or refused, the event is spent and the button would no longer do
    // anything. Only an outright refusal is remembered as a dismissal — Chrome
    // may offer the event again later, and that offer should be honoured.
    setCanPrompt(false);
    if (outcome === 'dismissed') dismissInstall();
  }, []);

  const dismiss = useCallback(() => { dismissInstall(); setHidden(true); }, []);

  if (hidden) return null;
  if (isStandalone()) return null;

  const ios = isIosDevice();
  if (!canPrompt && !ios) return null;

  return (
    <div
      role="region"
      aria-label="Install this app"
      className="no-print mb-5 rounded-2xl px-4 py-3 flex items-start gap-3
                 border border-accent-600/25 bg-accent-600/5">
      {ios && !canPrompt ? IosShareIcon : InstallIcon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-navy-800">Install Gate Pass on this phone</p>
        {ios && !canPrompt ? (
          <p className="text-sm text-navy-600 mt-0.5">
            Tap <span className="font-semibold">Share</span> at the bottom of Safari, then{' '}
            <span className="font-semibold">Add to Home Screen</span>. It opens full screen,
            without the address bar.
          </p>
        ) : (
          <p className="text-sm text-navy-600 mt-0.5">
            Opens full screen from your home screen, without the address bar.
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          {canPrompt && (
            <button type="button" className="btn-primary !px-4 !py-2" onClick={() => { void install(); }}>
              Install app
            </button>
          )}
          <button type="button" className="btn-ghost !px-4 !py-2 text-sm" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

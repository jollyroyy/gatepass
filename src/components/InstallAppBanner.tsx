import React, { useCallback, useEffect, useState } from 'react';
import {
  dismissInstall,
  getInstallPrompt,
  installDismissed,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '../lib/installPrompt';
import { installGuidance, manualInstallHint } from '../lib/installGuidance';

// The offer to install, and the only place in the app that makes one.
//
// A PHONE SHOWS NO INSTALL BUTTON UNLESS THE SITE DRAWS ONE. Everything a
// browser checks was already in place here — manifest, icons, standalone
// display, a service worker with a fetch handler, HTTPS — and the result on a
// handset was still nothing, because Chrome has not offered an automatic
// install bar since 2019. It fires `beforeinstallprompt` at the page and waits
// to be asked. This is the asking.
//
// WHICH of the five possible answers a given browser needs is decided in
// lib/installGuidance.ts — Chromium's event, Safari's Share sheet, the same
// sheet reached through Chrome-on-iOS's own menu, Firefox for Android's ⋮
// Install, or "you are inside an app's webview and cannot install from here".
// This file only renders them.
//
// It renders NOTHING inside the installed app, and nothing once dismissed. A
// banner on every screen that cannot be got rid of is an advertisement.

const IosShareIcon = (
  <svg className="w-6 h-6 shrink-0 mt-0.5 text-accent-600" fill="none" viewBox="0 0 24 24"
    stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3m0 0L8.25 6.75M12 3l3.75 3.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75v5.25A2.25 2.25 0 0 0 6.75 20.25h10.5A2.25 2.25 0 0 0 19.5 18v-5.25" />
  </svg>
);

const InstallIcon = (
  <svg className="w-6 h-6 shrink-0 mt-0.5 text-accent-600" fill="none" viewBox="0 0 24 24"
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

  const { kind } = installGuidance({ canPrompt });
  if (kind === 'none') return null;
  const prompting = kind === 'prompt';

  return (
    <div
      role="region"
      aria-label="Install this app"
      className="no-print mb-5 rounded-2xl px-4 py-3 flex items-start gap-3
                 border border-accent-600/25 bg-accent-600/5">
      {prompting ? InstallIcon : IosShareIcon}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold text-navy-800">Install Gate Pass</p>
        <p className="text-lg text-navy-600 mt-0.5 leading-relaxed">
          {prompting
            ? 'Opens full screen from your home screen, without the address bar.'
            : manualInstallHint()}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          {prompting && (
            <button type="button" className="btn-primary !px-4 !py-2 !text-lg" onClick={() => { void install(); }}>
              Install app
            </button>
          )}
          <button type="button" className="btn-ghost !px-4 !py-2 !text-lg" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

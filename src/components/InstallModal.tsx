import React, { useCallback, useEffect, useState } from 'react';
import ModalShell from './ModalShell';
import {
  dismissInstall,
  getInstallPrompt,
  installDismissed,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '../lib/installPrompt';
import { installGuidance, manualInstallHint } from '../lib/installGuidance';

// "It isn't on this phone yet" — said in front of the screen, once.
//
// NO SITE CAN PUT AN ICON ON A HOME SCREEN BY ITSELF. Every browser requires a
// person to agree, and on iOS requires them to perform the gesture themselves;
// there is no API that installs quietly and there is not going to be one. So
// the nearest honest thing to "automatic" is this: the moment a guard signs in
// on a handset that has no app, ask them, instead of drawing a banner above the
// fold and hoping it is read. InstallAppBanner stays for the desktop and for
// the second, quieter offer after this one is closed.
//
// PHONES ONLY (`guidance.mobile`). A modal in front of a desk user who is
// working in a tab is an interruption with nothing behind it — there is no home
// screen to add to — and the banner already covers that case.
//
// IT CLOSES AND STAYS CLOSED. Every exit — Install, Not now, Escape, the
// backdrop — records the dismissal, and `installDismissed()` now expires it
// after a week, so a device that later loses the app is offered it again
// rather than being silenced for the life of the browser profile.
export default function InstallModal(): React.ReactElement | null {
  const [canPrompt, setCanPrompt] = useState<boolean>(() => getInstallPrompt() !== null);
  const [closed, setClosed] = useState<boolean>(() => installDismissed());

  useEffect(() => subscribeInstallPrompt(() => setCanPrompt(getInstallPrompt() !== null)), []);

  const close = useCallback(() => { dismissInstall(); setClosed(true); }, []);

  const install = useCallback(async () => {
    const outcome = await promptInstall();
    // The event is spent whatever they chose, so this popup has nothing left to
    // offer either way. An outright refusal is remembered; an acceptance does
    // not need to be, because `appinstalled` clears the record anyway.
    if (outcome === 'dismissed') dismissInstall();
    setCanPrompt(false);
    setClosed(true);
  }, []);

  if (closed) return null;
  if (isStandalone()) return null;

  const { kind, mobile } = installGuidance({ canPrompt });
  if (kind === 'none' || !mobile) return null;
  const prompting = kind === 'prompt';

  return (
    <ModalShell onClose={close} labelledBy="install-modal-title" className="max-w-sm">
      <h2
        id="install-modal-title"
        className="font-display font-normal text-2xl text-brand-800 dark:text-brand-300"
      >
        Install Gate Pass
      </h2>
      <p className="mt-2 text-lg leading-relaxed text-navy-700 dark:text-navy-200">
        {prompting
          ? 'Add Gate Pass to your home screen. It opens full screen, without the address bar, and works at the gate the same way every time.'
          : 'Gate Pass is not on this phone yet.'}
      </p>
      {!prompting && (
        <p className="mt-2 text-lg leading-relaxed text-navy-600 dark:text-navy-300">
          {manualInstallHint()}
        </p>
      )}

      <div className="mt-5 flex items-center gap-2">
        {prompting && (
          <button type="button" className="btn-primary !px-5 !py-3 !text-lg" onClick={() => { void install(); }}>
            Install app
          </button>
        )}
        <button type="button" className="btn-ghost !px-5 !py-3 !text-lg" onClick={close}>
          {prompting ? 'Not now' : 'Got it'}
        </button>
      </div>
    </ModalShell>
  );
}

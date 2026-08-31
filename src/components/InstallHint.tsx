import React, { useCallback, useEffect, useState } from 'react';
import { getInstallPrompt, isStandalone, promptInstall, subscribeInstallPrompt } from '../lib/installPrompt';
import { manualInstallHint } from '../lib/installGuidance';

// "Install this app" on the SIGN-IN SCREEN — the one screen a phone actually
// lands on, and the reason the first version of this feature looked broken.
//
// The banner in AppShell renders behind the login, so a person who opens the
// URL on a handset and never signs in sees nothing at all. That was the whole
// of the client's report on 2026-08-31: Android, Chrome, no button.
//
// AND IT CANNOT WAIT FOR `beforeinstallprompt` THE WAY THE BANNER DOES.
// Chrome will not necessarily fire that event for an origin it has installed
// before, even long after the app was uninstalled from the phone — also the
// client's case. The ⋮ menu route works the entire time, so the instruction is
// unconditional and the button is the bonus when the event does turn up.
//
// A DISCLOSURE, NOT A BANNER: closed it is one quiet line under the sign-in
// form, which is all the room this deserves next to somebody's password.
//
// LITERAL COLOURS, NO `navy-*` / `surface-*` TOKENS. This renders on the login
// photograph, which is a fixed-context surface — the neutral ramp inverts under
// `.dark` (the shipped default) and tokenising it here would paint pale text on
// the pale card. Same rule as AuthField and QuestLockup tone="light".

const PALE = 'rgba(235,217,180,0.85)';
const PALE_DIM = 'rgba(235,217,180,0.7)';
const SHADOW = '0 1px 8px rgba(0,0,0,0.75)';

export default function InstallHint(): React.ReactElement | null {
  const [canPrompt, setCanPrompt] = useState<boolean>(() => getInstallPrompt() !== null);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeInstallPrompt(() => setCanPrompt(getInstallPrompt() !== null)), []);

  const install = useCallback(async () => {
    await promptInstall();
    // Spent either way — see promptInstall. If they declined, the instruction
    // below is still true and still reachable.
    setCanPrompt(false);
    setOpen(true);
  }, []);

  if (isStandalone()) return null;

  return (
    <div className="no-print mt-4 text-[11px]" style={{ color: PALE_DIM, textShadow: SHADOW }}>
      {canPrompt ? (
        <button
          type="button"
          onClick={() => { void install(); }}
          className="inline-flex items-center gap-1.5 underline underline-offset-2"
          style={{ color: PALE }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 3.75-3.75M12 15l-3.75-3.75M4.5 15.75V18a2.25 2.25 0 0 0 2.25 2.25h10.5A2.25 2.25 0 0 0 19.5 18v-2.25" />
          </svg>
          Install app on this device
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 underline underline-offset-2"
          style={{ color: PALE }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 3.75-3.75M12 15l-3.75-3.75M4.5 15.75V18a2.25 2.25 0 0 0 2.25 2.25h10.5A2.25 2.25 0 0 0 19.5 18v-2.25" />
          </svg>
          Install this app on your phone
        </button>
      )}

      {open && (
        <p className="mt-1.5 leading-relaxed max-w-sm">
          {manualInstallHint()}
        </p>
      )}
    </div>
  );
}

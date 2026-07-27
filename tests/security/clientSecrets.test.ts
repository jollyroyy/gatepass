// The service-role key bypasses every RLS policy in the project — VMS's and
// this app's. It must live in exactly one place: scripts/create-user.ts,
// read from process.env in a plain Node script. Vite inlines any `VITE_`-
// prefixed env var straight into the browser bundle, so the key must never
// carry that prefix, and the string that names it must never appear under
// src/ at all — not even in a comment, because a comment today is a copy-
// pasted constant tomorrow.
//
// Two more conventions from CLAUDE.md are cheap to enforce the same way:
// authorization must read `app_metadata` (server-writable) and never
// `user_metadata` (user-writable); and this app never blocks the page with
// `window.alert`/`confirm`/`prompt`, because a guard at the gate with a
// truck waiting can't afford a modal that halts automation and the UI.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSrc, srcFiles, stripComments } from './sourceScan';

const CREATE_USER_SCRIPT = resolve(process.cwd(), 'scripts', 'create-user.ts');

describe('client secrets', () => {
  it('never mentions SERVICE_ROLE / service_role anywhere under src/, comments included', () => {
    const pattern = /service_role/i;
    const offenders = srcFiles()
      .filter((file) => pattern.test(readSrc(file))) // raw text — comments count too
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `the service-role key (or its name) must never appear under src/, in code or in ` +
        `comments — it lives only in scripts/create-user.ts:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('scripts/create-user.ts is the one place that references SUPABASE_SERVICE_ROLE_KEY', () => {
    const text = readFileSync(CREATE_USER_SCRIPT, 'utf8');
    expect(
      text,
      'scripts/create-user.ts no longer references SUPABASE_SERVICE_ROLE_KEY — either this ' +
        'test is checking the wrong symbol, or the script stopped reading the key it needs'
    ).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('the service-role key name is never spelled with a VITE_ prefix in src/ or scripts/', () => {
    // Vite inlines any import.meta.env.VITE_* variable into the client bundle.
    // A VITE_-prefixed service-role var would ship the key to every browser.
    const pattern = /VITE_[A-Z_]*SERVICE_ROLE/;
    const files = [...srcFiles(), CREATE_USER_SCRIPT];
    const offenders = files
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `these files spell the service-role key with a VITE_ prefix, which Vite would inline ` +
        `into the client bundle:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('never authorizes off user_metadata (user-writable) in live code', () => {
    const offenders = srcFiles()
      .filter((file) => stripComments(readSrc(file)).includes('user_metadata'))
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `user_metadata is writable by the signed-in user themselves and must never gate ` +
        `authorization — use app_metadata instead:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('never blocks the page with window.alert/confirm/prompt or a bare alert/confirm/prompt call', () => {
    // window.print() in src/pages/Shared/PassPrint.tsx is explicitly allowed —
    // it is click-triggered, not on mount, and is outside the scope of this
    // check (only alert/confirm/prompt are forbidden).
    const windowBlocking = /window\.(alert|confirm|prompt)\(/;
    // Bare calls, but not a method/identifier that merely ends in one of these
    // words (onConfirm(, handleMatchConfirm(, alert-error className, etc.) —
    // require the previous character to not be a word char or a dot.
    const bareBlocking = /(?<![.\w$])(alert|confirm|prompt)\(/;

    const offenders = srcFiles()
      .filter((file) => {
        const text = stripComments(readSrc(file));
        return windowBlocking.test(text) || bareBlocking.test(text);
      })
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `these files call a blocking window.alert/confirm/prompt — they freeze the page and ` +
        `break automation; use an inline panel or .modal-overlay/.modal-content instead:\n` +
        `${offenders.join('\n')}`
    ).toEqual([]);
  });
});

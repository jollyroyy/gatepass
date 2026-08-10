import React, { useState } from 'react';
import { supabase, gp } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';
import { fetchMustChangePassword } from '../lib/profiles';
import AuthField from '../components/AuthField';
import { QuestLockup } from '../components/QuestMark';

const LockIcon = (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
    />
  </svg>
);

const EyeIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const EyeOffIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

type Props = {
  /** Called once `set_my_password` has succeeded AND the flag has been
   *  re-read as false. Never called speculatively. */
  onCleared: () => void;
};

/**
 * The gate an admin-reset password lands a user in. Full-screen, no escape
 * except signing out — mirrors Login.tsx's visual surface exactly (literal
 * hex colours, not navy or surface tokens, because that ramp inverts under
 * `.dark`, the app's shipped default, and would render this near-white on
 * near-white).
 *
 * `set_my_password` is the ONLY way the `must_change_password` flag comes
 * down — there is deliberately no separate "clear the flag" RPC — so success
 * here means re-reading `my_profile()` to confirm before calling `onCleared`,
 * never clearing it optimistically.
 */
export default function ForcePasswordChange({ onCleared }: Props): React.ReactElement {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Your new password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const { error: setErr } = await gp().rpc('set_my_password', { p_password: password });
      if (setErr) throw setErr;

      // set_my_password clears the flag server-side in the same call — but we
      // never take that on faith. Re-read it for real before dropping the gate.
      const stillOwed = await fetchMustChangePassword();
      if (stillOwed) {
        setError('Could not confirm the password change. Please try again.');
        return;
      }
      onCleared();
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not set your new password.'));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center
                 lg:justify-start lg:pl-[9vw] p-4 overflow-hidden"
      style={{ background: '#16161A' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />
      <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(14,13,16,0.52)' }} />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, rgba(10,9,12,0.90) 0%, rgba(10,9,12,0.72) 34%, rgba(10,9,12,0.30) 62%, rgba(10,9,12,0.42) 100%)',
        }}
      />

      <div className="relative w-full max-w-[400px] animate-fade-in">
        <div className="flex flex-col items-center lg:items-start mb-7">
          <QuestLockup tone="dark" size="lg" subtitle={null} />
          <div
            aria-hidden
            className="mt-5 mb-4 h-px w-16"
            style={{ background: 'linear-gradient(90deg, #C6A15B, rgba(198,161,91,0))' }}
          />
          <p
            className="text-[11px] text-brand-200/90 uppercase tracking-[0.26em] font-semibold"
            style={{ textShadow: '0 1px 10px rgba(0,0,0,0.7)' }}
          >
            Choose a New Password
          </p>
        </div>

        <div
          className="relative rounded-3xl p-7 overflow-hidden"
          style={{
            background: '#FBFAF8',
            border: '1px solid rgba(198,161,91,0.30)',
            boxShadow: '0 32px 64px -16px rgba(0,0,0,0.65), 0 0 0 1px rgba(16,16,20,0.06)',
          }}
        >
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #8A6C32, #D0AD68 45%, #EBD9B4 70%, #C6A15B)' }}
          />

          <form onSubmit={submit} className="space-y-5">
            <div className="mb-1">
              <h2
                className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
                style={{ color: '#16161A' }}
              >
                Set your password
              </h2>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#7C766C' }}>
                An administrator reset your password. Before you can continue, choose one only
                you know.
              </p>
            </div>

            <AuthField
              id="new-password"
              label="New password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              icon={LockIcon}
              trailing={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  className="transition-colors p-1"
                  style={{ color: '#A8A39A' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? EyeOffIcon : EyeIcon}
                </button>
              }
            />

            <AuthField
              id="confirm-password"
              label="Confirm new password"
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              autoComplete="new-password"
              icon={LockIcon}
              trailing={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirm((s) => !s)}
                  className="transition-colors p-1"
                  style={{ color: '#A8A39A' }}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? EyeOffIcon : EyeIcon}
                </button>
              }
            />

            {error && (
              <p
                className="text-sm rounded-xl px-3.5 py-2.5 flex items-start gap-2"
                style={{
                  color: '#b91c1c',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                  />
                </svg>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl px-5 py-3 text-sm font-bold uppercase tracking-[0.12em]
                         text-shell-ink bg-gradient-to-r from-brand-500 to-brand-600
                         hover:brightness-105 active:scale-[0.985]
                         disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                         transition-all duration-200 flex items-center justify-center gap-2"
              style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
            >
              {busy ? 'Setting password…' : 'Set new password'}
            </button>

            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="w-full text-center text-xs font-semibold tracking-wide transition-colors py-1
                         disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ color: '#7C766C' }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

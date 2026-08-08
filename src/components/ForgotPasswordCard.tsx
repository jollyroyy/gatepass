import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';
import AuthField from './AuthField';

/**
 * The built-in email provider sits behind a PROJECT-WIDE quota (2 emails/hour),
 * so a reset request can legitimately fail with over_email_send_rate_limit even
 * when the user has done nothing wrong. This cooldown exists to keep a user
 * from hammering that shared budget by double-clicking or retrying — the button
 * refuses a second send within the window, and the window SURVIVES the card
 * being unmounted (it lives in sessionStorage, not component state), because
 * the natural flow is send → leave → come back to try again.
 */
const RESEND_COOLDOWN_MS = 60_000;
const COOLDOWN_KEY = 'gatepass.forgot-cooldown-until';

function readCooldownRemaining(): number {
  try {
    const until = Number(sessionStorage.getItem(COOLDOWN_KEY) ?? 0);
    return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
  } catch {
    return 0;
  }
}

const MailIcon = (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
    />
  </svg>
);

/**
 * The "Forgot password?" card, rendered by Login in place of the email+password
 * form. ONLY the email is asked for here — the old flow kept the password field
 * mounted on the same form, so a user who had forgotten it was asked for it
 * anyway. Sending goes through Supabase's recovery email, whose link lands on
 * /reset-password (see Login.tsx's redirectTo and App.tsx's route).
 */
export default function ForgotPasswordCard({
  onBack,
}: {
  onBack: () => void;
}): React.ReactElement {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(readCooldownRemaining);

  useEffect(() => {
    if (cooldownMs <= 0) return;
    const t = window.setInterval(() => {
      const remaining = readCooldownRemaining();
      setCooldownMs(remaining);
      if (remaining <= 0) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [cooldownMs]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw err;
      try {
        sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + RESEND_COOLDOWN_MS));
      } catch {
        // Storage unavailable (private browsing) — the send succeeded regardless.
      }
      setCooldownMs(RESEND_COOLDOWN_MS);
      setSent(true);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not send reset email.'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <>
        <h2
          className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
          style={{ color: '#16161A' }}
        >
          Check your inbox
        </h2>
        <p className="text-xs mt-1.5" style={{ color: '#7C766C' }}>
          A password reset link is on its way to {email.trim() || 'your email'}. It opens a page
          where you can set a new password.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 w-full rounded-xl px-5 py-3 text-sm font-bold uppercase tracking-[0.12em]
                     text-shell-ink bg-gradient-to-r from-brand-500 to-brand-600 hover:brightness-105
                     transition-all duration-200"
          style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
        >
          Back to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <h2
        className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
        style={{ color: '#16161A' }}
      >
        Reset your password
      </h2>
      <p className="text-xs mt-1.5" style={{ color: '#7C766C' }}>
        Enter the email you sign in with. We&apos;ll send you a link to set a new password —
        no current password needed.
      </p>

      <form onSubmit={submit} className="space-y-5 mt-6">
        <AuthField
          id="forgot-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          autoComplete="username"
          icon={MailIcon}
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

        {cooldownMs > 0 && (
          <p
            className="text-xs mt-2 flex items-start gap-2"
            style={{ color: '#A8853F' }}
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            You can send another link in {Math.ceil(cooldownMs / 1000)}s.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || cooldownMs > 0}
          className="w-full rounded-xl px-5 py-3 text-sm font-bold uppercase tracking-[0.12em]
                     text-shell-ink bg-gradient-to-r from-brand-500 to-brand-600
                     hover:brightness-105 active:scale-[0.985]
                     disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
          style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
        >
          {busy ? 'Sending…' : 'Send reset link'}
        </button>

        <button
          type="button"
          onClick={onBack}
          className="block w-full text-center text-xs font-semibold hover:underline transition-colors"
          style={{ color: '#A8853F' }}
        >
          Back to sign in
        </button>
      </form>
    </>
  );
}
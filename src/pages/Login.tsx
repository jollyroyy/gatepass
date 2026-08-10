import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';
import AuthField from '../components/AuthField';
import { QuestLockup } from '../components/QuestMark';

/**
 * Password reset is administrator-assisted, not self-service (user's call,
 * 2026-08-10). The self-serve "Forgot password?" flow was removed along with
 * ForgotPasswordCard: the built-in Supabase email sender is capped at ~2 mails
 * per hour PROJECT-WIDE (shared with VMS), so most people who clicked it got a
 * rate-limit error and no way forward. A named human is a better answer than a
 * button that usually fails. The admin triggers the recovery mail instead, and
 * its link still lands on /reset-password (that page stays for exactly this).
 */
export const ADMIN_CONTACT_EMAIL = 'admin@demo.vms';

const MailIcon = (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
    />
  </svg>
);

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

export default function Login(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw err;
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center
                 lg:justify-start lg:pl-[9vw] p-4 overflow-hidden"
      style={{ background: '#16161A' }}
    >
      {/* The client's own building, at night. `cover` + `center` so the photo fills
          any viewport aspect ratio without distorting; the shell colour underneath
          covers the frame before it decodes. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />
      {/* Scrim, two layers.
          The lit faceted facade — the whole reason this photo is here — occupies the
          RIGHT of the frame, and the dark corner of the building sits centre-left.
          So the card is anchored left on wide screens: it lands on the quiet part of
          the photograph and leaves the facade unobstructed, instead of covering the
          subject. The veil is warm charcoal rather than blue-black, because a cool
          scrim over a gold facade greys the gold out — the one colour that has to
          survive. The second layer is a left-weighted gradient: heaviest exactly
          where the card sits, falling away to nothing over the facade. */}
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
        {/* Brand */}
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
            Gate Pass Control
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
          {/* Gilt edge along the top of the card. Purely decorative, and the only
              decoration on the page — it is what makes the panel read as stationery
              rather than as a dialog box. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #8A6C32, #D0AD68 45%, #EBD9B4 70%, #C6A15B)' }}
          />

          {/* Literal colours, not navy-* tokens: this card is fixed ivory chrome in
              both themes, and the tokens invert under `.dark` — the app's shipped
              default — which would render this heading near-white on near-white. */}
          <form onSubmit={submit} className="space-y-5">
              <div className="mb-1">
                <h2
                  className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
                  style={{ color: '#16161A' }}
                >
                  Welcome back
                </h2>
                <p className="text-xs mt-1.5" style={{ color: '#7C766C' }}>
                  Sign in
                </p>
              </div>

          <AuthField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            autoComplete="username"
            icon={MailIcon}
          />

          <AuthField
            id="password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            icon={LockIcon}
            trailing={
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((s) => !s)}
                className="transition-colors p-1"
                style={{ color: '#A8A39A' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#A8853F')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#A8A39A')}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? EyeOffIcon : EyeIcon}
              </button>
            }
          />

          {/* There is no self-service reset. A forgotten password is handled by
                  the administrator, so the card names them and makes the address
                  actionable in one tap rather than leaving a dead end. */}
              <p className="text-xs -mt-2 leading-relaxed" style={{ color: '#7C766C' }}>
                Forgot your password? Contact the administrator at{' '}
                <a
                  href={`mailto:${ADMIN_CONTACT_EMAIL}`}
                  className="font-semibold hover:underline transition-colors"
                  style={{ color: '#A8853F' }}
                >
                  {ADMIN_CONTACT_EMAIL}
                </a>{' '}
                to have it reset.
              </p>

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
            {busy ? (
              'Signing in…'
            ) : (
              <>
                Sign In
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </>
            )}
          </button>
          </form>
        </div>

        <p
          className="flex items-center justify-center lg:justify-start gap-1.5 text-[11px] mt-6"
          style={{ color: 'rgba(235,217,180,0.75)', textShadow: '0 1px 8px rgba(0,0,0,0.75)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.598 6 12 12 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Z"
            />
          </svg>
          Accounts are provisioned by an administrator.
        </p>
      </div>
    </div>
  );
}

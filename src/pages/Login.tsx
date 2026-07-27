import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';
import AuthField from '../components/AuthField';

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

export default function Login(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      // App.tsx's onAuthStateChange picks it up and routes by role.
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
      style={{ background: '#0f172a' }}
    >
      {/* Mall Management Office service gate. `cover` + `center` so the photo fills
          any viewport aspect ratio without distorting; the shell colour underneath
          covers the frame before it decodes. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />
      {/* Scrim — the photo is bright and unevenly lit, and the crop point moves with
          the viewport, so the card needs a guaranteed contrast floor behind it. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 100% at 50% 50%, rgba(8,12,24,0.42) 0%, rgba(8,12,24,0.80) 100%)',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <div className="relative mb-5">
            <div
              aria-hidden
              className="absolute -inset-3 rounded-full blur-xl"
              style={{ background: 'radial-gradient(circle, rgba(8,145,178,0.55) 0%, transparent 70%)' }}
            />
            <div
              className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-600
                         flex items-center justify-center"
              style={{ boxShadow: '0 8px 24px -6px rgba(8,145,178,0.6), inset 0 1px 0 rgba(255,255,255,0.25)' }}
            >
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
          </div>
          <h1
            className="text-[28px] leading-none font-bold text-white font-display tracking-tight"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
          >
            GatePass
          </h1>
          <p className="text-[11px] text-slate-300/80 mt-2.5 uppercase tracking-[0.22em] font-medium">
            Material Movement Control
          </p>
        </div>

        <form
          onSubmit={submit}
          className="relative rounded-3xl p-7 space-y-5 backdrop-blur-2xl overflow-hidden"
          style={{
            background: 'rgba(10,15,28,0.62)',
            border: '1px solid rgba(255,255,255,0.11)',
            boxShadow:
              '0 32px 64px -16px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.09)',
          }}
        >
          {/* Cyan hairline along the top edge — the one decorative flourish, and it
              doubles as the card's light source for the inset highlight below it. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.7) 50%, transparent 100%)',
            }}
          />

          <div className="mb-1">
            <h2 className="text-lg font-semibold text-white tracking-tight">Welcome back</h2>
            <p className="text-xs text-slate-400 mt-1">Sign in to continue to the gate console.</p>
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
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            icon={LockIcon}
          />

          {error && (
            <p
              className="text-sm rounded-xl px-3.5 py-2.5 flex items-start gap-2"
              // A light tint of flagged red rather than flagged-500 itself: #EF4444 on a
              // near-black card is only ~4:1. Same hue, readable contrast.
              style={{
                color: '#fca5a5',
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.28)',
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
            className="w-full rounded-xl px-5 py-3 text-sm font-semibold text-white
                       bg-gradient-to-r from-brand-600 to-accent-600
                       hover:brightness-110 active:scale-[0.985]
                       disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                       transition-all duration-200 flex items-center justify-center gap-2"
            style={{ boxShadow: '0 10px 28px -8px rgba(8,145,178,0.65)' }}
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

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400/80 mt-6">
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

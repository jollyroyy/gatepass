import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';
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

const CheckIcon = (
  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

type Status = 'checking' | 'ready' | 'done' | 'expired';

/**
 * The second half of "Forgot password?" — the page the reset email links to.
 *
 * Riding on supabase-js: the email link lands on this route carrying a recovery
 * token, the client picks it from the URL and fires PASSWORD_RECOVERY. Only then
 * does the form render, and only then is `updateUser` safe to call — a password
 * set without a recovery token is a (failed, silently dropped) password change
 * on someone else's browser. No recovery event means the link was stale, so the
 * page says so instead of showing a dead form.
 *
 * After the update the session is deliberately torn down: the user just proved
 * who they are with the email link, but signing them straight into the console
 * skips the login they expect to exercise with the brand-new password.
 */
export default function ResetPassword(): React.ReactElement {
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready');
    });
    // supabase-js usually fires the event moments after mount; if it never does,
    // the link the user followed is stale or forged — show the dead-link state.
    const timer = setTimeout(() => setStatus((s) => (s === 'checking' ? 'expired' : s)), 1500);
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Passwords must be at least 6 characters long.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      await supabase.auth.signOut();
      setStatus('done');
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not update the password.'));
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
          <p className="text-[11px] text-brand-200/90 uppercase tracking-[0.26em] font-semibold"
            style={{ textShadow: '0 1px 10px rgba(0,0,0,0.7)' }}>
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
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #8A6C32, #D0AD68 45%, #EBD9B4 70%, #C6A15B)' }}
          />

          {status === 'expired' && (
            <>
              <h2
                className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
                style={{ color: '#16161A' }}
              >
                This reset link is invalid
              </h2>
              <p className="text-xs mt-2" style={{ color: '#7C766C' }}>
                The link has expired or was already used. Use &quot;Forgot password?&quot; on the
                sign-in page to request a fresh one.
              </p>
              <Link
                to="/login"
                className="mt-6 block w-full rounded-xl px-5 py-3 text-center text-sm font-bold
                           uppercase tracking-[0.12em] text-shell-ink bg-gradient-to-r
                           from-brand-500 to-brand-600 hover:brightness-105 transition-all duration-200"
                style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
              >
                Back to sign in
              </Link>
            </>
          )}

          {status === 'ready' && (
            <>
              <h2
                className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
                style={{ color: '#16161A' }}
              >
                Choose a new password
              </h2>
              <p className="text-xs mt-1.5" style={{ color: '#7C766C' }}>
                Your identity was confirmed by the emailed link. Set the password you&apos;ll
                use from now on.
              </p>

              <form onSubmit={submit} className="space-y-5 mt-6">
                <AuthField
                  id="new-password"
                  label="New password"
                  type={'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  icon={LockIcon}
                />

                <AuthField
                  id="confirm-password"
                  label="Confirm new password"
                  type={'password'}
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  icon={LockIcon}
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
                             disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200
                             flex items-center justify-center gap-2"
                  style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
                >
                  {busy ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          {status === 'done' && (
            <>
              <h2
                className="text-[22px] leading-tight font-normal font-display tracking-[0.01em]"
                style={{ color: '#16161A' }}
              >
                Password updated
              </h2>
              <p
                className="text-sm mt-3 rounded-xl px-3.5 py-2.5 flex items-start gap-2"
                style={{
                  color: '#166534',
                  background: 'rgba(22,163,74,0.08)',
                  border: '1px solid rgba(22,163,74,0.25)',
                }}
              >
                {CheckIcon}
                Your new password is saved. Sign in with it now.
              </p>
              <Link
                to="/login"
                className="mt-6 block w-full rounded-xl px-5 py-3 text-center text-sm font-bold
                           uppercase tracking-[0.12em] text-shell-ink bg-gradient-to-r
                           from-brand-500 to-brand-600 hover:brightness-105 transition-all duration-200"
                style={{ boxShadow: '0 10px 28px -8px rgba(198,161,91,0.70)' }}
              >
                Back to sign in
              </Link>
            </>
          )}

          {status === 'checking' && (
            <p className="text-sm" style={{ color: '#7C766C' }}>
              Verifying your link…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
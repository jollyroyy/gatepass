import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { safeErrorMessage } from '../lib/errors';

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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0f172a' }}>
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-600 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white font-display tracking-tight">GatePass</h1>
          <p className="text-xs text-slate-400 mt-1">Material Movement Control</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl p-6 space-y-4"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
        >
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500
                         focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500
                         focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>

          {error && (
            <p className="text-sm text-flagged-500 bg-flagged-500/10 border border-flagged-500/25 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          Accounts are provisioned by an administrator.
        </p>
      </div>
    </div>
  );
}

// The idle deadline is shared by every tab and survives refresh. A warning
// starts at the configured timeout; only Keep session can extend it. Sixty
// seconds later, the locally persisted Supabase session is removed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, gp } from '../supabaseClient';
import ModalShell from './ModalShell';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MAX,
  SESSION_TIMEOUT_MIN,
} from '../lib/appSettings';
import {
  IDLE_GRACE_MS, IDLE_SESSION_KEY, clearIdleSession, extendIdleSession,
  idleState, recordIdleActivity, setIdleTimeout,
} from '../lib/idleSession';

export const IDLE_TIMEOUT_MS = DEFAULT_SESSION_TIMEOUT_MINUTES * 60 * 1000;
export const COUNTDOWN_SEC = IDLE_GRACE_MS / 1000;

export default function SessionTimeout(): React.ReactElement | null {
  const [idleMs, setIdleMs] = useState(IDLE_TIMEOUT_MS);
  const [showPrompt, setShowPrompt] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signingOut = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const signOut = useCallback(() => {
    if (signingOut.current) return;
    signingOut.current = true;
    clearTimers();
    clearIdleSession();
    setShowPrompt(false);
    // Local scope clears this browser's saved session even if the network is
    // unavailable. Supabase propagates SIGNED_OUT to the other same-origin tabs.
    void supabase.auth.signOut({ scope: 'local' });
  }, [clearTimers]);

  const reconcile = useCallback(() => {
    clearTimers();
    const now = Date.now();
    const state = idleState(now);
    if (state.phase === 'missing' || state.phase === 'expired') {
      signOut();
      return;
    }
    setIdleMs(state.timeoutMs);
    if (state.phase === 'active') {
      setShowPrompt(false);
      setCountdown(COUNTDOWN_SEC);
      timerRef.current = setTimeout(reconcile, Math.max(0, state.deadline - now));
      return;
    }
    setShowPrompt(true);
    setCountdown(Math.max(0, Math.ceil((state.expiresAt - now) / 1000)));
    countdownRef.current = setInterval(() => {
      const current = idleState();
      if (current.phase === 'expired' || current.phase === 'missing') {
        signOut();
      } else if (current.phase === 'active') {
        reconcile(); // another tab explicitly extended the warning
      } else {
        setCountdown(Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)));
      }
    }, 1000);
  }, [clearTimers, signOut]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await gp().rpc('get_session_timeout');
        if (cancelled || error) return;
        const minutes = Number(data);
        if (!Number.isFinite(minutes) || minutes < SESSION_TIMEOUT_MIN || minutes > SESSION_TIMEOUT_MAX) return;
        setIdleTimeout(minutes * 60_000);
        reconcile();
      } catch { /* The five-minute default remains in force. */ }
    })();
    return () => { cancelled = true; };
  }, [reconcile]);

  useEffect(() => {
    reconcile();
    const onActivity = () => {
      recordIdleActivity();
      reconcile();
    };
    const onWake = () => reconcile(); // visibility is not user activity
    const onStorage = (event: StorageEvent) => {
      if (event.key === IDLE_SESSION_KEY) reconcile();
    };
    // Wheel is a human input; a programmatic scroll is not proof of activity.
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((event) => document.addEventListener(event, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimers();
      events.forEach((event) => document.removeEventListener(event, onActivity));
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
      window.removeEventListener('storage', onStorage);
    };
  }, [reconcile, clearTimers]);

  if (!showPrompt) return null;

  return (
    <ModalShell onClose={() => undefined} dismissible={false} overlayClassName="z-[9999]" labelledBy="session-timeout-title">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="h-12 w-12 rounded-2xl bg-pending-50 border border-pending-500/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-pending-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 id="session-timeout-title" className="modal-title">Session Timeout</h3>
          <p className="text-sm text-navy-500 mt-1">
            Your session has been idle for {Math.round(idleMs / 60000)} minutes. Do you want to stay signed in?
          </p>
        </div>
        <div className="w-full bg-surface-100 rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-pending-500 to-pending-600 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${(countdown / COUNTDOWN_SEC) * 100}%` }} />
        </div>
        <p className="text-xs text-navy-500">
          Auto-logout in <span className="font-semibold text-pending-600 tabular-nums">{countdown}s</span>
        </p>
        <div className="flex gap-3 w-full pt-1">
          <button type="button" onClick={signOut} className="btn-secondary flex-1 text-sm">Sign out</button>
          <button type="button" onClick={() => extendIdleSession() ? reconcile() : signOut()}
            className="btn-primary flex-1 text-sm">Keep session</button>
        </div>
      </div>
    </ModalShell>
  );
}

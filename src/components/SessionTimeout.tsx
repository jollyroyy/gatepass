// Idle-session timeout, matching VMS's component of the same name but at FIVE
// minutes rather than VMS's ten: a gate terminal is a shared machine in a public
// corridor, so an abandoned session is a bigger exposure than one at a desk.
//
// Two deliberate behaviours:
//   * Once the prompt is visible, ordinary activity does NOT dismiss it. A mouse
//     nudge that wakes a screen must not silently cancel a logout nobody saw —
//     only an explicit "Keep session" does that.
//   * It is a modal panel, never window.confirm: a blocking browser dialog stops
//     the page dead, and the gate console has to keep receiving realtime updates.
//
// A convenience and a shoulder-surfing defence, not a security boundary — the
// Supabase JWT has its own lifetime and RLS is the real authority.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import ModalShell from './ModalShell';

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const COUNTDOWN_SEC = 60;

export default function SessionTimeout(): React.ReactElement | null {
  const [showPrompt, setShowPrompt] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const promptVisibleRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const signOut = useCallback(async () => {
    clearTimers();
    promptVisibleRef.current = false;
    setShowPrompt(false);
    await supabase.auth.signOut();
  }, [clearTimers]);

  const startTimer = useCallback(() => {
    clearTimers();
    promptVisibleRef.current = false;
    setShowPrompt(false);
    setCountdown(COUNTDOWN_SEC);
    timerRef.current = setTimeout(() => {
      promptVisibleRef.current = true;
      setShowPrompt(true);
      setCountdown(COUNTDOWN_SEC);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            signOut();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, IDLE_TIMEOUT_MS);
  }, [clearTimers, signOut]);

  useEffect(() => {
    startTimer();

    const resetOnActivity = () => {
      if (!promptVisibleRef.current) startTimer();
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((evt) => document.addEventListener(evt, resetOnActivity, { passive: true }));
    return () => {
      clearTimers();
      events.forEach((evt) => document.removeEventListener(evt, resetOnActivity));
    };
  }, [startTimer, clearTimers]);

  if (!showPrompt) return null;

  // Closing this popup (×, Escape, backdrop click) is deliberately wired to
  // the SAME safe action as the "Keep session" button, never to a silent
  // no-op and never to sign-out: dismissing a "do you want to stay signed
  // in?" prompt must not leave a countdown ticking down out of sight. This is
  // the same "closing must equal Cancel, never Confirm" rule as a destructive
  // confirmation, just with the roles swapped — here "Keep session" is the
  // safe path and "Sign out" is the one closing must never trigger. Ambient
  // mouse/keyboard activity still does NOT dismiss the prompt (unchanged,
  // see the resetOnActivity guard above) — only this explicit close does.
  return (
    <ModalShell onClose={startTimer} overlayClassName="z-[9999]" labelledBy="session-timeout-title">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-pending-50 border border-pending-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-pending-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 id="session-timeout-title" className="text-xl font-normal text-navy-950 font-display tracking-tight">Session Timeout</h3>
            <p className="text-sm text-navy-400 mt-1">
              Your session has been idle for 5 minutes. Do you want to stay signed in?
            </p>
          </div>
          <div className="w-full bg-surface-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pending-500 to-pending-600 rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / COUNTDOWN_SEC) * 100}%` }}
            />
          </div>
          <p className="text-xs text-navy-400">
            Auto-logout in <span className="font-semibold text-pending-600 tabular-nums">{countdown}s</span>
          </p>
          <div className="flex gap-3 w-full pt-1">
            <button type="button" onClick={() => void signOut()} className="btn-secondary flex-1 text-sm">
              Sign out
            </button>
            <button onClick={() => startTimer()} className="btn-primary flex-1 text-sm">
              Keep session
            </button>
          </div>
        </div>
    </ModalShell>
  );
}

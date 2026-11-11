import { DEFAULT_SESSION_TIMEOUT_MINUTES } from './appSettings';

/** Shared by every tab on this origin. A missing record never restores a saved login. */
export const IDLE_SESSION_KEY = 'gatepass-idle-session-v1';
export const IDLE_GRACE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = DEFAULT_SESSION_TIMEOUT_MINUTES * 60_000;

type IdleRecord = { lastActivityAt: number; timeoutMs: number };
export type IdleState =
  | { phase: 'missing' }
  | { phase: 'active' | 'prompt' | 'expired'; deadline: number; expiresAt: number; timeoutMs: number };

let fallback: IdleRecord | null = null;

function valid(value: unknown): value is IdleRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IdleRecord>;
  return Number.isFinite(record.lastActivityAt) && Number.isFinite(record.timeoutMs)
    && Number(record.lastActivityAt) > 0 && Number(record.timeoutMs) >= DEFAULT_TIMEOUT_MS
    && Number(record.timeoutMs) <= 24 * 60 * 60_000;
}

function read(): IdleRecord | null {
  try {
    const raw = window.localStorage.getItem(IDLE_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return fallback;
  }
}

function write(record: IdleRecord): void {
  fallback = record;
  try { window.localStorage.setItem(IDLE_SESSION_KEY, JSON.stringify(record)); } catch { /* memory only */ }
}

export function clearIdleSession(): void {
  fallback = null;
  try { window.localStorage.removeItem(IDLE_SESSION_KEY); } catch { /* memory only */ }
}

/** Called before signInWithPassword so auth events cannot race the timestamp. */
export function beginIdleSession(now = Date.now()): void {
  write({ lastActivityAt: now, timeoutMs: DEFAULT_TIMEOUT_MS });
}

export function idleState(now = Date.now()): IdleState {
  const record = read();
  if (!record) return { phase: 'missing' };
  const deadline = record.lastActivityAt + record.timeoutMs;
  const expiresAt = deadline + IDLE_GRACE_MS;
  return {
    phase: now >= expiresAt ? 'expired' : now >= deadline ? 'prompt' : 'active',
    deadline, expiresAt, timeoutMs: record.timeoutMs,
  };
}

/** Input after the idle deadline must never silently dismiss the warning. */
export function recordIdleActivity(now = Date.now()): boolean {
  const record = read();
  if (!record || now >= record.lastActivityAt + record.timeoutMs) return false;
  if (now - record.lastActivityAt >= 1000) write({ ...record, lastActivityAt: now });
  return true;
}

/** Only the explicit button may extend a session once the warning is visible. */
export function extendIdleSession(now = Date.now()): boolean {
  const state = idleState(now);
  if (state.phase === 'missing' || state.phase === 'expired') return false;
  write({ lastActivityAt: now, timeoutMs: state.timeoutMs });
  return true;
}

export function setIdleTimeout(timeoutMs: number): void {
  const record = read();
  if (!record || !Number.isFinite(timeoutMs)) return;
  if (Date.now() >= record.lastActivityAt + record.timeoutMs) return;
  write({ ...record, timeoutMs });
}

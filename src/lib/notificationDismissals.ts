// Which notifications this reader has already waved away.
//
// WHY THIS IS PERSISTED AT ALL: mismatch notices are DERIVED from the database
// on every mount (`status = 'flagged'` on the reader's own passes — see
// notifications.tsx), which is what makes the bell survive being signed out.
// The cost of that is that an in-memory dismissal comes straight back on the
// next page load, so the bell would be un-clearable. Remembering the dismissal
// is what closes that loop.
//
// WHY IT IS NOT A COLUMN: "I have seen this" is a display preference of one
// browser, not a fact about the gate pass. A `dismissed_at` on `gate_passes`
// would be a second, weaker record of a decision that `verifications` already
// holds properly, and it would follow the person to a machine where they never
// saw the notice at all.
//
// EVERY CALL IS WRAPPED. Safari in private mode throws on `setItem`, and some
// embedded browsers have no `localStorage` at all. A bell that forgets what was
// dismissed is a small annoyance; one that throws takes the whole app down.
const DISMISSED_STORAGE_KEY = 'gatepass.dismissedNotifications';

/** The identity of a notification as a FACT rather than as a rendered row:
 *  (pass, kind of event). The `id` a notification carries is per-render and
 *  would be a different string for the same mismatch on every reload, so it can
 *  never be what a dismissal is recorded against. */
export function factKey(passId: string | null, type: string): string {
  return `${passId}|${type}`;
}

export function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeDismissed(keys: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Private mode, quota, or no storage at all — the bell still works for this
    // session and simply forgets afterwards.
  }
}

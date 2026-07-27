/**
 * Postgres SQLSTATE / PostgREST codes worth translating to a friendlier
 * message than the raw driver text (constraint names, wire-protocol jargon).
 * Anything NOT in this map — including our own RPCs' `RAISE EXCEPTION '...'`
 * (SQLSTATE P0001, or no code at all) — falls through and is shown verbatim,
 * because those messages are written to be user-facing already, e.g.
 * "Only security can verify passes." or "Pass is not pending."
 */
const CODE_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'This action conflicts with related data.',
  '23502': 'A required field is missing.',
  '42501': 'You do not have permission to do that.',
  // A policy on a table whose USING clause reads that same table. Postgres only
  // catches this at query time, so it reaches the user as a failed screen. It is
  // never something they can act on themselves — say so plainly rather than
  // showing them "infinite recursion detected in policy for relation ...".
  // See supabase/fixes/public_profiles_recursion.sql.
  '42P17': 'A database security policy is misconfigured. Please contact your administrator.',
  PGRST301: 'Your session has expired. Please sign in again.',
  PGRST116: 'That record could not be found.',
};

/**
 * Constraint-specific messages, checked BEFORE the generic SQLSTATE map.
 *
 * A unique violation is always 23505, so the code alone cannot tell "you raised
 * this material twice" apart from any other collision — and "That record already
 * exists." tells an HOD nothing about what to do next. Postgres names the
 * offending index in the error text, which is the only thing that distinguishes
 * them, so match on that.
 *
 * Keys are index names from supabase/migrations/. Renaming an index there
 * without updating this map silently downgrades the message to the generic one —
 * tests/unit/errors.test.ts pins the pairing.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  gate_passes_one_pending_per_material_idx:
    'A pending gate pass already exists for this material in this department. ' +
    'Void it or have it verified at the gate before raising another.',
};

function isNetworkFailure(message: string): boolean {
  return /Failed to fetch|NetworkError|network request failed/i.test(message);
}

/** Postgres reports the index name in `message` or `details`, depending on driver path. */
function constraintMessage(err: object): string | null {
  const parts = [
    (err as { message?: unknown }).message,
    (err as { details?: unknown }).details,
    (err as { constraint?: unknown }).constraint,
  ];
  const haystack = parts.filter((p) => typeof p === 'string').join(' ');
  if (!haystack) return null;
  for (const [name, msg] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (haystack.includes(name)) return msg;
  }
  return null;
}

export function safeErrorMessage(err: unknown, fallback = 'An unexpected error occurred.'): string {
  if (err == null) return fallback;
  if (typeof err === 'string') return err || fallback;

  if (typeof err === 'object') {
    const named = constraintMessage(err);
    if (named) return named;

    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code in CODE_MESSAGES) return CODE_MESSAGES[code]!;

    if (err instanceof Error) {
      if (isNetworkFailure(err.message)) return 'Network error. Check your connection and try again.';
      return err.message || fallback;
    }

    if ('message' in err) {
      try {
        const msg = String((err as { message: unknown }).message);
        if (isNetworkFailure(msg)) return 'Network error. Check your connection and try again.';
        return msg || fallback;
      } catch { return fallback; }
    }
  }

  return fallback;
}

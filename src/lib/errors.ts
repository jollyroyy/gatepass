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
 * GoTrue codes (supabase-js `AuthApiError.code`). These are NOT SQLSTATEs —
 * they are auth-server strings — and they are kept in their own map so nobody
 * reads the list above as "Postgres codes" and adds one here by mistake.
 *
 * Only conditions whose GoTrue wording describes the server's internals rather
 * than the user's situation belong here. `unexpected_failure` is the one that
 * motivated the map: it is what a 500 from the auth server arrives as, and its
 * own text ("Database error querying schema") reads like a bug report. See
 * migration 034 — every user the admin panel created hit exactly that.
 *
 * An auth code NOT listed here falls through and shows GoTrue's own text,
 * which for the ordinary cases is already fine.
 */
const AUTH_CODE_MESSAGES: Record<string, string> = {
  unexpected_failure:
    'The authentication service could not complete that request. Please try again in a few ' +
    'minutes, and contact your administrator if it keeps happening.',
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed:
    'This account’s email address has not been confirmed yet. Ask your administrator to confirm it.',
  over_request_rate_limit: 'Too many attempts. Please wait a few minutes and try again.',
  over_email_send_rate_limit:
    'Too many emails have been requested recently — the sender allows only a few per hour. ' +
    'Please wait until the next hour and try again.',
};

/**
 * Messages that are technically strings but say nothing to a human. supabase-js
 * hands one over whenever it cannot turn a response body into a sentence, and
 * before this guard they reached the screen as bare punctuation — "{}" — which
 * reads as a broken UI rather than an error, and leaves the user with nothing
 * to act on or report. Falling back to the caller's own fallback ("Could not
 * sign in.") is strictly more informative.
 *
 * Matched EXACTLY (after trimming), never as a substring: a real sentence may
 * legitimately contain braces, e.g. the packed vendor blob in a blacklist
 * refusal, and must still be shown.
 */
const OPAQUE_MESSAGES = new Set(['{}', '[]', '[object Object]', 'null', 'undefined']);

function isOpaque(message: string): boolean {
  return OPAQUE_MESSAGES.has(message.trim());
}

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
  // 008's original index. It no longer exists on the database (020 moved the
  // rule onto gate_pass_items), so this entry cannot fire today — kept only
  // because an un-migrated environment could still raise it.
  gate_passes_one_pending_per_material_idx:
    'A pending gate pass already exists for this material in this department. ' +
    'Void it or have it verified at the gate before raising another.',

  // public.profiles' name rules are VMS-owned (three NOT VALID checks, read
  // from pg_constraint 2026-08-08) and fire on every screen that writes a
  // person's name: the admin Users tab (admin_create_user / admin_update_user)
  // and the profile page (update_my_name). A check violation is 23514, which is
  // deliberately absent from CODE_MESSAGES — so without these entries the admin
  // sees 'new row for relation "profiles" violates check constraint
  // "profiles_full_name_charset"', which names no field they recognise and
  // never says which characters are actually allowed. Adding a user called
  // "Probe 034" is enough to hit it.
  profiles_full_name_charset:
    'A name can contain only letters, spaces, full stops, apostrophes and hyphens — ' +
    'no digits or other symbols.',
  profiles_full_name_length: 'A name must be between 2 and 80 characters long.',
  profiles_full_name_trimmed: 'A name cannot start or end with a space.',
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
    if (typeof code === 'string') {
      if (code in CODE_MESSAGES) return CODE_MESSAGES[code]!;
      // Checked after the SQLSTATE map so a Postgres code can never be shadowed
      // by an auth code that happens to share its spelling.
      if (code in AUTH_CODE_MESSAGES) return AUTH_CODE_MESSAGES[code]!;
    }

    // Everything below resolves to raw text from the driver or the auth server,
    // so both paths end at the same guard: a message that says nothing to a
    // human is worse than the caller's fallback.
    if (err instanceof Error) {
      if (isNetworkFailure(err.message)) return 'Network error. Check your connection and try again.';
      return err.message && !isOpaque(err.message) ? err.message : fallback;
    }

    if ('message' in err) {
      try {
        const msg = String((err as { message: unknown }).message);
        if (isNetworkFailure(msg)) return 'Network error. Check your connection and try again.';
        return msg && !isOpaque(msg) ? msg : fallback;
      } catch { return fallback; }
    }
  }

  return fallback;
}

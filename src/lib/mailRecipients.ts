// THE STANDING COPY LIST (migration 078) — the addresses an admin types in
// Admin → Settings that are copied on EVERY gate pass letter.
//
// Client, 2026-09-01: "admin should be able to configure three to four email
// IDs in the setting part and all those emails should be receiving the
// notifications about the gate pass raising and all those status changes …
// gate pass creations and approvals."
//
// ═══ WHAT MAKES THIS DIFFERENT FROM EVERY OTHER RECIPIENT ═══
//
// Every other address the mail system uses is DERIVED from the pass — the
// person who raised it, the office holders on its ladder — and is therefore
// always correct and never needs maintaining. These are not participants. They
// hold no office, several have no login at all, and nothing about the pass
// implies them. That is exactly why they have to be typed, and exactly why the
// list needs a cap and a validator: it is the one recipient list that can be
// wrong.
//
// Pure functions over strings. No React, no Supabase — the same split
// `mailSettings.ts` follows, and the reason this is a separate module at all is
// that file's 268 lines against the repo's 300-line cap.

/** Five, matching `gatepass.notify_cc_is_valid` in migration 078. The client
 *  asked for "three to four"; the extra row is headroom, not an invitation.
 *
 *  WHY THERE IS A CAP AT ALL: every address here receives every letter about
 *  every pass, including the approval REQUESTS that the routing rule otherwise
 *  sends to exactly one office. Past a handful of people that stops being
 *  oversight and becomes noise nobody reads. */
export const MAX_COPY_ADDRESSES = 5;

/** How many blank rows the form offers before anything is typed. Four, because
 *  that is the number the client asked for, and an empty row is how you add
 *  one without hunting for a button. */
export const DEFAULT_COPY_ROWS = 4;

/** One address: no separator, no whitespace, no angle brackets, and an @ with
 *  a dotted domain after it. The same expression migration 078's validator
 *  uses, and the same one `override_to` has used since 052 — deliberately loose
 *  about what a domain may contain and strict about the two things that would
 *  turn one entry into a list. */
const ONE_ADDRESS = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

function isOne(value: string): boolean {
  return ONE_ADDRESS.test(value.trim());
}

/**
 * The list as the form holds it: a fixed number of rows, blanks included, so
 * that clearing row 2 does not renumber rows 3 and 4 under the person's cursor.
 * Padded to at least `DEFAULT_COPY_ROWS` and never beyond the cap.
 */
export function copyRowsFrom(stored: string[] | null | undefined): string[] {
  const rows = (stored ?? []).slice(0, MAX_COPY_ADDRESSES);
  while (rows.length < DEFAULT_COPY_ROWS) rows.push('');
  return rows;
}

/**
 * What actually gets stored: trimmed, blanks dropped, order kept.
 *
 * ⚠ NOT DEDUPLICATED HERE. A repeat is an ERROR the person should see and fix,
 * not something silently swallowed — a settings screen that quietly drops half
 * of what was typed is a settings screen nobody can trust. `validateCopyList`
 * reports it; `gatepass.notify_cc_is_valid` refuses it; and the Edge Function
 * deduplicates at send time anyway, because a listed watcher may also be the
 * raiser.
 */
export function copyListPayload(rows: string[]): string[] {
  return rows.map((r) => r.trim()).filter((r) => r.length > 0);
}

/**
 * One message per row that is wrong, indexed by row, or an empty object.
 *
 * The database says all of this too, in `notify_cc_is_valid`. This says it
 * first, in front of the person typing, because a 23514 reaching the browser is
 * not a sentence anybody can act on — and this repo deliberately leaves 23514
 * unmapped in `errors.ts`.
 */
export function validateCopyList(rows: string[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Map<string, number>();

  rows.forEach((raw, i) => {
    const value = raw.trim();
    if (!value) return;
    if (!isOne(value)) {
      errors[i] = 'Enter one email address, or leave this row blank.';
      return;
    }
    const key = value.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      errors[i] = `This is the same address as row ${first + 1}.`;
      return;
    }
    seen.set(key, i);
  });

  if (copyListPayload(rows).length > MAX_COPY_ADDRESSES) {
    errors[MAX_COPY_ADDRESSES] = `At most ${MAX_COPY_ADDRESSES} addresses.`;
  }
  return errors;
}

/**
 * The sentence under the list, which has to be honest about the ONE thing that
 * silently defeats it: while every letter is redirected to a single inbox, the
 * copies are suppressed with it, so a filled-in list sends nothing at all.
 *
 * That is deliberate — a redirected test letter must not reach live watchers —
 * but a person who typed four addresses and sees no mail deserves to be told
 * why, on the screen where they typed them, rather than discovering it in
 * `email_log`.
 */
export function copyListNote(count: number, overrideTo: string | null): string {
  const who =
    count === 0
      ? 'Nobody is copied on gate pass mail yet.'
      : count === 1
        ? 'One address is copied on every gate pass letter'
        : `${count} addresses are copied on every gate pass letter`;
  const what =
    count === 0
      ? ''
      : ' — raised, awaiting approval, approved, rejected, and both gate outcomes.';
  const caveat = overrideTo
    ? ` These copies are NOT being sent while all mail is redirected to ${overrideTo}. Clear that field above to start copying them.`
    : '';
  return `${who}${what}${caveat}`;
}

// RAISING AUTHORITY — the shapes, the labels and the form rule, as pure
// functions over plain data (migration 077).
//
// An HOD authorises somebody in their OWN department to raise gate passes on
// their behalf, for a stated period (client, 2026-09-01: "the HOD of all the
// departments should be able to delegate the pass creation capabilities … to the
// person he has asked … it should be from his own department only"). THIS IS THE
// HOD'S OWN ACT, exactly as an approval delegation is the approver's: no admin
// writes it and no admin approves it, and `create_pass_raiser` is gated on
// heading the department rather than on `is_admin()`.
//
// ⚠ IT IS NOT AN APPROVAL DELEGATION, and none of `approvalDelegation.ts` is
// reused here beyond the two status derivations the database shares. That module
// hands over a rung on the ladder — the queue, `approve_pass_level`, and the
// approver's whole set of routes. This hands over one verb, `raise_pass`, and
// the person who receives it gains no authority over anything, including their
// own pass: it goes to their HOD for signature at level 0 before it climbs the
// ordinary ladder.
//
// NO VALUE CEILING. 062's "Approval Limit (Optional)" caps what a stand-in may
// COMMIT the business to, and a raiser commits nothing — every pass they raise
// is signed by the HOD who authorised them before it moves at all. A ceiling
// here would be a control that reads as a limit on authority nobody has.
//
// Pure: no queries, no React. The same split every derivation module in
// `src/lib` follows — `usePassRaisers.ts` does the reading.
import type { DelegationStatus } from './approvalDelegation';

// The four statuses are `gatepass.delegation_status`'s, derived SERVER-SIDE for
// the reason that module gives: three of them turn on `now()`, and the clock
// that matters is the one the RPC authorises against.
export type { DelegationStatus } from './approvalDelegation';

/** One row of `gatepass.list_my_pass_raisers()`. `raiser_name` and
 *  `department_name` are nullable because the RPC LEFT JOINs into VMS's
 *  `public.profiles` / `public.departments` — a narrowed VMS policy must degrade
 *  to a missing name, never to a missing row: an unnamed authority is still one
 *  somebody has to be able to revoke. */
export interface PassRaiserRow {
  id: string;
  raiser_id: string;
  raiser_name: string | null;
  department_name: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  revoked_at: string | null;
  status: DelegationStatus;
  created_at: string;
}

/** One row of `gatepass.list_raiser_candidates()` — somebody this HOD may
 *  actually authorise. Already narrowed server-side to active members of their
 *  own department who are not department heads, admins, guards or approvers, so
 *  every name offered is one the RPC will accept. */
export interface RaiserCandidate {
  id: string;
  full_name: string | null;
  department_name: string | null;
}

/** What `gatepass.my_raising_grant()` tells the person holding one: which
 *  department they may raise for, and whose authority they are acting under. The
 *  sidebar's Raise tab is drawn from the presence of this, and the form says the
 *  HOD's name out loud — an assistant raising material must know whose signature
 *  it goes to. */
export interface RaisingGrant {
  id: string;
  department_id: string;
  department_name: string | null;
  hod_id: string;
  hod_name: string | null;
  starts_at: string;
  ends_at: string;
}

/** What the reader is told the status MEANS, under the row. A badge reading
 *  EXPIRED beside a name is not, on its own, an answer to "so can they still
 *  raise a pass for me?" */
export const RAISER_STATUS_NOTES: Record<DelegationStatus, string> = {
  active: 'This person can raise gate passes for your department right now. Each one comes to you for approval before it goes anywhere else.',
  scheduled: 'This authority has not started yet. Nothing is delegated until it does.',
  expired: 'This authority has run its course. Raising is back with you alone.',
  revoked: 'This authority was ended early. Raising is back with you alone.',
};

/** The one authority the summary card stands over: the live one, or else the one
 *  about to start. An expired or revoked one is history and belongs in the
 *  table — a card standing over something that grants nobody anything is the
 *  reading a person acts on wrongly. */
export function currentRaiser(rows: PassRaiserRow[]): PassRaiserRow | null {
  return (
    rows.find((r) => r.status === 'active') ??
    rows
      .filter((r) => r.status === 'scheduled')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ??
    null
  );
}

/** May this row still be revoked? Only something that has not already stopped —
 *  `revoke_pass_raiser` writes nothing over a revoked row, and offering a button
 *  that changes nothing is worse than offering none. */
export function canRevokeRaiser(row: PassRaiserRow): boolean {
  return row.status === 'active' || row.status === 'scheduled';
}

/** What the form holds. Strings throughout, because that is what the inputs give
 *  and half-typed input must be representable. */
export interface RaiserDraft {
  raiserId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export const EMPTY_RAISER_DRAFT: RaiserDraft = {
  raiserId: '',
  startsAt: '',
  endsAt: '',
  reason: '',
};

/** Field key → the sentence under that field. An empty object is a valid form. */
export type RaiserErrors = Partial<Record<keyof RaiserDraft, string>>;

/**
 * The form rule, which is the RPC's rule stated where the reader can act on it.
 *
 * Every sentence below has a matching `raise exception` in `create_pass_raiser`;
 * NEITHER copy is redundant. The database is the authority — the RPC is
 * reachable over PostgREST by any authenticated caller with a user id they typed
 * themselves — and this exists so the person is told before a round trip rather
 * than after. The refusals the browser CANNOT know (the person already holds an
 * authority over part of that period, they hold an approval office) are
 * deliberately not restated: the candidate list has already filtered the second,
 * and the first needs the database's own view of every window.
 *
 * `now` is injected rather than read, so the tests are not a race.
 */
export function validateRaiser(draft: RaiserDraft, now: Date = new Date()): RaiserErrors {
  const errors: RaiserErrors = {};

  if (!draft.raiserId) errors.raiserId = 'Choose somebody in your department.';

  const start = draft.startsAt ? new Date(draft.startsAt) : null;
  const end = draft.endsAt ? new Date(draft.endsAt) : null;

  if (!start || Number.isNaN(start.getTime())) {
    errors.startsAt = 'Choose when the authority starts.';
  }
  if (!end || Number.isNaN(end.getTime())) {
    errors.endsAt = 'Choose when the authority ends.';
  }

  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    if (end.getTime() <= start.getTime()) {
      errors.endsAt = 'The authority has to end after it starts.';
    } else if (end.getTime() <= now.getTime()) {
      errors.endsAt = 'That period is already over. Choose an end in the future.';
    }
  }

  return errors;
}

/** The arguments `create_pass_raiser` takes, built from a draft that has already
 *  validated.
 *
 *  THE TWO TIMES ARE SENT AS ABSOLUTE INSTANTS, for 062's reason: a
 *  `datetime-local` value is a wall clock with no zone, so it is resolved
 *  against the reader's own zone here and sent as an ISO string with an offset.
 *  A `timestamptz` column handed a bare local string would read it in the
 *  SERVER's zone, and an authority would start five and a half hours off.
 *
 *  A blank reason goes as NULL, never as `''`. */
export function raiserArgs(draft: RaiserDraft): {
  p_raiser_id: string;
  p_starts_at: string;
  p_ends_at: string;
  p_reason: string | null;
} {
  const reason = draft.reason.trim();
  return {
    p_raiser_id: draft.raiserId,
    p_starts_at: new Date(draft.startsAt).toISOString(),
    p_ends_at: new Date(draft.endsAt).toISOString(),
    p_reason: reason ? reason.slice(0, 500) : null,
  };
}

/** WHO AN HOD MAY AUTHORISE, in one sentence, under the control — the RPC's own
 *  rule stated where somebody would look for the name they cannot find. A
 *  silently short list reads as a broken query. */
export const RAISER_ELIGIBILITY_NOTE =
  'Your own department only. Anyone active who is not a department head, an admin, a guard or an approver.';

/** "Priya Mehta (Housekeeping)" — the person, with where they work in brackets so
 *  two people of the same name can be told apart. Never "(null)". */
export function raiserCandidateLabel(c: RaiserCandidate): string {
  const name = (c.full_name ?? '').trim() || 'Unnamed account';
  const dept = (c.department_name ?? '').trim();
  return dept ? `${name} (${dept})` : name;
}

/** The authorised person as the card and the table name them. Same rule. */
export function raiserLabel(row: PassRaiserRow): string {
  const name = (row.raiser_name ?? '').trim() || 'Unnamed account';
  const dept = (row.department_name ?? '').trim();
  return dept ? `${name} (${dept})` : name;
}

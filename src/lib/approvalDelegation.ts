// APPROVAL DELEGATION — the shapes, the labels and the form rule, as pure
// functions over plain data (migration 062).
//
// An office holder hands their own office to somebody else for a stated period
// while they are away. THIS IS THE APPROVER'S OWN ACT: no admin writes it, no
// admin approves it (client, 2026-08-22: "instead of that put it in the
// approvers section so whatever the approvers choose it should be automatically
// delegated"). The database says the same thing — `create_approval_delegation`
// is gated on holding the office yourself, not on `is_admin()`.
//
// THE ONLY COVER THERE IS. 054's standing deputy — permanent cover an ADMIN
// named, with no window — was withdrawn by the client and removed in 068, so a
// delegation is now the whole answer to an absent approver. It is a window the
// HOLDER declares before leave and it ends by itself; the pass record says when
// a rung was signed under one, and by whom for whom.
//
// NO GATE, NO SITE, NO PASS-TYPE SCOPE. The client's mock-up drew an Approval
// Type, a Location / Site and a Gate Pass Type scope and struck all three out
// by name ("no need to give any option or field to select the gate … no need to
// mention the type of delegation gate pass"). There is nothing in this schema
// to hang them on in any case: this app has no gate entity and no site. What a
// delegation DOES narrow is the value ceiling, which is the mock's own
// "Approval Limit (Optional)" and is enforced inside `approve_pass_level` —
// never on screen alone.
//
// Pure: no queries, no React. The same split every derivation module in
// `src/lib` follows — `useApprovalDelegations.ts` does the reading.
import type { ApprovalRoleKey } from './approvalLadder';

/** DERIVED SERVER-SIDE, never in the browser (`gatepass.delegation_status`).
 *  Three of the four turn on `now()`, and the clock that matters is the one the
 *  RPCs authorise against — a laptop an hour fast must not show a delegation as
 *  live while the database still refuses every press.
 *
 *  FOUR VALUES, where the mock drew three. A delegation written BEFORE the
 *  absence — which is the entire point of declaring one — is neither active nor
 *  expired until its window opens, and calling it "Active" a week early would
 *  be a screen lying about who can sign today. */
export type DelegationStatus = 'active' | 'scheduled' | 'expired' | 'revoked';

/** One row of `gatepass.list_my_delegations()`. `delegate_name` and
 *  `department_name` are nullable because the RPC LEFT JOINs into VMS's
 *  `public.profiles` / `public.departments` — a narrowed VMS policy must
 *  degrade to a missing name, never to a missing row: an unnamed delegation is
 *  still one somebody has to be able to revoke. */
export interface DelegationRow {
  id: string;
  role_key: ApprovalRoleKey;
  delegate_id: string;
  delegate_name: string | null;
  department_name: string | null;
  starts_at: string;
  ends_at: string;
  approval_limit: number | null;
  reason: string | null;
  status: DelegationStatus;
  created_at: string;
  revoked_at: string | null;
}

/** One row of `gatepass.list_delegation_candidates()` — a person this office
 *  holder may actually delegate to. The list is already narrowed server-side to
 *  active accounts holding no other approval seat, so every name offered is one
 *  the RPC will accept. */
export interface DelegateCandidate {
  id: string;
  full_name: string | null;
  department_name: string | null;
}

/** A `Record`, not a chain, so a fifth status in the database is a type error
 *  here rather than a blank badge. */
export const DELEGATION_STATUS_LABELS: Record<DelegationStatus, string> = {
  active: 'ACTIVE',
  scheduled: 'SCHEDULED',
  expired: 'EXPIRED',
  revoked: 'REVOKED',
};

/** The `.gb-pill-*` classes only — no new colour, so `themeAudit` stays
 *  absolute. Green is live, blue is coming, grey is over on its own terms, red
 *  is ended early: the two ways a delegation stops must not look alike, because
 *  one of them was somebody's decision. */
export const DELEGATION_STATUS_PILL: Record<DelegationStatus, string> = {
  active: 'gb-pill gb-pill-green',
  scheduled: 'gb-pill gb-pill-blue',
  expired: 'gb-pill gb-pill-grey',
  revoked: 'gb-pill gb-pill-red',
};

/** What the reader is told the status MEANS, under the status card. A badge
 *  reading EXPIRED beside a name is not, on its own, an answer to "so who signs
 *  my passes now?" */
export const DELEGATION_STATUS_NOTES: Record<DelegationStatus, string> = {
  active:
    'Gate pass approval requests are being handled by your delegate during the validity period. ' +
    'You can still approve them yourself at any time.',
  scheduled: 'This delegation has not started yet. Nothing is delegated until it does.',
  expired: 'This delegation has run its course. Approvals are back with you alone.',
  revoked: 'This delegation was ended early. Approvals are back with you alone.',
};

/** The one delegation the status card stands over: the live one, or else the
 *  one about to start.
 *
 *  ONLY THOSE TWO. An expired or revoked delegation is history and belongs in
 *  the table behind the Delegation History button — a card headed "My
 *  Delegation Status" standing over something that grants nobody anything is
 *  the reading a person acts on wrongly.
 *
 *  A live one WINS over a scheduled one: at most one of each can exist (the
 *  RPC refuses overlapping windows on the same office), and what is true now
 *  outranks what is true next week. */
export function currentDelegation(rows: DelegationRow[]): DelegationRow | null {
  return (
    rows.find((r) => r.status === 'active') ??
    rows
      .filter((r) => r.status === 'scheduled')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ??
    null
  );
}

/** May this row still be revoked? Only something that has not already stopped —
 *  the RPC refuses a second revocation, and offering a button that always fails
 *  is worse than offering none. */
export function canRevoke(row: DelegationRow): boolean {
  return row.status === 'active' || row.status === 'scheduled';
}

/** What the form holds. Strings throughout, because that is what the inputs
 *  give and half-typed input must be representable — a number field mid-edit is
 *  not a number. */
export interface DelegationDraft {
  delegateId: string;
  startsAt: string;
  endsAt: string;
  approvalLimit: string;
  reason: string;
}

export const EMPTY_DELEGATION_DRAFT: DelegationDraft = {
  delegateId: '',
  startsAt: '',
  endsAt: '',
  approvalLimit: '',
  reason: '',
};

/** Field key → the sentence under that field. An empty object is a valid form. */
export type DelegationErrors = Partial<Record<keyof DelegationDraft, string>>;

/**
 * The form rule, which is the RPC's rule stated where the reader can act on it.
 *
 * Every sentence below has a matching `raise exception` in
 * `create_approval_delegation`; NEITHER copy is redundant. The database is the
 * authority — a delegation is a grant of real approval authority and a screen
 * can be bypassed — and this exists so the person is told before a round trip
 * rather than after. The refusals the browser CANNOT know (the delegate already
 * holds a seat, the window overlaps another) are deliberately not restated: the
 * candidate list has already filtered the first, and the second needs the
 * database's own view of every window.
 *
 * `now` is injected rather than read, so the tests are not a race.
 */
export function validateDelegation(draft: DelegationDraft, now: Date = new Date()): DelegationErrors {
  const errors: DelegationErrors = {};

  if (!draft.delegateId) errors.delegateId = 'Choose somebody to delegate to.';

  const start = draft.startsAt ? new Date(draft.startsAt) : null;
  const end = draft.endsAt ? new Date(draft.endsAt) : null;

  if (!start || Number.isNaN(start.getTime())) {
    errors.startsAt = 'Choose when the delegation starts.';
  }
  if (!end || Number.isNaN(end.getTime())) {
    errors.endsAt = 'Choose when the delegation ends.';
  }

  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    if (end.getTime() <= start.getTime()) {
      errors.endsAt = 'The delegation has to end after it starts.';
    } else if (end.getTime() <= now.getTime()) {
      // A window already over grants nobody anything and would land in the
      // history reading "Expired" the moment it was written.
      errors.endsAt = 'That period is already over. Choose an end in the future.';
    }
  }

  // OPTIONAL, AND BLANK MEANS NO LIMIT. `Number('')` is 0 and 0 is a ceiling
  // nothing can pass, so the empty string is checked before it is ever parsed.
  const limit = draft.approvalLimit.trim();
  if (limit) {
    const n = Number(limit);
    if (!Number.isFinite(n)) {
      errors.approvalLimit = 'Enter an amount in rupees, or leave it blank for no limit.';
    } else if (n <= 0) {
      errors.approvalLimit = 'An approval limit has to be more than zero. Leave it blank for no limit.';
    }
  }

  return errors;
}

/** The arguments `create_approval_delegation` takes, built from a draft that
 *  has already validated.
 *
 *  THE TWO TIMES ARE SENT AS ABSOLUTE INSTANTS. A `datetime-local` value is a
 *  wall clock with no zone, so it is resolved against the reader's own zone
 *  here and sent as an ISO string with an offset — a `timestamptz` column
 *  handed a bare local string would be read in the SERVER's zone, and a
 *  delegation would start five and a half hours off.
 *
 *  A blank limit and a blank reason go as NULL, never as `0` or `''`: "no
 *  ceiling" and "a ceiling of zero" are opposite facts. */
export function delegationArgs(draft: DelegationDraft): {
  p_delegate_id: string;
  p_starts_at: string;
  p_ends_at: string;
  p_approval_limit: number | null;
  p_reason: string | null;
} {
  const limit = draft.approvalLimit.trim();
  const reason = draft.reason.trim();
  return {
    p_delegate_id: draft.delegateId,
    p_starts_at: new Date(draft.startsAt).toISOString(),
    p_ends_at: new Date(draft.endsAt).toISOString(),
    p_approval_limit: limit ? Number(limit) : null,
    p_reason: reason ? reason.slice(0, 500) : null,
  };
}

/** WHO THIS OFFICE MAY DELEGATE TO, in one sentence, under the Delegate To
 *  control — the RPC's own rule stated where somebody would look for the name
 *  they cannot find. A silently short list reads as a broken query.
 *
 *  TWO RULES, because there are two (migrations 066 and 067). The COO and the
 *  CEO share the last rung of the ladder, so each may hand it only to the
 *  other; every other office may hand it only to an active department head who
 *  holds no approval seat — never staff, and never the gate. */
export function delegateEligibilityNote(office: ApprovalRoleKey | null): string {
  if (office === 'coo') {
    return 'The COO office can only be delegated to the CEO, who signs the same level. Nobody else may cover it.';
  }
  if (office === 'ceo') {
    return 'The CEO office can only be delegated to the COO, who signs the same level. Nobody else may cover it.';
  }
  return 'Department heads only. Anyone active who does not already hold an approval office or a delegation.';
}

/** "Priya Mehta (Housekeeping)" — the person, with where they work in brackets
 *  so two people of the same name can be told apart. The mock's own bracket
 *  carried an employee number; this directory has no such column, and the
 *  department is the fact it does have. Never "(null)". */
export function candidateLabel(c: DelegateCandidate): string {
  const name = (c.full_name ?? '').trim() || 'Unnamed account';
  const dept = (c.department_name ?? '').trim();
  return dept ? `${name} (${dept})` : name;
}

/** The delegate as the status card and the table name them. Same rule. */
export function delegateLabel(row: DelegationRow): string {
  const name = (row.delegate_name ?? '').trim() || 'Unnamed account';
  const dept = (row.department_name ?? '').trim();
  return dept ? `${name} (${dept})` : name;
}

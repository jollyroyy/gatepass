// THE APPROVAL LADDER a gate pass record prints down its right-hand side.
//
// It is the printed slip's own chain and nothing else — `signatureBlocks.ts`
// has carried it since the beginning:
//
//     Issuing HOD → Security Head → COO → CEO → Finance HOD → the gate
//
// so the screen and the paper name the same five offices in the same order
// (client, 2026-08-19: "just match the print slip"). Change one and change the
// other, or a guard comparing the slip in their hand to the record on the
// tablet finds a level on one that is missing from the other.
//
// THIS IS A LADDER, NOT A WORKFLOW. Nothing here gates anything: `match_pass`
// is untouched, no pass waits on a level and no queue exists for these four
// offices. The signature is still the wet one on the A5 slip; migration 043
// only records WHO holds each office, so the record can print a name beside
// the level instead of a blank box. That is why none of the four carries a
// timestamp — this database stamps exactly two moments on a pass, the raise
// and the gate clearance, and inventing a third would be a fabricated audit
// trail on a document that goes out of the building.
//
// AN OFFICE NOBODY HOLDS IS NOT APPROVED. `approvalProgress` counts designated
// offices only, so "3 of 5 levels approved" is a true statement about a pass
// whose COO and CEO seats are empty. Defaulting to 5 of 5 would make the
// counter meaningless the moment someone left.
import type { GatePassView, UserRole } from '../types';
import { formatDateOnly } from './formatDate';

/** The four offices between the issuing HOD and the gate. Mirrors the
 *  `approval_roles_key_known` check in migration 043 — a fifth office is a
 *  migration and a new entry here, never a free-text row. */
export type ApprovalRoleKey = 'security_head' | 'coo' | 'ceo' | 'finance_head';

/** One row of `gatepass.get_approval_ladder()`. `full_name` and
 *  `department_name` are nullable because the RPC LEFT JOINs into VMS's
 *  `public.profiles` / `public.departments` — a narrowed VMS policy must
 *  degrade to a missing name, never to a missing office. */
export interface ApprovalRoleRow {
  role_key: ApprovalRoleKey;
  user_id: string;
  full_name: string | null;
  department_name: string | null;
  designated_at: string;
}

/** The title printed beside the level. "Finance HOD" and not "Finance Head"
 *  because that is the word on the slip, and the two documents must agree. */
export const APPROVAL_ROLE_TITLES: Record<ApprovalRoleKey, string> = {
  security_head: 'Security Head',
  coo: 'COO',
  ceo: 'CEO',
  finance_head: 'Finance HOD',
};

/** Slip order, and the order the levels are numbered in. An array rather than
 *  the Record's key order, because level numbers depend on it and object key
 *  order is a language detail, not a promise. */
export const APPROVAL_LADDER: { key: ApprovalRoleKey; level: number }[] = [
  { key: 'security_head', level: 1 },
  { key: 'coo', level: 2 },
  { key: 'ceo', level: 3 },
  { key: 'finance_head', level: 4 },
];

/** "COO (Vikram Singh)" — the office first, the person in brackets (client).
 *  The office is the fact that matters on an audit trail; the holder changes.
 *  A vacant office prints its own title alone, never "COO (—)". */
export function approverLine(title: string, name: string | null | undefined): string {
  return name && name.trim() ? `${title} (${name.trim()})` : title;
}

/**
 * `done`    — it happened, or the office is held and signs on the slip.
 * `pending` — it has not happened yet and nothing is wrong.
 * `blocked` — it went wrong, or a deadline has passed. Printed in the flagged
 *             hue, the way the mock-up prints its missed return date in red.
 * `unset`   — nobody holds this office. Distinct from `pending` on purpose: the
 *             fix is an admin designating somebody, not waiting.
 */
export type ApprovalStepState = 'done' | 'pending' | 'blocked' | 'unset';

export interface ApprovalStep {
  /** Stable identity for tests and React keys — never the label, which is
   *  wording and changes. */
  key: string;
  label: string;
  /** The office and its holder, or the person who acted. */
  who: string | null;
  /** The line under the name — a department, usually. */
  detail: string | null;
  /** ISO timestamp, or null when this system records no moment for the step. */
  at: string | null;
  state: ApprovalStepState;
  /** A sentence the step needs and the label cannot carry. */
  note?: string;
}

function byKey(roles: ApprovalRoleRow[]): Map<ApprovalRoleKey, ApprovalRoleRow> {
  return new Map(roles.map((r) => [r.role_key, r]));
}

/** The gate step: what happened when the material reached the barrier. Three
 *  outcomes, all of them normal — `match_pass`, `flag_pass` and neither yet. */
function gateStep(pass: GatePassView): ApprovalStep {
  if (pass.status === 'matched' && pass.verified_at) {
    return {
      key: 'gate',
      label: 'Cleared by Security',
      who: pass.verified_by_name ?? 'Security',
      detail: 'Security Verification',
      at: pass.verified_at,
      state: 'done',
    };
  }
  if (pass.status === 'flagged') {
    return {
      key: 'gate',
      label: 'Mismatch raised at the gate',
      who: pass.verified_by_name ?? 'Security',
      detail: 'Security Verification',
      at: pass.verified_at,
      state: 'blocked',
      note: pass.flag_reason ?? undefined,
    };
  }
  return {
    key: 'gate',
    label: 'Security Verification',
    who: null,
    detail: 'Pending at the gate',
    at: null,
    state: 'pending',
  };
}

/** The return leg — RGP only. An NRGP is finished the moment the gate cleared
 *  it, and a "To Be Returned" row on a pass that is never coming back would be
 *  a deadline nobody can meet. */
function returnStep(pass: GatePassView): ApprovalStep | null {
  if (pass.type !== 'RGP') return null;

  if (pass.return_status === 'returned') {
    return {
      key: 'return',
      label: 'Returned',
      who: null,
      detail: 'Material back in full',
      at: pass.actual_return_date,
      state: 'done',
    };
  }
  return {
    key: 'return',
    label: 'To Be Returned',
    who: null,
    detail: pass.return_status === 'partially_returned' ? 'Partially returned' : null,
    at: null,
    // The mock-up prints the missed deadline in red; `is_overdue` is the view's
    // own grading and is never recomputed here.
    state: pass.is_overdue ? 'blocked' : 'pending',
    note: pass.expected_return_date
      ? `Before ${formatDateOnly(pass.expected_return_date)}`
      : 'No return date recorded',
  };
}

/**
 * Every step of the ladder for one pass, oldest first.
 *
 * `roles` is the whole designation table; a missing entry is an empty office,
 * not an error. The four offices are graded on whether somebody holds them,
 * because their approval is the signature on the paper that travels WITH the
 * material — a pass at the gate with an unsigned box is a conversation between
 * the guard and the driver, not a state this database can observe.
 */
export function buildApprovalSteps(pass: GatePassView, roles: ApprovalRoleRow[]): ApprovalStep[] {
  const held = byKey(roles);

  const steps: ApprovalStep[] = [
    {
      key: 'raised',
      label: 'Raised By',
      who: pass.raised_by_name,
      detail: pass.department_name,
      at: pass.created_at,
      // The issuing HOD raised it, which IS their approval — there is nobody
      // for them to wait on (client, 2026-08-19).
      state: 'done',
      note: 'Approved on raising',
    },
  ];

  for (const { key, level } of APPROVAL_LADDER) {
    const row = held.get(key);
    const title = APPROVAL_ROLE_TITLES[key];
    steps.push({
      key: `level-${level}`,
      label: `Level ${level} Approval`,
      who: approverLine(title, row?.full_name),
      detail: row?.department_name ?? null,
      at: null,
      state: row ? 'done' : 'unset',
      note: row ? 'Signed on the printed pass' : 'Not designated yet',
    });
  }

  steps.push(gateStep(pass));

  const back = returnStep(pass);
  if (back) steps.push(back);

  return steps;
}

/** "4 of 5 level(s) approved" — the summary line the mock-up prints in its fact
 *  strip. The issuing HOD is always the first of the five and is always
 *  approved; the other four count only while somebody holds them. */
export function approvalProgress(roles: ApprovalRoleRow[]): { approved: number; total: number } {
  const held = byKey(roles);
  const designated = APPROVAL_LADDER.filter((l) => held.has(l.key)).length;
  return { approved: 1 + designated, total: 1 + APPROVAL_LADDER.length };
}

/**
 * May this reader still record a return on this pass?
 *
 * Both halves are the DATABASE's rule, restated so a button that would always
 * fail is never drawn: `apply_item_returns` refuses anyone who is not security
 * (`is_security()`), and refuses any pass whose `return_status` is outside
 * awaiting/partially returned. A returned pass therefore has nothing editable
 * left on it at all — which is the client's rule too (2026-08-19: "once it is
 * marked as returned, nothing can be edited anymore").
 */
export function canRecordReturns(pass: GatePassView, role: UserRole | null): boolean {
  if (role !== 'guard') return false;
  return pass.return_status === 'awaiting_return' || pass.return_status === 'partially_returned';
}

/** The pass has been fully returned and is closed. Not the same as "has no
 *  editable action": an NRGP has none either, but it was never awaiting one. */
export function isReturnClosed(pass: GatePassView): boolean {
  return pass.return_status === 'returned';
}

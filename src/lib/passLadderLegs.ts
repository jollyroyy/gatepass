// THE TWO LEGS OF THE LADDER THAT ARE NOT APPROVAL OFFICES — the gate, and the
// return — plus the shape every rung of it takes.
//
// Split out of `approvalLadder.ts` for the 300-line cap, which that module went
// over on 2026-08-21 and further over on 2026-08-22 when a delegated signature
// gained its own bracket. The seam is a real one all the same: everything left
// in `approvalLadder.ts` is about WHO SIGNS — the four offices, who holds them,
// what each one decided — while these two steps are about what happened to the
// MATERIAL afterwards, and are graded from the pass's own columns with no
// reference to `approval_roles` or `pass_approvals` at all.
//
// `approvalLadder.ts` re-exports both types, so no caller has to know this file
// exists; it is a file-size boundary, not an API one — the same arrangement
// `passApprovalState.ts` already has.
import type { GatePassView } from '../types';
import { formatDateOnly } from './formatDate';

/**
 * `done`    — it happened, or the office is held and signs on the slip.
 * `pending` — it has not happened yet and nothing is wrong.
 * `blocked` — it went wrong, or a deadline has passed. Printed in the flagged
 *             hue, the way the mock-up prints its missed return date in red.
 * `unset`   — nobody holds this office. Distinct from `pending` on purpose: the
 *             fix is an admin designating somebody, not waiting.
 * `skipped` — this office never had to sign: the rung it shares was closed by
 *             the other office on it (migration 063 — the COO and the CEO share
 *             level 3, and one signature closes it). Distinct from `done`
 *             because NOBODY SIGNED IT, and the printed slip draws a tick box
 *             per office: a tick here would be a signature nobody gave.
 */
export type ApprovalStepState = 'done' | 'pending' | 'blocked' | 'unset' | 'skipped';

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
  /** The heading the PRINTED slip's box carries, when it differs from the
   *  wording on screen. Set on the raise rung alone (migration 071): the paper
   *  heads it "Issuing HOD", and a pass the COO raised for a department they do
   *  not head must head it "Issuing COO" instead — a person signs underneath
   *  that line. `printSignatureBoxes.labelOf` falls back to its own words when
   *  this is absent, so no other rung has to carry it. */
  boxLabel?: string;
  /** The approval office this rung belongs to, for the rungs that have one.
   *  Absent on the raise, the gate and the return leg. Carried so the printed
   *  signature boxes can be HEADED by the office (the label a person signing
   *  paper reads) without parsing it back out of `key` or `who`. */
  office?: string;
}

/** The gate step: what happened when the material reached the barrier. Three
 *  outcomes, all of them normal — `match_pass`, `flag_pass` and neither yet. */
export function gateStep(pass: GatePassView): ApprovalStep {
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
      label: 'Rejected at the security gate',
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
export function returnStep(pass: GatePassView): ApprovalStep | null {
  if (pass.type !== 'RGP') return null;

  // THE CLOSING RUNG SAYS "CLOSED", NOT "RETURNED" (client, 2026-08-23). The
  // rail already carries the guard's own recorded "Material marked returned"
  // event a rung above; repeating the same word underneath it read as a second
  // return rather than as the end of the pass. "Closed" is the one thing this
  // rung says that no other rung on the rail does.
  if (pass.return_status === 'returned') {
    return {
      key: 'return',
      label: 'Closed',
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

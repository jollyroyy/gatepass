// THE APPROVAL PENDING STRIP, and the one set of numbers behind every "pending
// approval" figure on the HOD dashboard.
//
// The client's mock-up (2026-08-19) draws a strip of four offices — HOD
// Approval, Security Approval, Finance Approval, Other Approvers — each with a
// "Waiting" count. Migration 046 (2026-08-19, later the same day) built the
// real workflow behind them: `gatepass.pass_approvals` holds one row per office
// a pass owes a signature to, snapshotted from the ladder when it was raised.
// These four figures are DERIVED from that table, not hard zeros.
//
// ONE PASS COUNTS ONCE, AGAINST ONE DESK — the desk that can act on it RIGHT
// NOW, which `approve_pass_level` (046) defines as the lowest still-pending
// rung. THIS REVERSES THE RULE THIS FILE CARRIED UNTIL 2026-08-21, which
// counted every SIGNATURE still owed and so listed one freshly raised pass
// under four offices at once. Two things were wrong with it:
//
//   * IT DISAGREED WITH THE CARD DIRECTLY ABOVE IT. The Pending Approvals card
//     counts PASSES, so a board with a single pass climbing read "1" over a
//     strip summing to 4. The client, 2026-08-21: "there is only one pending
//     approval … at the bottom I do see that one is pending approval with
//     security and two is pending approval with some other approver … it should
//     match, right?" It does now, by construction — see `approvalWaitingTotal`.
//   * IT NAMED PEOPLE WHO CANNOT SEE THE DOCUMENT. Migration 061 made the slip
//     order RLS: an office cannot READ a pass until every rung below it is
//     approved. Printing a count against the CEO on a pass the Security Head
//     has not signed said a person was holding up paperwork that is invisible
//     to them.
//
// THE MOCK HAS FOUR SLOTS; THE SLIP HAS FOUR OFFICES; THEY ARE NOT THE SAME
// FOUR. `approvalLadder.ts` names the ladder Security Head → COO → Finance HOD
// → CEO. `ROLE_TO_SLOT` is the one place that reconciles them:
//
//   security ← security_head
//   finance  ← finance_head
//   other    ← coo AND ceo — the mock's fourth slot, "Other Approvers", is
//              exactly what COO and CEO are here: the two offices the mock does
//              not name individually.
//   hod      ← nothing. See below.
//
// `hod` STAYS STRUCTURALLY ZERO — the one figure in this module that a real
// workflow cannot move. The issuing HOD's own approval is granted by the act
// of raising the pass (`buildApprovalSteps` in `approvalLadder.ts` grades the
// "Raised By" rung `done` with "Approved on raising", unconditionally); there
// is no HOD row in `pass_approvals` for a designation to wait on and none is
// ever snapshotted. If a future migration adds an HOD countersignature step,
// this is where a fifth mapping would go — until then the slot is drawn only
// because the mock draws four, not because anything can be waiting there.
//
// WHAT COUNTS AS WAITING WITH AN APPROVER, precisely:
//
//   * the pass is still in the queue at all — `isWaitingAtGate`, THE SAME
//     predicate the Pending Approvals card counts with. Reused rather than
//     restated so the strip cannot admit a pass the card excludes: a rejected
//     pass (`reject_pass_level` moves it to `cancelled` and deliberately leaves
//     its lower, undecided rungs `pending` for ever) and an EXPIRED one
//     (`match_pass` refuses it no matter who signs) are both out;
//   * AND it has a still-pending rung. A pass with none has finished climbing —
//     or never had a ladder, which is every pass raised before an office was
//     designated and every level closed by 058's rollout — and is waiting at
//     the GATE, not with an approver. This strip has no gate row and counts no
//     such pass; the card above it does, on its own "N pending gate review"
//     line.
import type { GatePassView } from '../types';
import type { ApprovalRoleKey } from './approvalLadder';
import type { PassApprovalStatus } from './passApprovalState';
import { actingStep } from './approvalDecision';
import { isWaitingAtGate } from './gateQueue';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

export type ApprovalOffice = 'hod' | 'security' | 'finance' | 'other';

export interface ApprovalSlot {
  key: ApprovalOffice;
  label: string;
  glyph: HodGlyph;
  tone: HodTone;
}

/** The mock-up's four, in its own order. A `Record`-keyed union rather than a
 *  loose string, so a fifth office is a type error and not a silent blank. */
export const APPROVAL_SLOTS: ApprovalSlot[] = [
  { key: 'hod', label: 'HOD Approval', glyph: 'people', tone: 'green' },
  { key: 'security', label: 'Security Approval', glyph: 'shield', tone: 'blue' },
  { key: 'finance', label: 'Finance Approval', glyph: 'wallet', tone: 'orange' },
  { key: 'other', label: 'Other Approvers', glyph: 'people', tone: 'purple' },
];

/** The office→slot mapping described in the header. A `Record` over
 *  `ApprovalRoleKey`, so a fifth ladder office added to migration 046's check
 *  constraint is a compile error here rather than a signature nobody counts. */
export const ROLE_TO_SLOT: Record<ApprovalRoleKey, ApprovalOffice> = {
  security_head: 'security',
  coo: 'other',
  ceo: 'other',
  finance_head: 'finance',
};

/** One row of `gatepass.pass_approvals`, narrowed to what this module needs to
 *  count. `gate_pass_id` is what ties a row back to its own pass. It satisfies
 *  `ApprovalStepRow`, which is what lets `lowestPendingLevel` — the rule
 *  `approve_pass_level` itself enforces — grade these rows rather than a second
 *  copy of the slip order living here. */
export interface PendingApprovalRow {
  gate_pass_id: string;
  role_key: ApprovalRoleKey;
  /** The rung's position on the pass's own ladder (063: Security Head 1 ·
   *  Finance HOD 2 · COO and CEO jointly 3). Load-bearing — it is what decides
   *  which single desk a pass is counted against. */
  level_no: number;
  status: PassApprovalStatus;
}

/** How many of these passes each office is holding up, one pass counted once.
 *  `passes` is whatever the board was handed (RLS narrows to the department and
 *  `.eq('raised_by', …)` narrows again, both server-side — scope is the
 *  caller's, never this module's); `approvals` is the whole `pass_approvals`
 *  read for those same passes' ids. */
export function approvalWaiting(
  passes: GatePassView[],
  approvals: PendingApprovalRow[],
): Record<ApprovalOffice, number> {
  const byPass = new Map<string, PendingApprovalRow[]>();
  for (const a of approvals) {
    const list = byPass.get(a.gate_pass_id);
    if (list) list.push(a);
    else byPass.set(a.gate_pass_id, [a]);
  }

  const counts: Record<ApprovalOffice, number> = { hod: 0, security: 0, finance: 0, other: 0 };
  for (const p of passes) {
    if (!isWaitingAtGate(p)) continue;
    const rows = byPass.get(p.id) ?? [];
    // Nothing pending: the ladder is finished, or there never was one. That
    // pass is at the barrier, and the barrier has no slot on this strip.
    const step = actingStep(rows);
    if (!step) continue;
    counts[ROLE_TO_SLOT[step.role_key]] += 1;
  }
  return counts;
}

/** Everything the strip is counting. Summed from the map above rather than
 *  derived a second way, and it is BY CONSTRUCTION the Pending Approvals card's
 *  own "N pending approval" sub-figure: both are the passes `isWaitingAtGate`
 *  admits that still owe a signature, one filed by desk and one counted flat.
 *  `hodApprovals.test.ts` pins that equality against `pendingSplit`. */
export function approvalWaitingTotal(waiting: Record<ApprovalOffice, number>): number {
  return APPROVAL_SLOTS.reduce((n, s) => n + waiting[s.key], 0);
}

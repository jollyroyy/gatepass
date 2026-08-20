// THE APPROVAL PENDING STRIP, and the one set of numbers behind every "pending
// approval" figure on the HOD dashboard.
//
// The client's mock-up (2026-08-19) draws a strip of four offices — HOD
// Approval, Security Approval, Finance Approval, Other Approvers — each with a
// "Waiting" count, and two of the KPI cards above it carry a "N pending
// approval" line. Migration 046 (2026-08-19, later the same day) built the real
// workflow behind them: `gatepass.pass_approvals` holds one row per office a
// pass owes a signature to, snapshotted from the ladder when it was raised.
// These four figures are now DERIVED from that table, not hard zeros.
//
// THE MOCK HAS FOUR SLOTS; THE SLIP HAS FOUR OFFICES; THEY ARE NOT THE SAME
// FOUR. `approvalLadder.ts` names the ladder Security Head → COO → CEO →
// Finance HOD. `ROLE_TO_SLOT` is the one place that reconciles them:
//
//   security ← security_head
//   finance  ← finance_head
//   other    ← coo AND ceo — the mock's fourth slot, "Other Approvers", is
//              exactly what COO and CEO are here: the two offices between
//              Security and Finance that the mock does not name individually.
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
// WHAT COUNTS AS "WAITING": an approval row whose `status` is `'pending'` ON A
// PASS WHOSE OWN `status` IS STILL `'pending'`. The second clause is
// load-bearing: `reject_pass_level` (046) moves a rejected pass straight to
// `cancelled` and deliberately leaves that pass's lower, undecided levels
// exactly as they were — "pending", forever, on a pass that is never climbing
// again. Counting those would tell an HOD their Finance approval is still
// outstanding on a pass Security Head already killed.
//
// EACH PENDING ROW COUNTS ONCE, INTO ITS OWN OFFICE — including when a pass
// carries both a pending COO row and a pending CEO row, which then counts
// TWICE under "Other Approvers". The strip counts SIGNATURES still owed at an
// office, not passes stalled somewhere: Security and Finance already count
// this way because their office maps 1:1 to a role key, and folding two
// outstanding signatures into one "Other Approvers" count would make that
// slot mean something different from the other three it sits beside.
import type { GatePassView } from '../types';
import type { ApprovalRoleKey } from './approvalLadder';
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
 *  count. `gate_pass_id` is what ties a row back to its pass's own `status`. */
export interface PendingApprovalRow {
  gate_pass_id: string;
  role_key: ApprovalRoleKey;
  /** The rung's position on the pass's own ladder. Not read by anything in
   *  THIS module — it counts every owed signature and so needs no order — but
   *  the same rows drive the "Waiting With" strip at the foot of the board,
   *  which asks who can act NOW and therefore needs the slip order
   *  (`waitingWith.ts` → `lowestPendingLevel`). One read, both strips. */
  level_no: number;
  status: 'pending' | 'approved' | 'rejected';
}

/** How many signatures are still owed at each office, across the passes on
 *  this board. `passes` supplies each pass's CURRENT `status` — the rejection
 *  guard the header describes — and `approvals` is the whole `pass_approvals`
 *  read for those same passes' ids. */
export function approvalWaiting(
  passes: GatePassView[],
  approvals: PendingApprovalRow[],
): Record<ApprovalOffice, number> {
  const stillClimbing = new Set(passes.filter((p) => p.status === 'pending').map((p) => p.id));
  const counts: Record<ApprovalOffice, number> = { hod: 0, security: 0, finance: 0, other: 0 };
  for (const a of approvals) {
    if (a.status !== 'pending') continue;
    if (!stillClimbing.has(a.gate_pass_id)) continue;
    counts[ROLE_TO_SLOT[a.role_key]] += 1;
  }
  return counts;
}

/** The roll-up the KPI cards' "N pending approval" lines print. Summed from the
 *  map above rather than counted separately, so the strip and the cards cannot
 *  disagree. */
export function approvalWaitingTotal(waiting: Record<ApprovalOffice, number>): number {
  return APPROVAL_SLOTS.reduce((n, s) => n + waiting[s.key], 0);
}

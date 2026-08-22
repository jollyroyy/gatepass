// WHAT "REJECTED" IS MADE OF — the HOD dashboard's sixth figure.
//
// Client, 2026-08-20: "show a dashboard KPI card of rejected under all HOD, and
// under the rejected KPI card give the total number. Below that put it —
// rejected at security gate, rejected by approver — show exact count."
//
// A PASS CAN BE REJECTED AT TWO ENTIRELY DIFFERENT DESKS, and until now one
// figure would have hidden which:
//
//   AT THE SECURITY GATE — the guard pressed Reject (`flag_pass`), so the pass
//                          is `flagged`; or the raising HOD then UPHELD that
//                          rejection (`hod_review_flagged_pass('reject')`),
//                          which moves it to `cancelled` but leaves the guard's
//                          `flag_reason` on the record. Both are the same
//                          event, decided at the barrier.
//   BY AN APPROVER       — an office on the ladder pressed Reject
//                          (`reject_pass_level`, migration 046). The pass is
//                          `cancelled` and never reached the gate at all.
//
// THE TWO ARE TOLD APART BY THE LADDER'S OWN ROWS, NOT BY `flag_reason` BEING
// NULL. That null was the discriminator the bell's rejection notice used, and
// it is not exact: `hod_void_expired_pass` (041) ALSO writes `cancelled` with
// no flag reason, so a pass nobody rejected — it simply ran out of time —
// would be counted as an approver's rejection. Here a pass counts as rejected
// by an approver only when `pass_approvals` actually carries a `rejected` row
// for it. That is the exact count the client asked for.
//
// A VOIDED EXPIRED PASS IS THEREFORE IN NEITHER BUCKET, and the card's total is
// the two summed rather than a third count of every `cancelled` row — because
// nobody rejected it. The two sub-figures add up to the figure above them by
// construction, which is this app's board rule one level down.
import type { PassApprovalStatus } from './passApprovalState';
import type { GatePassView } from '../types';

/** The `pass_approvals` fields this module needs. Wider rows satisfy it. */
export interface RejectionApprovalRow {
  gate_pass_id: string;
  status: PassApprovalStatus;
}

export interface RejectionSplit {
  /** Both buckets together — what the card's figure prints. */
  all: GatePassView[];
  atGate: GatePassView[];
  byApprover: GatePassView[];
}

export function rejectionSplit(
  rows: GatePassView[],
  approvals: RejectionApprovalRow[],
): RejectionSplit {
  const rejectedLadder = new Set(
    approvals.filter((a) => a.status === 'rejected').map((a) => a.gate_pass_id),
  );

  const atGate: GatePassView[] = [];
  const byApprover: GatePassView[] = [];

  for (const p of rows) {
    // The guard's own rejection, still awaiting the HOD's review.
    if (p.status === 'flagged') {
      atGate.push(p);
      continue;
    }
    if (p.status !== 'cancelled') continue;
    // A cancelled pass carrying the guard's reason is one the HOD upheld — the
    // rejection was still made at the gate, and this is where it belongs.
    if (p.flag_reason) {
      atGate.push(p);
      continue;
    }
    if (rejectedLadder.has(p.id)) byApprover.push(p);
    // Anything else cancelled is a voided expiry — nobody rejected it.
  }

  return { all: [...atGate, ...byApprover], atGate, byApprover };
}

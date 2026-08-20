// WHAT "PENDING APPROVALS" IS ACTUALLY MADE OF — the one derivation behind the
// sub-figures on the admin Overview and the HOD dashboard.
//
// The client, 2026-08-20: "within the pending approval KPI card in the admin,
// you make two sub-sub things — pending for gate, pending for HOD approvals …
// Do this not only for the admin but for the HOD dashboard also, but the HOD
// dashboard should be only scoped within their department."
//
// A pass that has not been through the gate is waiting on ONE of two entirely
// different desks, and until now a single figure hid which:
//
//   PENDING GATE REVIEW — the ladder is finished (or the pass never had one:
//                         every pass raised before an office was designated,
//                         and every level closed by 058's rollout). Nothing is
//                         owed but the guard's decision.
//   PENDING APPROVAL    — still climbing the approval ladder. The guard cannot
//                         even SEE it (046 made that RLS), so counting it as
//                         "at the gate" told an admin the gate queue was longer
//                         than anything the gate could act on.
//
// THE TWO SUM TO THE CARD ABOVE THEM, BY CONSTRUCTION. Both are filters of the
// SAME array the card counted and the card's own drill opens — one predicate
// and its negation, never two independent predicates that could both miss a
// pass or both claim it. That is this app's board invariant applied one level
// down.
//
// `awaits_approval` COMES OFF `gatepass.v_gate_passes` (migration 057, which
// defines it as `gatepass.pass_awaits_approval(p.id)`) and is NEVER recomputed
// here — the same rule `is_overdue` and `is_expired` live by. It is OPTIONAL on
// `GatePassView` so that fixtures written before 057 still type-check, and
// FALSY IS THE SAFE READING: no ladder rows means nothing is owed, which is
// exactly what a pre-workflow pass is.
//
// SCOPE IS THE CALLER'S, and neither of these functions knows about it. The
// admin board reads every pass; the HOD board reads its own (RLS narrows to the
// department, and `.eq('raised_by', …)` narrows again, server-side). Filtering
// here would mean two places that decide who sees what.
import type { GatePassView } from '../types';
import { isWaitingAtGate } from './gateQueue';

export interface PendingSplit {
  /** Everything the card counts — `isWaitingAtGate`, unchanged. */
  waiting: GatePassView[];
  /** Cleared the ladder; the guard's decision is the only thing left. */
  atGate: GatePassView[];
  /** Still climbing the ladder; invisible to the guard by design. */
  awaitingApproval: GatePassView[];
}

export function pendingSplit(rows: GatePassView[]): PendingSplit {
  const waiting = rows.filter(isWaitingAtGate);
  const awaitingApproval = waiting.filter((p) => p.awaits_approval === true);
  const atGate = waiting.filter((p) => p.awaits_approval !== true);
  return { waiting, atGate, awaitingApproval };
}

/** The two lines a card prints under its figure, in the order the client named
 *  them. Singular/plural is done here rather than in two components, because
 *  the admin and the HOD must read identically. */
export function pendingSplitNotes(split: PendingSplit): { text: string; key: 'gate' | 'approval' }[] {
  // Spelled out rather than suffixed: "pass" pluralises to "passes", and a
  // naive `+ 's'` prints "2 passs" — which is exactly what the first run of
  // this function did.
  const n = (count: number) => `${count} ${count === 1 ? 'pass' : 'passes'}`;
  return [
    { key: 'gate', text: `${n(split.atGate.length)} pending gate review` },
    { key: 'approval', text: `${n(split.awaitingApproval.length)} pending approval` },
  ];
}

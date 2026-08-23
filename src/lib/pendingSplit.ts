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
import type { BoardDrill } from './boardDrills';
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

/** One line under a KPI figure — a desk, how many passes sit on it, AND the
 *  page that press opens.
 *
 *  IT CARRIES ITS OWN ROWS. A desk line used to be a reading inside the card's
 *  anchor, so pressing it opened the CARD's list — every pass of that type
 *  raised in the window, matched and returned ones included. The figure was
 *  right and the list was somebody else's; this app's board invariant says a
 *  number opens the array it counted, and a sub-figure is a number. */
export interface PendingNote {
  key: string;
  label: string;
  value: number;
  /** `${base}/${key}` — the drill page for this desk alone. */
  to: string;
  /** The waiting passes behind the figure, and the words above them. */
  drill: BoardDrill;
}

/** Which board is asking, and about which pass type. The type decides the key,
 *  which is what the URL is built from, so the RGP card's two desks and the
 *  NRGP card's two cannot collide on one route. */
export interface PendingScope {
  type: 'RGP' | 'NRGP';
  /** `/admin-dashboard` or `/dashboard` — the board the desk belongs to. */
  base: string;
}

/** The desks are RUNNING and the figure above them is windowed, on both boards.
 *  A reader who filtered to Today and pressed a desk is owed that sentence on
 *  the page, or the list looks like the filter failed. */
const RUNNING = 'Everything still waiting, whatever day it was raised — not limited to the window above.';

/**
 * THE TWO DESKS, AS THE SUB-LINES OF A PASS-TYPE CARD (client, 2026-08-23:
 * "instead of making it as a separate pending card, make the similar type of
 * pending gate approval and pending approval under each NRGP and RGP … remove
 * all those two pending cards completely. Do this across all the views").
 *
 * Both boards call this with the rows of ONE pass type, so the NRGP card's two
 * lines are the NRGP passes waiting and the RGP card's are the RGP ones — the
 * split is per type now, not one figure for the site. `pendingSplit` is
 * unchanged underneath, so the two lines still sum to the waiting set of that
 * type by construction rather than by a second predicate.
 *
 * THE NOTES ARE RUNNING, THE FIGURE ABOVE THEM IS WINDOWED, and that is
 * deliberate on both boards: an obligation does not stop being open because the
 * window rolled past the day it started in. They are a reading of what is
 * waiting, not a breakdown of the figure — and the page each one opens repeats
 * that in words, because the two scopes standing side by side is precisely
 * what made the old behaviour read as a bug.
 */
export function pendingNotes(rows: GatePassView[], scope: PendingScope): PendingNote[] {
  const split = pendingSplit(rows);
  const low = scope.type === 'RGP' ? 'rgp' : 'nrgp';
  const note = (
    suffix: string, label: string, own: GatePassView[], heading: string, empty: string,
  ): PendingNote => {
    const key = `${low}${suffix}`;
    return {
      key,
      label,
      value: own.length,
      to: `${scope.base}/${key}`,
      drill: { key, heading, empty, rows: own, scopeNote: RUNNING },
    };
  };
  return [
    note(
      'PendingGate', 'Pending gate approval', split.atGate,
      `${scope.type} pending gate approval`,
      `No ${scope.type} is waiting at the gate.`,
    ),
    note(
      'PendingApproval', 'Pending approval', split.awaitingApproval,
      `${scope.type} pending approval`,
      `No ${scope.type} is waiting on the approval ladder.`,
    ),
  ];
}

// NEITHER DESK IS A CARD ANY MORE. They were sub-lines of one Pending
// Approvals card (2026-08-20), then a card each (2026-08-22), then one card
// with the split under it (2026-08-23 morning); since 2026-08-23 they are two
// lines under EACH pass-type card and no card of their own exists on any board
// — `pendingNotes` above is the whole of what draws them.

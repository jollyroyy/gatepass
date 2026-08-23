// The guard's board, reduced to the two questions someone standing at a barrier
// actually asks (client mock-up, 2026-08-19):
//
//   Pending OUT (Needs Approval)        — what is waiting to leave
//   Pending RGP Return (Needs Verification) — what is due back TODAY and still
//                                             outside; once the date passes it
//                                             leaves for Overdue Returns
//
// It replaced a board of seven drill KPIs over a stack of pass cards. The
// figures that went are not lost — they are the admin's board and Reports,
// which is where a whole-site count belongs; what a guard needs is the two
// lists they will physically act on this shift, each with its own number on
// top of it.
//
// THE OLD BOARD'S ONE INVARIANT SURVIVES INTACT: a number on a card is
// `rows.length` of the very array the panel under it renders. Nothing here
// counts with one predicate and lists with another, and there is no
// `count: 'exact'` query anywhere behind it.
//
// LATENESS IS STILL NOT DECIDED HERE. `due_state` is computed in
// `gatepass.v_gate_passes` against `site_tz()` (Asia/Kolkata) and read, never
// recomputed — comparing `expected_return_date` to the browser clock would make
// the guard's screen disagree with the database for every pass after 18:30 IST.
import type { GatePassItemView, GatePassView, PassType } from '../types';
import { parseCompanyInfo } from './companyInfo';
import { buildScheduledReturns, type ScheduledReturnRow } from './scheduledReturns';

/** Waiting on the gate and nobody else. `hod_reviewed` rides along with
 *  `pending` and that is load-bearing: an HOD override-approved pass is waiting
 *  on exactly one action — this one — and for two months every guard surface
 *  refused to show one (`tests/unit/hodReviewGateFlow.test.tsx` pins it here).
 *  Expiry is NOT tested here: the query filters `expires_at >= now` server-side,
 *  which covers both states uniformly and never needs recomputing. */
export const isPendingOut = (p: GatePassView): boolean =>
  p.status === 'pending' || p.status === 'hod_reviewed';

/** Still owes material. `partially_returned` counts — one line back out of
 *  three is not closure. */
const isOpenReturn = (p: GatePassView): boolean =>
  p.return_status === 'awaiting_return' || p.return_status === 'partially_returned';

/**
 * Due back TODAY, and nothing else — not the backlog, not the future.
 *
 * PAST ITS DATE MEANS OVERDUE, AND OVERDUE IS ONE QUEUE (client, 2026-08-23:
 * "it should not show it in the pending return, it should show only in the
 * overdue section"). A late pass used to be graded `overdue` here as well, so
 * one slip stood in this figure AND in the Overdue Returns tile at the same
 * time — two numbers for one obligation, which read as two.
 *
 * Material due in October is absent for the older reason: no guard is watching
 * the barrier for it, and `/returns` would not accept its return today either,
 * so a row for it would be a button that cannot be pressed. The whole backlog
 * of any date is one Quick Action away on `/overdue`.
 */
export const needsReturnVerification = (p: GatePassView): boolean =>
  isOpenReturn(p) && p.due_state === 'due_today';

/** Longest wait first — the truck that arrived at 10:20 is served before 10:30. */
export function pendingOutOf(rows: GatePassView[]): GatePassView[] {
  return rows.filter(isPendingOut).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Oldest expected date first. A dateless row sorts last rather than throwing
 *  the order — it cannot reach this list today (an undated pass is never graded
 *  `due_today` or `overdue`), but the comparator stays total. */
export function pendingReturnsOf(rows: GatePassView[]): GatePassView[] {
  return rows.filter(needsReturnVerification).sort((a, b) => {
    const x = a.expected_return_date;
    const y = b.expected_return_date;
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  });
}

/**
 * THE RETURN QUEUE COUNTS ITEMS, NOT PASSES (client, 2026-08-24: "returns for
 * today I do see four items but in the pending awaiting verification of return
 * card there are only two … all of those four items should be in the Pending
 * RGP Return card also").
 *
 * The two figures never disagreed about WHICH passes were due back — both cut
 * on `due_state = 'due_today'`. They disagreed about the UNIT: the Returns Due
 * Today tile counted material LINES and this card counted PASSES, so four lines
 * across two RGPs read as "4" beside "2" and looked like two different queues.
 * They were one queue, and it is now counted once, in the unit a guard is
 * actually handed things in. The Returns Due Today tile is gone with it — one
 * obligation, one figure, one list.
 *
 * A PARTIALLY-RETURNED PASS BRINGS ITS LINES WITH IT. `pendingReturnsOf` admits
 * `partially_returned`, so a pass with two of three lines back still contributes
 * every one of its lines here — which is what the reader is comparing against
 * the load at the barrier, and what `/returns` has always listed.
 *
 * `buildScheduledReturns` is the same function the list under this figure
 * renders, over the same two arrays, so the board's oldest invariant holds
 * exactly: the number IS `rows.length` of what pressing it opens.
 */
export function returnLinesOf(
  openReturns: GatePassView[],
  items: GatePassItemView[]
): ScheduledReturnRow[] {
  return buildScheduledReturns(pendingReturnsOf(openReturns), items);
}

export interface TypeSplit {
  RGP: number;
  NRGP: number;
}

/** The pending-OUT list, split by type. A `Record<PassType, number>` by
 *  construction, so the two figures always sum to the list under them. */
export function typeSplit(rows: GatePassView[]): TypeSplit {
  const out: TypeSplit = { RGP: 0, NRGP: 0 };
  for (const p of rows) out[p.type] += 1;
  return out;
}

/** The tenant, brand or contractor firm the material belongs to, falling back
 *  to the person carrying it. Never the raw `visitor_company` blob — that is
 *  `{"n":…,"a":…,"v":…}` and printing it raw shipped once. */
export function partyOf(p: GatePassView): string {
  const name = parseCompanyInfo(p.visitor_company).name.trim();
  return name || p.visitor_name;
}

/** Both figures come off the view's roll-ups; never re-sum item rows here, or
 *  this cell and the overdue KPI can disagree. */
export function returnedQtyLabel(p: GatePassView): string {
  return `${p.returned_quantity} / ${p.total_quantity}`;
}

/** The mock-up colours a pass number and its type chip by TYPE, not by state:
 *  RGP blue, NRGP green, everywhere on this board. A `Record<PassType, …>` so
 *  a third type would be a compile error rather than an uncoloured pill. */
export const TYPE_PILL: Record<PassType, string> = {
  RGP: 'gb-pill-blue',
  NRGP: 'gb-pill-green',
};

/** How many rows a panel shows before the reader asks for the rest. */
export const PREVIEW_ROWS = 5;

export function previewOf<T>(rows: T[], expanded: boolean): T[] {
  return expanded ? rows : rows.slice(0, PREVIEW_ROWS);
}

/** "Hello, Ravi" — the signed-in guard's own first name, and "Guard" when the
 *  profile has not resolved yet, so the greeting never renders half-written. */
export function firstNameOf(fullName: string | null | undefined, fallback = 'Guard'): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0];
}

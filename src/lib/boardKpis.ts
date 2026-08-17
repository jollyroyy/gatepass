// THE CATALOGUE of the board's headline figures: RGP Overview (6), NRGP Overview
// (3) and Quick Summary (5) — the client's reference board, box for box, on this
// system's own data. What each card is CALLED, what it means, and which passes it
// matches; the plumbing that applies it to an array lives in boardWindows.ts.
//
// THE TILE ROWS ARE DAY-SCOPED WHERE THEY SAY "TODAY" AND NOWHERE ELSE. There is
// no period selector: `period` and `returned` both mean today and the label says
// so, while `current` means a running obligation and is deliberately NOT
// day-scoped — a pass that went overdue last week is overdue on today's board.
//
// NO CARD CARRIES A DELTA. The "↑ 8 vs yesterday" line is gone from every tile
// (client, same day). It is not merely hidden: `BoardWindows` no longer carries
// a previous window at all, so nothing on this board can compute one.
//
// EVERY CARD DECLARES A SCOPE, and that is the whole reason this file exists as
// data rather than as three hand-written rows of JSX. The reference board mixes
// two completely different kinds of number under one visual style, and getting
// them the wrong way round produces a card that is confidently wrong:
//
//   'period'   — passes RAISED today.
//   'returned' — RETURNS RECEIVED today, dated by `actual_return_date`. Scoping
//                this on `created_at` would drop today's return of a pass raised
//                last month, which is most of them.
//   'current'  — a running state: what is outside, due, overdue, stopped or
//                waiting RIGHT NOW. Deliberately NOT day-scoped — an obligation
//                raised last week is still open today, and a Today-scoped
//                "Overdue" card would print 0 while material sat off site.
//
// The matchers that could quietly widen are pinned by
// tests/unit/boardKpiSections.test.ts, which asserts the scope each card's own
// words promise.
//
// ONE SUBSTITUTION FROM THE REFERENCE, and it is a data fact rather than a
// choice: the reference's third NRGP card is "NRGP Currently Outside".
// `gate_passes_return_status_rgp_only` (001) pins every NRGP to
// `not_applicable`, so an NRGP is never "outside" in this database — it left for
// good. That card would be a permanent zero under a heading that cannot move, so
// it is "NRGP Awaiting Clearance", which is a real queue on the same material.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import { categoryKey } from './passTypes';
import { IS_OPEN_RETURN } from './boardDrills';

export type BoardKpiKey =
  // RGP Overview
  | 'rgpRequests'
  | 'rgpOut'
  | 'rgpReturned'
  | 'rgpOutside'
  | 'rgpDueToday'
  | 'rgpOverdue'
  // NRGP Overview
  | 'nrgpOut'
  | 'nrgpCleared'
  | 'nrgpPending'
  // Quick Summary
  | 'totalRaised'
  | 'totalCleared'
  | 'pendingApprovals'
  | 'overdueReturns'
  | 'materialOutside';

export type KpiScope = 'period' | 'returned' | 'current';

export interface BoardKpi {
  key: BoardKpiKey;
  /** Without any period word — `kpiLabel` adds that, and only where it is true. */
  label: string;
  tone: Tone;
  /** The line under the number. Its job is to say what the figure IS or what to
   *  DO about it, which a bare count never does. */
  note: string;
  scope: KpiScope;
  /** Heading above the list the card's click opens. */
  heading: string;
  empty: string;
  match: (p: GatePassView) => boolean;
}

const isRgp = (p: GatePassView): boolean => p.type === 'RGP';

/** WAITING AT THE GATE MEANS IT CAN STILL BE CLEARED THERE.
 *
 *  An expired pass is `pending` in the enum — expiry is derived from
 *  `expires_at`, never a status — but `match_pass` refuses it, so it is null and
 *  void: nothing the guard does can release that material. Counting it under
 *  "Requests" / "Pending Approvals" told an admin a queue was longer than it was
 *  and told the HOD their paperwork was still alive. It is excluded here and
 *  surfaced instead as a decision for the HOD who raised it (the bell, and
 *  `/expired/:id`). `is_expired` comes straight off the view — never recompute
 *  expiry in TypeScript. */
const isWaiting = (p: GatePassView): boolean => p.status === 'pending' && !p.is_expired;
const isRgpOut = (p: GatePassView): boolean => categoryKey(p.type, p.direction) === 'RGP-out';
const isNrgpOut = (p: GatePassView): boolean => categoryKey(p.type, p.direction) === 'NRGP-out';

/** No card takes the `brand` tone. Gold is this system's primary FILL — the
 *  sidebar's active link, the primary button, the wordmark — and as ink on a
 *  card it measures about 2:1, the same defect the notification panel had.
 *  Pinned by tests/unit/boardKpiSections.test.ts. */
export const BOARD_KPIS: Record<BoardKpiKey, BoardKpi> = {
  rgpRequests: {
    key: 'rgpRequests',
    label: 'RGP Requests',
    tone: 'pending',
    note: 'Awaiting gate clearance',
    scope: 'current',
    heading: 'RGP passes waiting at the gate',
    empty: 'No RGP pass is waiting at the gate.',
    match: (p) => isRgp(p) && isWaiting(p),
  },
  rgpOut: {
    key: 'rgpOut',
    label: 'RGP Out',
    tone: 'accent',
    note: 'Passes issued',
    scope: 'period',
    heading: 'RGP Out passes issued',
    empty: 'No RGP Out pass was issued in this period.',
    match: isRgpOut,
  },
  rgpReturned: {
    key: 'rgpReturned',
    label: 'RGP Returned',
    tone: 'matched',
    note: 'Returns received',
    scope: 'returned',
    heading: 'Returns received',
    empty: 'No return was recorded in this period.',
    match: (p) => p.return_status === 'returned',
  },
  rgpOutside: {
    key: 'rgpOutside',
    label: 'RGP Currently Outside',
    tone: 'accent',
    note: 'Material still out',
    scope: 'current',
    heading: 'Out and not yet returned',
    empty: 'Nothing is still out.',
    match: (p) => IS_OPEN_RETURN[p.return_status],
  },
  rgpDueToday: {
    key: 'rgpDueToday',
    label: 'RGP Due Today',
    tone: 'pending',
    note: 'Expected back today',
    scope: 'current',
    // `due_state` is the view's own graded form of `is_overdue`, computed in
    // `site_tz()`. Never re-derive "is it today" here.
    heading: 'Expected back today',
    empty: 'Nothing is due back today.',
    match: (p) => p.due_state === 'due_today',
  },
  rgpOverdue: {
    key: 'rgpOverdue',
    label: 'RGP Overdue',
    tone: 'overdue',
    note: 'Requires action',
    scope: 'current',
    heading: 'Past their return date',
    empty: 'Nothing is overdue.',
    match: (p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue,
  },

  nrgpOut: {
    key: 'nrgpOut',
    label: 'NRGP Out',
    tone: 'accent',
    note: 'Passes issued',
    scope: 'period',
    heading: 'NRGP Out passes issued',
    empty: 'No NRGP pass was issued in this period.',
    match: isNrgpOut,
  },
  nrgpCleared: {
    key: 'nrgpCleared',
    label: 'NRGP Cleared',
    tone: 'matched',
    note: 'Cleared at gate',
    scope: 'period',
    heading: 'NRGP passes cleared at the gate',
    empty: 'No NRGP pass was cleared in this period.',
    match: (p) => isNrgpOut(p) && p.status === 'matched',
  },
  nrgpPending: {
    key: 'nrgpPending',
    label: 'NRGP Awaiting Clearance',
    tone: 'pending',
    note: 'Waiting at the gate',
    scope: 'current',
    heading: 'NRGP passes waiting at the gate',
    empty: 'No NRGP pass is waiting at the gate.',
    match: (p) => isNrgpOut(p) && isWaiting(p),
  },

  // Quick Summary deliberately RESTATES figures from the two sections above —
  // so does the reference board (its Pending Approvals equals its RGP Requests).
  // It is the one row that answers "how did the whole site do", across both
  // categories, and a reader who scrolled past the sections should not have to
  // add two cards together to get it.
  totalRaised: {
    key: 'totalRaised',
    label: 'Total Gate Passes',
    tone: 'neutral',
    note: 'Every category',
    scope: 'period',
    heading: 'All passes raised',
    empty: 'No pass was raised in this period.',
    match: () => true,
  },
  totalCleared: {
    key: 'totalCleared',
    label: 'Total Cleared',
    tone: 'matched',
    note: 'Verified by security',
    scope: 'period',
    heading: 'Cleared through the gate',
    empty: 'Nothing was cleared in this period.',
    match: (p) => p.status === 'matched',
  },
  pendingApprovals: {
    key: 'pendingApprovals',
    label: 'Pending Approvals',
    tone: 'pending',
    note: 'Waiting at the gate',
    scope: 'current',
    heading: 'Waiting on the guard',
    empty: 'Queue clear — nothing is waiting.',
    match: isWaiting,
  },
  overdueReturns: {
    key: 'overdueReturns',
    label: 'Overdue Returns',
    tone: 'overdue',
    note: 'Requires action',
    scope: 'current',
    heading: 'Past their return date',
    empty: 'Nothing is overdue.',
    match: (p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue,
  },
  materialOutside: {
    key: 'materialOutside',
    label: 'Material Currently Outside',
    tone: 'accent',
    note: 'Not yet returned',
    scope: 'current',
    heading: 'Material out and not yet returned',
    empty: 'Nothing is still out.',
    match: (p) => IS_OPEN_RETURN[p.return_status],
  },
};

// SIX AND THREE, matching the client's reference board box for box (2026-08-17,
// second pass: "the exact layout of those individual boxes should remain the
// same"). The two "Mismatched at Gate" tiles added earlier that day are GONE
// from the tile rows — a mismatch is not lost with them: it reaches the raising
// HOD on the notification bell, opens a decision screen, and both boards carry
// an attention banner above the sections that counts stopped and expired passes.
export const RGP_SECTION: BoardKpiKey[] = [
  'rgpRequests', 'rgpOut', 'rgpReturned', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
];

export const NRGP_SECTION: BoardKpiKey[] = ['nrgpOut', 'nrgpCleared', 'nrgpPending'];

export const SUMMARY_SECTION: BoardKpiKey[] = [
  'totalRaised', 'totalCleared', 'pendingApprovals', 'overdueReturns', 'materialOutside',
];

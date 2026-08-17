// The board's headline figures: RGP Overview (6), NRGP Overview (3) and Quick
// Summary (5) — the client's reference board, on this system's own data.
//
// EVERY CARD DECLARES A SCOPE, and that is the whole reason this file exists as
// data rather than as three hand-written rows of JSX. The reference board mixes
// two completely different kinds of number under one visual style, and getting
// them the wrong way round produces a card that is confidently wrong:
//
//   'period'   — a count of passes RAISED inside the selected window. Comparable
//                against the previous window, so it carries a delta.
//   'returned' — a count of RETURNS RECEIVED inside the window, dated by
//                `actual_return_date`. Scoping this on `created_at` would drop
//                today's return of a pass raised last month, which is most of
//                them.
//   'current'  — a running state: what is outside, due, overdue or waiting RIGHT
//                NOW. Deliberately NOT period-scoped — an obligation raised last
//                week is still open today, and a Today-scoped "Overdue" card
//                would print 0 while material sat off site. It carries no delta
//                either: "vs yesterday" on a running total compares two
//                snapshots this board never took.
//
// The three matchers that could quietly widen are pinned by
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
import type { DashboardPeriod } from './dashboardPeriod';
import { IS_OPEN_RETURN, type BoardDrill } from './boardDrills';

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
    match: (p) => isRgp(p) && p.status === 'pending',
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
    match: (p) => isNrgpOut(p) && p.status === 'pending',
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
    match: (p) => p.status === 'pending',
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

export const RGP_SECTION: BoardKpiKey[] = [
  'rgpRequests', 'rgpOut', 'rgpReturned', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
];

export const NRGP_SECTION: BoardKpiKey[] = ['nrgpOut', 'nrgpCleared', 'nrgpPending'];

export const SUMMARY_SECTION: BoardKpiKey[] = [
  'totalRaised', 'totalCleared', 'pendingApprovals', 'overdueReturns', 'materialOutside',
];

/** The period word a period-scoped label ends with. A `Record`, so a period
 *  added to `DASHBOARD_PERIODS` without a word here is a type error rather than
 *  a card labelled `undefined`. */
const PERIOD_WORD: Record<DashboardPeriod, string> = {
  today: 'Today',
  weekly: 'This Week',
  biweekly: 'Last 14 Days',
  monthly: 'This Month',
  yearly: 'This Year',
};

/** The words on the card. A current-state card names its own scope already —
 *  "RGP Currently Outside Today" would claim a window it does not have. */
export function kpiLabel(kpi: BoardKpi, period: DashboardPeriod): string {
  if (kpi.scope === 'current') return kpi.label;
  return `${kpi.label} ${PERIOD_WORD[period]}`;
}

/** The five arrays a board hands its cards. Built ONCE per render, in one place,
 *  from one fetch — every figure on the page is `rows.length` of one of these
 *  filtered by one predicate, which is what keeps a card and the list its click
 *  opens the same array. */
export interface BoardWindows {
  /** Raised inside the selected period. */
  raised: GatePassView[];
  /** Raised inside the equal-length window immediately before it. */
  raisedPrev: GatePassView[];
  /** Returned inside the selected period (`actual_return_date`). */
  returned: GatePassView[];
  returnedPrev: GatePassView[];
  /** Everything the reader may see, unscoped by time. */
  all: GatePassView[];
}

export function rowsFor(kpi: BoardKpi, w: BoardWindows): GatePassView[] {
  const source = kpi.scope === 'period' ? w.raised : kpi.scope === 'returned' ? w.returned : w.all;
  return source.filter(kpi.match);
}

/** The comparison rows, or null when the card has nothing to compare against. */
export function previousRowsFor(kpi: BoardKpi, w: BoardWindows): GatePassView[] | null {
  if (kpi.scope === 'current') return null;
  const source = kpi.scope === 'period' ? w.raisedPrev : w.returnedPrev;
  return source.filter(kpi.match);
}

/** What a card's click resolves to. It CARRIES the rows rather than a predicate:
 *  a predicate has to be re-applied against some array, and "some array" is
 *  where a count and its list drift apart. */
export function kpiDrill(key: BoardKpiKey, rows: GatePassView[]): BoardDrill {
  const def = BOARD_KPIS[key];
  return { key: `kpi-${key}`, heading: def.heading, empty: def.empty, rows };
}

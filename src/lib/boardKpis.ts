// THE CATALOGUE of the board's headline figures: Today's Summary (5), RGP
// Overview (7) and NRGP Overview (3). What each card is CALLED, what it means,
// and which passes it matches; the plumbing that applies it to an array lives in
// boardWindows.ts.
//
// TODAY'S SUMMARY IS THE ROLL-UP, AND IT LEADS THE BOARD (client, 2026-08-18).
// It restates the two rows below it on purpose — that is what a summary is — and
// answers across BOTH categories, so a reader after the site-wide waiting queue
// does not have to add RGP Awaiting Clearance to NRGP Awaiting Clearance.
//
// ITS FIVE CARDS CARRY NO `note`, and that is the client's instruction in the
// same breath ("minimal yet aesthetic", "don't put too much cluttered text").
// The whole row is five short words and five numbers; the rows below it explain
// themselves. `note` is therefore OPTIONAL on a card, not an empty string — a
// tile with nothing to say renders no line at all rather than an empty one.
//
// NO CARD SAYS "TODAY" ANY MORE (client, 2026-08-18). The word is on the board
// ONCE, in the header chip beside the date, because it was on fourteen tiles and
// read as noise. The scopes themselves are unchanged and still mixed on purpose:
// `period` and `returned` mean today, while `current` means a running obligation
// and is deliberately NOT day-scoped — a pass that went overdue last week is
// overdue on today's board.
//
// THE TWO CATEGORY ROWS NOW MIRROR EACH OTHER: Raised / Awaiting Clearance /
// Cleared, in that order, for RGP and for NRGP alike. A reader comparing the two
// halves of the traffic reads the same three words in the same three places. RGP
// then carries its return leg — Returned, Currently Outside, Due Today, Overdue —
// which NRGP has nothing to put in.
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
  | 'rgpRaised'
  | 'rgpAwaiting'
  | 'rgpCleared'
  | 'rgpReturned'
  | 'rgpOutside'
  | 'rgpDueToday'
  | 'rgpOverdue'
  // NRGP Overview
  | 'nrgpRaised'
  | 'nrgpAwaiting'
  | 'nrgpCleared';

export type KpiScope = 'period' | 'returned' | 'current';

export interface BoardKpi {
  key: BoardKpiKey;
  /** Exactly the words on the tile. Nothing appends to it — see boardWindows.ts. */
  label: string;
  tone: Tone;
  /** The line under the number. Its job is to say what the figure IS or what to
   *  DO about it, which a bare count never does. OMITTED on the summary row,
   *  where five labels and five numbers are the whole point. */
  note?: string;
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
export const isWaitingAtGate = (p: GatePassView): boolean => p.status === 'pending' && !p.is_expired;
const isWaiting = isWaitingAtGate;
const isRgpOut = (p: GatePassView): boolean => categoryKey(p.type, p.direction) === 'RGP-out';
const isNrgpOut = (p: GatePassView): boolean => categoryKey(p.type, p.direction) === 'NRGP-out';

/** No card takes the `brand` tone. Gold is this system's primary FILL — the
 *  sidebar's active link, the primary button, the wordmark — and as ink on a
 *  card it measures about 2:1, the same defect the notification panel had.
 *  Pinned by tests/unit/boardKpiSections.test.ts. */
export const BOARD_KPIS: Record<BoardKpiKey, BoardKpi> = {
  rgpRaised: {
    key: 'rgpRaised',
    label: 'RGP Raised',
    tone: 'accent',
    note: 'Passes issued',
    scope: 'period',
    heading: 'RGP passes raised',
    empty: 'No RGP pass was raised in this period.',
    match: isRgpOut,
  },
  rgpAwaiting: {
    key: 'rgpAwaiting',
    label: 'RGP Awaiting Clearance',
    tone: 'pending',
    note: 'Waiting at the gate',
    scope: 'current',
    heading: 'RGP passes waiting at the gate',
    empty: 'No RGP pass is waiting at the gate.',
    match: (p) => isRgp(p) && isWaiting(p),
  },
  rgpCleared: {
    key: 'rgpCleared',
    label: 'RGP Cleared',
    tone: 'matched',
    note: 'Cleared at gate',
    scope: 'period',
    heading: 'RGP passes cleared at the gate',
    empty: 'No RGP pass was cleared in this period.',
    match: (p) => isRgpOut(p) && p.status === 'matched',
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

  nrgpRaised: {
    key: 'nrgpRaised',
    label: 'NRGP Raised',
    tone: 'accent',
    note: 'Passes issued',
    scope: 'period',
    heading: 'NRGP passes raised',
    empty: 'No NRGP pass was raised in this period.',
    match: isNrgpOut,
  },
  nrgpAwaiting: {
    key: 'nrgpAwaiting',
    label: 'NRGP Awaiting Clearance',
    tone: 'pending',
    note: 'Waiting at the gate',
    scope: 'current',
    heading: 'NRGP passes waiting at the gate',
    empty: 'No NRGP pass is waiting at the gate.',
    match: (p) => isNrgpOut(p) && isWaiting(p),
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
};

// SEVEN AND THREE, and the first three of each row are the same three facts in
// the same order — Raised, Awaiting Clearance, Cleared. RGP's remaining four are
// its return leg, which NRGP does not have. The two "Mismatched at Gate" tiles
// once here are still GONE, and a mismatch is not lost with them: it reaches the
// raising HOD on the notification bell, opens a decision screen, and both boards
// carry an attention banner above the sections counting stopped and expired
// passes.
export const RGP_SECTION: BoardKpiKey[] = [
  'rgpRaised', 'rgpAwaiting', 'rgpCleared', 'rgpReturned', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
];

export const NRGP_SECTION: BoardKpiKey[] = ['nrgpRaised', 'nrgpAwaiting', 'nrgpCleared'];

// THERE IS NO TODAY'S SUMMARY ROW ANY MORE (client, 2026-08-18, on both
// boards): five roll-up figures above two rows that break the same passes down
// by category restated them, and the client asked for it off the HOD board and
// then off the admin board. DELETED, not flagged off — the five keys it needed
// (`totalRaised`, `totalCleared`, `pendingApprovals`, `overdueReturns`,
// `materialOutside`) are gone from `BoardKpiKey`, so a stale reference is a
// type error rather than a blank tile. `/overdue` is still one click away: it
// is the admin's second sidebar tab and the target of `rgpOverdue`.

/**
 * THE TWO FIGURES THAT OPEN A PAGE INSTEAD OF A DRILL (client, 2026-08-18).
 *
 * Overdue and Due Today are the two lists every role acts on, so each has its
 * own route — `/overdue` and `/returns` — scoped to the reader inside the page
 * (guard: today's; HOD: own passes; admin: everything). A drill panel could
 * only ever show this board's own rows, and only the gate can record a return
 * from them.
 *
 * Every OTHER tile still drills in place, with the rows it counted.
 */
export const BOARD_KPI_LINKS: Partial<Record<BoardKpiKey, string>> = {
  rgpOverdue: '/overdue',
  rgpDueToday: '/returns',
};

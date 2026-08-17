// The admin dashboard's five headline KPIs, and the shape every drillable thing
// on that board reduces to.
//
// The board was rebuilt 2026-08-17 to the client's reference layout, and the
// invariant survived the rebuild intact and was WIDENED: it now covers the
// charts, not just the KPI cards. Every clickable figure on the page — a card, a
// donut slice, a bar, a day on the trend line — resolves to an `BoardDrill`
// carrying the very rows it counted. There is no second query and no second
// predicate anywhere on the board, so a chart cannot disagree with the list its
// own click opens.
//
// What the previous four cards became, so nothing was silently dropped:
//   Total         → `raised`, unchanged in meaning.
//   Awaiting Return → `outside` ("Materials Outside"), same predicate.
//   Overdue       → `overdue`, same predicate.
//   Return Rate   → the Returnable Status donut, which shows the same ratio as
//                   three real buckets (Returned / Awaiting / Overdue) instead
//                   of one percentage, and drills into each of them.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import type { BoardCategory } from './boardCategory';
import { categoryKey } from './passTypes';

export type BoardKpiKey =
  | 'raised'
  | 'rgpOut'
  | 'rgpIn'
  | 'nrgpOut'
  | 'cleared'
  | 'pending'
  | 'outside'
  | 'overdue';

/** The shape `DrillList` renders a revealed list from. It moved here when the
 *  HOD dashboard was rebuilt to the board layout (2026-08-17) and
 *  `src/lib/hodDrills.ts` — its previous home — was deleted along with the ten
 *  flat KPI cards it defined.
 *
 *  `src/lib/guardDrills.ts` deliberately keeps its own structurally identical
 *  copy: its `DrillKey` union is closed and its `DRILL_DEFS` is a
 *  `Record<DrillKey, …>`, which is what makes "added a drill, forgot its
 *  definition" a type error on that board. Neither board dashboard writes one
 *  by hand — they carry their rows on a `BoardDrill` and adapt through
 *  `drillDefOf` below. */
export interface DrillDef<K extends string = string> {
  key: K;
  label: string;
  tone: Tone;
  /** Heading above the revealed list. */
  heading: string;
  /** Shown instead of a list when the drill is empty. */
  empty: string;
  match: (p: GatePassView) => boolean;
}

/** A pass with one line still out is still an open obligation. Exact lookup,
 *  never `.includes()` on the enum. */
export const IS_OPEN_RETURN: Record<GatePassView['return_status'], boolean> = {
  not_applicable: false,
  awaiting_return: true,
  partially_returned: true,
  returned: false,
};

export interface BoardKpi {
  key: BoardKpiKey;
  label: string;
  tone: Tone;
  /** The line under the number, e.g. "Action required". Its job is to say what
   *  the reader should DO, which a bare count never does. */
  note: string;
  heading: string;
  empty: string;
  match: (p: GatePassView) => boolean;
}

export const BOARD_KPIS: Record<BoardKpiKey, BoardKpi> = {
  raised: {
    key: 'raised',
    label: 'Passes Raised',
    tone: 'neutral',
    note: 'Every category',
    heading: 'All passes raised',
    empty: 'No passes raised in this period.',
    match: () => true,
  },
  // The three category counters. They exist only on the UNNARROWED board
  // (see BOARD_KPI_ORDER below): once the reader picks RGP Out, the "RGP Out"
  // card and the "Passes Raised" card would carry the same number, and two
  // cards that can never disagree are one card and a decoration.
  rgpOut: {
    key: 'rgpOut',
    label: 'RGP Out Raised',
    tone: 'accent',
    note: 'Returnable, leaving site',
    heading: 'RGP Out passes raised',
    empty: 'No RGP Out passes in this period.',
    match: (p) => categoryKey(p.type, p.direction) === 'RGP-out',
  },
  rgpIn: {
    key: 'rgpIn',
    label: 'RGP In Raised',
    tone: 'accent',
    note: 'Returnable, coming in',
    heading: 'RGP In passes raised',
    empty: 'No RGP In passes in this period.',
    match: (p) => categoryKey(p.type, p.direction) === 'RGP-in',
  },
  nrgpOut: {
    key: 'nrgpOut',
    label: 'NRGP Out Raised',
    tone: 'accent',
    note: 'Leaving for good',
    heading: 'NRGP Out passes raised',
    empty: 'No NRGP Out passes in this period.',
    match: (p) => categoryKey(p.type, p.direction) === 'NRGP-out',
  },
  cleared: {
    key: 'cleared',
    label: 'Cleared at Gate',
    tone: 'matched',
    note: 'Verified by security',
    heading: 'Cleared through the gate',
    empty: 'Nothing has been cleared in this period.',
    match: (p) => p.status === 'matched',
  },
  pending: {
    key: 'pending',
    label: 'Pending Approvals',
    tone: 'pending',
    note: 'Waiting at the gate',
    heading: 'Waiting on the guard',
    empty: 'Queue clear — nothing is waiting.',
    match: (p) => p.status === 'pending',
  },
  // Was "Materials Outside" until 2026-08-17. Renamed on the client's call —
  // the words did not say what the number counted, and the gold `brand` tone
  // it carried is this system's primary FILL, which as ink on a card reads as
  // barely-there (the same ~2:1 defect the notification panel had). It is a
  // count of RETURNABLE PASSES still open, so it now says so.
  outside: {
    key: 'outside',
    label: 'Pending Return',
    tone: 'accent',
    note: 'Out and not yet returned',
    heading: 'Still out — not yet returned',
    empty: 'Nothing is still out from this period.',
    match: (p) => IS_OPEN_RETURN[p.return_status],
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue Returns',
    tone: 'overdue',
    note: 'Action required',
    heading: 'Past their return date',
    empty: 'Nothing is overdue.',
    match: (p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue,
  },
};

/** THE HEADLINE ROW IS CHOSEN BY THE CATEGORY TOGGLE, not fixed (client,
 *  2026-08-17: "make sure you dynamically change those KPI buttons depending on
 *  what we have selected… remove all the unnecessary KPIs which are not
 *  relevant to that particular selected item").
 *
 *  Two rules decide every row below:
 *
 *  1. **A card that cannot move is not a card.** An NRGP is pinned to
 *     `return_status = 'not_applicable'` by `gate_passes_return_status_rgp_only`
 *     (001) and never enters a return cycle, so Pending Return and Overdue
 *     Returns are permanent zeros on an NRGP board. Showing "0 Overdue" for a
 *     category that CANNOT go overdue is not reassurance — it is a reading the
 *     client correctly called wrong.
 *  2. **A card that duplicates the toggle is not a card.** The three category
 *     counters answer "what is the mix", which only has an answer while the
 *     board is showing the mix. Narrowed to RGP Out, "RGP Out Raised" would
 *     equal "Passes Raised" on every render.
 *
 *  Reading order within a row is unchanged: volume, then gate outcome, then the
 *  return loop. */
const RETURNING: BoardKpiKey[] = ['raised', 'pending', 'cleared', 'outside', 'overdue'];

const KPI_ORDER_BY_CATEGORY: Record<BoardCategory, BoardKpiKey[]> = {
  all: ['raised', 'rgpOut', 'rgpIn', 'nrgpOut', 'pending', 'overdue'],
  'RGP-out': RETURNING,
  'RGP-in': RETURNING,
  'NRGP-out': ['raised', 'pending', 'cleared'],
};

/** A `Record<BoardCategory, …>` lookup, never a conditional chain: a category
 *  added to `PASS_CATEGORY_LIST` without a KPI row becomes a type error rather
 *  than a board that silently keeps showing the previous selection's cards. */
export function boardKpiOrder(category: BoardCategory): BoardKpiKey[] {
  return KPI_ORDER_BY_CATEGORY[category];
}

/** True when the selected category can hold an open return obligation at all.
 *  The Overdue Returns panel and the Returnable Status donut are hidden on a
 *  board where it is false, for the same reason the two KPI cards are. */
export function categoryHasReturns(category: BoardCategory): boolean {
  return category !== 'NRGP-out';
}

/** What every drillable figure on the board resolves to: a stable key for the
 *  toggle, the words above the list, and THE ROWS THEMSELVES. Carrying the rows
 *  rather than a predicate is the whole point — a predicate would have to be
 *  re-applied against some array, and "some array" is where a count and its list
 *  drift apart. */
export interface BoardDrill {
  key: string;
  heading: string;
  empty: string;
  rows: GatePassView[];
}

/** `DrillList` takes the HOD/guard `DrillDef` shape and reads only `heading` and
 *  `empty` off it. This adapts an `BoardDrill` to that shape rather than
 *  widening `DrillList`, which four other screens depend on. */
export function drillDefOf(drill: BoardDrill): DrillDef<string> {
  return {
    key: drill.key,
    label: drill.heading,
    tone: 'neutral',
    heading: drill.heading,
    empty: drill.empty,
    match: () => true,
  };
}

export function kpiDrill(key: BoardKpiKey, rows: GatePassView[]): BoardDrill {
  const def = BOARD_KPIS[key];
  return { key: `kpi-${key}`, heading: def.heading, empty: def.empty, rows };
}

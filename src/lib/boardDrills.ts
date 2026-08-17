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

export type BoardKpiKey = 'raised' | 'cleared' | 'pending' | 'outside' | 'overdue';

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
    tone: 'accent',
    note: 'All categories',
    heading: 'All passes raised',
    empty: 'No passes raised in this period.',
    match: () => true,
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
  outside: {
    key: 'outside',
    label: 'Materials Outside',
    tone: 'brand',
    note: 'Returnable material still out',
    heading: 'Still out',
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

/** Volume, then gate outcome, then the return loop. Same reading order as the
 *  client's reference board. */
export const BOARD_KPI_ORDER: BoardKpiKey[] = ['raised', 'cleared', 'pending', 'outside', 'overdue'];

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

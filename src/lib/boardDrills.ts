// The shape every drillable thing on a board reduces to.
//
// THE INVARIANT THIS FILE SERVES: every clickable figure on a board dashboard —
// a KPI card, a donut slice, a bar, a day on the trend line, a tab of the return
// watch — resolves to a `BoardDrill` that CARRIES the very rows it counted. There
// is no second query and no second predicate anywhere on the board, so a chart
// cannot disagree with the list its own click opens.
//
// The KPI definitions themselves live in `src/lib/boardKpis.ts` — this module is
// only the plumbing, so a test that wants the numbers does not have to know about
// the sections they are arranged in.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';

/** The shape `DrillList` renders a revealed list from.
 *
 *  `src/lib/guardDrills.ts` deliberately keeps its own structurally identical
 *  copy: its `DrillKey` union is closed and its `DRILL_DEFS` is a
 *  `Record<DrillKey, …>`, which is what makes "added a drill, forgot its
 *  definition" a type error on that board. The board dashboards never write one
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
 *  `empty` off it. This adapts a `BoardDrill` to that shape rather than widening
 *  `DrillList`, which four other screens depend on. */
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

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
 *  The admin and HOD board dashboards never write a `DrillDef` by hand — a
 *  hand-written definition (label, tone, predicate) can drift from the KPI it
 *  is supposed to describe. Instead they carry their rows on a `BoardDrill`
 *  (the KPI's own key, label and rows, computed once alongside the number)
 *  and adapt it into a `DrillDef` through `drillDefOf` below, so the list a
 *  click reveals can never disagree with the figure that was clicked. */
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
  /** THE SCOPE IN WORDS, when it is not the board's own. A card's drill inherits
   *  the window the board is filtered to and needs no sentence — the drill page
   *  already prints the date span. A desk line does: it is RUNNING while the
   *  figure above it is windowed, and a reader who filtered to Today and got
   *  yesterday's unsigned pass back would otherwise read that as a broken
   *  filter. Set, it replaces the span under the page title. */
  scopeNote?: string;
}

/** A thing on a board that can be pressed: a card, or one of the desk lines
 *  under it. Both carry a `BoardDrill`, and a drill page is handed a `:key`
 *  that could be either. */
export interface Drillable {
  key: string;
  drill?: BoardDrill;
  notes?: readonly { key: string; drill: BoardDrill }[];
}

/** The drill a URL's `:key` names — searched over the cards AND their desk
 *  lines, in one place, so both drill pages resolve a key the same way and a
 *  new sub-figure becomes reachable by carrying a drill rather than by editing
 *  a route table. `undefined` for a key no figure on the board owns, which the
 *  pages turn into a redirect home. */
export function drillFor(cards: readonly Drillable[], key: string | undefined): BoardDrill | undefined {
  if (!key) return undefined;
  for (const c of cards) {
    if (c.key === key) return c.drill;
    const note = c.notes?.find((n) => n.key === key);
    if (note) return note.drill;
  }
  return undefined;
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

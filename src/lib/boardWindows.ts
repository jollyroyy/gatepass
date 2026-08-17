// How a board turns one fetch into the figure on each tile.
//
// Split out of boardKpis.ts, which is the CATALOGUE — what each card is called,
// what it means and which passes it matches. This file is the plumbing that
// applies that catalogue to an array, and keeping the two apart is what lets a
// test read the numbers without importing every label in the app.
//
// EVERY FIGURE ON A BOARD IS `rows.length` OF ONE OF THESE ARRAYS, filtered by
// one predicate. That is the whole invariant: there is no `count: 'exact'` query
// on a board dashboard and no predicate re-applied against a second array, so a
// tile cannot disagree with the list its own click opens.
import type { GatePassView } from '../types';
import { BOARD_KPIS, type BoardKpi, type BoardKpiKey } from './boardKpis';
import type { BoardDrill } from './boardDrills';

/** The words on the card. A day-scoped card says "Today" out loud even though
 *  the page heading does: the two scopes sit side by side in one grid, and
 *  without the word there is nothing on a tile to say whether "RGP Out 3" means
 *  three today or three ever. A `current` card names its own scope already —
 *  "RGP Currently Outside Today" would claim a window it does not have. */
export function kpiLabel(kpi: BoardKpi): string {
  if (kpi.scope === 'current') return kpi.label;
  return `${kpi.label} Today`;
}

/** The three arrays a board hands its cards. Built ONCE per render, in one place,
 *  from one fetch — every figure on the page is `rows.length` of one of these
 *  filtered by one predicate, which is what keeps a card and the list its click
 *  opens the same array.
 *
 *  There is deliberately NO previous window here. The delta line is gone from
 *  every tile, and keeping the arrays that fed it would leave the board one prop
 *  away from growing it back. */
export interface BoardWindows {
  /** Raised today. */
  raised: GatePassView[];
  /** Returned today (`actual_return_date`). */
  returned: GatePassView[];
  /** Everything the reader may see, unscoped by time. */
  all: GatePassView[];
}

export function rowsFor(kpi: BoardKpi, w: BoardWindows): GatePassView[] {
  const source = kpi.scope === 'period' ? w.raised : kpi.scope === 'returned' ? w.returned : w.all;
  return source.filter(kpi.match);
}

/** What a card's click resolves to. It CARRIES the rows rather than a predicate:
 *  a predicate has to be re-applied against some array, and "some array" is
 *  where a count and its list drift apart. */
export function kpiDrill(key: BoardKpiKey, rows: GatePassView[]): BoardDrill {
  const def = BOARD_KPIS[key];
  return { key: `kpi-${key}`, heading: def.heading, empty: def.empty, rows };
}

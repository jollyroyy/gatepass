// MY PASSES — the data half of the client's list mock-up (2026-08-20).
//
// Pure functions, no React: the page loads `v_gate_passes` ONCE and the three
// tab counts, the rows and the pager are three readings of that one array. Same
// board rule the rest of this app lives by — a figure and the list it sits over
// cannot drift when neither is a second query.
//
// THE TAB IS THE PASS TYPE, AND THE COUNTS ARE OVER THE DATE-SCOPED ROWS, not
// over the tab's own selection: a tab reading "(0)" is exactly what tells a
// reader not to click it. Everything else the page can narrow by (period, day,
// status, awaiting-return, free text) is applied BEFORE the counts, so
// "All (24)" is always the sum of "RGP (14)" and "NRGP (10)".
import type { GatePassView, PassType } from '../types';

export type MyPassTab = 'all' | PassType;

export const MY_PASS_TABS: MyPassTab[] = ['all', 'RGP', 'NRGP'];

export const MY_PASS_TAB_LABELS: Record<MyPassTab, string> = {
  all: 'All',
  RGP: 'RGP',
  NRGP: 'NRGP',
};

/** The mock colours a pass by type in two places at once — the tinted plate on
 *  the left of the card and the chip beside the number. RGP is blue and NRGP is
 *  PURPLE here, which is the mock's own pairing; every value is a `.gb-*` class
 *  so no hex reaches a `.tsx` (see `themeAudit.test.ts`). */
export const MY_PASS_TYPE_PILL: Record<PassType, string> = {
  RGP: 'gb-pill-blue',
  NRGP: 'gb-pill-purple',
};

export const MY_PASS_TYPE_PLATE: Record<PassType, string> = {
  RGP: 'gb-tint-blue',
  NRGP: 'gb-tint-purple',
};

/** An RGP goes out and comes back — a plain arrow. An NRGP leaves for good —
 *  an arrow walking out of a box. A `Record<PassType, …>` so a third type would
 *  be a type error rather than a blank square. */
export const MY_PASS_TYPE_GLYPH: Record<PassType, 'arrow' | 'exit'> = {
  RGP: 'arrow',
  NRGP: 'exit',
};

/** How many of each type are in `rows`. `all` is `rows.length`, never a third
 *  predicate, so the three figures add up by construction. */
export function myPassTabCounts(rows: GatePassView[]): Record<MyPassTab, number> {
  let rgp = 0;
  for (const p of rows) if (p.type === 'RGP') rgp += 1;
  return { all: rows.length, RGP: rgp, NRGP: rows.length - rgp };
}

export function applyMyPassTab(rows: GatePassView[], tab: MyPassTab): GatePassView[] {
  return tab === 'all' ? rows : rows.filter((p) => p.type === tab);
}

/**
 * The search bar. The mock labels it "Search by GP No. or Purpose", and those
 * two are what a reader is told they can type — but the person's name and the
 * vehicle stay in the match, because this page has always found a pass by them
 * and a search that finds MORE than its label promises costs nobody anything.
 * Removing that would.
 */
export function matchesMyPassSearch(p: GatePassView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    p.pass_number.toLowerCase().includes(q) ||
    (p.purpose ?? '').toLowerCase().includes(q) ||
    (p.visitor_name ?? '').toLowerCase().includes(q) ||
    (p.vehicle_number ?? '').toLowerCase().includes(q)
  );
}

/** "6 Items" / "1 Item" — the mock's own cell, singular where it should be. */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'Item' : 'Items'}`;
}

// The board dashboards' category toggle — All / RGP Out / RGP In / NRGP Out.
//
// Client's call, 2026-08-17: "I want a toggle so that we can toggle between
// them and it will be much more clear… keep the same filter on the top right
// corner — today, last one week, last one month — I just put the toggle and
// keep all the KPI buttons and all the pie charts accordingly."
//
// So this is a SECOND, INDEPENDENT AXIS beside the period filter, not a
// replacement for it. Period answers "when", category answers "what". They
// compose: RGP Out ∧ Last 7 days.
//
// IT IS APPLIED ONCE, TO THE RAW `rows` ARRAY, BEFORE ANYTHING ELSE ON THE
// PAGE SEES IT — before the period scope, before every KPI, chart and panel.
// That is what makes the board's own invariant survive it: every figure is
// still `rows.length` of the very array its click opens, because there is only
// ever one array. Filtering per-panel would give each panel its own chance to
// forget, and the two panels that are deliberately NOT period-scoped (the
// all-time Overdue list and the trend line) would be the two that forgot.
//
// The options come straight off `PASS_CATEGORY_LIST`, so this toggle and the
// gate console's filter can never offer different categories. There is no
// "NRGP In" for the same reason there is no such pass: permanently inbound
// material is a goods receipt, not a gate pass (`gate_passes_nrgp_is_outward`).
import type { GatePassView } from '../types';
import { categoryKey, PASS_CATEGORIES, PASS_CATEGORY_LIST, type PassCategoryKey } from './passTypes';

/** `'all'` is a real, default state — not the absence of one. A board that
 *  opened already narrowed to one category would understate the org's traffic
 *  to anyone who did not notice the toggle. */
export type BoardCategory = 'all' | PassCategoryKey;

export const BOARD_CATEGORY_OPTIONS: readonly { key: BoardCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PASS_CATEGORY_LIST.map((key) => ({ key: key as BoardCategory, label: PASS_CATEGORIES[key].label })),
];

/** Narrows a pass array to one category, or hands it straight back for `'all'`.
 *  `categoryKey` is a direct lookup off (type, direction) — never a string
 *  built by concatenation, so an inbound NRGP (which no constraint permits)
 *  still lands in a real bucket rather than in none. */
export function filterByCategory(rows: GatePassView[], category: BoardCategory): GatePassView[] {
  if (category === 'all') return rows;
  return rows.filter((p) => categoryKey(p.type, p.direction) === category);
}

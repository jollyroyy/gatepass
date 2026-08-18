// The RGP return loop as a display stage — the second half of a returnable
// gate pass's life, which `status` alone cannot express.
//
// An RGP makes TWO trips: out through the gate, then back in. `match_pass`
// (003) sets `status = 'matched'` the moment the gate clears it OUTWARD, and
// in the same statement sets `return_status = 'awaiting_return'`. Nothing
// about `status` changes when the material eventually comes back —
// `apply_item_returns` / `mark_returned` (013) move `return_status` forward
// to 'partially_returned' and then 'returned' instead. So a pass still
// standing outside the mall and a pass that closed weeks ago are BOTH
// `matched`, and every screen that rendered only the status badge showed
// them identically.
//
// This module is the fix, and it is presentation only — no new query, no new
// column, no migration. The distinction was always in the data.
//
// It derives the stage from `return_status` ALONE. Not from `status`, for two
// reasons: `return_status` is the axis the database actually advances, and it
// is already constrained to 'not_applicable' for anything that is not a
// matched RGP (`gate_passes_return_status_rgp_only`, 001), so the NRGP and
// not-yet-at-the-gate cases fall out for free rather than needing a second
// condition that could drift out of step with the first.
import type { GatePassView, ReturnStatus } from '../types';
import type { StatusStyle } from './statusStyles';

export type RgpStage = 'out_open' | 'partly_returned' | 'closed';

/** Direct lookup, never an `includes()` chain — the repo rule for enums.
 *  `Record<ReturnStatus, …>` is deliberately exhaustive so adding a label to
 *  `gatepass.return_status` breaks the build here until someone has decided
 *  what it means for the badge, rather than rendering as a blank pill. */
const STAGE_BY_RETURN_STATUS: Record<ReturnStatus, RgpStage | null> = {
  // Covers every NRGP (which never comes back) and every RGP that has not
  // been cleared outward yet. In both cases the return obligation has not
  // started, and a badge would read as missing data rather than "n/a".
  not_applicable: null,
  awaiting_return: 'out_open',
  partially_returned: 'partly_returned',
  returned: 'closed',
};

/** Which half of the return loop a pass is in, or null if it has no loop. */
export function rgpStage(p: Pick<GatePassView, 'return_status'>): RgpStage | null {
  return STAGE_BY_RETURN_STATUS[p.return_status];
}

export const RGP_STAGE_STYLES: Record<RgpStage, StatusStyle> = {
  // Gold, matching the "Awaiting Return" KPI card and the Return Schedule
  // report — the same obligation, so the same hue. Deliberately not green:
  // green is `matched`, and the whole complaint was that this stage reads as
  // finished when it is not.
  out_open: {
    bg: 'bg-brand-50', text: 'text-brand-700', dot: 'bg-brand-500', label: 'Out — Not Returned',
  },
  // Indigo, matching RETURN_STYLES.partially_returned: a genuinely different
  // situation to reconcile, not "still out, but a bit less".
  partly_returned: {
    bg: 'bg-accent-50', text: 'text-accent-700', dot: 'bg-accent-500', label: 'Partly Returned',
  },
  // Green — this is the ONLY thing in the app that means an RGP is finished.
  closed: {
    bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Closed',
  },
};

/** Overdue RENAMES the open stages as well as re-toning them (client,
 *  2026-08-18: a report must say "overdue", not "Out — Not Returned" in
 *  orange). It used to re-tone only, which meant the fact was carried by colour
 *  alone — invisible on the mono laser the register is printed on, and invisible
 *  to anyone reading the CSV. */
const OVERDUE_STAGE: StatusStyle = {
  bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Overdue',
};

/** The pill to render beside the status badge, or null if there is none.
 *
 *  `is_overdue` comes straight off `gatepass.v_gate_passes` and is NEVER
 *  recomputed here — the view owns that comparison, in the site's timezone. */
export function rgpStageStyle(
  p: Pick<GatePassView, 'return_status' | 'is_overdue'>,
): StatusStyle | null {
  const stage = rgpStage(p);
  if (!stage) return null;
  const base = RGP_STAGE_STYLES[stage];
  // A closed pass cannot be overdue any more — whatever `is_overdue` says,
  // the material is back and the obligation is discharged.
  if (stage === 'closed' || !p.is_overdue) return base;
  return OVERDUE_STAGE;
}

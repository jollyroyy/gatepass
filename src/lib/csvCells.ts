// What a CSV cell says.
//
// A spreadsheet is read by someone who was not looking at the screen when the
// export happened, so it has to stand on its own — and every one of these
// columns was previously exporting the value the DATABASE stores rather than
// the one the table beside the Export button renders. `hod_reviewed`,
// `not_applicable`, `nos`, `2026-08-17T09:47:23.481+00:00`: each is correct
// and each is unreadable, which is what the client meant by "gibberish" and
// "ASCII format" (2026-08-17).
//
// Every formatter here goes through the SAME label map the badge does —
// `statusStyles.ts`, `passTypes.ts`, `units.ts`, `formatDate.ts`. None of them
// carries a second copy of a label, so a status renamed for the screen is
// renamed in the export in the same edit.
//
// Two rules the formatters share:
//   * "nothing here" exports as an EMPTY cell, never as the em-dash the screen
//     uses. A dash is a typographic device for a person reading a page; in a
//     spreadsheet column it is a value, and it breaks sorting and any SUM.
//   * a formatter never re-derives a fact. `is_expired` and `is_overdue` come
//     off `v_gate_passes`; this module only chooses words for them.
import type { GatePassView, PassDirection, PassType, ReturnStatus } from '../types';
import { EXPIRED_STYLE, RETURN_STYLES, STATUS_STYLES, isExpiredPending } from './statusStyles';
import { categoryFor } from './passTypes';
import { formatDateOnly, formatDateTime } from './formatDate';
import { unitLabel } from './units';

/** A free-text cell: null, undefined and the empty string all export blank. */
export function csvText(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Date + time, in the site's own format — never the raw ISO string. */
export function csvDateTime(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : '';
}

/** Date only, for the return-schedule columns. */
export function csvDate(iso: string | null | undefined): string {
  return iso ? formatDateOnly(iso) : '';
}

/** The badge's own words, including the derived "Expired" — which is not an
 *  enum label at all (expiry is `status = 'pending'` plus `is_expired`), so an
 *  export of the raw column would silently call an expired pass "Pending". */
export function csvStatus(p: Pick<GatePassView, 'status' | 'is_expired'>): string {
  return isExpiredPending(p) ? EXPIRED_STYLE.label : STATUS_STYLES[p.status].label;
}

/** Blank for a pass with no return loop — an NRGP, or an RGP the gate has not
 *  cleared yet. Exact lookup on the enum, never a string test. */
export function csvReturnStatus(p: { return_status: ReturnStatus }): string {
  return p.return_status === 'not_applicable' ? '' : RETURN_STYLES[p.return_status].label;
}

/** "RGP Out" / "RGP In" / "NRGP Out" — the category, not the bare type. The
 *  direction is half of what a pass IS, and a column headed Type that reads
 *  "RGP" for both legs cannot be filtered on in the spreadsheet. */
export function csvCategory(p: { type: PassType; direction: PassDirection }): string {
  return categoryFor(p.type, p.direction).label;
}

/** "Numbers", not "nos". Blank rather than the dash `unitLabel` shows on screen. */
export function csvUnit(unit: string | null | undefined): string {
  return unit ? unitLabel(unit) : '';
}

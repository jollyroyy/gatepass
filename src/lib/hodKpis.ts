// The local-day boundary the guard dashboard scopes its shift counters to.
//
// This file used to also map the `kpis()` RPC row into `PassKpis`. That went
// with the HOD dashboard's rebuild to the board layout (2026-08-17): every
// figure on both board dashboards is now `rows.length` of the array its own
// click opens, and `kpis()` — which takes no date parameter and aggregates ALL
// TIME — could only ever disagree with them. It was the source of the 2026-08-11
// frozen-Return-Rate bug for exactly that reason.
//
// CONSEQUENCE WORTH KNOWING: `gatepass.kpis()` now has NO CALLER anywhere in
// `src/`. It is left in the database rather than dropped blind, the same way
// `bulk_create_passes` was — but per "never leave unused schema in place" it
// wants a migration that drops it, and until then it stays EXECUTE-able over
// PostgREST by every authenticated user.
import { periodBounds } from './dashboardPeriod';

/** Start of "today" and "tomorrow" in the browser's local timezone, computed
 *  once as real Date boundaries — never by comparing formatted date strings,
 *  which breaks across month/year rollovers and locale formats. Delegates to
 *  `periodBounds('today')` in dashboardPeriod.ts so there is exactly one
 *  implementation of "start of today", not two that could drift apart. */
export function todayBounds(): { start: number; end: number } {
  return periodBounds('today');
}

// Maps the `kpis()` RPC row into `PassKpis`, and the local-day boundary used
// to scope the HOD dashboard to today, unconditionally. Split out of
// Dashboard.tsx to stay under the 300-line cap.
import type { PassKpis } from '../types';
import { EMPTY_KPIS } from '../types';
import { periodBounds } from './dashboardPeriod';

export interface KpiRow {
  total: number;
  pending: number;
  matched: number;
  flagged: number;
  awaiting_return: number;
  overdue: number;
  raised_today: number;
  overdue_value: number;
  flagged_rate: number;
  return_rate: number;
}

export function mapKpiRow(row: KpiRow | undefined): PassKpis {
  if (!row) return EMPTY_KPIS;
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    matched: row.matched ?? 0,
    flagged: row.flagged ?? 0,
    awaitingReturn: row.awaiting_return ?? 0,
    overdue: row.overdue ?? 0,
    raisedToday: row.raised_today ?? 0,
    overdueValue: row.overdue_value ?? 0,
    flaggedRate: row.flagged_rate ?? 0,
    returnRate: row.return_rate ?? 0,
  };
}

/** Start of "today" and "tomorrow" in the browser's local timezone, computed
 *  once as real Date boundaries — never by comparing formatted date strings,
 *  which breaks across month/year rollovers and locale formats. Delegates to
 *  `periodBounds('today')` in dashboardPeriod.ts so there is exactly one
 *  implementation of "start of today", not two that could drift apart. */
export function todayBounds(): { start: number; end: number } {
  return periodBounds('today');
}

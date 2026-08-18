// The Scheduled Returns table — one row per MATERIAL LINE, not per pass.
//
// The Awaiting Return drill used to open a stack of pass cards. A guard at the
// barrier is handed items, not passes: three lines of one pass can come back
// on three different trips, so the row a guard acts on is the line (client,
// 2026-08-18, with a layout to match).
//
// Derivation only — no new query beyond the lines of the passes the drill
// already counted, and no new column. The stage of a line is
// `itemReturnStage`, the same function the Search Pass record uses, so a line
// cannot read "Returned" here and "Pending" there.
import type { GatePassItemView, GatePassView } from '../types';
import { itemReturnStage, type ItemReturnStage } from './passRecordView';

export interface ScheduledReturnRow {
  item: GatePassItemView;
  pass: GatePassView;
  stage: ItemReturnStage;
  /** The line's own date when it carries one, else the pass's. A pass-level
   *  date is what most rows have — per-line dates are optional on raise. */
  expectedReturn: string | null;
}

/**
 * Lines of the given passes, oldest expected date first, so what is most
 * overdue is what a guard reads first. A line whose pass is not in `passes`
 * is dropped — the drill decides which passes are in scope, never this.
 */
export function buildScheduledReturns(
  passes: GatePassView[],
  items: GatePassItemView[]
): ScheduledReturnRow[] {
  const byPass = new Map(passes.map((p) => [p.id, p]));
  const rows: ScheduledReturnRow[] = [];
  for (const item of items) {
    const pass = byPass.get(item.gate_pass_id);
    if (!pass) continue;
    rows.push({
      item,
      pass,
      stage: itemReturnStage(item, pass.type),
      expectedReturn: item.expected_return_date ?? pass.expected_return_date ?? null,
    });
  }
  return rows.sort((a, b) => {
    // A row with no date sorts last: it is a legacy row, not an urgent one.
    const av = a.expectedReturn ?? '9999-12-31';
    const bv = b.expectedReturn ?? '9999-12-31';
    if (av !== bv) return av < bv ? -1 : 1;
    return a.pass.pass_number === b.pass.pass_number
      ? a.item.line_no - b.item.line_no
      : a.pass.pass_number < b.pass.pass_number ? -1 : 1;
  });
}

export interface ReturnsPage<T> {
  rows: T[];
  /** 1-based, for "Showing 1–5 of 18". Both are 0 on an empty set. */
  from: number;
  to: number;
  total: number;
  pages: number;
  page: number;
}

/** One page of rows, clamped — a page number past the end returns the last
 *  page rather than an empty table the reader cannot get out of. */
export function pageOf<T>(rows: T[], page: number, size: number): ReturnsPage<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + slice.length,
    total: rows.length,
    pages,
    page: current,
  };
}

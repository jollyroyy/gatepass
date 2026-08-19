// Overdue PASSES — the guard's reading of the same backlog Overdue Items holds.
//
// ONE ROW IS ONE PASS, not one material line. That is the whole difference
// between this module and `overdueItems.ts`, and it exists because the guard's
// screen counts what a guard chases at the barrier: a truck arrives against a
// pass, and "5 overdue" has to mean five slips to clear, not five lines spread
// across two of them.
//
// THE COUNT IS DERIVED, NEVER RE-DERIVED. `buildOverduePasses` groups the rows
// `buildOverdueRows` already produced — it does NOT re-ask "is this pass late?"
// against `due_state` or against the browser clock. That is deliberate and it
// is the reliability the client asked for: one definition of late, in
// `overdueItems.ts`, read by the item page, the pass page and the KPI alike, so
// the tile cannot say 5 while the stack under it lists 4. A pass reaches this
// list if and only if at least one of its lines is on the item page.
//
// LATENESS IS DAYS, because `expected_return_date` is a `date` column with no
// time and no zone. "21 Hrs overdue" would be an invented figure; see the note
// at the head of overdueItems.ts.
import type { GatePassView } from '../types';
import {
  buildOverdueRows,
  CRITICAL_DAYS,
  type OverdueRow,
  type OverdueSeverity,
} from './overdueItems';
import type { GatePassItemView } from '../types';

export interface OverduePassRow {
  pass: GatePassView;
  /** How many of this pass's lines are still outside past their date. */
  pendingItems: number;
  /** Outstanding quantity across those lines — what is physically still out. */
  pendingQty: number;
  /** Days past the EARLIEST missed date on the pass: the age of the oldest
   *  thing on it, which is what "2 days overdue" means to a guard holding it. */
  daysLate: number;
  /** That earliest missed date, as the ISO day the data holds. */
  expectedReturn: string;
  severity: OverdueSeverity;
}

/**
 * Every pass with at least one overdue line, worst delay first.
 *
 * Grouping, and nothing else — `rows` decides membership. Ties break on pass
 * number so the order is stable between renders and between readers.
 */
export function buildOverduePasses(
  passes: GatePassView[],
  items: GatePassItemView[],
  now: number = Date.now(),
): OverduePassRow[] {
  return groupOverdueRows(buildOverdueRows(passes, items, now));
}

/** The grouping on its own, for callers that already hold the line rows. */
export function groupOverdueRows(rows: OverdueRow[]): OverduePassRow[] {
  const byPass = new Map<string, OverduePassRow>();

  for (const row of rows) {
    const seen = byPass.get(row.pass.id);
    if (!seen) {
      byPass.set(row.pass.id, {
        pass: row.pass,
        pendingItems: 1,
        pendingQty: row.item.outstanding_qty,
        daysLate: row.daysLate,
        expectedReturn: row.expectedReturn,
        severity: row.severity,
      });
      continue;
    }
    seen.pendingItems += 1;
    seen.pendingQty += row.item.outstanding_qty;
    // The oldest line on the pass sets the pass's age, and the date that goes
    // with it. Severity follows that same figure — one threshold, as everywhere.
    if (row.daysLate > seen.daysLate) {
      seen.daysLate = row.daysLate;
      seen.expectedReturn = row.expectedReturn;
      seen.severity = row.daysLate >= CRITICAL_DAYS ? 'critical' : seen.severity;
    }
  }

  return [...byPass.values()].sort((a, b) => {
    if (a.daysLate !== b.daysLate) return b.daysLate - a.daysLate;
    return a.pass.pass_number < b.pass.pass_number ? -1 : 1;
  });
}

/** "3 Days" / "1 Day" — the stack's Overdue By cell, title-cased as drawn. */
export function formatOverdueBy(days: number): string {
  return `${days} ${days === 1 ? 'Day' : 'Days'}`;
}

/** "3 items pending" / "1 item pending". */
export function pendingItemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'} pending`;
}

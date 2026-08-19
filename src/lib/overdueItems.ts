// Overdue Items — the line-level derivations `overduePasses.ts` groups into
// the pass-level cards every role's `/overdue` renders.
//
// ONE ROW IS ONE MATERIAL LINE, never a pass. A pass with three lines can have
// one back and two still outside; the thing somebody has to chase is the line.
// Same rule as the Scheduled Returns table, and the same stage function
// (`itemReturnStage`), so a line cannot read "Pending" on one screen and
// "Returned" on the other.
//
// LATENESS IS A COUNT OF CALENDAR DAYS, not hours. `expected_return_date` is a
// `date` column — no time, no zone — so "1d 7h late" would be an invented
// figure. `parseLocalDay` reads it as a local calendar day (see localDay.ts:
// `new Date('2026-08-17')` is UTC midnight and slips a day west of UTC).
//
// SCOPE IS THE CALLER'S, NOT THIS MODULE'S. Which passes arrive here is decided
// by the page — RLS plus `raised_by` for an HOD, everything for an admin.
// Nothing below widens a set, and there is no day cut: a guard sees the whole
// backlog, the same as everyone else (client, 2026-08-19 — a page that showed
// only what went late in the last 24 hours read "0 overdue" while a pass sat
// late in the return queue, which is the bug this scope was creating).
import type { GatePassItemView, GatePassView } from '../types';
import { itemReturnStage } from './passRecordView';
import { dayStart, daysBetween, parseLocalDay } from './localDay';

/** Days late at which a line stops being a chase and becomes an escalation.
 *  One threshold, so a line's severity here and the card stack's severity
 *  pill can never disagree about what "critical" means. */
export const CRITICAL_DAYS = 3;

export type OverdueSeverity = 'overdue' | 'critical';

export interface OverdueRow {
  item: GatePassItemView;
  pass: GatePassView;
  /** The earlier of the line's own expected date and the pass's deadline. */
  expectedReturn: string;
  /** Whole calendar days past the expected date. Always >= 1 — a line due
   *  today is not late yet. */
  daysLate: number;
  severity: OverdueSeverity;
}

/** A line still owes material: RGP, and not everything has come back. NRGP has
 *  no return leg at all, so it can never be overdue. */
function isOutstanding(item: GatePassItemView, pass: GatePassView): boolean {
  const stage = itemReturnStage(item, pass.type);
  return stage === 'pending' || stage === 'partial';
}

/**
 * The date this line was due back — the EARLIER of the line's own date and the
 * deadline printed on the pass it is on.
 *
 * The pass-level date is not decoration: it is what the slip says, what the
 * database grades `due_state` against, and what the return queue shows. A line
 * cannot outlive the pass carrying it, so a pass the database already calls
 * overdue must yield at least one overdue line here — otherwise the return
 * queue says "Overdue" while Overdue Items counts zero, which is exactly what
 * it did (client, 2026-08-19: RGP-20260818-0003 was due back on the 18th, one
 * of its two lines came back, and the line still outside carried its own later
 * date, so no screen agreed with any other).
 *
 * Taking the earlier of the two is what keeps the two readings in step. The
 * cost is accepted and is real: a pass whose earliest line is late drags its
 * later lines into the backlog with it, because the pass as a whole is late.
 */
function expectedOf(item: GatePassItemView, pass: GatePassView): string | null {
  const own = item.expected_return_date ?? null;
  const deadline = pass.expected_return_date ?? null;
  if (own === null) return deadline;
  if (deadline === null) return own;
  return own < deadline ? own : deadline;
}

/**
 * Every outstanding line whose expected date has passed, worst delay first.
 *
 * A line with NO expected date is not overdue — it is undated, which is a
 * legacy-data fact rather than a late one, and printing it as "∞ days late"
 * would put a number on the screen that nothing supports.
 */
export function buildOverdueRows(
  passes: GatePassView[],
  items: GatePassItemView[],
  now: number = Date.now(),
): OverdueRow[] {
  const today = dayStart(now);
  const byPass = new Map(passes.map((p) => [p.id, p]));
  const rows: OverdueRow[] = [];

  for (const item of items) {
    const pass = byPass.get(item.gate_pass_id);
    if (!pass || !isOutstanding(item, pass)) continue;
    const expected = expectedOf(item, pass);
    const day = parseLocalDay(expected);
    if (day === null || expected === null) continue;
    const daysLate = daysBetween(day, today);
    if (daysLate < 1) continue;
    rows.push({
      item,
      pass,
      expectedReturn: expected,
      daysLate,
      severity: daysLate >= CRITICAL_DAYS ? 'critical' : 'overdue',
    });
  }

  return rows.sort((a, b) => {
    if (a.daysLate !== b.daysLate) return b.daysLate - a.daysLate;
    if (a.pass.pass_number !== b.pass.pass_number) {
      return a.pass.pass_number < b.pass.pass_number ? -1 : 1;
    }
    return a.item.line_no - b.item.line_no;
  });
}


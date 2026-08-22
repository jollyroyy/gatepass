// THE RETURN LEG, LINE BY LINE, ON THE TIMELINE RAIL.
//
// Client, 2026-08-22: "when you see that the RGP pass has returned only a few
// of the things, not all the things … in the timeline on the right-hand side …
// if it is not returned fully, within the bracket you can mention 'returned
// partially' and how many items of how many total items were returned, in a
// very small, very short format. That has to be real-time — as and when the
// guard enters the numbers it should reflect in the timeline also … across all
// the views, not only the guard's."
//
// SO THIS IS A SUMMARY, NOT A SECOND TABLE. The material table already states
// every fact about a line — description, serial, value, the moment it came
// back. What the rail carries is the one thing a reader of the TIMELINE is
// asking: which lines are still out, and how far each one has got. Hence
// "Partially Returned (3/8)" and nothing else: a state and two numbers, short
// enough to sit inside a rail one column wide.
//
// IT COUNTS QUANTITY, NOT LINES. Three of eight headsets back on ONE line is
// exactly the case the client is describing, and a line-count would call it
// zero — the same bug `returnProgress`'s percentage was fixed for on
// 2026-08-21.
//
// REAL-TIME MEANS THE DRAFT IS INCLUDED, AND THAT IS THE WHOLE MECHANISM.
// `effectiveReturned` is what every figure on the item table already reads, so
// the rail and the table move together as the guard types, before anything is
// recorded. A staged line is MARKED as staged — `apply_item_returns` has no
// undo, so "looks recorded" must never be read as "is recorded", which is the
// same rule the table's own tinted row follows.
//
// A REFUSED PASS HAS NO RETURN LEG AT ALL. Its lines never left the building,
// so listing them as "Not Returned (0/8)" would describe an obligation that
// never began — the same withholding `PassRecordItems` makes for the progress
// bar and the Action column.
import type { GatePassItemView, GatePassView } from '../types';
import { passWasRejected } from './passRecordView';
import {
  LINE_STATE_LABELS, effectiveReturned, formatQty, lineState,
  type LineState, type ReturnDraft,
} from './returnDraft';

export interface ReturnTimelineLine {
  /** The item id — a stable React key, and what a caller can match a row on. */
  id: string;
  lineNo: number;
  name: string;
  state: LineState;
  /** "Partially Returned (3/8)" — the state and the two numbers, nothing else. */
  short: string;
  /** This line's figure includes a quantity that has NOT been recorded yet. */
  staged: boolean;
}

/** The pass facts this summary needs. Kept narrow so a caller can hand it a
 *  row from any of the surfaces that render the record. */
export type ReturnTimelinePass = Pick<GatePassView, 'type' | 'status'>;

/** "Partially Returned (3/8)" / "Returned (8/8)" / "Not Returned (0/8)".
 *  The unit is deliberately NOT named: this is a ratio in a one-column rail,
 *  and the table beside it already carries the unit on every figure. */
export function shortReturnNote(state: LineState, back: number, total: number): string {
  return `${LINE_STATE_LABELS[state]} (${formatQty(back)}/${formatQty(total)})`;
}

/**
 * One entry per material line of an RGP, in line order, graded on the
 * quantities the reader is looking at right now — recorded plus staged.
 *
 * Empty for an NRGP (no return leg) and for a refused pass (a return leg that
 * never began), which is what keeps the rail silent on every pass where these
 * lines would be a reading of something that does not exist.
 */
export function buildReturnTimeline(
  items: GatePassItemView[],
  pass: ReturnTimelinePass,
  draft: ReturnDraft = {},
): ReturnTimelineLine[] {
  if (pass.type !== 'RGP') return [];
  if (passWasRejected(pass)) return [];

  return items.map((item) => {
    const total = Number(item.quantity) || 0;
    // Clamped: the database caps a return at the issued quantity, and a rail
    // reading "9/8" would look like a bug in the register rather than in a sum.
    const back = Math.min(Math.max(effectiveReturned(item, draft), 0), total);
    const state = lineState(item, draft);
    return {
      id: item.id,
      lineNo: item.line_no,
      name: item.name,
      state,
      short: shortReturnNote(state, back, total),
      staged: draft[item.id] !== undefined,
    };
  });
}

/** "2 of 3 lines still out" — the one sentence above the list, so a rail with
 *  twenty lines still answers the question at a glance. Null when nothing is
 *  outstanding: a finished return says so on its own rung. */
export function outstandingLineNote(lines: ReturnTimelineLine[]): string | null {
  const open = lines.filter((l) => l.state !== 'returned').length;
  if (open === 0) return null;
  return `${open} of ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} still out`;
}

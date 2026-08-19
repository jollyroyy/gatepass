// A guard's staged return, line by line, before any of it reaches the database
// (client mock-up, 2026-08-19).
//
// WHY A DRAFT EXISTS AT ALL. `apply_item_returns` has NO undo — `returned_qty`
// only ever increases and `returned_at` is written through `coalesce`. So a tap
// on this screen must never be the commit. A guard opens a pass, sets what
// actually came back on each line (with a remark), and every one of those
// entries lands here, in memory; a single Record press then sends the whole set
// as ONE RPC call for that pass. Cancel throws it away and nothing happened.
//
// MICRO-LEVEL RETURNS ARE THE POINT. 800 of 1,000 litres coming back is a
// normal event at a gate, and the RPC has always accepted a partial quantity —
// nothing in the UI ever offered it. `checkReturnQty` is where "how much" is
// decided, and it enforces the same ceiling the database does (`qty >
// outstanding` raises there), so the guard is told before the press rather
// than by an exception after it.
//
// NOTHING HERE READS `returned_at` OR THE PARENT'S `return_status`. A line's
// stage is decided on quantities alone, exactly as `itemReturnStage` does it —
// the two must agree, because this screen and the pass record are read side by
// side.
import type { GatePassItemView, GatePassView } from '../types';
import { dayStart, daysBetween, parseLocalDay } from './localDay';

/** One staged line: how much came back, and the guard's own words for it. */
export interface DraftLine {
  qty: number;
  remarks: string;
}

/** Keyed by item id. One entry per line, so staging the same line twice
 *  replaces rather than accumulates — the guard is correcting a figure they
 *  can still see, not adding to it. */
export type ReturnDraft = Record<string, DraftLine>;

export const EMPTY_DRAFT: ReturnDraft = {};

/** A typed quantity, or null when it is not a number this screen can use.
 *  Rejects the empty string, text, Infinity and NaN — `Number('')` is 0 and
 *  `Number(' ')` is 0, which would silently stage a zero-quantity return. */
export function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export type QtyCheck = { ok: true; qty: number } | { ok: false; error: string };

/**
 * What the Add Return box accepts. The ceiling is the line's OUTSTANDING
 * quantity, not its total: a line that already has 1,000 of 1,250 back can
 * only take 250 more, and sending 1,250 would be refused by the database with
 * an exception the guard cannot act on while a truck waits.
 */
export function checkReturnQty(text: string, outstanding: number): QtyCheck {
  const qty = parseQty(text);
  if (qty === null) return { ok: false, error: 'Enter the quantity that came back.' };
  if (qty <= 0) return { ok: false, error: 'A return must be more than zero.' };
  if (qty > outstanding) {
    return { ok: false, error: `Only ${formatQty(outstanding)} is still outstanding on this line.` };
  }
  return { ok: true, qty };
}

/** Immutable set — React state, so never mutate the object in place. */
export function stageLine(draft: ReturnDraft, itemId: string, line: DraftLine): ReturnDraft {
  return { ...draft, [itemId]: line };
}

/** Immutable delete, for the guard who staged a line and changed their mind. */
export function unstageLine(draft: ReturnDraft, itemId: string): ReturnDraft {
  const next = { ...draft };
  delete next[itemId];
  return next;
}

/** How many lines are staged — what the Record bar counts and what disables it. */
export function stagedCount(draft: ReturnDraft): number {
  return Object.keys(draft).length;
}

/** Quantity already recorded PLUS what is staged. This is the figure every
 *  cell and badge in the open panel reads, so a staged line looks exactly like
 *  the row it will become once recorded. */
export function effectiveReturned(item: GatePassItemView, draft: ReturnDraft): number {
  return item.returned_qty + (draft[item.id]?.qty ?? 0);
}

/** What is still owed after the staged quantity — never negative, because
 *  `checkReturnQty` capped the entry at the outstanding figure. */
export function effectiveOutstanding(item: GatePassItemView, draft: ReturnDraft): number {
  return Math.max(0, item.quantity - effectiveReturned(item, draft));
}

/** The three states a line on this screen can be in, decided on quantities
 *  alone — the same rule `itemReturnStage` follows, restated here because this
 *  screen grades the line INCLUDING what is staged and not yet recorded. */
export type LineState = 'returned' | 'partial' | 'pending';

export function lineState(item: GatePassItemView, draft: ReturnDraft): LineState {
  const back = effectiveReturned(item, draft);
  if (back <= 0) return 'pending';
  if (back >= item.quantity) return 'returned';
  return 'partial';
}

/** The mock-up's own colours, in this app's words — a line reads "Returned",
 *  "Partially Returned (250 Kg Pending)" or "Not Returned". A `Record` keyed by
 *  the union, so a fourth state would be a compile error. */
export const LINE_STATE_LABELS: Record<LineState, string> = {
  returned: 'Returned',
  partial: 'Partially Returned',
  pending: 'Not Returned',
};

export const LINE_STATE_PILL: Record<LineState, string> = {
  returned: 'gb-pill-green',
  partial: 'gb-pill-orange',
  pending: 'gb-pill-grey',
};

/** Trailing zeros are noise on a gate screen: 800, not 800.000. Grouped in
 *  en-IN like every other figure in this app. */
export function formatQty(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

/** "Partially Returned (250 Kg Pending)" — the mock's own status cell, in this
 *  app's word for the state (client, 2026-08-19: no surface says "Partial").
 *  The unit is named here even when the column heading names it, because this
 *  string is a sentence about a quantity, not a cell under that heading. */
export function lineStateLabel(
  item: GatePassItemView,
  draft: ReturnDraft,
  unitText: string
): string {
  const state = lineState(item, draft);
  if (state !== 'partial') return LINE_STATE_LABELS[state];
  const pending = formatQty(effectiveOutstanding(item, draft));
  return `${LINE_STATE_LABELS.partial} (${pending}${unitText ? ` ${unitText}` : ''} Pending)`;
}

/** The lines the RPC is sent, in line order. Staged entries only — a line the
 *  guard did not touch is not "returning nothing", it is simply not part of
 *  this movement, and `apply_item_returns` skips a zero anyway. */
export function draftPayload(
  items: GatePassItemView[],
  draft: ReturnDraft
): { item_id: string; qty: number }[] {
  return items
    .filter((i) => draft[i.id] !== undefined)
    .map((i) => ({ item_id: i.id, qty: draft[i.id].qty }));
}

/**
 * The remark written to `verifications` for the whole movement — one row per
 * RPC call, so each line's own note has to be carried inside it or it is lost.
 * Named per line, because "Returned 3 lines" tells an auditor nothing about
 * which drum was dented.
 */
export function draftRemarks(items: GatePassItemView[], draft: ReturnDraft): string {
  return items
    .filter((i) => draft[i.id] !== undefined)
    .map((i) => {
      const line = draft[i.id];
      const head = `#${i.line_no} ${i.name} ${formatQty(line.qty)} ${i.unit}`;
      return line.remarks.trim() ? `${head} — ${line.remarks.trim()}` : head;
    })
    .join('; ');
}

/* ── The pass row, above the lines ──────────────────────────────────────── */

/** "7 of 13 returned (53.8%)" — the mock's Returned Summary cell.
 *
 *  It counts QUANTITY, not lines, and that is deliberate: this screen's whole
 *  subject is that 800 of 1,000 litres is a real answer, and a line-count
 *  summary would call that pass 0 of 1 returned. Both figures come off
 *  `v_gate_passes`'s own roll-ups — never re-summed from item rows here, or
 *  this cell and the overdue KPI can disagree. */
export function returnSummary(p: GatePassView): { text: string; percent: number } {
  const total = p.total_quantity;
  const back = p.returned_quantity;
  const percent = total === 0 ? 0 : (back / total) * 100;
  const shown = Math.round(percent * 10) / 10;
  return { text: `${formatQty(back)} of ${formatQty(total)} returned`, percent: shown };
}

/** The Status column on the pass row: Partially Returned · Overdue · Not
 *  Returned. Partly-returned outranks lateness — a pass with material already back is a
 *  different conversation from one with none, and the Expected Back cell
 *  beside it carries the lateness anyway. */
export type PassReturnState = 'partial' | 'overdue' | 'pending';

export function passReturnState(p: GatePassView): PassReturnState {
  if (p.return_status === 'partially_returned') return 'partial';
  return p.due_state === 'overdue' ? 'overdue' : 'pending';
}

export const PASS_RETURN_LABELS: Record<PassReturnState, string> = {
  partial: 'Partially Returned',
  overdue: 'Overdue',
  pending: 'Not Returned',
};

export const PASS_RETURN_PILL: Record<PassReturnState, string> = {
  partial: 'gb-pill-orange',
  overdue: 'gb-pill-red',
  pending: 'gb-pill-grey',
};

/**
 * "(1 Day Overdue)" / "(2 Days Overdue)" under the expected date — the mock's
 * own second line, and the only place on this screen where a day count is
 * computed in TypeScript.
 *
 * A one-day delay used to read "(Yesterday)". It is a day count now (client,
 * 2026-08-19): the column answers "how late", and a word that answers "when"
 * instead makes the reader do the conversion, once, on every row.
 *
 * LATENESS ITSELF IS NOT DECIDED HERE. Whether a pass IS overdue comes from
 * `due_state`, graded by the database in `site_tz()`; this only says HOW LATE a
 * pass the database has already called late is, from a `date` column, in whole
 * calendar days — the same arithmetic `buildOverdueRows` uses, so the note and
 * the Overdue Items delay column can never disagree by a day.
 */
export function lateNote(p: GatePassView, now: number = Date.now()): string | null {
  if (p.due_state !== 'overdue') return null;
  const day = parseLocalDay(p.expected_return_date);
  if (day === null) return null;
  const days = daysBetween(day, dayStart(now));
  if (days < 1) return null;
  return `(${days} ${days === 1 ? 'Day' : 'Days'} Overdue)`;
}

/**
 * The note under the Expected Back date, for EITHER state on this page.
 *
 * A due-today row is on this list for a reason a reader must be told in words —
 * the mock-up prints a bare date there, and colour alone does not survive a
 * screenshot, a mono print or a reader who does not separate orange from red.
 * The lateness half is `lateNote`; this only adds today's half.
 */
export function dueNote(p: GatePassView, now: number = Date.now()): string | null {
  return p.due_state === 'due_today' ? '(Due Today)' : lateNote(p, now);
}

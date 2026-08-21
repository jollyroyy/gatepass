// A MATERIAL LINE READS THE PASS'S OWN STATUS, unless the line's own return
// says something the pass's badge cannot.
//
// Client, 2026-08-21: "whatever status you are showing on the top for the gate
// pass, make sure you show the exact same status for the individual items,
// except when the individual return item status has to be mentioned. If a
// couple of items have been returned and a couple haven't, mention partially
// returned. If an individual item has been completely returned, mark it
// returned. Otherwise show whatever you are showing on top of the pass. Show
// that exactly across all the views."
//
// So there are exactly TWO facts a line can carry that its pass cannot: this
// line is fully back, and this line is half back. Everything else — waiting on
// the ladder, waiting at the gate, refused, expired, out and overdue, closed —
// is a fact about the PASS, and the line repeats it word for word rather than
// grading a return leg that has not started (which is what used to make a
// rejected pass's lines read "Pending", and an overdue pass's lines read
// "Pending" beside a badge saying "Overdue").
//
// It is ONE function, `itemLineView`, so the record's table, the approver's
// unfolded card and the HOD's unfolded card cannot disagree.
import { describe, it, expect } from 'vitest';
import type { GatePassItemView, GatePassView } from '../../src/types';
import { itemLineView } from '../../src/lib/passRecordView';
import { passStageStyle } from '../../src/lib/passStage';
import { itemPillClass } from '../../src/lib/passStackCard';

function line(quantity: number, returned_qty: number): GatePassItemView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id: 'i1', quantity, returned_qty, unit: 'nos' } as any;
}

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', type: 'RGP', status: 'matched', return_status: 'awaiting_return',
    is_expired: false, is_overdue: false, awaits_approval: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...over } as any;
}

describe('itemLineView — the line says what the pass says', () => {
  it('repeats the pass badge on a line nothing has come back on', () => {
    const p = pass();
    expect(itemLineView(line(8, 0), p).label).toBe(passStageStyle(p).label);
    expect(itemLineView(line(8, 0), p).label).toBe('Partially Returned');
  });

  it('says "Overdue" on the lines of an overdue pass, exactly as the badge does', () => {
    const p = pass({ is_overdue: true });
    expect(passStageStyle(p).label).toBe('Overdue');
    expect(itemLineView(line(8, 0), p).label).toBe('Overdue');
  });

  it('says "Rejected at Security Gate" on the lines of a flagged pass', () => {
    const p = pass({ status: 'flagged', return_status: 'not_applicable' });
    expect(itemLineView(line(8, 0), p).label).toBe('Rejected at Security Gate');
  });

  it('says "Pending Approval" on the lines of a pass still climbing the ladder', () => {
    const p = pass({ status: 'pending', return_status: 'not_applicable', awaits_approval: true });
    expect(itemLineView(line(8, 0), p).label).toBe('Pending Approval');
  });

  it('says "Closed" on an NRGP line the gate cleared', () => {
    const p = pass({ type: 'NRGP', return_status: 'not_applicable' });
    expect(itemLineView(line(8, 0), p).label).toBe('Closed');
  });

  it('overrides the pass with the line: fully back reads "Returned"', () => {
    const p = pass({ is_overdue: true, return_status: 'partially_returned' });
    expect(itemLineView(line(8, 8), p).label).toBe('Returned');
  });

  it('overrides the pass with the line: half back reads "Partially Returned"', () => {
    const p = pass({ is_overdue: true, return_status: 'partially_returned' });
    expect(itemLineView(line(8, 3), p).label).toBe('Partially Returned');
  });

  it('does NOT let a return override a refusal — nothing moved on a refused pass', () => {
    const p = pass({ status: 'cancelled', return_status: 'not_applicable' });
    expect(itemLineView(line(8, 0), p).label).toBe(passStageStyle(p).label);
  });
});

describe('itemPillClass — the guard skin says the same thing in colour', () => {
  it('paints a returned line green and a half-returned one blue', () => {
    const p = pass();
    expect(itemPillClass(line(8, 8), p)).toBe('gb-pill gb-pill-green');
    expect(itemPillClass(line(8, 3), p)).toBe('gb-pill gb-pill-blue');
  });

  it('takes the PASS tone for every other line', () => {
    expect(itemPillClass(line(8, 0), pass({ is_overdue: true }))).toBe('gb-pill gb-pill-red');
    expect(itemPillClass(line(8, 0), pass({ status: 'flagged', return_status: 'not_applicable' })))
      .toBe('gb-pill gb-pill-red');
    expect(itemPillClass(line(8, 0), pass())).toBe('gb-pill gb-pill-blue');
  });
});

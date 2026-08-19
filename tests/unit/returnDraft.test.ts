// A guard's staged return, before any of it reaches the database (client
// mock-up, 2026-08-19). Each case is written to fail for the right reason:
// `checkReturnQty`'s ceiling is the OUTSTANDING quantity (not the total), so
// the boundary case here is the one that catches an off-by-one `>=`;
// `stageLine`/`unstageLine` are React state, so a mutation is a real bug the
// UI would silently swallow; and `lateNote` takes an explicit `now` so the
// day-count arithmetic is never at the mercy of the clock the suite runs on.
import { describe, it, expect } from 'vitest';
import type { GatePassItemView, GatePassView } from '../../src/types';
import {
  parseQty, checkReturnQty, stageLine, unstageLine, stagedCount,
  effectiveReturned, effectiveOutstanding, lineState, lineStateLabel,
  draftPayload, draftRemarks, returnSummary, passReturnState,
  PASS_RETURN_LABELS, PASS_RETURN_PILL, lateNote, formatQty,
  EMPTY_DRAFT, type ReturnDraft,
} from '../../src/lib/returnDraft';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', raised_by: 'u1',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'x', expected_return_date: null,
    actual_return_date: null,
    verified_by: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2026-08-19T23:59:59.000Z',
    created_at: '2026-08-19T04:50:00.000Z', updated_at: '2026-08-19T04:50:00.000Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    flagged_at: null, hod_reviewed_at: null,
    item_count: 1, total_quantity: 1000, returned_quantity: 0,
    material_summary: 'Steel Props', total_value: 0,
    department_name: 'Engineering', department_code: 'ENG',
    raised_by_name: 'HOD One', verified_by_name: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  const quantity = over.quantity ?? 1000;
  const returned_qty = over.returned_qty ?? 0;
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Steel Props',
    description: 'MS props', purpose: 'x', expected_return_date: null,
    quantity, unit: 'Kg', serial_no: null, approx_value: null,
    returned_qty, returned_at: null, department_id: 'd1', is_open: true,
    created_at: '2026-08-19T04:50:00.000Z',
    outstanding_qty: quantity - returned_qty,
    pass_number: 'RGP-20260819-0001', pass_status: 'matched',
    return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('parseQty', () => {
  it('returns null for the empty string, whitespace, text, and non-finite input', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('   ')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(parseQty('Infinity')).toBeNull();
    expect(parseQty('1e999')).toBeNull();
  });

  it('returns the number for a plain, padded, or zero figure', () => {
    expect(parseQty('800')).toBe(800);
    expect(parseQty(' 800.5 ')).toBe(800.5);
    expect(parseQty('0')).toBe(0);
  });
});

describe('checkReturnQty', () => {
  it('rejects a non-number with "Enter the quantity"', () => {
    const result = checkReturnQty('abc', 500);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('Enter the quantity that came back.');
  });

  it('rejects zero', () => {
    const result = checkReturnQty('0', 500);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('A return must be more than zero.');
  });

  it('rejects a negative quantity', () => {
    const result = checkReturnQty('-5', 500);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('A return must be more than zero.');
  });

  it('rejects more than the outstanding quantity and names the outstanding figure', () => {
    const result = checkReturnQty('501', 500);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('Only 500 is still outstanding on this line.');
  });

  it('accepts exactly the outstanding quantity — the boundary an off-by-one `>=` would reject', () => {
    const result = checkReturnQty('500', 500);
    expect(result).toEqual({ ok: true, qty: 500 });
  });
});

describe('stageLine / unstageLine — immutable, and stagedCount follows', () => {
  it('stageLine returns a new object and does not mutate the input', () => {
    const before: ReturnDraft = EMPTY_DRAFT;
    const after = stageLine(before, 'i1', { qty: 200, remarks: '' });
    expect(after).not.toBe(before);
    expect(before).not.toHaveProperty('i1');
    expect(after).toHaveProperty('i1');
    expect(stagedCount(before)).toBe(0);
    expect(stagedCount(after)).toBe(1);
  });

  it('unstageLine returns a new object and does not mutate the input', () => {
    const staged = stageLine(EMPTY_DRAFT, 'i1', { qty: 200, remarks: '' });
    const after = unstageLine(staged, 'i1');
    expect(after).not.toBe(staged);
    expect(staged).toHaveProperty('i1');
    expect(after).not.toHaveProperty('i1');
    expect(stagedCount(staged)).toBe(1);
    expect(stagedCount(after)).toBe(0);
  });
});

describe('effectiveReturned / effectiveOutstanding', () => {
  it('adds the staged quantity on top of returned_qty', () => {
    const it1 = item({ quantity: 1000, returned_qty: 800 });
    const draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 150, remarks: '' });
    expect(effectiveReturned(it1, draft)).toBe(950);
    expect(effectiveOutstanding(it1, draft)).toBe(50);
  });

  it('outstanding never goes negative', () => {
    const it1 = item({ quantity: 1000, returned_qty: 1000 });
    expect(effectiveOutstanding(it1, EMPTY_DRAFT)).toBe(0);
  });

  it('with nothing staged, effectiveReturned is just returned_qty', () => {
    const it1 = item({ quantity: 1000, returned_qty: 300 });
    expect(effectiveReturned(it1, EMPTY_DRAFT)).toBe(300);
    expect(effectiveOutstanding(it1, EMPTY_DRAFT)).toBe(700);
  });
});

describe('lineState', () => {
  it('is pending with nothing back', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 0 });
    expect(lineState(it1, EMPTY_DRAFT)).toBe('pending');
  });

  it('is partial with some back', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 400 });
    expect(lineState(it1, EMPTY_DRAFT)).toBe('partial');
  });

  it('is returned when the staged quantity closes the line', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 800 });
    const draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 200, remarks: '' });
    expect(lineState(it1, draft)).toBe('returned');
  });

  it('a staged partial does not read as returned', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 800 });
    const draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 100, remarks: '' });
    expect(lineState(it1, draft)).toBe('partial');
  });
});

describe('lineStateLabel', () => {
  it('reads "Returned" when fully back', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 1000 });
    expect(lineStateLabel(it1, EMPTY_DRAFT, 'Kg')).toBe('Returned');
  });

  it('reads "Not Returned" with nothing back', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 0 });
    expect(lineStateLabel(it1, EMPTY_DRAFT, 'Kg')).toBe('Not Returned');
  });

  it('reads "Partially Returned (250 Kg Pending)" for a partial line', () => {
    const it1 = item({ id: 'i1', quantity: 1000, returned_qty: 750 });
    expect(lineStateLabel(it1, EMPTY_DRAFT, 'Kg')).toBe('Partially Returned (250 Kg Pending)');
  });
});

describe('draftPayload', () => {
  it('carries only the staged lines, in items order, as {item_id, qty}', () => {
    const items = [
      item({ id: 'i1', line_no: 1 }),
      item({ id: 'i2', line_no: 2 }),
      item({ id: 'i3', line_no: 3 }),
    ];
    let draft = stageLine(EMPTY_DRAFT, 'i3', { qty: 50, remarks: '' });
    draft = stageLine(draft, 'i1', { qty: 200, remarks: '' });
    expect(draftPayload(items, draft)).toEqual([
      { item_id: 'i1', qty: 200 },
      { item_id: 'i3', qty: 50 },
    ]);
  });

  it('is empty when nothing is staged', () => {
    const items = [item({ id: 'i1' })];
    expect(draftPayload(items, EMPTY_DRAFT)).toEqual([]);
  });
});

describe('draftRemarks', () => {
  it('names each staged line as #<line_no> <name> <qty> <unit>, omitting unstaged lines', () => {
    const items = [
      item({ id: 'i1', line_no: 1, name: 'Steel Props', unit: 'Kg' }),
      item({ id: 'i2', line_no: 2, name: 'Cable Drum', unit: 'Nos' }),
    ];
    const draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 800, remarks: '' });
    expect(draftRemarks(items, draft)).toBe('#1 Steel Props 800 Kg');
  });

  it('appends the guard`s own remark after an em dash when there is one', () => {
    const items = [item({ id: 'i1', line_no: 1, name: 'Steel Props', unit: 'Kg' })];
    const draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 800, remarks: 'One damaged panel' });
    expect(draftRemarks(items, draft)).toBe('#1 Steel Props 800 Kg — One damaged panel');
  });

  it('joins several staged lines with "; "', () => {
    const items = [
      item({ id: 'i1', line_no: 1, name: 'Steel Props', unit: 'Kg' }),
      item({ id: 'i2', line_no: 2, name: 'Cable Drum', unit: 'Nos' }),
    ];
    let draft = stageLine(EMPTY_DRAFT, 'i1', { qty: 800, remarks: '' });
    draft = stageLine(draft, 'i2', { qty: 3, remarks: 'Fine' });
    expect(draftRemarks(items, draft)).toBe('#1 Steel Props 800 Kg; #2 Cable Drum 3 Nos — Fine');
  });
});

describe('returnSummary', () => {
  it('formats "1,625 of 1,962 returned" with one decimal place', () => {
    const p = pass({ total_quantity: 1962, returned_quantity: 1625 });
    expect(returnSummary(p)).toEqual({ text: '1,625 of 1,962 returned', percent: 82.8 });
  });

  it('is 0 percent, never NaN, when total_quantity is 0', () => {
    const p = pass({ total_quantity: 0, returned_quantity: 0 });
    expect(returnSummary(p)).toEqual({ text: '0 of 0 returned', percent: 0 });
  });
});

describe('passReturnState', () => {
  it('is partial when return_status is partially_returned, even if the pass is also overdue', () => {
    const p = pass({ return_status: 'partially_returned', due_state: 'overdue' });
    expect(passReturnState(p)).toBe('partial');
  });

  it('is overdue when awaiting and due_state is overdue', () => {
    const p = pass({ return_status: 'awaiting_return', due_state: 'overdue' });
    expect(passReturnState(p)).toBe('overdue');
  });

  it('is pending otherwise', () => {
    const p = pass({ return_status: 'awaiting_return', due_state: 'due_today' });
    expect(passReturnState(p)).toBe('pending');
  });

  it('PASS_RETURN_LABELS and PASS_RETURN_PILL are keyed by every union member', () => {
    const states: Array<keyof typeof PASS_RETURN_LABELS> = ['partial', 'overdue', 'pending'];
    for (const s of states) {
      expect(typeof PASS_RETURN_LABELS[s]).toBe('string');
      expect(typeof PASS_RETURN_PILL[s]).toBe('string');
    }
  });
});

describe('lateNote', () => {
  const NOW = new Date(2026, 7, 19, 12, 0, 0).getTime();

  it('is null when due_state is not overdue, even with a past date', () => {
    const p = pass({ due_state: 'due_today', expected_return_date: '2026-08-01' });
    expect(lateNote(p, NOW)).toBeNull();
  });

  it('is null when expected_return_date is null', () => {
    const p = pass({ due_state: 'overdue', expected_return_date: null });
    expect(lateNote(p, NOW)).toBeNull();
  });

  it('counts the day rather than naming it — "(1 Day Overdue)", never "(Yesterday)"', () => {
    const p = pass({ due_state: 'overdue', expected_return_date: '2026-08-18' });
    expect(lateNote(p, NOW)).toBe('(1 Day Overdue)');
  });

  it('reads "(3 Days Overdue)" at three days late', () => {
    const p = pass({ due_state: 'overdue', expected_return_date: '2026-08-16' });
    expect(lateNote(p, NOW)).toBe('(3 Days Overdue)');
  });
});

describe('formatQty', () => {
  it('groups in en-IN, as every other figure in this app does', () => {
    expect(formatQty(1625)).toBe('1,625');
  });
});

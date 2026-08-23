// A REJECTED PASS'S MATERIAL LINES SAY THE PASS WAS REJECTED, NEVER "Pending".
//
// REWRITTEN 2026-08-21. Until then this file held that such a line read the bare
// word "Rejected", from a fifth `ItemLineStage` of its own. The client then
// generalised the rule — "whatever status you are showing on the top for the
// gate pass, show the exact same status for the individual items … across all
// the views" — so `itemLineStage` / `ITEM_LINE_STYLES` / `ITEM_STAGE_PILL` are
// GONE and a line simply repeats `passStageStyle`, which for these three
// statuses says "Rejected at Security Gate", "Voided" or "Cancelled". The
// defect this file was written for is fixed by the general rule rather than by
// a special case, and the cases below assert the pass's own words.
//
// Client, 2026-08-20: "once any approver is rejecting the pass, all the
// individual items are still showing pending … all the individual items should
// also show as rejected for all the approvers' rejections … and everywhere, not
// only the pass. Show the status also as rejected against each individual item."
//
// The line's return leg never began: an approver's rejection closes the pass
// before the gate ever sees it, so `returned_qty` is 0 on every line and
// `itemReturnStage` — which grades the RETURN LEG and nothing else — reads
// "Pending" for ever. The pass's own outcome outranks it.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GatePassItemView, GatePassView } from '../../src/types';
import { itemLineView, passWasRejected } from '../../src/lib/passRecordView';
import { passStageStyle } from '../../src/lib/passStage';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import PassStackItems from '../../src/components/PassStackItems';
import { itemPillClass } from '../../src/lib/passStackCard';
import { EMPTY_DRAFT } from '../../src/lib/returnDraft';

// The two unfolded panels read their lines through this hook; the query behind
// it is not what these cases are about.
const items: GatePassItemView[] = [];
vi.mock('../../src/lib/usePassItems', () => ({
  usePassItems: () => ({ items, error: null }),
}));

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260820-0001', type: 'RGP', status: 'pending',
    return_status: 'awaiting_return', flag_reason: null,
    is_expired: false, is_overdue: false, awaits_approval: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Diesel', description: 'HSD',
    serial_no: null, quantity: 3, unit: 'litre', returned_qty: 0, returned_at: null,
    approx_value: 500, expected_return_date: '2026-08-24', outstanding_qty: 3,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('passWasRejected', () => {
  it('is true for an approval office\'s rejection — cancelled with no gate reason', () => {
    expect(passWasRejected(pass({ status: 'cancelled', flag_reason: null }))).toBe(true);
  });

  it('is true for a rejection at the security gate, and for the HOD upholding one', () => {
    expect(passWasRejected(pass({ status: 'flagged', flag_reason: 'Count short' }))).toBe(true);
    expect(passWasRejected(pass({ status: 'cancelled', flag_reason: 'Count short' }))).toBe(true);
  });

  it('is false for every pass that is still alive', () => {
    expect(passWasRejected(pass({ status: 'pending' }))).toBe(false);
    expect(passWasRejected(pass({ status: 'held' }))).toBe(false);
    expect(passWasRejected(pass({ status: 'hod_reviewed' }))).toBe(false);
    expect(passWasRejected(pass({ status: 'matched' }))).toBe(false);
  });
});

describe('itemLineView on a refused pass', () => {
  it('gives every line the pass\'s own refusal, whatever the return leg says', () => {
    const p = pass({ status: 'flagged', flag_reason: 'Count short' });
    expect(itemLineView(line(), p).label).toBe('Rejected at Security Gate');
    expect(itemLineView(line({ returned_qty: 3 }), p).label).toBe('Rejected at Security Gate');
    const voided = pass({ status: 'cancelled', type: 'NRGP', return_status: 'not_applicable' });
    expect(itemLineView(line(), voided).label).toBe(passStageStyle(voided).label);
  });

  it('leaves a live pass reading its own state, line by line', () => {
    // Nothing back yet: the line repeats the pass. Some back: the line's own
    // return outranks it. All back: "Returned".
    expect(itemLineView(line(), pass({ status: 'matched' })).label).toBe('Partially Returned');
    expect(itemLineView(line({ returned_qty: 1 }), pass({ status: 'matched' })).label)
      .toBe('Partially Returned');
    expect(itemLineView(line({ returned_qty: 3 }), pass({ status: 'matched' })).label)
      .toBe('Returned');
    const nrgp = pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' });
    expect(itemLineView(line(), nrgp).label).toBe('Closed');
  });

  it('is styled in the flagged red the pass badge uses', () => {
    expect(itemLineView(line(), pass({ status: 'flagged' })).text).toContain('flagged');
  });
});

describe('the record\'s item table on a rejected pass', () => {
  function draw(p: GatePassView, items: GatePassItemView[]) {
    return render(
      <PassRecordItems pass={p} items={items} draft={EMPTY_DRAFT} canRecord={false} onAdd={vi.fn()} />,
    );
  }

  it('badges every line with the pass\'s refusal, and never "Pending"', () => {
    const refused = pass({ status: 'cancelled' });
    draw(refused, [line(), line({ id: 'i2', name: 'Bolts', unit: 'nos' })]);

    expect(screen.getAllByText(passStageStyle(refused).label)).toHaveLength(2);
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('drops the return progress line — nothing was ever going to come back', () => {
    draw(pass({ status: 'cancelled' }), [line()]);
    expect(screen.queryByText(/items returned/)).not.toBeInTheDocument();
  });

  it('heads the column "Status", not "Return Status"', () => {
    draw(pass({ status: 'cancelled' }), [line()]);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain('Status');
    expect(heads).not.toContain('Return Status');
  });
});

// MY PASSES IS GONE (client, 2026-08-23), and `MyPassItems` with it. What it
// asserted about the STACKED card's unfolded panel is unchanged and stays here.
describe('the unfolded panel of a stacked card', () => {
  it('badge each line with the pass\'s own status on a refused pass', () => {
    items.length = 0;
    items.push(line(), line({ id: 'i2', name: 'Bolts', unit: 'nos' }));

    const refused = pass({ status: 'cancelled' });
    const word = passStageStyle(refused).label;
    const stack = render(<PassStackItems pass={refused} />);
    expect(stack.getAllByText(word)).toHaveLength(2);
    expect(stack.queryByText('Pending')).not.toBeInTheDocument();
    stack.unmount();
  });

  it('says what a LIVE pass is actually doing, line by line', () => {
    items.length = 0;
    items.push(line(), line({ id: 'i2', returned_qty: 3 }));

    const live = pass({ status: 'matched' });
    const stack = render(<PassStackItems pass={live} />);
    // The untouched line repeats the pass's badge; the finished one does not.
    expect(stack.getByText(passStageStyle(live).label)).toBeInTheDocument();
    expect(stack.getByText('Returned')).toBeInTheDocument();
    stack.unmount();
  });

  it('paint the pill from the guard skin alone — no new colour', () => {
    // Every value is one of `.gb-board`'s own pills, so themeAudit stays absolute.
    const cases = [
      itemPillClass(line(), pass({ status: 'flagged' })),
      itemPillClass(line(), pass({ status: 'matched' })),
      itemPillClass(line({ returned_qty: 1 }), pass({ status: 'matched' })),
      itemPillClass(line({ returned_qty: 3 }), pass({ status: 'matched' })),
      itemPillClass(line(), pass({ status: 'matched', is_overdue: true })),
    ];
    for (const cls of cases) {
      expect(cls).toMatch(/^gb-pill gb-pill-(blue|green|orange|grey|red|purple)$/);
    }
    // A line on a pass the gate rejected is red, exactly as its badge is.
    expect(cases[0]).toContain('gb-pill-red');
  });
});

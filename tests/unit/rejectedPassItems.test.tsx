// A REJECTED PASS'S MATERIAL LINES READ "Rejected", NEVER "Pending".
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
import {
  ITEM_LINE_STYLES, itemLineStage, passWasRejected,
} from '../../src/lib/passRecordView';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import PassStackItems from '../../src/components/PassStackItems';
import MyPassItems from '../../src/components/mypasses/MyPassItems';
import { ITEM_STAGE_PILL } from '../../src/lib/passStackCard';
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

describe('itemLineStage', () => {
  it('reads rejected on every line of a rejected pass, whatever the return leg says', () => {
    const p = pass({ status: 'cancelled' });
    expect(itemLineStage(line(), p)).toBe('rejected');
    expect(itemLineStage(line({ returned_qty: 3 }), p)).toBe('rejected');
    expect(itemLineStage(line(), pass({ status: 'cancelled', type: 'NRGP' }))).toBe('rejected');
  });

  it('leaves a live pass exactly as the return leg grades it', () => {
    expect(itemLineStage(line(), pass())).toBe('pending');
    expect(itemLineStage(line({ returned_qty: 1 }), pass({ status: 'matched' }))).toBe('partial');
    expect(itemLineStage(line({ returned_qty: 3 }), pass({ status: 'matched' }))).toBe('returned');
    expect(itemLineStage(line(), pass({ type: 'NRGP', status: 'matched' }))).toBe('closed');
  });

  it('is styled in the flagged red the pass badge uses, and says "Rejected"', () => {
    expect(ITEM_LINE_STYLES.rejected.label).toBe('Rejected');
    expect(ITEM_LINE_STYLES.rejected.text).toContain('flagged');
  });
});

describe('the record\'s item table on a rejected pass', () => {
  function draw(p: GatePassView, items: GatePassItemView[]) {
    return render(
      <PassRecordItems pass={p} items={items} draft={EMPTY_DRAFT} canRecord={false} onAdd={vi.fn()} />,
    );
  }

  it('badges every line Rejected and never Pending', () => {
    draw(pass({ status: 'cancelled' }), [line(), line({ id: 'i2', name: 'Bolts', unit: 'nos' })]);

    expect(screen.getAllByText('Rejected')).toHaveLength(2);
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

describe('the unfolded panels — a stacked card and My Passes', () => {
  it('badge each line with its own status, Rejected on a refused pass', () => {
    items.length = 0;
    items.push(line(), line({ id: 'i2', name: 'Bolts', unit: 'nos' }));

    const refused = pass({ status: 'cancelled' });
    const stack = render(<PassStackItems pass={refused} />);
    expect(stack.getAllByText('Rejected')).toHaveLength(2);
    expect(stack.queryByText('Pending')).not.toBeInTheDocument();
    stack.unmount();

    const mine = render(<MyPassItems pass={refused} />);
    expect(mine.getAllByText('Rejected')).toHaveLength(2);
    mine.unmount();
  });

  it('says what a LIVE pass is actually doing, line by line', () => {
    items.length = 0;
    items.push(line(), line({ id: 'i2', returned_qty: 3 }));

    const live = pass({ status: 'matched' });
    const stack = render(<PassStackItems pass={live} />);
    expect(stack.getByText('Pending')).toBeInTheDocument();
    expect(stack.getByText('Returned')).toBeInTheDocument();
    stack.unmount();
  });

  it('paint the pill from the guard skin alone — no new colour', () => {
    // Every value is one of `.gb-board`'s own pills, so themeAudit stays absolute.
    for (const cls of Object.values(ITEM_STAGE_PILL)) {
      expect(cls).toMatch(/^gb-pill gb-pill-(blue|green|orange|grey|red|purple)$/);
    }
    expect(ITEM_STAGE_PILL.rejected).toContain('gb-pill-red');
  });
});

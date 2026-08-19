// A unit that is COUNTED cannot come back in halves (client, 2026-08-19).
//
// Boxes, bags, drums, rolls, sets, lots and plain numbers are discrete objects:
// "2.5 Boxes" is not a quantity anybody can hand over at a barrier, and once it
// is recorded the outstanding figure on that line is a fraction forever, because
// `apply_item_returns` has no undo. Kg, litres and metres are measured and stay
// fractional — 800.5 Kg is an ordinary movement.
//
// The rule lives in `isWholeUnit` alone, and both the raise form and the return
// box read it, so a pass can never be RAISED in a quantity its own return box
// would refuse.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { isWholeUnit } from '../../src/lib/units';
import { checkReturnQty } from '../../src/lib/returnDraft';
import { validateRaiseForm } from '../../src/lib/raisePassForm';
import type { NewGatePass, GatePassItemView } from '../../src/types';
import AddReturnBox from '../../src/components/guard/AddReturnBox';
import PassReturnBox from '../../src/components/passview/PassReturnBox';

describe('isWholeUnit', () => {
  it('counts nos, box, roll, set, bag, drum and lot as whole', () => {
    for (const u of ['nos', 'box', 'roll', 'set', 'bag', 'drum', 'lot']) {
      expect(isWholeUnit(u)).toBe(true);
    }
  });

  it('leaves measured units fractional', () => {
    for (const u of ['kg', 'litre', 'metre']) {
      expect(isWholeUnit(u)).toBe(false);
    }
  });

  it('lets an unknown or missing code stay fractional', () => {
    // A code this app does not know is not evidence that it is countable, and
    // refusing a fraction on it would block a return nobody can otherwise record.
    expect(isWholeUnit('tonne')).toBe(false);
    expect(isWholeUnit(null)).toBe(false);
    expect(isWholeUnit(undefined)).toBe(false);
  });
});

describe('checkReturnQty refuses a fraction of a counted unit', () => {
  it('rejects 2.5 boxes and names the unit', () => {
    const result = checkReturnQty('2.5', 10, 'box');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Box cannot be split — enter 2 or 3.');
  });

  it('accepts a whole number of boxes', () => {
    expect(checkReturnQty('3', 10, 'box')).toEqual({ ok: true, qty: 3 });
  });

  it('still accepts a fraction of a measured unit', () => {
    expect(checkReturnQty('800.5', 1000, 'kg')).toEqual({ ok: true, qty: 800.5 });
  });

  it('checks the ceiling before the fraction, so an over-entry says so', () => {
    // Catches: reporting "enter a whole number" for 12.5 of 10 outstanding,
    // which sends the guard to type 13 and be refused again.
    const result = checkReturnQty('12.5', 10, 'box');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('still outstanding');
  });

  it('is unchanged when no unit is given', () => {
    expect(checkReturnQty('2.5', 10)).toEqual({ ok: true, qty: 2.5 });
  });
});

// 2026-08-19: the raise form's grid lost its UOM column — every line raised
// from it is `nos`, so `validateRaiseForm` no longer takes a per-item unit at
// all and refuses ANY fraction outright, through the same "Enter a whole
// number." message every line shares. The unit-aware `isWholeUnit` rule stays
// alive on the RETURN side (`checkReturnQty`, pinned above and below), because
// a line raised long ago can still carry `kg` or `litre`.
function form(quantity: string): NewGatePass {
  return {
    type: 'NRGP',
    direction: 'out',
    visitor_name: 'Ramesh',
    visitor_company: 'Acme',
    visitor_phone: '9876543210',
    company_address: '',
    vehicle_number: '',
    department_id: 'd1',
    purpose: 'Testing',
    expected_return_date: '',
    items: [
      { name: 'Crates', make_model: 'Wooden', serial_no: '', invoice_no: '', remarks: '', quantity },
    ],
  };
}

describe('a pass cannot be RAISED in a fraction of a counted unit', () => {
  it('refuses a fraction on any line — every line raised from this form is nos', () => {
    const errs = validateRaiseForm(form('2.5'), true, '2026-08-19');
    expect(errs.item_0_quantity).toBe('Enter a whole number.');
  });

  it('allows a whole number', () => {
    expect(validateRaiseForm(form('3'), true, '2026-08-19').item_0_quantity).toBeUndefined();
  });
});

const ITEM: GatePassItemView = {
  id: 'i1',
  pass_id: 'p1',
  line_no: 1,
  name: 'Crates',
  description: 'Wooden',
  purpose: 'Repair',
  quantity: 10,
  unit: 'box',
  approx_value: null,
  serial_no: null,
  expected_return_date: '2026-08-20',
  returned_qty: 0,
  returned_at: null,
} as unknown as GatePassItemView;

describe('both return boxes refuse the fraction on screen', () => {
  for (const [label, Box] of [
    ['guard queue', AddReturnBox],
    ['pass record', PassReturnBox],
  ] as const) {
    it(`${label}: typing 2.5 boxes stages nothing and says why`, () => {
      const onConfirm = vi.fn();
      render(
        <Box
          item={ITEM}
          alreadyReturned={0}
          outstanding={10}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );
      fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '2.5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText('Box cannot be split — enter 2 or 3.')).toBeTruthy();
    });
  }
});

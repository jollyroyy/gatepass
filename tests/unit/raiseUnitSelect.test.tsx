// THE UNIT IS CHOSEN AGAIN ON THE RAISE FORM (client, 2026-08-20: "add unit
// field as dropdown to select different types of unit while raising the
// nrgp/rgp passes for all views and also show the selected unit in guard view
// as readonly").
//
// This REVERSES the 2026-08-19 mock-up's removal of the UOM column, which cost
// this form the ability to raise material counted in bags, drums, kg or litres
// in its own unit — every line was written `nos`. The dropdown offers every
// code `unitLabel` knows, `lot` included, so what is raised is what the guard
// reads back at the barrier.
//
// The unit is what decides whether the QUANTITY may carry a fraction:
// `isWholeUnit` is the one rule, and this form and the gate's return box both
// read it, so a pass can never be raised in a quantity its own return box
// would refuse.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialItemsCard from '../../src/pages/HOD/MaterialItemsCard';
import { itemGridColumns } from '../../src/pages/HOD/materialItemGrid';
import { EMPTY_ITEM } from '../../src/types';
import { UNIT_OPTIONS, unitLabel } from '../../src/lib/units';
import { validateRaiseForm } from '../../src/lib/raisePassForm';
import type { NewGatePass } from '../../src/types';

function renderCard(overrides: Partial<typeof EMPTY_ITEM> = {}, onItemChange = vi.fn()) {
  render(
    <MaterialItemsCard
      items={[{ ...EMPTY_ITEM, ...overrides }]}
      errors={{}}
      onItemChange={onItemChange}
      onRemoveItem={() => {}}
      onAddItem={() => {}}
      showReturnDate={false}
    />
  );
  return onItemChange;
}

describe('UNIT_OPTIONS — every unit this app knows, in one ordered list', () => {
  it('offers the counted and the measured units, lots included', () => {
    const codes = UNIT_OPTIONS.map((u) => u.code);
    expect(codes).toEqual(
      expect.arrayContaining(['nos', 'kg', 'litre', 'metre', 'box', 'roll', 'set', 'bag', 'drum', 'lot'])
    );
  });

  it('labels each one the way every other screen labels it', () => {
    for (const opt of UNIT_OPTIONS) expect(opt.label).toBe(unitLabel(opt.code));
  });
});

describe('the item row asks for a unit', () => {
  it('draws a Unit select on every line, with every option', () => {
    renderCard();
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.options).toHaveLength(UNIT_OPTIONS.length);
    expect(select.value).toBe('nos');
  });

  it('reports the picked unit to the form', () => {
    const onItemChange = renderCard();
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'litre' } });
    expect(onItemChange).toHaveBeenCalledWith(0, 'unit', 'litre');
  });

  it('names the column in the header, and the grid has a track for it', () => {
    renderCard();
    expect(screen.getAllByText('Unit')).toHaveLength(1);
    // Ten since 2026-08-20, when the Approx. Value column came back beside it.
    expect(itemGridColumns(false).split(' ')).toHaveLength(10);
    expect(itemGridColumns(true).split(' ')).toHaveLength(11);
  });

  it('lets a MEASURED unit be typed in fractions and refuses a fraction of a counted one', () => {
    renderCard({ unit: 'kg' });
    const qty = screen.getByLabelText('Quantity') as HTMLInputElement;
    expect(qty.step).toBe('0.01');

    render(
      <MaterialItemsCard
        items={[{ ...EMPTY_ITEM, unit: 'box' }]}
        errors={{}}
        onItemChange={() => {}}
        onRemoveItem={() => {}}
        onAddItem={() => {}}
        showReturnDate={false}
      />
    );
    const boxQty = screen.getAllByLabelText('Quantity')[1] as HTMLInputElement;
    expect(boxQty.step).toBe('1');
  });
});

function form(unit: string, quantity: string): NewGatePass {
  return {
    type: 'NRGP',
    direction: 'out',
    department_id: 'd1',
    visitor_name: 'Ravi',
    visitor_phone: '+919876543210',
    visitor_company: 'Acme',
    company_address: '',
    vehicle_number: '',
    purpose: 'Servicing',
    items: [{ ...EMPTY_ITEM, name: 'Paint', make_model: 'Asian 10L', unit, quantity }],
  };
}

describe('validateRaiseForm — the unit decides whether a fraction is legal', () => {
  it('accepts 2.5 litres', () => {
    expect(validateRaiseForm(form('litre', '2.5'), true, '2026-08-20').item_0_quantity).toBeUndefined();
  });

  it('refuses 2.5 boxes, naming the two whole numbers either side', () => {
    const err = validateRaiseForm(form('box', '2.5'), true, '2026-08-20').item_0_quantity;
    expect(err).toMatch(/Box cannot be split/);
    expect(err).toMatch(/2 or 3/);
  });

  it('still refuses a fraction of the default unit', () => {
    expect(validateRaiseForm(form('nos', '2.5'), true, '2026-08-20').item_0_quantity).toBeDefined();
  });

  it('still refuses zero and blank whatever the unit', () => {
    expect(validateRaiseForm(form('kg', '0'), true, '2026-08-20').item_0_quantity).toBeDefined();
    expect(validateRaiseForm(form('kg', ''), true, '2026-08-20').item_0_quantity).toBeDefined();
  });
});

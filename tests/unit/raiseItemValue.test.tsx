// THE APPROXIMATE VALUE IS ASKED FOR AGAIN, PER LINE, ON BOTH PASS TYPES
// (client, 2026-08-20: "make a field for the HOD to input the approx value for
// each item in our GP and RGP form").
//
// This REVERSES the 2026-08-19 mock-up's removal of the value column, which is
// why "Total Value" has read a dash on every pass raised since. NO MIGRATION
// WAS NEEDED: `raise_pass` has read `approx_value` out of each `p_items`
// element since 019 and `gate_pass_items.approx_value` has always been there —
// the form simply stopped sending one.
//
// THE FIELD IS OPTIONAL AND MUST STAY OPTIONAL. A blank line is one nobody has
// priced; requiring a figure would make somebody invent one, and that invented
// figure then prints on the record and the report as if it had been declared.
// A blank must reach the RPC as an empty string, never as `Number('') === 0`.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialItemsCard from '../../src/pages/HOD/MaterialItemsCard';
import { EMPTY_ITEM, type NewGatePass } from '../../src/types';
import { validateRaiseForm } from '../../src/lib/raisePassForm';

function renderCard(overrides: Partial<typeof EMPTY_ITEM> = {}, showReturnDate = false) {
  const onItemChange = vi.fn();
  render(
    <MaterialItemsCard
      items={[{ ...EMPTY_ITEM, ...overrides }]}
      errors={{}}
      onItemChange={onItemChange}
      onRemoveItem={() => {}}
      onAddItem={() => {}}
      showReturnDate={showReturnDate}
    />
  );
  return onItemChange;
}

function form(value: string): NewGatePass {
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
    items: [{ ...EMPTY_ITEM, name: 'Paint', make_model: 'Asian 10L', quantity: '2', approx_value: value }],
  };
}

describe('the item row asks for an approximate value', () => {
  it('draws the field on an NRGP and on an RGP alike, named once in the header', () => {
    renderCard();
    expect(screen.getByLabelText('Approx. Value (Rs)')).toBeInTheDocument();
    // The header names it, and only the header — the row's own copy is a
    // `data-label`, not a second text node.
    expect(screen.getAllByText(/Approx\. Value/)).toHaveLength(1);

    // An RGP draws it too: material that is coming back is still worth
    // something while it is out.
    render(
      <MaterialItemsCard
        items={[{ ...EMPTY_ITEM }]}
        errors={{}}
        onItemChange={() => {}}
        onRemoveItem={() => {}}
        onAddItem={() => {}}
        showReturnDate
      />
    );
    expect(screen.getAllByLabelText('Approx. Value (Rs)')).toHaveLength(2);
  });

  it('is a rupee number that cannot go below zero, and takes paise whatever the unit', () => {
    // The material is counted in whole boxes; the money is not.
    renderCard({ unit: 'box' });
    const input = screen.getByLabelText('Approx. Value (Rs)') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.step).toBe('0.01');
  });

  it('reports what was typed back to the form, on the line it was typed on', () => {
    const onItemChange = renderCard();
    fireEvent.change(screen.getByLabelText('Approx. Value (Rs)'), { target: { value: '4500' } });
    expect(onItemChange).toHaveBeenCalledWith(0, 'approx_value', '4500');
  });

  it('carries the value it was given', () => {
    renderCard({ approx_value: '1250.50' });
    expect((screen.getByLabelText('Approx. Value (Rs)') as HTMLInputElement).value).toBe('1250.50');
  });
});

describe('validateRaiseForm — the value is optional, and checked only when given', () => {
  it('accepts a blank, which is what an unpriced line is', () => {
    expect(validateRaiseForm(form(''), true, '2026-08-20').item_0_approx_value).toBeUndefined();
    expect(validateRaiseForm(form('   '), true, '2026-08-20').item_0_approx_value).toBeUndefined();
  });

  it('accepts a whole rupee figure, paise, and an explicit zero', () => {
    for (const v of ['4500', '1250.50', '0']) {
      expect(validateRaiseForm(form(v), true, '2026-08-20').item_0_approx_value).toBeUndefined();
    }
  });

  it('refuses a negative value and a figure that is not a number', () => {
    expect(validateRaiseForm(form('-1'), true, '2026-08-20').item_0_approx_value).toBeDefined();
    expect(validateRaiseForm(form('abc'), true, '2026-08-20').item_0_approx_value).toBeDefined();
  });

  it('does not block the rest of the form — a bad value fails only its own line', () => {
    const errs = validateRaiseForm(form('-1'), true, '2026-08-20');
    expect(errs.item_0_quantity).toBeUndefined();
    expect(errs.item_0_name).toBeUndefined();
  });
});

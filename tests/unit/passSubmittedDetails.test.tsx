// THE CONFIRMATION SHOWS WHAT WAS ACTUALLY RAISED (client, 2026-09-01: "in the
// success pop-up you show all the details, like how many quantities, what is
// the material item, everything … how much worth of item").
//
// Before this, the popup said "Line Items 3 / Total Quantity —": the count came
// from the form, and `total_quantity` came off `raise_pass`'s return, which is
// a `gate_passes` ROW and carries no roll-up at all — so the one number it
// printed was an em dash. The lines themselves, their units, their declared
// value and the vendor's contact number were nowhere.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PassSubmittedModal from '../../src/pages/HOD/PassSubmittedModal';
import type { GatePassView } from '../../src/types';

const ITEMS = [
  { id: 'i1', line_no: 1, name: 'Drill Machine', make_model: 'Bosch GSB 13mm', quantity: 2, unit: 'nos', approx_value: 12000 },
  { id: 'i2', line_no: 2, name: 'Copper Wire', make_model: null, quantity: 50.5, unit: 'kg', approx_value: null },
];

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data: ITEMS, error: null }).then(ok, err);
  return {
    gp: () => ({ from: () => builder, rpc: () => Promise.resolve({ data: [], error: null }) }),
    pub: () => ({ from: () => builder }),
    supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
  };
});

const PASS = {
  id: 'p1',
  pass_number: 'RGP-ENG-0007',
  type: 'RGP',
  direction: 'out',
  status: 'pending',
  visitor_name: 'Ravi Kumar',
  visitor_company: JSON.stringify({ n: 'Bharat Steel Co', a: '12 MG Road', v: '9800000000' }),
  vehicle_number: 'WB01AB1234',
  purpose: 'Repair at vendor works',
  item_count: 2,
  total_quantity: 52.5,
  total_value: 12000,
  expected_return_date: '2026-09-10',
  created_at: '2026-08-10T09:15:00Z',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as GatePassView;

function renderModal(pass: GatePassView = PASS) {
  return render(
    <MemoryRouter>
      <PassSubmittedModal submittedPass={pass} deptName="Engineering (ENG)" itemCount={2} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('PassSubmittedModal — the whole of what was raised', () => {
  it('lists every material line with its own quantity, unit and value', async () => {
    renderModal();
    expect(await screen.findByText('Drill Machine')).toBeInTheDocument();
    expect(screen.getByText('Bosch GSB 13mm')).toBeInTheDocument();
    // A quantity always names its unit — `quantityCell`, the one formatter.
    expect(screen.getByText('2 Numbers')).toBeInTheDocument();
    expect(screen.getByText('Copper Wire')).toBeInTheDocument();
    expect(screen.getByText('50.5 Kg')).toBeInTheDocument();
    // Twice: the priced line, and the pass's own total above it.
    expect(screen.getAllByText('₹12,000')).toHaveLength(2);
  });

  it("states what the pass is worth, from the view's own sum", async () => {
    renderModal();
    expect(await screen.findByText('Total Value')).toBeInTheDocument();
    // The header figure and the priced line agree; both read ₹12,000.
    expect(screen.getAllByText('₹12,000').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('52.5')).toBeInTheDocument();
  });

  it("shows the vendor's contact number and the reason the material is going out", async () => {
    renderModal();
    expect(await screen.findByText('9800000000')).toBeInTheDocument();
    expect(screen.getByText('Repair at vendor works')).toBeInTheDocument();
  });

  it('prints a dash for an unpriced pass rather than ₹0', async () => {
    renderModal({ ...PASS, total_value: 0 } as GatePassView);
    expect(await screen.findByText('Drill Machine')).toBeInTheDocument();
    expect(screen.queryByText('₹0')).toBeNull();
  });
});

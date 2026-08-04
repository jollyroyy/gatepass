// RaisePass had two defects that together made an RGP unsubmittable:
//
//  1. validate() required a PASS-LEVEL `expected_return_date` for RGP, but the
//     form never rendered a pass-level date input (per-item dates replaced it in
//     migration 019). So every RGP submit failed validation on a field the user
//     could not see or fix, and the error was never rendered either — the button
//     simply did nothing.
//  2. handleSubmit never sent `p_expected_return_date` to raise_pass. The view's
//     `is_overdue` / `due_state` read the PASS-level column, so even a pass that
//     did get through would never have gone overdue.
//
// The fix: per-item return dates are the source of truth for RGP, and the
// pass-level date is derived as the EARLIEST of them (a pass is due when its
// first line is due).
//
// Serial number was also dropped from the HOD forms entirely.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  for (const m of ['in', 'eq', 'order', 'limit']) {
    obj[m] = () => thenable(result);
  }
  return obj;
}

const TABLE_DATA: Record<string, { data: unknown; error: unknown }> = {
  hod_departments: { data: [{ department_id: 'd1' }], error: null },
  departments: { data: [{ id: 'd1', name: 'IT', code: 'IT' }], error: null },
};

function fakeFrom(table: string) {
  return { select: () => thenable(TABLE_DATA[table] ?? { data: [], error: null }) };
}

const rpc = vi.fn((name: string) => {
  if (name === 'raise_pass') {
    return thenable({
      data: { id: 'p1', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', visitor_name: 'Ravi' },
      error: null,
    });
  }
  return thenable({ data: [], error: null });
});

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: fakeFrom, rpc }),
  pub: () => ({ from: fakeFrom }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'Test HOD' }),
}));

import RaisePass from '../../src/pages/HOD/RaisePass';

function renderRaisePass() {
  return render(
    <MemoryRouter>
      <RaisePass />
    </MemoryRouter>
  );
}

/** Fill everything an RGP needs except the per-item return date. */
function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('Person authorized to collect material'), {
    target: { value: 'Ravi Kumar' },
  });
  fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: 'Drill' } });
  fireEvent.change(screen.getByPlaceholderText('Description (brand, model, details)'), {
    target: { value: 'Bosch GSB 13mm' },
  });
  fireEvent.change(screen.getByPlaceholderText('Reason for taking out'), {
    target: { value: 'Servicing' },
  });
  fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: '2' } });
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function raisePassArgs(): Record<string, unknown> {
  const call = rpc.mock.calls.find((c) => c[0] === 'raise_pass');
  if (!call) throw new Error('raise_pass was never called');
  return call[1] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  rpc.mockClear();
});

describe('RaisePass — serial number is gone', () => {
  it('renders no serial number input', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/serial/i)).not.toBeInTheDocument();
  });

  it('does not send serial_no in the raise_pass item payload', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();
    const due = futureDate(5);
    fireEvent.change(screen.getByLabelText('Return Date'), { target: { value: due } });
    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const items = raisePassArgs().p_items as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty('serial_no');
  });
});

describe('RaisePass — an RGP can actually be submitted', () => {
  it('submits with the per-item return date and derives the pass-level date from it', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();
    const due = futureDate(5);
    fireEvent.change(screen.getByLabelText('Return Date'), { target: { value: due } });

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const args = raisePassArgs();
    expect(args.p_type).toBe('RGP');
    expect(args.p_expected_return_date).toBe(due);
    const items = args.p_items as Record<string, unknown>[];
    expect(items[0].expected_return_date).toBe(due);
    expect(items[0].name).toBe('Drill');
    expect(items[0].quantity).toBe(2);

    await waitFor(() => expect(screen.getByText('Pass Submitted')).toBeInTheDocument());
  });

  it('uses the EARLIEST item return date as the pass-level date', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Item/ }));

    const names = screen.getAllByPlaceholderText('Item name');
    fireEvent.change(names[1], { target: { value: 'Ladder' } });
    fireEvent.change(screen.getAllByPlaceholderText('Description (brand, model, details)')[1], {
      target: { value: 'Aluminium 8ft' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Reason for taking out')[1], {
      target: { value: 'Repair' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Qty')[1], { target: { value: '1' } });

    const dates = screen.getAllByLabelText('Return Date');
    fireEvent.change(dates[0], { target: { value: futureDate(9) } });
    fireEvent.change(dates[1], { target: { value: futureDate(3) } });

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    expect(raisePassArgs().p_expected_return_date).toBe(futureDate(3));
  });

  it('blocks submit with a visible per-item error when an RGP line has no return date', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(screen.getByText(/return date is required/i)).toBeInTheDocument());
    expect(rpc).not.toHaveBeenCalledWith('raise_pass', expect.anything());
  });

  it('submits an NRGP with no return date at all', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /NRGP/ }));
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const args = raisePassArgs();
    expect(args.p_type).toBe('NRGP');
    expect(args.p_expected_return_date).toBeNull();
    expect((args.p_items as Record<string, unknown>[])[0].expected_return_date).toBeNull();
  });
});

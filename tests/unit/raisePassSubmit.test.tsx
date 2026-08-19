// RaisePass had two defects that together made an RGP unsubmittable, both
// from the same root cause: migration 019 moved the return date onto each
// item, but the form kept demanding (and never rendering) a pass-level
// field. Fixed on 2026-08-17 by moving to per-item dates end to end.
//
// 2026-08-19: the client reversed the decision — "the return date of all
// individual items in the pass should be the expected return date of the
// entire pass." The date is collected ONCE, on the pass, and every item in
// `p_items` is written with that same value. There is no per-item date
// input left at all.
//
// The client also asked, in the same pass, for a serial number on every
// line ("put the serial number against all the items, in both the
// passes") — `raise_pass` has always read `serial_no` off each element of
// `p_items`; the form simply never sent it. This file pins both.
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
    // A realistic slice of what `raise_pass` actually returns (a full
    // gate_passes row) — PassSubmittedModal reads status/direction/vehicle
    // off it now, not just the four fields this fixture used to carry.
    return thenable({
      data: {
        id: 'p1',
        pass_number: 'RGP-OUT-20260804-0001',
        type: 'RGP',
        direction: 'out',
        status: 'pending',
        visitor_name: 'Ravi',
        visitor_company: null,
        vehicle_number: 'WB01AB1234',
        created_at: '2026-08-04T10:00:00Z',
        total_quantity: 2,
      },
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

/** Fill everything an RGP needs except the pass-level return date. */
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

describe('RaisePass — serial number, on every line', () => {
  it('renders a Serial / ID input for every item row', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    expect(screen.getByLabelText('Serial / ID')).toBeInTheDocument();
  });

  it('sends a typed serial as serial_no, and an untouched line as null', async () => {
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

    const serials = screen.getAllByLabelText('Serial / ID');
    fireEvent.change(serials[0], { target: { value: 'SN-001' } });
    // serials[1] deliberately left untouched.

    const due = futureDate(5);
    fireEvent.change(screen.getByLabelText('Expected Return Date'), { target: { value: due } });
    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const items = raisePassArgs().p_items as Record<string, unknown>[];
    expect(items[0].serial_no).toBe('SN-001');
    expect(items[1].serial_no).toBeNull();
  });
});

describe('RaisePass — an RGP can actually be submitted', () => {
  it('submits with the pass-level return date, and every item carries the SAME date', async () => {
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

    const due = futureDate(5);
    fireEvent.change(screen.getByLabelText('Expected Return Date'), { target: { value: due } });

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const args = raisePassArgs();
    expect(args.p_type).toBe('RGP');
    expect(args.p_expected_return_date).toBe(due);
    const items = args.p_items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.expected_return_date === due)).toBe(true);
    expect(items[0].name).toBe('Drill');
    expect(items[0].quantity).toBe(2);

    await waitFor(() => expect(screen.getByText('Pass Submitted')).toBeInTheDocument());
  });

  it('blocks submit with a visible error when an RGP has no pass-level return date', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(screen.getByText(/return date is required/i)).toBeInTheDocument());
    expect(rpc).not.toHaveBeenCalledWith('raise_pass', expect.anything());
  });

  it('submits an NRGP with no return date at all, but still sends serials', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /NRGP/ }));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Serial / ID'), { target: { value: 'ASSET-42' } });

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const args = raisePassArgs();
    expect(args.p_type).toBe('NRGP');
    expect(args.p_expected_return_date).toBeNull();
    const items = args.p_items as Record<string, unknown>[];
    expect(items[0].expected_return_date).toBeNull();
    expect(items[0].serial_no).toBe('ASSET-42');
  });

  it('surfaces the blacklist refusal with the reason — the HOD learns WHY it was blocked', async () => {
    // The DB trigger (027/033) raises 'Blocked: company BSC is blacklisted
    // (company). Reason: not good' — that exact message must reach the form so
    // the HOD can tell a deliberate ban from a typo. safeErrorMessage passes
    // P0001 through verbatim; this pins the whole chain.
    rpc.mockImplementation((name: string) => {
      if (name === 'raise_pass') {
        return thenable({
          data: null,
          error: { message: 'Blocked: company BSC is blacklisted (company). Reason: not good' },
        });
      }
      return thenable({ data: [], error: null });
    });

    renderRaisePass();
    await waitFor(() => expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument());
    fillRequiredFields();
    fireEvent.change(screen.getByPlaceholderText('Vendor name'), { target: { value: 'BSC' } });
    const due = futureDate(5);
    fireEvent.change(screen.getByLabelText('Expected Return Date'), { target: { value: due } });

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => {
      expect(screen.getByText(/Blocked: company BSC is blacklisted \(company\)\. Reason: not good/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Pass Submitted')).not.toBeInTheDocument();
  });
});

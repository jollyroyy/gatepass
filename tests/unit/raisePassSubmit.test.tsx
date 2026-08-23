// RaisePass — the raise-form's submit flow and the RPC payload shape, drawn
// to the client's 2026-08-19 "Raise Gate Pass" mock-up: ONE pass-level purpose,
// one vendor with an auto-filled address, and an item table with make/model,
// serial, invoice, remarks and — on an RGP — ITS OWN RETURN DATE per line, but
// a UNIT picked per line (client, 2026-08-20 — it defaults to `nos`).
//
// The pass-level `p_expected_return_date` is the EARLIEST of the line dates
// (`earliestReturnDate`): a pass is overdue as soon as its first line is.
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

/** Set by the blacklist case only, and reset every test — `rpc`'s implementation
 *  is shared across the file, so a lingering override from one test would
 *  otherwise leak into every test that runs after it. */
let raiseError: { message: string } | null = null;

const rpc = vi.fn((name: string) => {
  if (name === 'raise_pass') {
    if (raiseError) return thenable({ data: null, error: raiseError });
    return thenable({
      data: {
        id: 'p1',
        pass_number: 'RGP-20260804-0001',
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

function typeVendor(name: string) {
  fireEvent.change(screen.getByLabelText('Vendor Name'), { target: { value: name } });
}

function fillFirstItem(name: string, makeModel: string, qty: string) {
  fireEvent.change(screen.getAllByLabelText('Item Description')[0], { target: { value: name } });
  fireEvent.change(screen.getAllByLabelText('Make / Model / Size')[0], { target: { value: makeModel } });
  fireEvent.change(screen.getAllByLabelText('Quantity')[0], { target: { value: qty } });
}

function fillAllRequired() {
  typeVendor('Acme Co');
  fireEvent.change(screen.getByLabelText(/Person Who Will Carry/), { target: { value: 'Ravi Kumar' } });
  fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '+91' } });
  fireEvent.change(screen.getByPlaceholderText('Enter mobile number'), { target: { value: '9876543210' } });
  fireEvent.change(screen.getByLabelText(/Purpose \/ Description/), { target: { value: 'Servicing' } });
  fillFirstItem('Drill', 'Bosch GSB 13mm', '2');
  // Second (blank) starter row.
  fireEvent.change(screen.getAllByLabelText('Item Description')[1], { target: { value: 'Ladder' } });
  fireEvent.change(screen.getAllByLabelText('Make / Model / Size')[1], { target: { value: 'Aluminium 8ft' } });
  fireEvent.change(screen.getAllByLabelText('Quantity')[1], { target: { value: '1' } });
}

/** Every RGP line needs a date of its own now. Takes one date per row. */
function setItemDates(dates: string[]) {
  const inputs = screen.getAllByLabelText('Expected Return Date');
  dates.forEach((d, i) => fireEvent.change(inputs[i], { target: { value: d } }));
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
  raiseError = null;
});

describe('RaisePass — serial number and the item table, on every line', () => {
  it('renders a Serial / Asset Tag input for every item row', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    expect(screen.getAllByLabelText('Serial / Asset Tag')).toHaveLength(2);
  });

  it('sends a typed serial as serial_no, and an untouched line as null', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fillAllRequired();

    const serials = screen.getAllByLabelText('Serial / Asset Tag');
    fireEvent.change(serials[0], { target: { value: 'SN-001' } });
    // serials[1] deliberately left untouched.

    setItemDates([futureDate(5), futureDate(5)]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const items = raisePassArgs().p_items as Record<string, unknown>[];
    expect(items[0].serial_no).toBe('SN-001');
    expect(items[1].serial_no).toBeNull();
  });
});

describe('RaisePass — the unit the HOD picked is what the pass is raised in', () => {
  it('sends each line its own unit', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fillAllRequired();

    const units = screen.getAllByLabelText('Unit');
    fireEvent.change(units[0], { target: { value: 'lot' } });
    fireEvent.change(units[1], { target: { value: 'kg' } });
    // A measured unit takes a fraction — and the submit must accept it.
    fireEvent.change(screen.getAllByLabelText('Quantity')[1], { target: { value: '2.5' } });

    setItemDates([futureDate(5), futureDate(5)]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const items = raisePassArgs().p_items as Record<string, unknown>[];
    expect(items[0].unit).toBe('lot');
    expect(items[1].unit).toBe('kg');
    expect(items[1].quantity).toBe(2.5);
  });
});

describe('RaisePass — an RGP can actually be submitted', () => {
  it('sends each line its own return date, and the pass takes the EARLIEST', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fillAllRequired();

    const later = futureDate(9);
    const sooner = futureDate(3);
    // Deliberately out of order — the pass must take the earlier of the two,
    // whichever row it was typed into.
    setItemDates([later, sooner]);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('raise_pass', expect.anything()));
    const args = raisePassArgs();
    expect(args.p_type).toBe('RGP');
    expect(args.p_expected_return_date).toBe(sooner);
    expect(args.p_purpose).toBe('Servicing');
    const items = args.p_items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0].expected_return_date).toBe(later);
    expect(items[1].expected_return_date).toBe(sooner);
    expect(items[0].name).toBe('Drill');
    expect(items[0].quantity).toBe(2);
    // Untouched select → the default, which is what every line raised between
    // 2026-08-19 and 2026-08-20 carries.
    expect(items[0].unit).toBe('nos');
    expect(items[0].make_model).toBe('Bosch GSB 13mm');

    await waitFor(() => expect(screen.getByText('Pass Submitted')).toBeInTheDocument());
  });

  it('blocks submit with a visible error when an RGP line has no return date', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fillAllRequired();

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    // One error per LINE — both rows are missing a date, and each says so under
    // its own input rather than once at the top of a table nobody scrolls back up.
    await waitFor(() => expect(screen.getAllByText(/return date is required/i)).toHaveLength(2));
    expect(rpc).not.toHaveBeenCalledWith('raise_pass', expect.anything());
  });

  it('submits an NRGP with no return date at all, but still sends serials', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fireEvent.click(screen.getByRole('radio', { name: /NRGP/ }));
    fillAllRequired();
    fireEvent.change(screen.getAllByLabelText('Serial / Asset Tag')[0], { target: { value: 'ASSET-42' } });
    // An NRGP draws no date column at all — nothing comes back.
    expect(screen.queryAllByLabelText('Expected Return Date')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

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
    raiseError = { message: 'Blocked: company BSC is blacklisted (company). Reason: not good' };

    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    fillAllRequired();
    setItemDates([futureDate(5), futureDate(5)]);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => {
      expect(screen.getByText(/Blocked: company BSC is blacklisted \(company\)\. Reason: not good/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Pass Submitted')).not.toBeInTheDocument();
  });
});

describe('RaisePass — the mock-up\'s Vendor Details section', () => {
  it('the vendor name and address are plain text inputs, not tied to a saved-vendor picker', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));

    fireEvent.change(screen.getByLabelText('Vendor Name'), { target: { value: 'Acme Co' } });
    fireEvent.change(screen.getByLabelText('Vendor Address'), { target: { value: '9 New Road' } });

    expect(screen.getByLabelText('Vendor Name')).toHaveValue('Acme Co');
    expect(screen.getByLabelText('Vendor Address')).toHaveValue('9 New Road');
    expect((screen.getByLabelText('Vendor Address') as HTMLInputElement).readOnly).toBe(false);
  });
});

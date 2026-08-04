// BulkCreate must behave like RaisePass but for N passes: every field the RPC
// accepts must have an editable input, no value may be baked into the submit
// call, and NRGP must hide the return-date controls. These tests pin that down.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  for (const m of ['in', 'eq', 'order', 'limit']) obj[m] = () => thenable(result);
  return obj;
}

const TABLE_DATA: Record<string, { data: unknown; error: unknown }> = {
  hod_departments: { data: [{ department_id: 'd1' }], error: null },
  departments: { data: [{ id: 'd1', name: 'IT', code: 'IT' }], error: null },
};

function fakeFrom(table: string) {
  return { select: () => thenable(TABLE_DATA[table] ?? { data: [], error: null }) };
}

const rpcMock = vi.fn(() => thenable({ data: [], error: null }));

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: fakeFrom, rpc: rpcMock }),
  pub: () => ({ from: fakeFrom }),
}));

import BulkRaise from '../../src/pages/HOD/BulkRaise';

function renderBulk() {
  return render(
    <MemoryRouter>
      <BulkRaise />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BulkRaise — every field is editable, nothing hardcoded', () => {
  it('starts with an empty Name Prefix, not a baked-in "Worker"', () => {
    renderBulk();
    const input = screen.getByLabelText('Name Prefix') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('accepts typed edits in Name Prefix and Number of Passes', async () => {
    renderBulk();
    const name = screen.getByLabelText('Name Prefix') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Contractor Staff' } });
    expect(name.value).toBe('Contractor Staff');

    const count = screen.getByLabelText('Number of Passes') as HTMLInputElement;
    fireEvent.change(count, { target: { value: '12' } });
    expect(count.value).toBe('12');
  });

  it('renders editable Contact Number and Company Address fields', () => {
    renderBulk();
    const phone = screen.getByLabelText('Contact Number') as HTMLInputElement;
    const address = screen.getByLabelText('Company Address') as HTMLTextAreaElement;
    expect(phone).toBeInTheDocument();
    expect(address).toBeInTheDocument();
    fireEvent.change(phone, { target: { value: '9876543210' } });
    fireEvent.change(address, { target: { value: '2F, Quest Mall' } });
    expect(phone.value).toBe('9876543210');
    expect(address.value).toBe('2F, Quest Mall');
  });

  it('sends the typed values to bulk_create_passes — no hardcoded direction/unit/count', async () => {
    renderBulk();
    // Flush the async department lookup so department_id is populated.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText('Name Prefix'), { target: { value: 'Staff' } });
    fireEvent.change(screen.getByLabelText('Number of Passes'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Contact Number'), { target: { value: '555' } });
    fireEvent.change(screen.getByLabelText('Company Address'), { target: { value: 'Street 1' } });
    fireEvent.change(screen.getByLabelText('Vehicle Number'), { target: { value: 'WB-01' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Event setup' } });
    fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: 'Cable' } });
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'HDMI 2m' } });
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'metre' } });

    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const call = rpcMock.mock.calls[0];
    const fn = call[0];
    const params = call[1];
    expect(fn).toBe('bulk_create_passes');
    expect(params.p_name_prefix).toBe('Staff');
    expect(params.p_count).toBe(3);
    expect(params.p_direction).toBe('out');
    expect(params.p_vehicle_number).toBe('WB-01');
    expect(params.p_purpose).toBe('Event setup');
    const company = JSON.parse(params.p_visitor_company);
    expect(company.n).toBe('Acme');
    expect(company.v).toBe('555');
    expect(company.a).toBe('Street 1');
    expect(params.p_items[0]).toMatchObject({
      name: 'Cable',
      description: 'HDMI 2m',
      quantity: 4,
      unit: 'metre',
    });
  });

  it('shows return-date controls for RGP and hides them for NRGP', async () => {
    const { container } = renderBulk();
    fireEvent.change(screen.getByLabelText('Pass Type'), { target: { value: 'RGP' } });
    await waitFor(() => expect(screen.getByLabelText('Expected Return Date')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Pass Type'), { target: { value: 'NRGP' } });
    await waitFor(() => expect(screen.queryByLabelText('Expected Return Date')).not.toBeInTheDocument());
    expect(container.querySelectorAll('input[type="date"]').length).toBe(0);
  });

  it('rejects a missing Name Prefix and an out-of-range count', async () => {
    renderBulk();
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText(/Name prefix is required/i)).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

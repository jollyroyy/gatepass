// NRGP is outward-only, permanent material — nothing ever comes back, so it
// has no return date to set (see requiresReturnDate() in lib/passTypes.ts).
// RaisePass must hide the Expected Return Date the moment NRGP is selected,
// not just for the RGP-only backend validation that already existed.
//
// 2026-08-19 (second instruction the same day): the date is PER ITEM again
// (client: "we would expect a date of return against each item in the RGP
// form"), so there is one input PER ROW to show or hide — and the whole column,
// header included, goes with them.
//
// This file also holds the two other things the client asked for on that pass:
// the read-only Reference Number at the top, and the absence of the Department
// field ("no need to show the department because it will be automatically
// captured").
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

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: fakeFrom, rpc: () => thenable({ data: [], error: null }) }),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RaisePass — return date visibility by pass type', () => {
  it('shows one Expected Return Date input per item row for RGP (the default type)', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));

    // Two starter rows, two dates — and no THIRD date anywhere, which is what
    // would appear if a pass-level field had been left behind beside them.
    expect(screen.getAllByLabelText('Expected Return Date')).toHaveLength(2);
    expect(document.querySelectorAll('input[type="date"]').length).toBe(2);
  });

  it('the column grows with the table', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /Add Another Item/ }));
    await waitFor(() => expect(screen.getAllByLabelText('Expected Return Date')).toHaveLength(3));
  });

  it('hides every Expected Return Date input, and its header, once NRGP is selected', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Expected Return Date')).toHaveLength(2));

    fireEvent.click(screen.getByRole('radio', { name: /NRGP/ }));

    await waitFor(() => expect(screen.queryAllByLabelText('Expected Return Date')).toHaveLength(0));
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
    expect(screen.queryByText('Expected Return Date')).not.toBeInTheDocument();
  });
});

describe('RaisePass — the reference number, and the department that is not asked for', () => {
  it('shows the pass reference read-only, and re-prefixes it when the type changes', async () => {
    renderRaisePass();
    const ref = await screen.findByLabelText('Reference Number');

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect((ref as HTMLInputElement).value).toBe(`RGP-${today}-####`);
    expect((ref as HTMLInputElement).readOnly).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /NRGP/ }));
    await waitFor(() =>
      expect((screen.getByLabelText('Reference Number') as HTMLInputElement).value).toBe(`NRGP-${today}-####`),
    );
  });

  it('asks for no department at all — it is captured from the HOD', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));

    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
    expect(screen.queryByText('Department')).not.toBeInTheDocument();
  });
});

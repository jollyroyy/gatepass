// NRGP is outward-only, permanent material — nothing ever comes back, so it
// has no return date to set (see requiresReturnDate() in lib/passTypes.ts).
// RaisePass must hide the pass-level Expected Return Date field the moment
// NRGP is selected, not just for the RGP-only backend validation that
// already existed.
//
// 2026-08-19: the date is pass-level again, not per item (client: "the
// return date of all individual items in the pass should be the expected
// return date of the entire pass"), so there is exactly ONE such input to
// show or hide.
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
  it('shows exactly one Expected Return Date input for RGP (the default type)', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByLabelText('Expected Return Date')).toBeInTheDocument());
    expect(document.querySelectorAll('input[type="date"]').length).toBe(1);
  });

  it('hides the Expected Return Date input once NRGP is selected', async () => {
    renderRaisePass();
    await waitFor(() => expect(screen.getByLabelText('Expected Return Date')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /NRGP/ }));

    await waitFor(() => expect(screen.queryByLabelText('Expected Return Date')).not.toBeInTheDocument());
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });
});

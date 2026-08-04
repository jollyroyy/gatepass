// NRGP is outward-only, permanent material — nothing ever comes back, so it
// has no return date to set (see requiresReturnDate() in lib/passTypes.ts).
// RaisePass must hide the Return Date card and each item's per-item return
// date input the moment NRGP is selected, not just for the RGP-only backend
// validation that already existed.
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
  it('shows the Return Date card and a per-item return date input for RGP (the default type)', async () => {
    const { container } = renderRaisePass();
    await waitFor(() => expect(screen.getByText('Return Date')).toBeInTheDocument());
    expect(container.querySelectorAll('input[type="date"]').length).toBeGreaterThan(0);
  });

  it('hides the Return Date card and every per-item return date input once NRGP is selected', async () => {
    const { container } = renderRaisePass();
    await waitFor(() => expect(screen.getByText('Return Date')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /NRGP/ }));

    await waitFor(() => expect(screen.queryByText('Return Date')).not.toBeInTheDocument());
    expect(container.querySelectorAll('input[type="date"]').length).toBe(0);
  });
});

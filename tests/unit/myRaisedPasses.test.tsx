// "PASSES I RAISED" — THE COO'S OR CEO'S OWN REGISTER (migration 069).
//
// Client, 2026-08-31: the COO and the CEO may raise a pass "on behalf of any
// department". `MyRaisedPasses` is the other half of that: an office holder
// heads no department, so no board of theirs otherwise lists a pass they
// raised — `gate_passes_select` admits it only through 069's
// `raised_by = auth.uid()` arm, and their approval queue lists what is routed
// TO them, not what they themselves raised. Without this page such a pass is
// unreachable the moment the confirmation modal closes.
//
// Split from officeRaisesPass.test.tsx to keep both files under the 300-line
// cap.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, bad),
  };
  for (const m of ['select', 'eq', 'order', 'limit']) obj[m] = () => obj;
  return obj;
}

// The exact query `MyRaisedPasses` must issue: `.from('v_gate_passes')`
// filtered by `raised_by` = the signed-in user, newest first. Recorded here
// rather than merely stubbed, so a change to the query shape (a dropped
// `.eq('raised_by', …)`, a swapped table) fails the assertions below instead
// of silently passing on whatever the mock happens to return.
const calls: { table: string; method: string; args: unknown[] }[] = [];
let rows: Partial<GatePassView>[] = [];

function trackingFrom(table: string) {
  const chain = {
    select: (...a: unknown[]) => { calls.push({ table, method: 'select', args: a }); return chain; },
    eq: (...a: unknown[]) => { calls.push({ table, method: 'eq', args: a }); return chain; },
    order: (...a: unknown[]) => { calls.push({ table, method: 'order', args: a }); return chain; },
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(ok, bad),
  };
  return chain;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: trackingFrom }),
  pub: () => ({ from: () => thenable({ data: [], error: null }) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-ceo' } } }) } },
}));

import MyRaisedPasses from '../../src/pages/Approver/MyRaisedPasses';

function renderPage() {
  return render(
    <MemoryRouter>
      <MyRaisedPasses />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rows = [];
});

describe('MyRaisedPasses — the register a raising office needs to see its own passes at all', () => {
  it('queries v_gate_passes filtered by raised_by = the signed-in user, newest first', async () => {
    rows = [
      {
        id: 'p1', pass_number: 'RGP-IT-0001', raised_by: 'u-ceo', created_at: '2026-08-31T10:00:00Z',
        status: 'pending', type: 'RGP', direction: 'out',
      } as GatePassView,
    ];
    renderPage();
    await waitFor(() => expect(screen.getByText(/RGP-IT-0001/)).toBeInTheDocument());

    expect(calls.some((c) => c.table === 'v_gate_passes' && c.method === 'select')).toBe(true);
    expect(calls.some((c) => c.table === 'v_gate_passes' && c.method === 'eq' && c.args[0] === 'raised_by' && c.args[1] === 'u-ceo')).toBe(true);
    expect(calls.some((c) => c.table === 'v_gate_passes' && c.method === 'order' && c.args[0] === 'created_at')).toBe(true);
  });

  it('renders one card per row', async () => {
    rows = [
      {
        id: 'p1', pass_number: 'RGP-IT-0001', raised_by: 'u-ceo', created_at: '2026-08-31T10:00:00Z',
        status: 'pending', type: 'RGP', direction: 'out',
      } as GatePassView,
      {
        id: 'p2', pass_number: 'NRGP-MKT-0002', raised_by: 'u-ceo', created_at: '2026-08-30T10:00:00Z',
        status: 'matched', type: 'NRGP', direction: 'out',
      } as GatePassView,
    ];
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('pass-stack-card')).toHaveLength(2));
    expect(screen.getByText(/RGP-IT-0001/)).toBeInTheDocument();
    expect(screen.getByText(/NRGP-MKT-0002/)).toBeInTheDocument();
  });

  it('shows an empty state when the office holder has raised nothing yet', async () => {
    rows = [];
    renderPage();
    await waitFor(() => expect(screen.getByText('You have not raised a gate pass yet.')).toBeInTheDocument());
    expect(screen.queryAllByTestId('pass-stack-card')).toHaveLength(0);
  });
});

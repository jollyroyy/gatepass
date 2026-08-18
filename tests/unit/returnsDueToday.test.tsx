// /returns — Returns Due Today, where every board's "due today" figure lands.
//
// TODAY IS THE DATABASE'S TODAY: the page filters on `due_state`, computed in
// `v_gate_passes` against `site_tz()`. Nothing here compares a date to the
// browser clock, and this spec fails if anyone makes it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-0001', type: 'RGP', direction: 'out', status: 'matched',
    return_status: 'awaiting_return', department_id: 'd1', department_name: 'Engineering',
    visitor_name: 'Rohan Sharma', expected_return_date: '2026-08-18', due_state: 'due_today',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Bosch Drill', quantity: 1, unit: 'nos',
    returned_qty: 0, outstanding_qty: 1, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PASSES = [
  pass({}),
  pass({ id: 'p2', pass_number: 'RGP-OUT-0002', expected_return_date: '2026-07-01', due_state: 'overdue' }),
];
const ITEMS = [item({}), item({ id: 'i2', gate_pass_id: 'p2', name: 'Cable Coil' })];

const eqCalls: { col: string; value: unknown }[] = [];

function builder(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o: any = {};
  for (const m of ['select', 'in', 'order']) o[m] = () => o;
  o.eq = (col: string, value: unknown) => { eqCalls.push({ col, value }); return o; };
  o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data: table === 'v_gate_pass_items' ? ITEMS : PASSES, error: null }).then(ok, err);
  return o;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (t: string) => builder(t),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import ReturnsDueTodayPage from '../../src/pages/Shared/ReturnsDueTodayPage';

function renderPage(role: 'guard' | 'hod' | 'admin') {
  return render(
    <MemoryRouter>
      <ReturnsDueTodayPage role={role} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  eqCalls.length = 0;
  vi.clearAllMocks();
});

describe('Returns Due Today', () => {
  it("lists today's lines and leaves an overdue one to the Overdue page", async () => {
    renderPage('guard');
    await waitFor(() => expect(screen.getByText('Bosch Drill')).toBeInTheDocument());
    expect(screen.queryByText('Cable Coil')).not.toBeInTheDocument();
  });

  it('lets the gate record a return', async () => {
    renderPage('guard');
    await waitFor(() => expect(screen.getByText('Bosch Drill')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Mark returned' })).toBeInTheDocument();
  });

  it('is read-only for an HOD and an admin — apply_item_returns refuses them', async () => {
    renderPage('admin');
    await waitFor(() => expect(screen.getByText('Bosch Drill')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Mark returned' })).not.toBeInTheDocument();
  });

  it("scopes an HOD to their own passes SERVER-side, and does not scope a guard", async () => {
    renderPage('hod');
    await waitFor(() => expect(screen.getByText('Bosch Drill')).toBeInTheDocument());
    expect(eqCalls.some((c) => c.col === 'raised_by' && c.value === 'u1')).toBe(true);

    eqCalls.length = 0;
    renderPage('guard');
    await waitFor(() => expect(screen.getAllByText('Bosch Drill').length).toBeGreaterThan(0));
    expect(eqCalls.some((c) => c.col === 'raised_by')).toBe(false);
  });
});

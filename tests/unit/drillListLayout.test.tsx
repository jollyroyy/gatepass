// DRILL_CARD_SPEC.md Rule 2: "The drill list is a vertical stack of full-width
// rows... never a 2-up or 3-up grid." GuardDashboard used to render its drill
// cards in `grid grid-cols-1 md:grid-cols-2`; this pins the fix.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260810-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const RAISED_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending' }),
  pass({ id: 'p2', pass_number: 'PEND-0002', status: 'pending' }),
];

function builder() {
  let axis: 'created_at' | 'verified_at' | 'return_status' | 'status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt']) obj[m] = () => obj;
  // `expires_at` rides along with the gate queue's `.in('status', …)` — only a
  // day axis selects a set, so it must not overwrite one.
  obj.gte = (col: string) => { if (col !== 'expires_at') axis = col as typeof axis; return obj; };
  obj.eq = (col: string) => { if (col === 'return_status') axis = 'return_status'; return obj; };
  obj.in = (col: string) => {
    if (col === 'return_status') axis = 'return_status';
    if (col === 'status') axis = 'status';
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    // The pending drill reads the gate queue now (its own query), not the
    // day-scoped raises.
    const data = axis === 'created_at' || axis === 'status' ? RAISED_TODAY : [];
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => builder(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: () => ({ then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) }),
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GuardDashboard drill list — full-width vertical stack, never a grid', () => {
  it('renders the revealed cards in a flex column, not a multi-column grid', async () => {
    render(
      <MemoryRouter>
        <GuardDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    const card = screen.getByText('PEND-0001').closest('[data-testid="pass-card-header"]')!;
    // Walk up to the list container (the flex/grid wrapper GuardDashboard renders).
    const listContainer = card.parentElement!.parentElement!.parentElement!;
    expect(listContainer.className).toMatch(/flex-col/);
    expect(listContainer.className).not.toMatch(/grid-cols-2/);
  });
});

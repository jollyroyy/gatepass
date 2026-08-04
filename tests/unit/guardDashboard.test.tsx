// The guard view was one screen doing two jobs: a KPI board and the working
// queue, with a full-width lookup form wedged between them. Now:
//   * Dashboard (first sidebar tab) owns every number, and each KPI is a drill —
//     clicking it lists the matching passes as premium cards on the SAME page.
//   * Gate Console is purely the queue, with a compact lookup on the right.
//   * Pending Returns is gone as a tab. Its two numbers are drills on the
//     dashboard, and — critically — the Mark Returned action moved onto the
//     drill cards. Deleting the tab without moving that action would have left
//     a guard no way to close an RGP at all.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES } from '../../src/lib/roleRoutes';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 2, total_quantity: 3, returned_quantity: 0,
    material_summary: 'Drill, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Raised today: one of each category, plus an outstanding and an overdue RGP.
const RAISED_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending', type: 'RGP', direction: 'out' }),
  pass({ id: 'i1', pass_number: 'RGPIN-0001', status: 'pending', type: 'RGP', direction: 'in' }),
  pass({ id: 'n1', pass_number: 'NRGP-0001', status: 'pending', type: 'NRGP', direction: 'out' }),
  pass({ id: 'a1', pass_number: 'AWAIT-0001', status: 'matched', type: 'RGP', direction: 'out',
         return_status: 'awaiting_return', expected_return_date: '2026-09-01' }),
  pass({ id: 'o1', pass_number: 'OVER-0001', status: 'matched', type: 'RGP', direction: 'out',
         return_status: 'awaiting_return', expected_return_date: '2026-07-01', is_overdue: true }),
];

// Verified today — a separate axis, because a pass raised yesterday and matched
// this morning is still this shift's work.
const VERIFIED_TODAY: GatePassView[] = [
  pass({ id: 'm1', pass_number: 'MTCH-0001', status: 'matched', verified_at: new Date().toISOString() }),
  pass({ id: 'f1', pass_number: 'FLAG-0001', status: 'flagged', flag_reason: 'Qty short',
         verified_at: new Date().toISOString() }),
];

/** Query builder mock: the dashboard now issues exactly two day-scoped
 *  queries — .gte('created_at', today) and .gte('verified_at', today) — and
 *  filters every drill out of those two sets client-side. */
function builder() {
  let axis: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'lte', 'eq']) obj[m] = () => obj;
  obj.gte = (col: string) => { axis = col; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = axis === 'verified_at' ? VERIFIED_TODAY : RAISED_TODAY;
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

const markReturned = vi.fn(() => Promise.resolve({ data: null, error: null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => builder(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: any) => {
      if (name === 'mark_returned') return markReturned(name, args) as never;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) };
      return t;
    },
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';
import GateConsole from '../../src/pages/Security/GateConsole';

function renderAt(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Guard navigation', () => {
  it('lists Dashboard first and Gate Console second', () => {
    const guardLinks = ALL_LINKS.filter((n) => n.roles.includes('guard')).map((n) => n.label);
    expect(guardLinks[0]).toBe('Dashboard');
    expect(guardLinks[1]).toBe('Gate Console');
  });

  it('no longer offers a Pending Returns tab', () => {
    const guardLinks = ALL_LINKS.filter((n) => n.roles.includes('guard')).map((n) => n.label);
    expect(guardLinks).not.toContain('Pending Returns');
  });

  it('drops /returns from the guard route list and allows the new dashboard', () => {
    expect(ROLE_ROUTES.guard).not.toContain('/returns');
    expect(ROLE_ROUTES.guard).toContain('/guard-dashboard');
  });
});

describe('GuardDashboard — KPI drills', () => {
  it('renders every gate KPI, including the two that came from Pending Returns', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('Pending for Gate Approval')).toBeInTheDocument());
    // "Successful Gate Passes" — every pass the gate cleared today, any type
    // or direction. `matched` is the status match_pass sets, so it IS success.
    expect(screen.getByText('Successful Gate Passes')).toBeInTheDocument();
    expect(screen.getByText('Mismatch at Gate')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Return')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it("shows today's movement counters for all three legal categories", async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('RGP Out')).toBeInTheDocument());
    expect(screen.getByText('RGP In')).toBeInTheDocument();
    expect(screen.getByText('NRGP Out')).toBeInTheDocument();
  });

  it('says out loud that the board is today-only', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText(/resets at midnight/i)).toBeInTheDocument());
  });

  it('drills into RGP In and shows only the inbound returnable pass', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('RGP In'));

    await waitFor(() => expect(screen.getByText('RGPIN-0001')).toBeInTheDocument());
    expect(screen.queryByText('NRGP-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();
  });

  it('shows the pending passes below by default', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // Pending covers every category raised today, not just RGP Out.
    expect(screen.getByText('RGPIN-0001')).toBeInTheDocument();
    expect(screen.getByText('NRGP-0001')).toBeInTheDocument();
  });

  it('swaps the card list when another KPI is clicked', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mismatch at Gate'));

    await waitFor(() => expect(screen.getByText('FLAG-0001')).toBeInTheDocument());
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();
  });

  it('shows full pass detail on the drill cards', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // The pending drill legitimately holds several cards, so match on count.
    expect(screen.getAllByText('Ravi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WB01AB1234').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drill, Ladder').length).toBeGreaterThan(0);
  });

  it('offers Mark Returned on the Awaiting Return drill and calls the RPC', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Awaiting Return'));
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());

    // Both the outstanding and the overdue RGP are awaiting return, so there
    // is a Mark Returned button per card — act on the first.
    fireEvent.click(screen.getAllByRole('button', { name: /mark returned/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /confirm return/i }));

    await waitFor(() => expect(markReturned).toHaveBeenCalled());
    expect(markReturned.mock.calls[0][0]).toBe('mark_returned');
  });

  it('does not offer Mark Returned on the pending drill — nothing has left yet', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /mark returned/i })).not.toBeInTheDocument();
  });
});

describe('GateConsole — queue only, with the lookup on the right', () => {
  it('no longer renders the KPI cards', async () => {
    renderAt(<GateConsole />);
    await waitFor(() => expect(screen.getByText('Gate Console')).toBeInTheDocument());
    expect(screen.queryByText('Successful Gate Passes')).not.toBeInTheDocument();
    expect(screen.queryByText('Mismatch at Gate')).not.toBeInTheDocument();
  });

  it('still renders the pass lookup, constrained rather than full width', async () => {
    const { container } = renderAt(<GateConsole />);
    await waitFor(() => expect(screen.getByLabelText('Find a Pass')).toBeInTheDocument());
    const lookup = container.querySelector('[data-testid="gate-lookup"]');
    expect(lookup).not.toBeNull();
    expect(lookup?.className).toMatch(/max-w-/);
  });
});

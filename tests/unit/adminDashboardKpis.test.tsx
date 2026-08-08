// Admin Dashboard is today-only (2026-08-08): every dashboard in this app
// shows only today's data, historical data lives in Reports (/all-passes).
// There is no per-day `kpis()` RPC, so the page reads `v_gate_passes` rows
// directly and derives every KPI from a client-side today filter. This file
// covers both halves of an earlier move: the Dashboard's KPI cards, and
// AllPassesReport's now-removed status tab group (the Status column stays).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  for (const m of ['in', 'eq', 'order', 'limit', 'select']) {
    obj[m] = () => thenable(result);
  }
  return obj;
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x',
    pass_number: 'RGP-OUT-20260808-0001',
    type: 'RGP',
    direction: 'out',
    status: 'matched',
    return_status: 'not_applicable',
    department_id: 'd1',
    department_name: 'IT',
    department_code: 'IT',
    raised_by: 'u1',
    raised_by_name: 'HOD One',
    visitor_name: 'Alice',
    visitor_company: null,
    vehicle_number: null,
    purpose: null,
    expected_return_date: null,
    actual_return_date: null,
    verified_by: null,
    verified_by_name: null,
    verified_at: null,
    flag_reason: null,
    qr_token: 't',
    expires_at: null,
    created_at: new Date().toISOString(),
    is_overdue: false,
    is_expired: false,
    due_state: 'not_applicable',
    item_count: 1,
    total_quantity: 1,
    returned_quantity: 0,
    material_summary: 'Bolts',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const TODAY = new Date().toISOString();
const SEVERAL_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// Seeded fixture: 3 rows raised today (one awaiting, one overdue-and-awaiting,
// one already returned), plus one raised several days ago that must be
// excluded from every KPI entirely. Names distinguish rows in drill lists.
const ROWS: GatePassView[] = [
  pass({ id: 'today-awaiting', visitor_name: 'Alice', created_at: TODAY, return_status: 'awaiting_return', is_overdue: false }),
  pass({ id: 'today-overdue', visitor_name: 'Bob', created_at: TODAY, return_status: 'partially_returned', is_overdue: true }),
  pass({ id: 'today-returned', visitor_name: 'Carol', created_at: TODAY, return_status: 'returned', is_overdue: false }),
  pass({ id: 'old-pass', visitor_name: 'Dave', created_at: SEVERAL_DAYS_AGO, return_status: 'awaiting_return', is_overdue: true }),
];

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => ({ select: () => thenable({ data: ROWS, error: null }) }),
  }),
}));

import AdminDashboard from '../../src/pages/Admin/AdminDashboard';
import AllPassesReport from '../../src/pages/Admin/AllPassesReport';

describe('AdminDashboard defaults to Today and offers a period control', () => {
  it('renders a Dashboard period control defaulting to Today, with a pointer to Reports for older data', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('group', { name: 'Dashboard period' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/all-passes');
  });

  it('selecting Yearly includes the pass raised several days ago', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('4'));
    // old-pass is awaiting_return + is_overdue, so both KPIs pick up +1 too —
    // every number is still derived from the one scoped array.
    expect(screen.getByText('Awaiting Return').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Overdue').nextSibling).toHaveTextContent('2');
  });

  it('excludes a pass raised several days ago and includes today\'s rows in Total', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
    // 3 of the 4 seeded rows are today's; the 4-day-old row must not count.
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));
  });

  it('matches the seeded today-only fixture exactly for every KPI', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    // Awaiting Return: today-awaiting + today-overdue (both open return states).
    expect(screen.getByText('Awaiting Return').nextSibling).toHaveTextContent('2');
    // Overdue: only today-overdue is both open AND is_overdue.
    expect(screen.getByText('Overdue').nextSibling).toHaveTextContent('1');
    // Return Rate: all 3 today rows are returnable (return_status !== not_applicable),
    // 1 of them is returned → 33%.
    expect(screen.getByText('Return Rate').nextSibling).toHaveTextContent('33%');
  });
});

describe('Admin Dashboard KPIs are drills', () => {
  function renderAdmin() {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
  }

  it('renders every KPI card as a clickable button, unpressed initially', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    const card = (label: RegExp) => screen.getByRole('button', { name: label });
    expect(card(/Total/)).toHaveAttribute('aria-pressed', 'false');
    expect(card(/Awaiting Return/)).toHaveAttribute('aria-pressed', 'false');
    expect(card(/Return Rate/)).toHaveAttribute('aria-pressed', 'false');
    expect(card(/Overdue/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Total opens the exact rows it counted, and only those', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: /Total/ }));
    expect(screen.getByText('All passes raised')).toBeInTheDocument();
    expect(screen.getByText('3 passes')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    // The pass raised several days ago is outside the Today scope — its list
    // must not show it either (the card value IS this list's length).
    expect(screen.queryByText('Dave')).not.toBeInTheDocument();
  });

  it('clicking Awaiting Return lists the two open passes, excluding returned and stale', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: /Awaiting Return/ }));
    expect(screen.getByText('Still out')).toBeInTheDocument();
    expect(screen.getByText('2 passes')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    expect(screen.queryByText('Dave')).not.toBeInTheDocument();
  });

  it('clicking Overdue lists only the overdue open pass', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
    expect(screen.getByText('Past their return date')).toBeInTheDocument();
    expect(screen.getByText('1 pass')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('clicking Return Rate drills into the returned passes behind the percentage', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: /Return Rate/ }));
    expect(screen.getByText('Returned in this period')).toBeInTheDocument();
    expect(screen.getByText('1 pass')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('marks the selected drill pressed and toggles it shut on a second click', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    const total = screen.getByRole('button', { name: /Total/ });
    fireEvent.click(total);
    expect(total).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('All passes raised')).toBeInTheDocument();

    fireEvent.click(total);
    expect(screen.queryByText('All passes raised')).not.toBeInTheDocument();
    expect(total).toHaveAttribute('aria-pressed', 'false');
  });

  it('opening a second drill replaces the first list', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Total').nextSibling).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: /Total/ }));
    expect(screen.getByText('3 passes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
    expect(screen.queryByText('3 passes')).not.toBeInTheDocument();
    expect(screen.getByText('Past their return date')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});

const ROW_A = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260730-0001',
  type: 'RGP',
  department_id: 'd1',
  department_name: 'IT',
  visitor_name: 'Alice',
  material_summary: 'Bolts',
  item_count: 2,
  total_quantity: 10,
  status: 'pending',
  raised_by_name: 'HOD One',
  created_at: '2026-07-29T10:00:00Z',
  vehicle_number: null,
  is_expired: false,
} as unknown as GatePassView;

const ROW_B = {
  ...ROW_A,
  id: 'p2',
  pass_number: 'RGP-OUT-20260730-0002',
  status: 'flagged',
} as unknown as GatePassView;

describe('AllPassesReport status tabs removed', () => {
  it('renders no status filter tab group, but keeps the Status column', () => {
    render(
      <MemoryRouter>
        <AllPassesReport rows={[ROW_A, ROW_B]} onRowsChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /Pending for Gate Approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mismatched/ })).not.toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});

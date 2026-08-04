// Status counts (Pending for Gate Approval / Matched / Mismatched) moved off
// the Reports register's tab group and onto the Admin Dashboard as plain KPI
// cards, alongside the existing Total / Awaiting Return / Return Rate /
// Overdue cards. This file covers both halves of that move: the Dashboard
// gains the three cards, and AllPassesReport loses its status tab group
// (the Status column itself stays).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

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

const KPI_ROW = {
  total: 10,
  pending: 4,
  matched: 5,
  flagged: 1,
  awaiting_return: 2,
  overdue: 1,
  raised_today: 3,
  overdue_value: 0,
  flagged_rate: 10,
  return_rate: 50,
};

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc: () => thenable({ data: [KPI_ROW], error: null }) }),
}));

import AdminDashboard from '../../src/pages/Admin/AdminDashboard';
import AllPassesReport from '../../src/pages/Admin/AllPassesReport';

describe('AdminDashboard status KPI cards', () => {
  it('renders Pending for Gate Approval, Matched and Mismatched cards with kpis() values', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Pending for Gate Approval')).toBeInTheDocument());
    expect(screen.getByText('Pending for Gate Approval').nextSibling).toHaveTextContent('4');

    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Matched').nextSibling).toHaveTextContent('5');

    expect(screen.getByText('Mismatched')).toBeInTheDocument();
    expect(screen.getByText('Mismatched').nextSibling).toHaveTextContent('1');

    // Existing cards must survive the change.
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Return')).toBeInTheDocument();
    expect(screen.getByText('Return Rate')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
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

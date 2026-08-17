// The department and RGP/NRGP filters used to live inside AllPassesReport, so
// they applied to ONE of the three report views. An admin "taking out a report"
// for Engineering, or for RGP only, expects that choice to hold whichever
// portal they print. The filters are lifted to ReportsPage and applied to the
// row set BEFORE it is handed to any view.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function row(over: Partial<GatePassView>): GatePassView {
  return {
    id: over.id ?? 'x',
    pass_number: over.pass_number ?? 'RGP-OUT-20260804-0001',
    type: over.type ?? 'RGP',
    direction: 'out',
    status: over.status ?? 'pending',
    return_status: 'not_applicable',
    department_id: over.department_id ?? 'd1',
    department_name: over.department_name ?? 'Engineering',
    department_code: over.department_code ?? 'ENG',
    raised_by: 'u1',
    raised_by_name: 'HOD One',
    visitor_name: over.visitor_name ?? 'Ravi',
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
    // Dated "now" so the default `today` preset always contains the fixtures —
    // a hardcoded date would silently stop matching the day after it is written.
    created_at: new Date().toISOString(),
    is_overdue: false,
    is_expired: false,
    due_state: 'none',
    item_count: 1,
    total_quantity: 1,
    returned_quantity: 0,
    material_summary: over.material_summary ?? 'Drill',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ROWS: GatePassView[] = [
  row({ id: 'a', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', department_id: 'd1', department_name: 'Engineering', visitor_name: 'Ravi' }),
  row({ id: 'b', pass_number: 'NRGP-OUT-20260804-0002', type: 'NRGP', department_id: 'd2', department_name: 'Housekeeping', visitor_name: 'Sunil' }),
];

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  for (const m of ['in', 'eq', 'order', 'limit', 'select']) obj[m] = () => thenable(result);
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => thenable({ data: ROWS, error: null }),
    rpc: () => thenable({ data: [], error: null }),
  }),
  pub: () => ({ from: () => thenable({ data: [], error: null }) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
}));

import ReportsPage from '../../src/pages/Admin/ReportsPage';

function renderReports() {
  return render(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Reports — department and pass-type filters', () => {
  it('shows both passes with no filter applied', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());
    expect(screen.getByText('NRGP-OUT-20260804-0002')).toBeInTheDocument();
  });

  it('filters to RGP only via the pass-type segmented control', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('NRGP-OUT-20260804-0002')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'RGP' }));

    await waitFor(() => expect(screen.queryByText('NRGP-OUT-20260804-0002')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument();
  });

  it('filters to NRGP only', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'NRGP' }));

    await waitFor(() => expect(screen.queryByText('RGP-OUT-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('NRGP-OUT-20260804-0002')).toBeInTheDocument();
  });

  it('filters by department', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } });

    await waitFor(() => expect(screen.queryByText('RGP-OUT-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('NRGP-OUT-20260804-0002')).toBeInTheDocument();
  });

  it('offers a Clear button only while a filter is active, and it resets both filters', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'NRGP' }));
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } });

    const clear = await screen.findByRole('button', { name: /clear/i });
    fireEvent.click(clear);

    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());
    expect(screen.getByText('NRGP-OUT-20260804-0002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  // The three report portals (All Passes / Return Schedule / Department
  // Summary) were removed 2026-08-17 on the client's call. A tab bar is not
  // "empty" here — it is gone, and this fails if one creeps back.
  it('offers no report-portal tabs — Reports is one register', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());

    for (const gone of ['All Passes', 'Return Schedule', 'Department Summary']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
  });

  it('no longer renders the old type/department dropdowns inside the register', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByLabelText('Department')).toBeInTheDocument());
    // The lifted bar owns these; the register keeps only search + Export CSV.
    expect(screen.queryByRole('option', { name: /All Types/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Department')).toHaveLength(1);
  });
});

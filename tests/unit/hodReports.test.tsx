// The HOD's own Reports tab (2026-08-20, client: "the same report tab section
// you built for the admin ... do it for the listing for all the HODs too, but
// only for their own department. Remove the Department and Raised By columns
// for an individual HOD, both from the column header and from the filter
// section.").
//
// `HodReports` is a one-line wrapper over the admin's `ReportsPage` with
// `showPeople={false}` — the department scope itself is RLS's job (migration
// 046's `gate_passes_select`), not this component's, so there is no separate
// query to fake here: the mocking harness is copied from
// `tests/unit/reportsFilters.test.tsx`, unmodified, because both screens run
// through the exact same `gp().from('v_gate_passes').select('*')` call.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function row(over: Partial<GatePassView>): GatePassView {
  return {
    id: over.id ?? 'x',
    pass_number: over.pass_number ?? 'RGP-20260804-0001',
    type: over.type ?? 'RGP',
    direction: 'out',
    status: over.status ?? 'pending',
    return_status: over.return_status ?? 'not_applicable',
    department_id: over.department_id ?? 'd1',
    department_name: over.department_name ?? 'Engineering',
    department_code: over.department_code ?? 'ENG',
    raised_by: over.raised_by ?? 'u1',
    raised_by_name: over.raised_by_name ?? 'HOD One',
    visitor_name: over.visitor_name ?? 'Ravi',
    visitor_company: null,
    vehicle_number: null,
    purpose: over.purpose ?? 'Raw Materials - Production',
    expected_return_date: null,
    actual_return_date: null,
    verified_by: null,
    verified_by_name: null,
    verified_at: null,
    flag_reason: null,
    qr_token: 't',
    expires_at: null,
    created_at: new Date().toISOString(),
    is_overdue: over.is_overdue ?? false,
    is_expired: over.is_expired ?? false,
    due_state: 'none',
    item_count: over.item_count ?? 1,
    total_quantity: 1,
    returned_quantity: 0,
    total_value: over.total_value ?? 0,
    material_summary: over.material_summary ?? 'Drill',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ROWS: GatePassView[] = [
  row({ id: 'a', pass_number: 'RGP-20260804-0001', type: 'RGP', total_value: 4500 }),
  row({
    id: 'b', pass_number: 'NRGP-20260804-0002', type: 'NRGP',
    department_id: 'd2', department_name: 'Housekeeping',
    raised_by: 'u2', raised_by_name: 'HOD Two',
  }),
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

import HodReports from '../../src/pages/HOD/HodReports';
import ReportsPage from '../../src/pages/Admin/ReportsPage';
import { reportCsvColumns, REPORT_CSV_COLUMNS } from '../../src/lib/gatePassReport';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HOD Reports — the same register, minus the two people columns', () => {
  it('renders the register with no Raised By Department or Created By column, and no matching filter', async () => {
    render(
      <MemoryRouter>
        <HodReports />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    expect(screen.queryByRole('columnheader', { name: 'Raised By Department' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Created By' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Created By')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();

    // Everything else survives: the other columns, the other filters.
    // ONE heading, not two (2026-08-21): the screen's own title and blurb are
    // gone on the client's instruction, leaving only the `print-only` sheet
    // header, which never renders on screen.
    expect(screen.getAllByRole('heading', { name: 'Gate Pass Report (RGP & NRGP)' }).length).toBe(1);
    expect(screen.getByRole('columnheader', { name: 'Value of Items' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pass Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  // REWRITTEN 2026-08-21. It used to assert an Apply Filters button on this
  // screen; the client had it removed everywhere, so what is pinned now is that
  // the HOD's copy narrows live like the admin's — one component, one rule.
  it('narrows live, with no Apply button and no people controls in play', async () => {
    render(
      <MemoryRouter>
        <HodReports />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Apply Filters/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Pass Type'), { target: { value: 'RGP' } });
    await waitFor(() => expect(screen.queryByText('NRGP-20260804-0002')).not.toBeInTheDocument());
  });

  // The two desks a waiting pass can be on are offered to an HOD as well as to
  // the admin (client, 2026-08-21) — the same one `ReportsFilterBar`, so there
  // is nothing role-specific to keep in step. RLS is what scopes the rows.
  it('offers Pending Gate Review and Pending Approval on the Status select', async () => {
    render(
      <MemoryRouter>
        <HodReports />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument());

    const options = Array.from(
      (screen.getByLabelText('Status') as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options).toContain('Pending Gate Review');
    expect(options).toContain('Pending Approval');
  });
});

describe('Admin Reports — unchanged by the HOD prop existing', () => {
  it('still renders all four: the two columns and the two selects', async () => {
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Raised By Department' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Created By' })).toBeInTheDocument();
    expect(screen.getByLabelText('Created By')).toBeInTheDocument();
    expect(screen.getByLabelText('Department')).toBeInTheDocument();
  });
});

describe('reportCsvColumns', () => {
  it('true is exactly REPORT_CSV_COLUMNS', () => {
    expect(reportCsvColumns(true)).toBe(REPORT_CSV_COLUMNS);
  });

  it('false omits Raised By Department and Created By, and nothing else', () => {
    const cols = reportCsvColumns(false);
    const headers = cols.map((c) => c.header);
    expect(headers).not.toContain('Raised By Department');
    expect(headers).not.toContain('Created By');
    expect(headers.length).toBe(REPORT_CSV_COLUMNS.length - 2);
    for (const h of headers) expect(REPORT_CSV_COLUMNS.map((c) => c.header)).toContain(h);
  });
});

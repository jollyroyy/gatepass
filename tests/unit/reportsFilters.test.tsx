// REWRITTEN 2026-08-20 for the client's "Gate Pass Report (RGP & NRGP)" mock-up.
//
// What this file used to hold: the lifted RGP/NRGP segmented toggle and the
// department select sitting in the house `.page-header`, plus the standalone
// Overdue and Expired buttons beside them. The client replaced the whole tab
// with the attached mock-up — a filter CARD of labelled selects with Reset and
// Apply Filters — so the toggle and the two buttons are gone as controls. NOTHING
// THEY DID WAS LOST: overdue-only and expired-only are options on the Status
// select, and the department filter is a select in the same card.
//
// The cases below are the same questions asked of the new controls, plus the two
// columns the client added on top of the mock (Value of Items, Raised By
// Department) and the Apply-before-it-takes-effect rule.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    // Dated "now" so the opening 30-day range always contains the fixtures — a
    // hardcoded date would silently stop matching the day after it is written.
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
  // Late: an RGP still out, past its date. `is_overdue` and `return_status` both
  // come off v_gate_passes — nothing recomputes lateness in TypeScript.
  row({
    id: 'c', pass_number: 'RGP-20260804-0003', type: 'RGP',
    status: 'matched', return_status: 'awaiting_return', is_overdue: true,
  }),
  // Dead paperwork: never reached the gate before its own expiry.
  row({ id: 'e', pass_number: 'RGP-20260804-0004', status: 'pending', is_expired: true }),
  // Finished: an NRGP the gate cleared is not coming back.
  row({ id: 'f', pass_number: 'NRGP-20260804-0005', type: 'NRGP', status: 'matched' }),
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

import { localDateString, presetRange } from '../../src/lib/reportsDateRange';
import ReportsPage from '../../src/pages/Admin/ReportsPage';

function renderReports() {
  return render(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>
  );
}

/** Changing a control IS the change — there is no Apply Filters button and no
 *  draft copy any more (client, 2026-08-21). Kept as a helper so the cases below
 *  read the same as they did before the button went. */
async function applyFilter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Gate Pass Report — the mock-up itself', () => {
  // REWRITTEN 2026-08-21. It used to hold that the screen drew the mock-up's
  // title AND its blurb ("is titled and described exactly as the attachment",
  // asserting two headings — the h1 and the print sheet — plus the sentence).
  // The client asked for both off every page a printout is taken from, so the
  // ONLY heading left is the `print-only` letterhead, which never shows on
  // screen and is what identifies the paper.
  it('draws no title and no blurb on screen — the print sheet keeps the one heading', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    expect(screen.getAllByRole('heading', { name: 'Gate Pass Report (RGP & NRGP)' }).length).toBe(1);
    expect(
      screen.queryByText('View and download RGP and NRGP gate pass transactions with detailed information.'),
    ).not.toBeInTheDocument();
  });

  it('carries the mock\'s three header buttons and its four filter controls', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    // REWRITTEN 2026-08-21: /Apply Filters/ used to be in this list. The
    // client had it removed — every control applies itself now — so its absence
    // is asserted below rather than its presence here.
    for (const name of [/Export/, /^Print$/, /Download/, /Reset/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const label of ['From date', 'To date', 'Pass Type', 'Status', 'Created By']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('renders the six figures, and Total = RGP + NRGP over the same rows', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    const figures = screen.getByRole('group', { name: 'Report figures' });
    for (const label of ['Total Passes', 'RGP Passes', 'NRGP Passes', 'Completed', 'In Progress', 'Cancelled']) {
      expect(figures).toHaveTextContent(label);
    }
    // 5 rows: 3 RGP + 2 NRGP.
    expect(figures).toHaveTextContent('5');
    expect(figures).toHaveTextContent('60.00% of total');
    expect(figures).toHaveTextContent('40.00% of total');
  });

  // The two columns the client asked for on top of the mock.
  it('carries a Value of Items column and a Raised By Department column', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Value of Items' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Raised By Department' })).toBeInTheDocument();
    // ₹4,500 is the priced pass; an unpriced one is a dash, never ₹0.
    expect(screen.getByText('₹4,500')).toBeInTheDocument();
    expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Housekeeping').length).toBeGreaterThan(0);
  });

  // The house `.page-header` toggle and the two standalone buttons are gone —
  // this fails if either creeps back beside the new card.
  it('draws no pass-type segmented toggle and no standalone Overdue/Expired buttons', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    expect(screen.queryByRole('group', { name: 'Pass type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overdue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expired' })).not.toBeInTheDocument();
  });
});

describe('Gate Pass Report — the ready-made ranges', () => {
  // Client, 2026-08-20: "in all the reports across admin and HOD, under the
  // date selection, mention Last 7 days / Last 30 days / Last 90 days / Last 6
  // months / Last 3 months / Last 1 month / Last 1 year".
  it('offers the seven ranges the client named, under the date inputs', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    const select = screen.getByLabelText('Quick range');
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual([
      'Custom range',
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
      'Last 6 months',
      'Last 3 months',
      'Last 1 month',
      'Last 1 year',
    ]);
  });

  it('writes the two date inputs, and reads back the preset it wrote', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    const select = screen.getByLabelText('Quick range') as HTMLSelectElement;
    // The report opens on the last 30 days, so the select says so before it is
    // ever touched — no preset is "remembered", every one is derived.
    expect(select.value).toBe('30d');

    fireEvent.change(select, { target: { value: '7d' } });
    const from = screen.getByLabelText('From date') as HTMLInputElement;
    const to = screen.getByLabelText('To date') as HTMLInputElement;
    const expected = presetRange('7d', localDateString(new Date()));
    expect(from.value).toBe(expected.from);
    expect(to.value).toBe(expected.to);
    expect((screen.getByLabelText('Quick range') as HTMLSelectElement).value).toBe('7d');
  });

  it("falls back to Custom range once an edge is moved by hand", async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-01-02' } });
    expect((screen.getByLabelText('Quick range') as HTMLSelectElement).value).toBe('custom');
  });
});

describe('Gate Pass Report — the filter card', () => {
  // REWRITTEN 2026-08-21. It used to hold the opposite — "narrows nothing until
  // Apply Filters is pressed", the draft-and-applied rule the mock-up's button
  // implied. Client: "remove the apply filters from everywhere. As soon as
  // anything is changed in those filters it should automatically get reflected
  // across all the views."
  it('narrows the report the moment a control is changed, with no button to press', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Pass Type'), { target: { value: 'RGP' } });
    await waitFor(() => expect(screen.queryByText('NRGP-20260804-0002')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Apply Filters/ })).not.toBeInTheDocument();
  });

  it('filters to RGP only, then back with Reset', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument());

    await applyFilter('Pass Type', 'RGP');
    await waitFor(() => expect(screen.queryByText('NRGP-20260804-0002')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument());
  });

  it('filters by department', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    await applyFilter('Department', 'd2');
    await waitFor(() => expect(screen.queryByText('RGP-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument();
  });

  it('filters by the person who created the pass', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0001')).toBeInTheDocument());

    await applyFilter('Created By', 'u2');
    await waitFor(() => expect(screen.queryByText('RGP-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('NRGP-20260804-0002')).toBeInTheDocument();
  });
});

describe('Gate Pass Report — the Status select', () => {
  // Client, 2026-08-18: "make a button for overdue, so it would show only the
  // overdue items." The button became an option; the report is the same.
  it('narrows to passes that are late', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0003')).toBeInTheDocument());

    await applyFilter('Status', 'overdue');
    await waitFor(() => expect(screen.queryByText('RGP-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-20260804-0003')).toBeInTheDocument();
  });

  // Expired passes came off both dashboards on 2026-08-18; this report is where
  // the record of them is still kept, over any range the admin picks.
  it('narrows to passes that ran out of time, and shows them as Expired', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('RGP-20260804-0004')).toBeInTheDocument());

    await applyFilter('Status', 'expired');
    await waitFor(() => expect(screen.queryByText('RGP-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-20260804-0004')).toBeInTheDocument();
    // The row's own pill — `pending` in the enum, and printing that word would
    // be a lie about a pass the gate will refuse forever.
    // Two: the Status select's own option, and the row's pill.
    expect(screen.getAllByText('Expired').length).toBe(2);
  });

  it('narrows to the mock\'s Completed bucket', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('NRGP-20260804-0005')).toBeInTheDocument());

    await applyFilter('Status', 'completed');
    await waitFor(() => expect(screen.queryByText('RGP-20260804-0001')).not.toBeInTheDocument());
    expect(screen.getByText('NRGP-20260804-0005')).toBeInTheDocument();
  });
});

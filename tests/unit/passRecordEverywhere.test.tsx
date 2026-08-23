// Every drill-down shows the SAME record the gate search shows.
//
// Client, 2026-08-18: "whenever we are clicking to check the details of our
// gate pass, it should show exactly in the same format as when we are
// searching with that gate pass ... in the guard's view make it the same
// across all the views."
//
// Every stacked list in the app — the guard's KPI drills, the board drills,
// Overdue Items, Scheduled Returns, My Passes, the notification bell — routes
// to `/pass/:id`. So this is one assertion in one place: `/pass/:id` renders
// `PassRecordView`, the exact component `GateConsole` renders after a search,
// and nothing that only the detail page could do (the flagged override) was
// lost in the swap.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

let row: GatePassView;
let items: unknown[] = [];
let verifications: unknown[] = [];

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260818-0007', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"Sharma Traders","a":"12 Park Street","v":"9876543210"}',
    vehicle_number: 'WB01AB1234',
    purpose: 'Service centre', expected_return_date: '2026-08-25',
    actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: null,
    created_at: '2026-08-18T04:00:00Z', updated_at: '2026-08-18T07:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'due_later',
    item_count: 1, total_quantity: 2, returned_quantity: 0, total_value: 5000,
    material_summary: 'Drill Machine',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: row, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'v_verifications' ? verifications : table === 'v_gate_pass_items' ? items : [],
        error: null,
      }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({ from: (t: string) => builder(t) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/pass/p1']}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('/pass/:id renders the Search Pass record, not a second format', () => {
  beforeEach(() => {
    row = pass();
    verifications = [];
    items = [
      {
        id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine',
        description: 'Bosch 500W', serial_no: null, quantity: 2, unit: 'nos',
        returned_qty: 0, returned_at: null, approx_value: 5000,
      },
    ];
  });

  it('is the same component the gate search resolves to', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'RGP Gate Pass Details' })).toBeInTheDocument();
    expect(screen.getByText('Items in this gate pass')).toBeInTheDocument();
    expect(screen.getByTestId('pass-timeline')).toBeInTheDocument();
  });

  it('keeps every fact the old detail page carried', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    for (const label of ["Authorized Person's Name", 'Contact No.', 'Vendor / Person', 'Vendor Address', 'Vehicle No.', 'Requested By', 'Request Date & Time', 'Expected Return Date']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Sharma Traders')).toBeInTheDocument();
    expect(screen.getByText('12 Park Street')).toBeInTheDocument();
    expect(screen.getByText('WB01AB1234')).toBeInTheDocument();
    expect(screen.getByText('9876543210')).toBeInTheDocument();
  });

  // Client, 2026-08-19: "don't put any extra words other than the ones I gave
  // you." The strip explaining that the four approval signatures are collected
  // on paper is gone; the ladder's own states say it.
  it('carries no explanatory strip under the material table', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    expect(screen.queryByText(/multi-level approval chain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/signs the printed pass/i)).not.toBeInTheDocument();
  });

  // The notification bell is `fixed top-4 right-4` on every screen, so a header
  // row whose buttons sit on the right edge renders UNDERNEATH it (client,
  // 2026-08-19: Print Pass was overlapping the bell in the guard's view). The
  // record's title row is not a `.page-header`, so it must make the same 76px
  // reservation itself — this is the test that fails if it is dropped.
  it('keeps Print Pass clear of the fixed notification bell', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    const head = screen.getByRole('link', { name: /Print Pass/ }).closest('div')?.parentElement;
    expect(head?.className).toContain('pr-[76px]');
  });

  // Client, 2026-08-19: "put value in all the details and the cards … overall
  // the total value also." The strip carried no money at all until now.
  it('carries the pass total value in the fact strip', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    // Twice on purpose: the strip states the pass's own roll-up, and the item
    // table foots the very lines under it.
    expect(screen.getAllByText('Total Value').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹5,000').length).toBeGreaterThan(0);
  });

  it('still offers the raising HOD the flagged override, above the record', async () => {
    row = pass({ status: 'flagged', flag_reason: 'Count did not match', verified_at: '2026-08-18T08:00:00Z' });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    // Twice on purpose: the override panel above the record states it, and the
    // approval ladder's gate rung carries it as the reason that rung is blocked.
    expect(screen.getAllByText('Count did not match').length).toBeGreaterThan(0);
    // "Send Back to the Gate" since 2026-08-23 — the requester's answer that
    // returns the pass to the guard who flagged it, and to nobody else.
    expect(screen.getByRole('button', { name: 'Send Back to the Gate' })).toBeInTheDocument();
  });
});

// Client, 2026-08-20: "the overdue is showing twice when I'm looking at the
// details page." The stage badge already RENAMES a late open pass to "Overdue"
// (2026-08-18, twelfth pass), so the separate `is_overdue` pill beside it
// restated the same word. It is drawn now only when the stage badge says
// something else — a flagged pass that is ALSO late still carries both facts.
describe('the record says Overdue once', () => {
  beforeEach(() => {
    verifications = [];
    items = [];
  });

  it('draws one Overdue badge on a late open RGP', async () => {
    row = pass({ is_overdue: true, due_state: 'overdue' });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    const head = screen.getByRole('heading', { name: 'RGP Gate Pass Details' }).parentElement!;
    expect([...head.querySelectorAll('span')].filter((s) => s.textContent === 'Overdue')).toHaveLength(1);
  });

  it('still says it beside a stage badge that does not, such as a mismatch', async () => {
    row = pass({ status: 'flagged', flag_reason: 'Count did not match', is_overdue: true, due_state: 'overdue' });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    const head = screen.getByRole('heading', { name: 'RGP Gate Pass Details' }).parentElement!;
    expect([...head.querySelectorAll('span')].filter((s) => s.textContent === 'Overdue')).toHaveLength(1);
    expect(head.textContent).toContain('Rejected at Security Gate');
  });
});

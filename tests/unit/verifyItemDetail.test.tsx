// The guard's verify screen fetched the item rows and then never rendered them:
// it showed only `material_summary` and "N line(s)". So the two things a guard
// most needs before releasing material — WHY each item is going out, and what it
// is worth — were invisible.
//
// The pass-level `purpose` field it did show is null on every pass raised
// through RaisePass: migration 019 moved the real reasons onto the items and
// RaisePass never sends p_purpose. So "Purpose" rendered blank, every time.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PASS = {
  id: 'p1', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
  status: 'pending', return_status: 'not_applicable',
  department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
  raised_by: 'u1', raised_by_name: 'HOD One',
  visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
  // Null exactly as a real HOD-raised pass has it — the reasons live on items.
  purpose: null,
  expected_return_date: '2026-09-01', actual_return_date: null,
  verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
  qr_token: 'tok', expires_at: null, created_at: '2026-08-04T06:00:00Z',
  is_overdue: false, is_expired: false, due_state: 'none',
  item_count: 2, total_quantity: 5, returned_quantity: 0,
  material_summary: 'Drill Machine, Ladder',
};

const ITEMS = [
  {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine',
    description: 'Bosch GSB 13mm', purpose: 'Servicing at vendor workshop',
    expected_return_date: '2026-09-01', quantity: 2, unit: 'nos',
    approx_value: 14500, returned_qty: 0, department_id: 'd1', is_open: true,
    created_at: '2026-08-04T06:00:00Z', outstanding_qty: 2,
    pass_number: 'RGP-OUT-20260804-0001', pass_status: 'pending', return_status: 'not_applicable',
  },
  {
    id: 'i2', gate_pass_id: 'p1', line_no: 2, name: 'Ladder',
    description: 'Aluminium 8ft', purpose: 'Facade light repair',
    expected_return_date: '2026-09-05', quantity: 3, unit: 'nos',
    approx_value: 3200, returned_qty: 0, department_id: 'd1', is_open: true,
    created_at: '2026-08-04T06:00:00Z', outstanding_qty: 3,
    pass_number: 'RGP-OUT-20260804-0001', pass_status: 'pending', return_status: 'not_applicable',
  },
];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'maybeSingle', 'single']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => thenable(table === 'v_gate_pass_items' ? ITEMS : PASS),
    rpc: () => thenable(null),
  }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'p1' }) };
});

import Verify from '../../src/pages/Security/Verify';

function renderVerify() {
  return render(
    <MemoryRouter>
      <Verify />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Verify — per-item detail the guard needs', () => {
  it('shows each item name and description', async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeInTheDocument());
    expect(screen.getByText('Bosch GSB 13mm')).toBeInTheDocument();
    expect(screen.getByText('Ladder')).toBeInTheDocument();
    expect(screen.getByText('Aluminium 8ft')).toBeInTheDocument();
  });

  it("shows each item's reason — the field that used to render blank", async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('Servicing at vendor workshop')).toBeInTheDocument());
    expect(screen.getByText('Facade light repair')).toBeInTheDocument();
  });

  it("shows each item's approximate value, grouped in Indian digits", async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('₹14,500')).toBeInTheDocument());
    expect(screen.getByText('₹3,200')).toBeInTheDocument();
  });

  // The unit is the HOD's choice on the raise form and the guard may not change
  // it (client, 2026-08-20: "show the selected unit in guard view as
  // readonly"). It reads in the same words every other surface prints — the raw
  // code `nos` used to be shown here, which is the abbreviation the client
  // rejected in 2026-08-11.
  it('shows per-item quantity with its unit, labelled and read-only', async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('2 Numbers')).toBeInTheDocument());
    expect(screen.getByText('3 Numbers')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });

  it('totals the declared value across the whole pass', async () => {
    renderVerify();
    // 14500 + 3200
    await waitFor(() => expect(screen.getByText('₹17,700')).toBeInTheDocument());
  });

  it('states the item count and total quantity, not a bare "line(s)" figure', async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText(/2 items/i)).toBeInTheDocument());
    expect(screen.getByText(/5 total qty/i)).toBeInTheDocument();
  });

  it('shows per-item expected return dates for an RGP', async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeInTheDocument());
    // Both lines carry their own date; the pass-level one is only a roll-up.
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it('does not render an empty pass-level Purpose field', async () => {
    renderVerify();
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeInTheDocument());
    // The pass-level purpose is null here; a labelled blank is worse than nothing.
    expect(screen.queryByText('Purpose')).not.toBeInTheDocument();
  });
});

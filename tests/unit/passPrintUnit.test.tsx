// The printed slip's Material Items table must read "Numbers", not the raw
// "nos" code — the same display rule the raise-pass dropdown follows
// (2026-08-11, client: "in the print pass option also ... the unit should be
// numbers not nos"). `unitLabel()` in src/lib/units.ts is the single source;
// this renders a real PassPrint to pin the printed cell itself.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { current } = vi.hoisted(() => ({ current: { pass: {} as Record<string, unknown>, items: [] as Record<string, unknown>[] } }));

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'single', 'maybeSingle']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) =>
      table === 'v_gate_pass_items'
        ? thenable(current.items)
        : thenable(current.pass),
    rpc: () => thenable(null),
  }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'p1' }) };
});

import PassPrint from '../../src/pages/Shared/PassPrint';

beforeEach(() => {
  vi.clearAllMocks();
  current.items = [
    { id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill', description: 'Cordless', purpose: 'work', quantity: 2, unit: 'nos', approx_value: 500, expected_return_date: null },
    { id: 'i2', gate_pass_id: 'p1', line_no: 2, name: 'Coil', description: 'Cable', purpose: 'work', quantity: 3, unit: 'kg', approx_value: 900, expected_return_date: null },
  ];
});

describe('PassPrint material unit', () => {
  it('renders "Numbers" for a nos unit, not the raw code', async () => {
    current.pass = {
      id: 'p1', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
      status: 'pending', return_status: 'not_applicable',
      department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
      raised_by: 'u1', raised_by_name: 'HOD One',
      visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
      purpose: null, expected_return_date: null, actual_return_date: null,
      verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
      qr_token: 'tok', expires_at: null, created_at: '2026-08-11T06:00:00Z',
      is_overdue: false, is_expired: false, due_state: 'none',
      item_count: 2, total_quantity: 5, returned_quantity: 0,
      material_summary: 'Drill',
    };
    render(
      <MemoryRouter>
        <PassPrint />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260811-0001')).toBeInTheDocument());
    expect(screen.getByText('Numbers')).toBeInTheDocument();
    expect(screen.getByText('Kg')).toBeInTheDocument();
    expect(screen.queryByText('nos')).not.toBeInTheDocument();
  });
});

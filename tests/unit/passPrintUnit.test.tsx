// The printed slip has no Unit column. Every quantity cell carries its own
// unit label now, mixed or shared, `nos` included (client, 2026-08-23:
// "whatever unit has been selected, you need to show all of them, no matter
// what, no deviation across all the views") — the old rule, where one shared
// unit moved into the Qty heading and `nos` printed bare, is gone with
// `headingUnit`/`quantityHeading`. `src/lib/units.ts` is the single source;
// this renders a real PassPrint to pin the printed cells.
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
  it('names every unit in its own cell, nos included, and the heading stays plain', async () => {
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
    // Mixed units: the heading names none of them — it never does any more —
    // and each line keeps its own.
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Unit' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Qty (Kg)' })).toBeNull();
    expect(screen.getByText('3 Kg')).toBeInTheDocument();
    // `nos` is spelled out now, same as every other unit — it no longer
    // prints bare.
    expect(screen.getByText('2 Numbers')).toBeInTheDocument();
    expect(screen.queryByText('nos')).toBeNull();
  });

  it('still names each line even when every line shares one unit', async () => {
    current.items = current.items.map((i) => ({ ...i, unit: 'kg' }));
    render(
      <MemoryRouter>
        <PassPrint />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('RGP-OUT-20260811-0001')).toBeInTheDocument());
    // A shared unit no longer moves into the heading — the heading is plain
    // and every cell still names its own unit.
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Qty (Kg)' })).toBeNull();
    expect(screen.getByText('2 Kg')).toBeInTheDocument();
    expect(screen.getByText('3 Kg')).toBeInTheDocument();
  });
});

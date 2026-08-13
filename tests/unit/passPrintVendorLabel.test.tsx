// The printed slip's vendor row is labelled "Vendor Name", not "Vendor"
// (2026-08-13, client). The value beside it is the vendor's NAME — the address
// and phone are their own rows — so the bare label read as a heading for the
// whole vendor block rather than as the field it actually is.
//
// Pinned for BOTH categories: PassPrint is one component for RGP and NRGP, so
// this also guards anyone making the header block conditional on type.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { current } = vi.hoisted(() => ({ current: { pass: {} as Record<string, unknown> } }));

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
    from: (table: string) => (table === 'v_gate_pass_items' ? thenable([]) : thenable(current.pass)),
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

function view(over: Record<string, unknown>) {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260813-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi',
    visitor_company: JSON.stringify({ n: 'Bengal Services Co', a: '12 Park St', v: '9876543210' }),
    vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 'tok', expires_at: null, created_at: '2026-08-13T06:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderFor(over: Record<string, unknown>) {
  current.pass = view(over);
  render(
    <MemoryRouter>
      <PassPrint />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText(String(current.pass.pass_number))).toBeInTheDocument());
}

describe('PassPrint vendor field label', () => {
  const CATEGORIES: { name: string; over: Record<string, unknown> }[] = [
    { name: 'RGP Out', over: { type: 'RGP', direction: 'out' } },
    { name: 'RGP In', over: { type: 'RGP', direction: 'in', pass_number: 'RGP-IN-20260813-0001' } },
    { name: 'NRGP Out', over: { type: 'NRGP', direction: 'out', pass_number: 'NRGP-OUT-20260813-0001' } },
  ];

  for (const c of CATEGORIES) {
    it(`labels the vendor row "Vendor Name" on ${c.name}`, async () => {
      await renderFor(c.over);
      expect(screen.getByText('Vendor Name')).toBeInTheDocument();
      expect(screen.getByText('Bengal Services Co')).toBeInTheDocument();
      // The bare "Vendor" label is gone; "Vendor Address" stays its own row.
      expect(screen.queryByText('Vendor')).not.toBeInTheDocument();
      expect(screen.getByText('Vendor Address')).toBeInTheDocument();
    });
  }
});

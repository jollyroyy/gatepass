// The printed slip is the physical artefact seven people sign and stamp before
// material crosses the gate. It carries all seven blocks on EVERY category —
// RGP Out, RGP In and NRGP Out — because the approval chain does not change
// with the direction the material is travelling.
//
// Row 1 (approvals):   Issuing HOD · Security Head · COO
// Row 2 (approvals):   Finance HOD · CEO
// Row 3 (at the gate): Security Verification · Receiver Signature
//
// Read left→right, top→bottom the approval order is Issuing HOD → Security Head
// → COO → Finance HOD → CEO (the CEO moved from third to last on 2026-08-20,
// on the client's instruction — see `APPROVAL_LADDER` and migration 057; this
// file's own cases below were rewritten with it). Three boxes per row is a
// print constraint, not a
// grouping: five across an A5 sheet leaves ~18mm per box, too narrow for a
// rubber stamp.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SIGNATURE_ROWS } from '../../src/pages/Shared/signatureBlocks';

function view(over: Record<string, unknown>) {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 'tok', expires_at: null, created_at: '2026-08-04T06:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
  };
}

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
    from: (table: string) =>
      table === 'v_gate_pass_items'
        ? thenable([])
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
});

async function renderFor(over: Record<string, unknown>) {
  current.pass = view(over);
  render(
    <MemoryRouter>
      <PassPrint />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByText('RGP-OUT-20260804-0001')).toBeInTheDocument());
}

describe('signature block definitions', () => {
  it('defines exactly seven blocks over three rows', () => {
    const all = SIGNATURE_ROWS.flat();
    expect(all).toHaveLength(7);
    expect(SIGNATURE_ROWS).toHaveLength(3);
  });

  it('never puts more than three boxes on a row (an A5 sheet cannot hold more)', () => {
    for (const row of SIGNATURE_ROWS) expect(row.length).toBeLessThanOrEqual(3);
  });

  // REWRITTEN 2026-08-20: this used to run …→ COO → CEO → finance, and the case
  // under it pinned the CEO immediately after the COO. The client reordered the
  // ladder so the CEO signs LAST; the slip and the screen must agree, or a
  // guard comparing the two finds a level on one that is missing from the other.
  it('runs the approval chain issuing → security → COO → finance → CEO', () => {
    expect(SIGNATURE_ROWS.flat().slice(0, 5).map((b) => b.label)).toEqual([
      'Issuing HOD',
      'Security Head',
      'COO',
      'Finance HOD',
      'CEO',
    ]);
  });

  it('places the CEO block last of the five, immediately after Finance HOD', () => {
    const labels = SIGNATURE_ROWS.flat().map((b) => b.label);
    expect(labels.indexOf('CEO')).toBe(labels.indexOf('Finance HOD') + 1);
    expect(labels.indexOf('Finance HOD')).toBe(labels.indexOf('COO') + 1);
  });

  it('puts gate verification and the receiver last, on their own row', () => {
    expect(SIGNATURE_ROWS[SIGNATURE_ROWS.length - 1].map((b) => b.label)).toEqual([
      'Security Verification',
      'Receiver Signature',
    ]);
  });

  it('gives every block room for a signature and a stamp', () => {
    for (const b of SIGNATURE_ROWS.flat()) {
      expect(b.caption.toLowerCase()).toContain('stamp');
    }
  });
});

describe('PassPrint renders all seven signature labels for every category', () => {
  const CATEGORIES: { name: string; over: Record<string, unknown> }[] = [
    { name: 'RGP Out', over: { type: 'RGP', direction: 'out' } },
    { name: 'RGP In', over: { type: 'RGP', direction: 'in' } },
    { name: 'NRGP Out', over: { type: 'NRGP', direction: 'out' } },
  ];

  for (const c of CATEGORIES) {
    it(`renders all seven signature labels for ${c.name}`, async () => {
      await renderFor(c.over);
      for (const b of SIGNATURE_ROWS.flat()) {
        expect(screen.getByText(b.label)).toBeInTheDocument();
      }
    });
  }
});

// THE PRINTED SLIP CARRIES THE DIGITAL APPROVAL TRAIL, NOT SEVEN EMPTY BOXES.
//
// REWRITTEN 2026-08-22. This file used to pin the opposite: seven signature
// blocks over three rows (Issuing HOD · Security Head · COO / Finance HOD · CEO
// / Security Verification · Receiver Signature), three per row because five
// across an A5 sheet leaves ~18mm per box — too narrow for a rubber stamp — and
// all seven drawn on every category. `src/pages/Shared/signatureBlocks.ts` is
// DELETED with them.
//
// Client, 2026-08-22: "when I'm printing the pass from any page it should not
// show the previous boxes for the signature. Show it as per the digital
// approval. It should show all the digital signature timeline and everything in
// a proper format. Remove those boxes for the signs."
//
// The offices sign in the portal now (migration 046, linear since 061), and
// `gatepass.pass_approvals` records who pressed each rung and when. A blank box
// beside that is not a second safeguard — it is an invitation to sign paper and
// believe it counted.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

const { current } = vi.hoisted(() => ({
  current: {
    pass: {} as Record<string, unknown>,
    approvals: [] as Record<string, unknown>[],
    roles: [] as Record<string, unknown>[],
  },
}));

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
    rpc: (name: string) =>
      thenable(
        name === 'get_pass_approvals'
          ? current.approvals
          : name === 'get_approval_ladder'
            ? current.roles
            : null,
      ),
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
  current.approvals = [];
  current.roles = [];
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

const CATEGORIES: { name: string; over: Record<string, unknown> }[] = [
  { name: 'RGP Out', over: { type: 'RGP', direction: 'out' } },
  { name: 'RGP In', over: { type: 'RGP', direction: 'in' } },
  { name: 'NRGP Out', over: { type: 'NRGP', direction: 'out' } },
];

describe('the slip prints no signature box, on any category', () => {
  for (const c of CATEGORIES) {
    it(`draws none of the old blocks or their captions for ${c.name}`, async () => {
      await renderFor(c.over);
      // "Security Verification" is deliberately NOT in this list: it survives
      // as a STEP of the digital trail (`gateStep`), which is the gate's real
      // decision rather than a box somebody signs.
      for (const gone of ['Signature & Stamp', 'Receiver Signature', 'Issuing HOD']) {
        expect(screen.queryByText(gone)).toBeNull();
      }
    });
  }

  // The boxes were the ONLY thing on this sheet drawn as an empty ruled
  // rectangle; nothing else uses that height. If one comes back, this bites.
  it('draws no empty ruled box for anybody to sign', async () => {
    await renderFor({});
    expect(document.querySelectorAll('div.border.border-black.h-20')).toHaveLength(0);
  });
});

describe('the slip prints the digital approval trail instead', () => {
  it('heads the block and says signatures are captured digitally', async () => {
    await renderFor({});
    expect(screen.getByText(/Approval & Verification Record/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded digitally/i)).toBeInTheDocument();
    expect(screen.getByText(/No manual signature is required/i)).toBeInTheDocument();
  });

  it('opens with the raise, naming the HOD and their department', async () => {
    await renderFor({});
    // Twice on the sheet by design: the slip's own fact row, and the first rung
    // of the trail.
    expect(screen.getAllByText('Raised By').length).toBeGreaterThan(1);
    expect(screen.getAllByText('HOD One').length).toBeGreaterThan(0);
    expect(screen.getByText('Approved on raising')).toBeInTheDocument();
  });

  // The point of the whole change: a level somebody actually signed in the
  // portal prints WHO signed it and WHEN, where a blank box used to be.
  it('prints the approver and the moment for a level that was signed', async () => {
    current.roles = [{
      role_key: 'security_head', user_id: 'u9', full_name: 'Demi', department_name: 'Security',
      designated_at: '2026-08-01T00:00:00Z', deputy_id: null, deputy_name: null,
    }];
    current.approvals = [
      {
        role_key: 'security_head', level_no: 1, status: 'approved',
        routed_name: 'Demi', decided_name: 'Demi', decided_at: '2026-08-04T07:30:00Z',
        reason: null, decided_as_deputy: false,
      },
      {
        role_key: 'coo', level_no: 2, status: 'pending',
        routed_name: 'Sudeshna', decided_name: null, decided_at: null,
        reason: null, decided_as_deputy: false,
      },
    ];
    await renderFor({});
    expect(screen.getByText('Level 1 Approval')).toBeInTheDocument();
    expect(screen.getByText('Security Head (Demi)')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Level 2 Approval')).toBeInTheDocument();
    expect(screen.getByText('Waiting for this approval')).toBeInTheDocument();
  });

  it('prints the gate clearance as a step of the same trail', async () => {
    await renderFor({
      status: 'matched', verified_by_name: 'Guard Sam', verified_at: '2026-08-04T09:00:00Z',
      return_status: 'awaiting_return', expected_return_date: '2026-08-20',
    });
    expect(screen.getByText('Cleared by Security')).toBeInTheDocument();
    expect(screen.getByText('Guard Sam')).toBeInTheDocument();
    // RGP only — the return leg closes the trail.
    expect(screen.getByText('To Be Returned')).toBeInTheDocument();
  });

  it('invents no moment for a step this database records none for', async () => {
    current.roles = [{
      role_key: 'coo', user_id: 'u8', full_name: 'Sudeshna', department_name: 'Ops',
      designated_at: '2026-08-01T00:00:00Z', deputy_id: null, deputy_name: null,
    }];
    await renderFor({});
    // A legacy pass carries no ladder rows at all, so the gate step is still
    // pending and prints a dash rather than a made-up timestamp.
    expect(screen.getByText('Pending at the gate')).toBeInTheDocument();
  });
});

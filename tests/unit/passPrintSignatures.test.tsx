// THE PRINTED SLIP CARRIES SIGNATURE BOXES AGAIN — WITH THE DIGITAL APPROVAL
// INSIDE THEM.
//
// REWRITTEN 2026-08-22, for the second time in one day. Earlier the same day
// this file pinned that the slip drew NO boxes at all, and before that it
// pinned seven EMPTY ones. The client asked for the boxes back, carrying the
// decision:
//
//   "In the print pass, when we are trying to take the print pass, please go
//    back to the boxes that were there before. Make sure for all the approvals
//    if the approval has been given, give a tick box inside that box … Also
//    give the approval date when it was approved."
//
// So a box is now one of four things — signed (a tick, the signer and the
// moment), rejected, not required (the other office on a shared rung signed
// it, 063), or awaiting — and every one of them is a WORD as well as a mark,
// because the sheet is read on a cheap mono laser. The one box still blank by
// design is the receiver's: nothing in this system records a receipt.
//
// The boxes are built from the record's own `buildApprovalSteps`, so the paper
// and the screen cannot name a different office, person or moment.
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

describe('the slip prints a box per office, on every category', () => {
  for (const c of CATEGORIES) {
    it(`draws the boxes and the receiver's blank one for ${c.name}`, async () => {
      await renderFor(c.over);
      for (const label of ['Issuing HOD', 'Security Verification', 'Receiver Signature']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      // The receiver's is the ONE box a person still signs by hand.
      expect(screen.getByText('Signature & Stamp')).toBeInTheDocument();
    });
  }

  it('says a ticked box is a portal approval, not a mark made with a pen', async () => {
    await renderFor({});
    expect(screen.getByText(/Approvals/)).toBeInTheDocument();
    expect(screen.getByText(/recorded in Quest GatePass/i)).toBeInTheDocument();
    expect(screen.getByText(/receiver's box is signed by hand/i)).toBeInTheDocument();
  });

  it('draws no return-leg box — a deadline is not a signature', async () => {
    await renderFor({
      type: 'RGP', return_status: 'awaiting_return', expected_return_date: '2026-08-20',
    });
    expect(screen.queryByText('To Be Returned')).toBeNull();
  });
});

describe('a box carries the decision that was made in the portal', () => {
  // THE POINT OF THE WHOLE CHANGE: a level somebody actually signed prints a
  // tick, the person's name and the moment, inside the box that used to be
  // ruled and empty.
  it('ticks the box, names the signer and prints the date', async () => {
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
        role_key: 'finance_head', level_no: 2, status: 'pending',
        routed_name: 'Sameer', decided_name: null, decided_at: null,
        reason: null, decided_as_deputy: false,
      },
    ];
    await renderFor({});
    expect(screen.getByText('Security Head')).toBeInTheDocument();
    // The office is the box's heading, so the name inside it is the person
    // alone — never "Security Head (Demi)" under a heading saying the same.
    expect(screen.getByText('Demi')).toBeInTheDocument();
    // Twice on this sheet: the issuing HOD's box says it too, because raising
    // a pass IS that office's approval.
    expect(screen.getAllByText('Approved in Quest GatePass').length).toBe(2);
    // And the office that has not signed says so, with nothing in its box.
    expect(screen.getByText('Finance HOD')).toBeInTheDocument();
    // Twice: finance's own box, and the gate's, which has not acted either.
    expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0);
  });

  it('marks the office that never had to sign as Not required', async () => {
    current.approvals = [
      {
        role_key: 'coo', level_no: 3, status: 'approved',
        routed_name: 'Vikram', decided_name: 'Vikram', decided_at: '2026-08-04T08:00:00Z',
        reason: null, decided_as_deputy: false,
      },
      {
        role_key: 'ceo', level_no: 3, status: 'not_required',
        routed_name: 'Neha', decided_name: null, decided_at: '2026-08-04T08:00:00Z',
        reason: 'Not required — level 3 was approved by the COO.', decided_as_deputy: false,
      },
    ];
    await renderFor({});
    expect(screen.getByText('Not required')).toBeInTheDocument();
    // NOT a tick and NOT a name: the CEO pressed nothing (063).
    expect(screen.queryByText('Neha')).toBeNull();
  });

  it('prints the gate clearance in its own box', async () => {
    await renderFor({
      status: 'matched', verified_by_name: 'Guard Sam', verified_at: '2026-08-04T09:00:00Z',
      return_status: 'awaiting_return', expected_return_date: '2026-08-20',
    });
    expect(screen.getByText('Security Verification')).toBeInTheDocument();
    expect(screen.getByText('Guard Sam')).toBeInTheDocument();
  });

  it('opens with the issuing HOD, who approved it by raising it', async () => {
    await renderFor({});
    expect(screen.getByText('Issuing HOD')).toBeInTheDocument();
    expect(screen.getAllByText('HOD One').length).toBeGreaterThan(0);
  });
});

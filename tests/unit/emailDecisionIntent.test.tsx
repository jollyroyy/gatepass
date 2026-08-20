// THE EMAIL'S APPROVE / REJECT BUTTON LANDS ON THE PASS WITH THAT DECISION
// ALREADY IN HAND (client, 2026-08-20: "make sure … it gives this Approve or
// Reject button in the email approval emails … once it is clicked on any of
// those links, it should directly open up the portal … From the email also the
// approval and rejection button should work").
//
// The link is `/pass/:id?decide=approve|reject`. What arrives is an INTENT, not
// a decision:
//
//   * `?decide=reject` opens the reason modal, because a rejection is refused
//     without a written reason anyway and the reader pressed Reject knowing
//     that. Nothing is sent until they type one and confirm.
//   * `?decide=approve` does NOT approve. A link in an email is a GET and GETs
//     are prefetched — Outlook Safe Links opens a URL before its reader does —
//     so an approval that happened on arrival would be an approval nobody made.
//     The reader still presses Approve, on the record, having seen the pass.
//
// And the intent is only ever an intent: the bar itself is still drawn by
// `approvalDecision.ts`, so a reader who holds no office, or whose rung is not
// the one the pass is on, sees the same thing they always did.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const rpc = vi.fn();
let approvals: unknown[] = [];

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260820-0009', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix","a":"Noida","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Repair', expected_return_date: '2026-08-24', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2099-08-19T18:30:00Z',
    created_at: '2026-08-20T05:00:00Z', updated_at: '2026-08-20T05:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok', awaits_approval: true,
    item_count: 1, total_quantity: 5, returned_quantity: 0, total_value: 500,
    material_summary: 'Pump',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let row: GatePassView = pass();

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: row, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_verifications' ? [] : [], error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({
      from: (t: string) => builder(t),
      rpc: (name: string, args: unknown) => {
        rpc(name, args);
        if (name === 'get_pass_approvals') return Promise.resolve({ data: approvals, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u9' } } }) },
      rpc: (name: string, args: unknown) => { rpc(name, args); return Promise.resolve({ data: null, error: null }); },
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

function open(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail role={null} office="coo" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockClear();
  row = pass();
  approvals = [
    { role_key: 'security_head', level_no: 1, status: 'approved', decided_name: 'Demi', decided_at: '2026-08-20T06:00:00Z', reason: null },
    { role_key: 'coo', level_no: 2, status: 'pending', decided_name: null, decided_at: null, reason: null },
    { role_key: 'finance_head', level_no: 3, status: 'pending', decided_name: null, decided_at: null, reason: null },
    { role_key: 'ceo', level_no: 4, status: 'pending', decided_name: null, decided_at: null, reason: null },
  ];
});

describe('the emailed decision link', () => {
  it('opens the reason modal on ?decide=reject, and sends nothing until it is filled', async () => {
    open('/pass/p1?decide=reject');
    await waitFor(() => expect(screen.getByTestId('record-approval-actions')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText(/reason for rejection/i)).toBeTruthy());
    expect(rpc.mock.calls.some(([n]) => n === 'reject_pass_level')).toBe(false);
  });

  it('does NOT approve on ?decide=approve — the reader still presses the button', async () => {
    open('/pass/p1?decide=approve');
    await waitFor(() => expect(screen.getByTestId('record-approval-actions')).toBeTruthy());
    expect(rpc.mock.calls.some(([n]) => n === 'approve_pass_level')).toBe(false);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('says the letter is what brought them here, so the screen is not a surprise', async () => {
    open('/pass/p1?decide=approve');
    await waitFor(() => expect(screen.getByTestId('record-approval-actions')).toBeTruthy());
    expect(screen.getByTestId('decide-from-email')).toBeTruthy();
  });

  it('opens no modal and says nothing without the parameter', async () => {
    open('/pass/p1');
    await waitFor(() => expect(screen.getByTestId('record-approval-actions')).toBeTruthy());
    expect(screen.queryByLabelText(/reason for rejection/i)).toBeNull();
    expect(screen.queryByTestId('decide-from-email')).toBeNull();
  });
});

// The pass detail page's header badge must agree with the card that opened it.
//
// Client, 2026-08-11: "When I'm clicking on the card to see more details, on
// the detail page on the top it is still showing them as Matched. Make sure
// that all the closed items should be shown as only Closed. Upon clicking to
// see more details it should show all the timelines."
//
// The header used STATUS_STYLES[status] directly, so a returned RGP — whose
// `status` is frozen at 'matched' forever, because only `return_status` moves
// after the outward trip — read "Matched" at the top of its own record. It now
// uses `passStageStyle`, the same single-badge rule every card uses.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

let row: GatePassView;
let verifications: unknown[] = [];

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'returned',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Servicing', expected_return_date: null,
    actual_return_date: '2026-08-03T07:00:00Z',
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-01T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: null, created_at: '2026-08-01T04:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 1, total_value: 0,
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
        data: table === 'v_verifications' ? verifications : [],
        error: null,
      }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({ from: (t: string) => builder(t) }),
    supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
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

describe('PassDetail header badge', () => {
  beforeEach(() => {
    verifications = [];
  });

  it('reads "Closed" for a fully returned RGP, never "Matched"', async () => {
    row = pass({ status: 'matched', return_status: 'returned' });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Closed')).toBeInTheDocument());
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('reads "Out — Not Returned" for an RGP still outside', async () => {
    row = pass({ return_status: 'awaiting_return', actual_return_date: null });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Out — Not Returned')).toBeInTheDocument());
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('keeps "Matched" for an NRGP, whose outward trip IS its end state', async () => {
    row = pass({ type: 'NRGP', return_status: 'not_applicable', actual_return_date: null });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Matched')).toBeInTheDocument());
  });

  // The whole point of dropping "Matched" from the badge: the moment has to be
  // legible somewhere, and the detail page is where the client asked for it.
  it('shows both gate events in the timeline', async () => {
    row = pass({ status: 'matched', return_status: 'returned' });
    verifications = [
      { id: 'v1', gate_pass_id: 'p1', action: 'matched', security_name: 'Guard One', created_at: '2026-08-01T07:00:00Z', verified_quantity: null, verified_vehicle: null, remarks: null },
      { id: 'v2', gate_pass_id: 'p1', action: 'returned', security_name: 'Guard Two', created_at: '2026-08-03T07:00:00Z', verified_quantity: null, verified_vehicle: null, remarks: null },
    ];
    renderDetail();
    await waitFor(() => expect(screen.getByText(/Matched at gate/)).toBeInTheDocument());
    expect(screen.getByText(/Returned/)).toBeInTheDocument();
  });
});

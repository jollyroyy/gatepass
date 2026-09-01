// RENAMED THREE TIMES. 2026-08-21 collapsed both open stages onto the SAME
// word, "Partially Returned", and the closed stage read "Closed" — which the
// header badge shared with the timeline rail's own closing rung
// (`passLadderLegs.returnStep`), so a returned RGP printed "Closed" twice on
// its own detail page. 2026-09-01 split the badge's word away from the rail's:
// the badge now says "Returned" (client: "its status should be changed to
// returned or partially returned only when any of its items has been
// returned") while the rail's closing rung KEEPS "Closed" on purpose — that
// rung means the end of the paperwork, not the whereabouts of the goods, and
// the task explicitly leaves it alone. A cleared NRGP's badge moved too, from
// "Closed" to "Out — No Return Due" (client: "once a NRGP gate pass is
// cleared out the status of it should show as out, not returned yet").
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

  it('reads "Returned" for a fully returned RGP, never "Matched"', async () => {
    row = pass({ status: 'matched', return_status: 'returned' });
    renderDetail();
    // The header badge and the rail's own closing rung now say DIFFERENT
    // things on purpose (client, 2026-09-01): the badge names the material
    // ("Returned"), the rail's rung names the paperwork ("Closed") — one of
    // each, not the same word twice.
    await waitFor(() => expect(screen.getByText('Returned')).toBeInTheDocument());
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('reads "Out — Awaiting Return" for an RGP still outside with nothing back', async () => {
    row = pass({ return_status: 'awaiting_return', actual_return_date: null });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Out — Awaiting Return')).toBeInTheDocument());
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('reads "Out — No Return Due" for an NRGP, whose outward trip IS its end state', async () => {
    row = pass({ type: 'NRGP', return_status: 'not_applicable', actual_return_date: null });
    renderDetail();
    // No "Closed" anywhere: this pass has no recorded gate event, so the
    // ladder's own gate rung is worded as the event — "Cleared by Security" —
    // not as the pass's resulting state, and the header no longer borrows the
    // RGP's closing word (client, 2026-09-01).
    await waitFor(() => expect(screen.getByText('Out — No Return Due')).toBeInTheDocument());
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  // The whole point of dropping "Matched" from the badge: the moment has to be
  // legible somewhere, and the detail page is where the client asked for it.
  // Since 2026-08-18 the page renders the Search Pass record, so the wording is
  // that rail's — `PassRecordActivity`'s Record<VerifyAction, string>.
  it('shows both gate events in the timeline', async () => {
    row = pass({ status: 'matched', return_status: 'returned' });
    verifications = [
      { id: 'v1', gate_pass_id: 'p1', action: 'matched', security_name: 'Guard One', created_at: '2026-08-01T07:00:00Z', verified_quantity: null, verified_vehicle: null, remarks: null },
      { id: 'v2', gate_pass_id: 'p1', action: 'returned', security_name: 'Guard Two', created_at: '2026-08-03T07:00:00Z', verified_quantity: null, verified_vehicle: null, remarks: null },
    ];
    renderDetail();
    await waitFor(() => expect(screen.getByText('Cleared out at the gate')).toBeInTheDocument());
    expect(screen.getByText('Material marked returned')).toBeInTheDocument();
  });
});

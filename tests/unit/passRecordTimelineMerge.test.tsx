// ONE TIMELINE ON A PASS, AND THE ACTION AT THE FOOT OF IT (client, 2026-08-19).
//
// The record used to carry two rails side by side: the approval ladder (who
// signs) and the activity trail (what the gate did). They are one story about
// one pass read top to bottom, and a reader comparing them had to hold two
// columns in their head. So there is now ONE card: the ladder's rungs, then the
// gate's own events under them, oldest first, on the same rail.
//
// The guard's Approve OUT moved OUT of the header and to the BOTTOM of the
// record — the client's own words, "for better visibility": it is the last
// thing under the material table a guard has just finished reading, not a small
// button above the fold.
//
// And the fact strip no longer carries "Multi-level Approval — 5 of 5 levels
// approved" (client). The ladder itself states every level; a counter of them
// was the same fact twice, and the slot carries the vendor's address instead.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

let row: GatePassView;
let verifications: unknown[] = [];

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0003', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix Solutions","a":"B-108, Sector 63, Noida","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24',
    actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2099-08-19T18:30:00Z',
    created_at: '2026-08-18T05:00:00Z', updated_at: '2026-08-18T06:15:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 1000, returned_quantity: 0, total_value: 5000,
    material_summary: 'Diesel',
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
    gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u9' } } }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

async function renderAs(role: 'guard' | 'hod' | 'admin') {
  render(
    <MemoryRouter initialEntries={['/pass/p1']}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail role={role} />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
}

beforeEach(() => {
  row = pass();
  verifications = [
    {
      id: 'v1', gate_pass_id: 'p1', action: 'flagged', remarks: 'two crates short',
      gate_name: null, security_id: 'g1', security_name: 'Guard One',
      created_at: '2026-08-18T06:15:00Z',
    },
  ];
});

describe('the pass carries ONE timeline', () => {
  it('puts the gate activity on the approval rail, in one card', async () => {
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));
    // The ladder's own rungs …
    expect(rail.getByText('Raised By')).toBeInTheDocument();
    expect(rail.getByText('Level 1 Approval')).toBeInTheDocument();
    // … and the gate's events, with the remark that explains them.
    expect(rail.getByText('Rejected at the security gate')).toBeInTheDocument();
    expect(rail.getByText('two crates short')).toBeInTheDocument();
    expect(rail.getByText(/Guard One/)).toBeInTheDocument();
  });

  it('has no second rail — the old Activity timeline card is gone', async () => {
    await renderAs('hod');
    expect(screen.queryByText('Activity timeline')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('pass-timeline')).toHaveLength(1);
  });

  it('says so when the gate has recorded nothing yet, without a card of its own', async () => {
    verifications = [];
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));
    expect(rail.getByText('Nothing recorded at the gate yet.')).toBeInTheDocument();
  });
});

describe('Approve OUT sits at the foot of the record', () => {
  it('is in the bottom action bar, after the timeline, for a guard', async () => {
    await renderAs('guard');
    const bar = screen.getByTestId('record-actions');
    const link = within(bar).getByRole('link', { name: 'Approve OUT' });
    expect(link).toHaveAttribute('href', '/verify/p1');
    // Catches a second copy left behind in the header: a pass with two Approve
    // buttons is a pass where one of them is the stale one.
    expect(screen.getAllByRole('link', { name: 'Approve OUT' })).toHaveLength(1);
    // DOM order is the layout claim — the bar follows the rail.
    expect(
      screen.getByTestId('pass-timeline').compareDocumentPosition(bar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws no bar at all for a reader who cannot clear the gate', async () => {
    await renderAs('hod');
    expect(screen.queryByTestId('record-actions')).not.toBeInTheDocument();
  });
});

describe('the fact strip', () => {
  it('no longer counts the approval levels', async () => {
    await renderAs('guard');
    expect(screen.queryByText('Multi-level Approval')).not.toBeInTheDocument();
    expect(screen.queryByText(/levels? approved/)).not.toBeInTheDocument();
  });

  it('carries the vendor address', async () => {
    await renderAs('hod');
    expect(screen.getByText('Vendor Address')).toBeInTheDocument();
    expect(screen.getByText('B-108, Sector 63, Noida')).toBeInTheDocument();
  });
});

// THE RETURN IS THE LAST RUNG, ALWAYS (client, 2026-08-19: "Cleared out at the
// gate should be just before the return … To Be Returned should be after
// Cleared out at the gate"). The ladder's own order puts its return step
// straight after the gate step, which pushed it ABOVE the recorded gate events
// once the two rails merged — so the card claimed the material was due back
// before it had left. The return step now closes the rail, under the activity.
describe('the return closes the rail', () => {
  function railLines(): string[] {
    return Array.from(screen.getByTestId('pass-timeline').querySelectorAll('li'))
      .map((li) => li.textContent ?? '');
  }

  beforeEach(() => {
    row = pass({
      status: 'matched',
      verified_at: '2026-08-18T06:15:00Z',
      verified_by_name: 'Guard One',
      return_status: 'awaiting_return',
    });
    verifications = [
      {
        id: 'v1', gate_pass_id: 'p1', action: 'matched', remarks: null,
        gate_name: 'Service Gate', security_id: 'g1', security_name: 'Guard One',
        created_at: '2026-08-18T06:15:00Z',
      },
    ];
  });

  it('draws To Be Returned after the gate clearance, not before it', async () => {
    await renderAs('hod');
    const lines = railLines();
    const approval = lines.findIndex((t) => t.includes('Cleared by Security'));
    const cleared = lines.findIndex((t) => t.includes('Cleared out at the gate'));
    const back = lines.findIndex((t) => t.includes('To Be Returned'));
    expect(approval).toBeGreaterThanOrEqual(0);
    expect(cleared).toBeGreaterThan(approval);
    expect(back).toBeGreaterThan(cleared);
    // and it is the very last rung on the rail
    expect(back).toBe(lines.length - 1);
  });

  it('keeps the closing rung last too, once the material is back', async () => {
    row = pass({
      status: 'matched',
      verified_at: '2026-08-18T06:15:00Z',
      return_status: 'returned',
      actual_return_date: '2026-08-19T04:00:00Z',
    });
    verifications = [
      {
        id: 'v1', gate_pass_id: 'p1', action: 'matched', remarks: null,
        gate_name: null, security_id: 'g1', security_name: 'Guard One',
        created_at: '2026-08-18T06:15:00Z',
      },
      {
        id: 'v2', gate_pass_id: 'p1', action: 'returned', remarks: null,
        gate_name: null, security_id: 'g1', security_name: 'Guard One',
        created_at: '2026-08-19T04:00:00Z',
      },
    ];
    await renderAs('hod');
    const lines = railLines();
    expect(lines[lines.length - 1]).toContain('Closed');
    expect(lines.findIndex((t) => t.includes('Material marked returned')))
      .toBeLessThan(lines.length - 1);
  });
});

// THE CLEARANCE IS WRITTEN ONCE, AND THE END OF THE PASS IS CALLED "CLOSED"
// (client, 2026-08-23: "since 'cleared out' is already mentioned once, the
// second time you just mention closed … in the same green … make the closed
// bold"). The ladder's own gate rung already says the material was cleared by
// security; the recorded gate event underneath repeated it word for word. On an
// NRGP — which never comes back — that second line is what closes the pass, so
// it says so. An RGP keeps the plain wording there, because its material is
// still out, and closes on its return rung instead.
describe('the rail says "Closed" once, at the end', () => {
  function railLines(): string[] {
    return Array.from(screen.getByTestId('pass-timeline').querySelectorAll('li'))
      .map((li) => li.textContent ?? '');
  }

  const clearedAtTheGate = {
    id: 'v1', gate_pass_id: 'p1', action: 'matched', remarks: null,
    gate_name: 'Service Gate', security_id: 'g1', security_name: 'Arjun Mehta',
    created_at: '2026-08-22T06:05:00Z',
  };

  it('closes an NRGP at the gate, in bold matched green, saying it only once', async () => {
    row = pass({
      type: 'NRGP', return_status: 'not_applicable',
      status: 'matched', verified_at: '2026-08-22T06:05:00Z', verified_by_name: 'Arjun Mehta',
    });
    verifications = [clearedAtTheGate];
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));

    const closed = rail.getByText('Closed');
    expect(closed.className).toContain('font-bold');
    expect(closed.className).toContain('text-matched-700');
    // The ladder rung above still names the clearance — the recorded event no
    // longer says the same words a second time.
    expect(rail.getByText('Cleared by Security')).toBeInTheDocument();
    expect(rail.queryByText('Cleared out at the gate')).toBeNull();
  });

  it('leaves an RGP still out reading "Cleared out at the gate", not closed', async () => {
    row = pass({
      status: 'matched', verified_at: '2026-08-22T06:05:00Z', verified_by_name: 'Arjun Mehta',
      return_status: 'awaiting_return',
    });
    verifications = [clearedAtTheGate];
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));
    expect(rail.getByText('Cleared out at the gate')).toBeInTheDocument();
    expect(rail.queryByText('Closed')).toBeNull();
  });

  it('closes a returned RGP on its last rung, in the same bold green', async () => {
    row = pass({
      status: 'matched', verified_at: '2026-08-22T06:05:00Z', verified_by_name: 'Arjun Mehta',
      return_status: 'returned', actual_return_date: '2026-08-23T04:00:00Z',
    });
    verifications = [
      clearedAtTheGate,
      {
        id: 'v2', gate_pass_id: 'p1', action: 'returned', remarks: null,
        gate_name: null, security_id: 'g1', security_name: 'Arjun Mehta',
        created_at: '2026-08-23T04:00:00Z',
      },
    ];
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));
    const closed = rail.getByText('Closed');
    expect(closed.className).toContain('font-bold');
    expect(closed.className).toContain('text-matched-700');
    // …and it is the last rung on the rail.
    expect(railLines()[railLines().length - 1]).toContain('Closed');
  });
});

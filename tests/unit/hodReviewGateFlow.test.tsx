// The flag → HOD approval → gate release chain, end to end.
//
// Security flags a pass (status 'flagged'); the HOD reviews and approves it
// ('hod_reviewed'); the truck is then still standing at the barrier. The
// server has always accepted 'hod_reviewed' in match_pass, but the guard's UI
// dead-ended: the queue filtered status = 'pending' only, and Verify hid the
// Approve button (then labelled Match) for anything that was not 'pending'. A pass approved by the
// HOD could therefore never be cleared through the UI at all.
//
// These tests pin the three links of the chain: the queue shows such a pass,
// Verify offers a working Approve for it, and the board lists it with the action
// that clears it.
//
// THE QUEUE HAS MOVED FOUR TIMES. Search Pass became search-only on
// 2026-08-18 and the list became the guard dashboard's "Pending for Gate
// Approval" figure; on 2026-08-19 the dashboard's two preview tables were
// deleted in favour of two drillable summary cards and the list became its own
// page, `/pending-out`; on 2026-08-22 the client took that page and its
// sidebar tab away again, so the list opened IN PLACE on the dashboard when the
// figure that counts it was pressed; and on 2026-08-23 the client reversed
// that too — "don't show the table on the same page ... show it on a
// different page, like you are showing the overdue details" — so the RGP
// figure is a `<Link>` again, to `/guard-dashboard/RGP`, which `GuardDrill`
// renders. Its query is unchanged through all four - still its own read,
// deliberately not day-scoped - so this is still where the test looks for the
// approved pass, because it is the only list a guard picks one from.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260808-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: 'Qty short',
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const APPROVED = pass({
  id: 'h1',
  pass_number: 'APPROVED-0001',
  status: 'hod_reviewed',
  flag_reason: 'Qty short',
  // 035 refreshes expiry on approval: an override makes a FRESH pass, and the
  // gate controls are gated on the pass's own expiry.
  expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
});

// Mutable slot the hoisted mock reads. The screen under test decides which
// call it is by the table name it asked for.
let verifyRow: GatePassView | null = null;
let queueRows: GatePassView[] = [];
const queueInCalls: { col: string; values: string[] }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order', 'gte', 'lt']) o[m] = () => o;
    o.in = (col: string, values: string[]) => {
      queueInCalls.push({ col, values });
      return o;
    };
    o.maybeSingle = () => Promise.resolve({ data: verifyRow ?? null, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_gate_pass_items' ? [] : queueRows, error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      channel: vi.fn(() => ch),
      removeChannel: () => undefined,
    },
  };
});

/** `GuardDrill` at `/guard-dashboard/RGP`, which is what the RGP figure links
 *  to since 2026-08-23 and the only place that list exists. Every pass in this
 *  spec is an RGP, so the RGP figure's own page is where it must show up. */
async function renderQueue() {
  const GuardDrill = (await import('../../src/pages/Security/GuardDrill')).default;
  const { Routes, Route } = await import('react-router-dom');
  render(
    <MemoryRouter initialEntries={['/guard-dashboard/RGP']}>
      <Routes>
        <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('tablist', { name: 'Pass type' })).toBeInTheDocument());
}

describe('HOD-approved passes at the gate (flag → hod_reviewed → clear)', () => {
  beforeEach(() => {
    verifyRow = null;
    queueRows = [];
    queueInCalls.length = 0;
    vi.clearAllMocks();
  });

  describe('the gate queue, drilled open on its own page', () => {
    it('includes hod_reviewed passes in the queue, not just pending', async () => {
      queueRows = [APPROVED];
      await renderQueue();

      await waitFor(() => expect(screen.getByText('APPROVED-0001')).toBeInTheDocument());
      const statusIn = queueInCalls.find((c) => c.col === 'status');
      expect(statusIn).toBeDefined();
      expect(statusIn!.values).toEqual(expect.arrayContaining(['pending', 'hod_reviewed']));
      // And the row reaches the pass, which is what makes it clearable —
      // otherwise it is visible and stuck, the original bug in a new place.
      // Approve OUT opens the DECISION since 2026-08-23, not the record above it.
      expect(screen.getByRole('link', { name: /approve out/i })).toHaveAttribute('href', '/verify/h1');
    });
  });

  describe('Verify screen', () => {
    async function renderVerify() {
      const Verify = (await import('../../src/pages/Security/Verify')).default;
      const { Routes, Route } = await import('react-router-dom');
      return render(
        <MemoryRouter initialEntries={['/verify/h1']}>
          <Routes>
            <Route path="/verify/:id" element={<Verify />} />
          </Routes>
        </MemoryRouter>
      );
    }

    it('offers both Approve and Flag to Requester for a hod_reviewed pass', async () => {
      verifyRow = APPROVED;
      await renderVerify();

      await waitFor(() => expect(screen.getByText(/APPROVED-0001/)).toBeInTheDocument());
      // Approve / Reject since 2026-08-20, and Approve / Flag to Requester
      // since 2026-08-23 (client). The RPCs are unchanged throughout — this is
      // still match_pass and flag_pass underneath.
      const matchBtn = screen.getByRole('button', { name: 'Approve' });
      expect(matchBtn).toBeInTheDocument();
      expect(matchBtn).toBeEnabled();
      // 035: an override approval is not a fact about the material — the guard
      // at the barrier must still be able to re-flag a fresh pass whose
      // mismatch was not actually fixed. flag_pass admits hod_reviewed now.
      const flagBtn = screen.getByRole('button', { name: 'Flag to Requester' });
      expect(flagBtn).toBeInTheDocument();
      expect(flagBtn).toBeEnabled();
    });

    it('shows an HOD-approved banner on the Verify screen', async () => {
      verifyRow = APPROVED;
      await renderVerify();

      await waitFor(() => expect(screen.getByText(/approved by the hod/i)).toBeInTheDocument());
    });
  });

  // The RGP figure's number is the only way into this list, and since
  // 2026-08-23 it opens the list on a page of its own again. The chain this
  // whole spec exists to protect is NOT broken by that move, and this case is
  // what proves it: an HOD-approved pass sits in the list the figure opens,
  // carrying the action that clears it (renamed "Approve OUT"; the Verify
  // screen still accepts it, asserted above).
  describe('the Pending OUT list', () => {
    it('lists an HOD-approved pass with a working Approve OUT action', async () => {
      queueRows = [APPROVED, pass({ id: 'p2', pass_number: 'PEND-0001', status: 'pending' })];
      await renderQueue();

      await waitFor(() => expect(screen.getByText('APPROVED-0001')).toBeInTheDocument());

      const row = screen.getByText('APPROVED-0001').closest('tr')!;
      expect(within(row).getByRole('link', { name: 'Approve OUT' })).toHaveAttribute('href', '/verify/h1');

      // And it asked the database for BOTH states the gate can still act on —
      // narrowing this back to 'pending' alone is the original bug.
      expect(queueInCalls.some((c) => c.col === 'status' && c.values.includes('hod_reviewed'))).toBe(true);
    });
  });
});
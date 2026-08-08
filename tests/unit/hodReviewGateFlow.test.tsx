// The flag → HOD approval → gate release chain, end to end.
//
// Security flags a pass (status 'flagged'); the HOD reviews and approves it
// ('hod_reviewed'); the truck is then still standing at the barrier. The
// server has always accepted 'hod_reviewed' in match_pass, but the guard's UI
// dead-ended: the queue filtered status = 'pending' only, and Verify hid the
// Match button for anything that was not 'pending'. A pass approved by the
// HOD could therefore never be cleared through the UI at all.
//
// These tests pin the three links of the chain: the queue shows such a pass,
// Verify offers a working Match for it, and the dashboard has a drill for it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('HOD-approved passes at the gate (flag → hod_reviewed → clear)', () => {
  beforeEach(() => {
    verifyRow = null;
    queueRows = [];
    queueInCalls.length = 0;
    vi.clearAllMocks();
  });

  describe('GateConsole queue', () => {
    it('includes hod_reviewed passes in the queue, not just pending', async () => {
      queueRows = [APPROVED];
      const GateConsole = (await import('../../src/pages/Security/GateConsole')).default;
      render(
        <MemoryRouter>
          <GateConsole />
        </MemoryRouter>
      );

      await waitFor(() => expect(screen.getByText('APPROVED-0001')).toBeInTheDocument());
      const statusIn = queueInCalls.find((c) => c.col === 'status');
      expect(statusIn).toBeDefined();
      expect(statusIn!.values).toEqual(expect.arrayContaining(['pending', 'hod_reviewed']));
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

    it('offers a Match for a hod_reviewed pass and no Flag', async () => {
      verifyRow = APPROVED;
      await renderVerify();

      await waitFor(() => expect(screen.getByText(/APPROVED-0001/)).toBeInTheDocument());
      const matchBtn = screen.getByRole('button', { name: /match/i });
      expect(matchBtn).toBeInTheDocument();
      expect(matchBtn).toBeEnabled();
      // The mismatch already has its outcome — the HOD's decision — so re-
      // flagging is not offered; only the go-ahead remains.
      expect(screen.queryByRole('button', { name: /flag mismatch/i })).not.toBeInTheDocument();
    });

    it('shows an HOD-approved banner on the Verify screen', async () => {
      verifyRow = APPROVED;
      await renderVerify();

      await waitFor(() => expect(screen.getByText(/approved by the hod/i)).toBeInTheDocument());
    });
  });

  describe('Dashboard drill', () => {
    it('has a drill that matches hod_reviewed passes', async () => {
      const { DRILL_DEFS, DRILL_ORDER } = await import('../../src/lib/guardDrills');
      expect(DRILL_ORDER).toContain('approved');
      expect(DRILL_DEFS.approved.match(pass({ status: 'hod_reviewed' }))).toBe(true);
      expect(DRILL_DEFS.approved.match(pass({ status: 'pending' }))).toBe(false);
    });

    it('renders an HOD Approved KPI on the dashboard', async () => {
      queueRows = [APPROVED, pass({ id: 'p2', pass_number: 'PEND-0001', status: 'pending' })];
      const GuardDashboard = (await import('../../src/pages/Security/GuardDashboard')).default;
      render(
        <MemoryRouter>
          <GuardDashboard />
        </MemoryRouter>
      );

      await waitFor(() => expect(screen.getByText('HOD Approved')).toBeInTheDocument());
      fireEvent.click(screen.getByText('HOD Approved'));
      await waitFor(() => expect(screen.getByText('APPROVED-0001')).toBeInTheDocument());
    });
  });
});
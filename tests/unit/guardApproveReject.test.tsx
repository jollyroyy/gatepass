// The guard's gate decision is APPROVE or REJECT — nothing else.
//
// Client, 2026-08-20: "for the guard's view, whatever is pending for him to
// check … during the approval page put it as approve and reject. Don't put
// mismatched or something … and if rejects, make the rejection reason
// mandatory."
//
// THIS IS A WORDING CHANGE, NOT A STATE-MACHINE CHANGE. Approve is still
// `match_pass` and Reject is still `flag_pass` — a rejected pass still goes
// back to the raising HOD for review, which is the mechanism that has always
// been behind the old "Flag Mismatch" button. The RPCs, the statuses and the
// HOD's review screen are untouched; only what the guard reads changed.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const PASS: GatePassView = {
  id: 'p1', pass_number: 'RGP-20260820-0001', type: 'RGP', direction: 'out',
  status: 'pending', return_status: 'awaiting_return',
  department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
  raised_by: 'u1', raised_by_name: 'HOD One',
  visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
  purpose: null, expected_return_date: null, actual_return_date: null,
  verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
  qr_token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString(),
  created_at: new Date().toISOString(),
  is_overdue: false, is_expired: false, due_state: 'none',
  item_count: 1, total_quantity: 2, returned_quantity: 0,
  material_summary: 'Drill',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order', 'in']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: PASS, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'v_gate_pass_items'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? ([{ id: 'i1', gate_pass_id: 'p1', line_no: 1, description: 'Drill', quantity: 2, unit: 'nos' }] as any)
            : [],
        error: null,
      }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({
      from: (t: string) => builder(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
    }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'g1' } } }) },
      channel: vi.fn(() => ch),
      removeChannel: () => undefined,
    },
  };
});

async function renderVerify() {
  const Verify = (await import('../../src/pages/Security/Verify')).default;
  render(
    <MemoryRouter initialEntries={['/verify/p1']}>
      <Routes>
        <Route path="/verify/:id" element={<Verify />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByText('RGP-20260820-0001')).toBeInTheDocument());
}

describe("the guard's decision screen says Approve and Flag to Requester", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
  });

  // The second answer was called Reject until 2026-08-23, when the client
  // renamed it to what it has always DONE: "replace the reject with flag to
  // requestor button". Match, Mismatch and Hold stay banned — they are the
  // database's words, not the barrier's.
  it('offers exactly Approve and Flag to Requester, and never Match, Mismatch or Hold', async () => {
    await renderVerify();

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^flag to requester$/i })).toBeEnabled();

    for (const banned of [/match/i, /mismatch/i, /\bhold\b/i, /^reject$/i]) {
      expect(screen.queryAllByRole('button', { name: banned })).toHaveLength(0);
    }
  });

  it('approving confirms through match_pass', async () => {
    await renderVerify();

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm approval/i }));

    await waitFor(() => expect(rpcCalls.map((c) => c.fn)).toContain('match_pass'));
  });

  it('will not flag a pass without a reason, and sends the typed one', async () => {
    await renderVerify();

    fireEvent.click(screen.getByRole('button', { name: /^flag to requester$/i }));

    const confirm = screen.getByRole('button', { name: /send to requester/i });
    // Mandatory: the control is dead until a reason is typed, and pressing it
    // in that state must not reach the database.
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(rpcCalls).toHaveLength(0);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Only 1 drill of 2 present.  ' } });
    expect(screen.getByRole('button', { name: /send to requester/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /send to requester/i }));

    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0].fn).toBe('flag_pass');
    expect(rpcCalls[0].args.p_reason).toBe('Only 1 drill of 2 present.');
  });

  it('whitespace alone is not a reason', async () => {
    await renderVerify();

    fireEvent.click(screen.getByRole('button', { name: /^flag to requester$/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '     ' } });

    expect(screen.getByRole('button', { name: /send to requester/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /send to requester/i }));
    expect(rpcCalls).toHaveLength(0);
  });
});

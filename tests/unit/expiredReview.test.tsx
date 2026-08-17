// THE TWO DECISIONS an expiry notification leads to (client, 2026-08-17): "make
// it null and void and notify the HOD about that so that he can either raise it
// or reject it. He can review it and raise it or maybe void it completely."
//
// WHAT IS EASY TO GET WRONG HERE, and is therefore what this file pins:
//
//   1. THE VOID IS ITS OWN RPC. `hod_review_flagged_pass` refuses anything that
//      is not currently flagged, so calling it here would fail on every single
//      expired pass — and it would fail at the END of the flow, after the HOD
//      had confirmed. `hod_void_expired_pass` (041) is the one that admits a
//      pending, genuinely-expired pass.
//   2. THE OLD PASS IS NOT VOIDED ON THE WAY TO THE RAISE FORM. An HOD who opens
//      the form and walks away must not have destroyed the record of what was
//      authorised. The supersede happens after the replacement is submitted,
//      which `reraisePass.test.tsx` covers.
//   3. A PASS THAT IS NO LONGER PENDING GETS AN EXPLANATION, not buttons the RPC
//      would refuse.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const PASS: GatePassView = {
  id: 'p-expired',
  pass_number: 'RGP-OUT-20260816-0004',
  type: 'RGP',
  direction: 'out',
  status: 'pending',
  is_expired: true,
  expires_at: new Date(2026, 7, 16, 23, 59).toISOString(),
  created_at: new Date(2026, 7, 16, 9, 0).toISOString(),
  flag_reason: null,
  verified_by_name: null,
  flagged_at: null,
  visitor_name: 'Alice',
  material_summary: 'Ladder',
  return_status: 'not_applicable',
  is_overdue: false,
  due_state: 'not_applicable',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let passRow: GatePassView | null = PASS;

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(ok, bad),
  };
  for (const m of ['select', 'eq', 'order', 'limit']) obj[m] = () => obj;
  obj.maybeSingle = () => thenable(data);
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => thenable(passRow),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import ExpiredReview from '../../src/pages/HOD/ExpiredReview';

/** Prints the pathname AND whatever router state came with it, so "raise it
 *  again carries the pass it is replacing" is assertable without mocking. */
function Here(): React.ReactElement {
  const loc = useLocation();
  return (
    <span data-testid="where">
      {loc.pathname}|{JSON.stringify(loc.state ?? null)}
    </span>
  );
}

function renderReview() {
  return render(
    <MemoryRouter initialEntries={['/expired/p-expired']}>
      <Routes>
        <Route path="/expired/:id" element={<ExpiredReview />} />
        <Route path="*" element={<Here />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  passRow = PASS;
});

describe('the expired-pass review screen', () => {
  it('says the pass is null and void, and when it died', async () => {
    // The consequence, not the mechanism: an HOD reading "Expired" has to work
    // out for themselves that the gate can no longer clear it.
    renderReview();
    expect(await screen.findByText('Null and void')).toBeInTheDocument();
    expect(screen.getByText(/Security can no longer clear it/)).toBeInTheDocument();
    expect(screen.getAllByText(/RGP-OUT-20260816-0004/).length).toBeGreaterThan(0);
  });

  it('offers exactly the two decisions the client asked for', async () => {
    renderReview();
    expect(await screen.findByRole('button', { name: 'Raise It Again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void It Permanently' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('voids through hod_void_expired_pass, behind a confirmation', async () => {
    // NOT `hod_review_flagged_pass`: that RPC refuses anything that is not
    // flagged, so it would fail on every expired pass — after the HOD confirmed.
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Void It Permanently' }));
    expect(rpcCalls).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm — Void It Permanently' }));
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0].fn).toBe('hod_void_expired_pass');
    expect(rpcCalls[0].args.p_pass_id).toBe('p-expired');
  });

  it('"raise it again" carries the pass being replaced, and voids nothing yet', async () => {
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Raise It Again' }));

    const where = screen.getByTestId('where').textContent ?? '';
    expect(where.startsWith('/raise|')).toBe(true);
    expect(JSON.parse(where.split('|')[1])).toEqual({ copyFrom: 'p-expired' });
    // The old pass is still the only record of what was authorised until the
    // replacement actually exists.
    expect(rpcCalls).toEqual([]);
  });

  it('offers no decision on a pass that is no longer pending', async () => {
    // Someone else's decision, another tab, or the gate clearing it after all:
    // the RPC would refuse, so the screen must not draw the button.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passRow = { ...PASS, status: 'cancelled' } as any;
    renderReview();
    expect(await screen.findByText(/no longer awaiting your decision/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void It Permanently' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise It Again' })).not.toBeInTheDocument();
  });

  it('offers no decision on a pass that has not actually expired', async () => {
    // The screen's own eligibility test is the view's `is_expired`, never a
    // comparison against `expires_at` in TypeScript — the view computes it in
    // `site_tz()`, and the RPC re-checks it on the server regardless.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passRow = { ...PASS, is_expired: false } as any;
    renderReview();
    expect(await screen.findByText(/no longer awaiting your decision/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void It Permanently' })).not.toBeInTheDocument();
  });
});

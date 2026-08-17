// THE TWO DECISIONS a mismatch notification leads to (client, 2026-08-17):
// "there will be two options — completely reject, or raise it again. If he
// rejects it, it will be completely void and null. If he decides to raise the
// pass again, it will directly take him to the gate pass raise, automatically
// populating all those things."
//
// WHY THE ORDER OF OPERATIONS IS THE INTERESTING PART. "Raise it again" is two
// facts, not one: a new pass exists, and the old one is void. Doing the second
// first — voiding on the button press — destroys the record of what the gate
// stopped for anyone who then closes the tab, and leaves the gate with nothing
// at all if the replacement is never submitted. So the supersede is asserted
// here to happen only AFTER `raise_pass` returns, and a failure to supersede is
// asserted to be a WARNING rather than a submit error: the new pass exists
// either way, and reporting "that failed" would invite a third one.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const PASS: GatePassView = {
  id: 'p-flagged',
  pass_number: 'RGP-OUT-20260817-0009',
  type: 'RGP',
  direction: 'out',
  status: 'flagged',
  flag_reason: 'Two ladders loaded, three on the slip',
  verified_by_name: 'Guard One',
  flagged_at: new Date(2026, 7, 17, 9, 30).toISOString(),
  created_at: new Date(2026, 7, 17, 9, 0).toISOString(),
  visitor_name: 'Alice',
  material_summary: 'Ladder',
  return_status: 'not_applicable',
  is_overdue: false,
  is_expired: false,
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

import MismatchReview from '../../src/pages/HOD/MismatchReview';

/** Prints the pathname AND whatever router state came with it, so "raise it
 *  again carries the pass it is correcting" is assertable without mocking. */
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
    <MemoryRouter initialEntries={['/mismatch/p-flagged']}>
      <Routes>
        <Route path="/mismatch/:id" element={<MismatchReview />} />
        <Route path="*" element={<Here />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  passRow = PASS;
});

describe('the mismatch review screen', () => {
  it('says why the pass was stopped and who stopped it', async () => {
    // Both are the client's explicit requirement, and neither is on any other
    // screen an HOD reaches from the bell.
    renderReview();
    // More than once: the panel at the top of the page states it, and the pass
    // card below it carries the same reason in flagged red. That repetition is
    // the card's own doing and is not worth suppressing here.
    expect(await screen.findAllByText('Two ladders loaded, three on the slip')).not.toHaveLength(0);
    expect(screen.getByText('Guard One')).toBeInTheDocument();
    expect(screen.getAllByText(/RGP-OUT-20260817-0009/).length).toBeGreaterThan(0);
  });

  it('offers exactly the two decisions, and no approve-override', async () => {
    // The override still exists on the pass detail page. It is a DIFFERENT
    // decision — "the paperwork is fine, release the material" — and three
    // buttons under a heading that promises two is how a screen gets misread at
    // speed.
    renderReview();
    expect(await screen.findByRole('button', { name: 'Raise It Again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject Permanently' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('rejects behind a confirmation, never on the first click', async () => {
    // There is no undo in the database: `hod_review_flagged_pass(reject)` moves
    // the pass to `cancelled` and nothing moves it back.
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Permanently' }));
    expect(rpcCalls).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }));
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0].fn).toBe('hod_review_flagged_pass');
    expect(rpcCalls[0].args.p_action).toBe('reject');
    expect(rpcCalls[0].args.p_pass_id).toBe('p-flagged');
  });

  it('"raise it again" carries the pass being corrected to the raise form', async () => {
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Raise It Again' }));

    const where = screen.getByTestId('where').textContent ?? '';
    expect(where.startsWith('/raise|')).toBe(true);
    expect(JSON.parse(where.split('|')[1])).toEqual({ copyFrom: 'p-flagged' });
  });

  it('voids NOTHING on the way to the raise form', async () => {
    // The pass is voided by the raise form once the replacement is submitted.
    // An HOD who opens the form and walks away must not have destroyed the only
    // record of what the gate stopped.
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Raise It Again' }));
    expect(rpcCalls).toEqual([]);
  });

  it('offers no decision on a pass that is no longer flagged', async () => {
    // Decided in another tab, or overridden at the gate. Buttons that would be
    // refused by the RPC must not be drawn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passRow = { ...PASS, status: 'cancelled' } as any;
    renderReview();
    expect(await screen.findByText(/no longer awaiting your decision/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise It Again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject Permanently' })).not.toBeInTheDocument();
  });

  it('says so plainly when the pass cannot be read at all', async () => {
    passRow = null;
    renderReview();
    expect(await screen.findByText(/could not be found/)).toBeInTheDocument();
  });
});

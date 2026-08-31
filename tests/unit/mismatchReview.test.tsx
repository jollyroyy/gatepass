// THERE IS NOW EXACTLY ONE THING TO DO HERE, AND IT IS NOT A DECISION. Client,
// 2026-08-31: "once a guard rejects a pass he has to mention the justification
// as to why is he rejecting the pass and then the entire pass will be cancelled
// and a new pass needs to be raised." Migration 070 dropped
// `hod_review_flagged_pass` accordingly, so the two answers this screen used to
// offer (client, 2026-08-17: "completely reject, or raise it again") are both
// gone — "Reject Permanently" because the pass is ALREADY closed when this page
// opens, and the approve/uphold override because the RPC behind it no longer
// exists. What is left is RAISE IT AGAIN, and nothing is voided by pressing
// it: there is nothing left to void, so the RPC mock here must never be called
// with `hod_review_flagged_pass` at all.
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

  it('offers exactly one thing to do, and no approve-override', async () => {
    // Client, 2026-08-31: a guard's rejection is now final, so there is no
    // longer a decision to make here at all. "Reject Permanently" is gone
    // because the pass is ALREADY cancelled when this page opens; the
    // approve/uphold override lived on the pass detail page and is deleted
    // with the RPC behind it (migration 070 drops `hod_review_flagged_pass`).
    renderReview();
    expect(await screen.findByRole('button', { name: 'Raise It Again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject Permanently' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('states plainly that the pass is cancelled', async () => {
    // The heading and body copy are the client's finality requirement made
    // visible: nothing on this screen suggests the pass could still go out.
    renderReview();
    expect(await screen.findByText('This pass is cancelled')).toBeInTheDocument();
    expect(screen.getByText(/A rejection at the gate is final/)).toBeInTheDocument();
  });

  it('never calls the retired review RPC', async () => {
    // Migration 070 drops `hod_review_flagged_pass` entirely — there is no
    // server call left for this page to make about the pass it is showing.
    renderReview();
    await screen.findByRole('button', { name: 'Raise It Again' });
    fireEvent.click(screen.getByRole('button', { name: 'Raise It Again' }));
    expect(rpcCalls.some((c) => c.fn === 'hod_review_flagged_pass')).toBe(false);
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

  it('says so plainly when the pass cannot be read at all', async () => {
    passRow = null;
    renderReview();
    expect(await screen.findByText(/could not be found/)).toBeInTheDocument();
  });
});

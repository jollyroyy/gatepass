// The Delegation tab (client mock-up, 2026-08-22; migration 062).
//
// THE TWO INSTRUCTIONS THIS FILE EXISTS TO HOLD:
//
//   1. "make sure you don't show the history on the first page but only when
//      the user clicks on the top right corner, Delegation History, then only
//      you show them below a delegation history table."
//   2. "just remove the gate. No need to select, no need to give any option or
//      field to select the gate. Gate and what type of gate it should be, gate
//      path, so no need to mention the type of delegation gate pass and all."
//
// The second is pinned by NAME, over the whole rendered page, because it is the
// kind of thing that comes back the next time somebody works from the mock-up
// image rather than from what the client said about it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApprovalDelegation from '../../src/pages/Approver/ApprovalDelegation';
import type { DelegationRow } from '../../src/lib/approvalDelegation';

function thenable(result: { data: unknown; error: unknown }) {
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return obj;
}

const ACTIVE: DelegationRow = {
  id: 'd-live',
  role_key: 'coo',
  delegate_id: 'u-1',
  delegate_name: 'Priya Mehta',
  department_name: 'Housekeeping',
  starts_at: '2026-08-25T03:30:00Z',
  ends_at: '2026-08-30T18:29:00Z',
  approval_limit: null,
  reason: 'Official leave',
  status: 'active',
  created_at: '2026-08-22T04:15:00Z',
  revoked_at: null,
};

const EXPIRED: DelegationRow = {
  ...ACTIVE,
  id: 'd-old',
  delegate_name: 'Amit Verma',
  status: 'expired',
  approval_limit: 50000,
};

const CANDIDATES = [
  { id: 'u-2', full_name: 'Neha Iyer', department_name: 'Engineering' },
  { id: 'u-3', full_name: 'Rahul Nair', department_name: null },
];

let delegations: DelegationRow[] = [ACTIVE, EXPIRED];
let candidatesFail = false;

const rpc = vi.fn((name: string, _args?: unknown) => {
  if (name === 'list_my_delegations') return thenable({ data: delegations, error: null });
  if (name === 'list_delegation_candidates') {
    return candidatesFail
      ? thenable({ data: null, error: { message: 'You do not hold a gate pass approval office.' } })
      : thenable({ data: CANDIDATES, error: null });
  }
  return thenable({ data: null, error: null });
});

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
  pub: () => ({ rpc }),
}));

async function renderPage() {
  render(<ApprovalDelegation office="coo" />);
  // The status card is no longer drawn when nothing is delegated, so the load
  // is over when the skeleton goes — not when a particular card appears.
  await waitFor(() => {
    expect(document.querySelector('.gb-skeleton')).toBeNull();
  });
}

describe('Approval Delegation', () => {
  beforeEach(() => {
    rpc.mockClear();
    delegations = [ACTIVE, EXPIRED];
    candidatesFail = false;
  });

  // ── 1. The history is hidden until it is asked for ────────────────────────
  it('draws no history table until the Delegation History button is pressed', async () => {
    await renderPage();

    expect(screen.queryByText('Delegation History')).toBeTruthy(); // the BUTTON
    expect(screen.queryByRole('table')).toBeNull();
    // The expired delegation is history and must not be on the first screen at
    // all — not in a table, and not in the status card either.
    expect(screen.queryByText(/Amit Verma/)).toBeNull();

    const toggle = screen.getByRole('button', { name: /Delegation History/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText(/Amit Verma/)).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('pressing it again puts the history away', async () => {
    await renderPage();
    const toggle = screen.getByRole('button', { name: /Delegation History/i });
    fireEvent.click(toggle);
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('table')).toBeNull();
  });

  // ── 2. Nothing anywhere mentions a gate, a site or a pass type ────────────
  it('asks for no gate, no site and no delegation pass type — on the form OR in the history', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delegation History/i }));

    const page = document.body.textContent ?? '';
    for (const banned of ['Approval Type', 'Location / Site', 'Location/Site', 'Scope / Limit', 'Bangalore Plant', 'All Gate Pass Types']) {
      expect(page).not.toContain(banned);
    }
    // And no control of any kind for one, which the text sweep alone would miss
    // on a select whose label happened to be worded differently. The word
    // boundary matters: "Delegate To" contains "gate".
    expect(screen.queryByLabelText(/\bgate\b/i)).toBeNull();
    expect(screen.queryByLabelText(/\bsite\b/i)).toBeNull();
    expect(screen.queryByLabelText(/\bscope\b/i)).toBeNull();
  });

  it('asks for exactly the five fields that survived', async () => {
    await renderPage();
    expect(screen.getByLabelText(/Delegate To/i)).toBeTruthy();
    expect(screen.getByLabelText(/Start Date/i)).toBeTruthy();
    expect(screen.getByLabelText(/End Date/i)).toBeTruthy();
    expect(screen.getByLabelText(/Approval Limit/i)).toBeTruthy();
    expect(screen.getByLabelText(/Reason/i)).toBeTruthy();
  });

  // ── The status card ───────────────────────────────────────────────────────
  it('stands over the live delegation, naming the delegate and its window', async () => {
    await renderPage();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText(/Priya Mehta/)).toBeTruthy();
    // "No Limit" is the common case and is said out loud — a blank cell would
    // read as a ceiling the reader could not see.
    expect(screen.getByText('No Limit')).toBeTruthy();
  });

  // Client, 2026-08-23: "remove My Delegation Status / You have no delegation
  // running … from approver view". Holding an office nobody is covering is the
  // ordinary condition of all four, so the page says nothing about it at all.
  it('draws no status card when nothing is delegated', async () => {
    delegations = [EXPIRED];
    await renderPage();
    expect(screen.queryByText('My Delegation Status')).toBeNull();
    expect(screen.queryByText(/no delegation running/i)).toBeNull();
    expect(screen.queryByText('ACTIVE')).toBeNull();
  });

  it('still draws it, and its Revoke, while a delegation is live', async () => {
    await renderPage();
    expect(screen.getByText('My Delegation Status')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Revoke Delegation/i })).toBeTruthy();
  });

  // ── Writing one ───────────────────────────────────────────────────────────
  it('refuses to submit an empty form and never reaches the RPC', async () => {
    delegations = [];
    await renderPage();
    rpc.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Activate Delegation/i }));

    await waitFor(() => {
      expect(screen.getByText(/Choose somebody to delegate to/i)).toBeTruthy();
    });
    expect(rpc.mock.calls.some((c) => c[0] === 'create_approval_delegation')).toBe(false);
  });

  it('sends the office holder’s choices to create_approval_delegation and re-reads the list', async () => {
    delegations = [];
    await renderPage();
    rpc.mockClear();

    fireEvent.change(screen.getByLabelText(/Delegate To/i), { target: { value: 'u-2' } });
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2099-01-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2099-01-05T18:00' } });
    fireEvent.change(screen.getByLabelText(/Approval Limit/i), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /Activate Delegation/i }));

    await waitFor(() => {
      const call = rpc.mock.calls.find((c) => c[0] === 'create_approval_delegation');
      expect(call).toBeTruthy();
      const args = call![1] as Record<string, unknown>;
      expect(args.p_delegate_id).toBe('u-2');
      expect(args.p_approval_limit).toBe(50000);
      expect(args.p_reason).toBeNull();
    });
    // RE-READ, NEVER PATCHED: only the database knows whether the row it just
    // wrote came out `active` or `scheduled`.
    await waitFor(() => {
      expect(rpc.mock.calls.filter((c) => c[0] === 'list_my_delegations').length).toBeGreaterThan(0);
    });
  });

  // ── Revoking ──────────────────────────────────────────────────────────────
  it('takes two presses to revoke, because it cannot be undone', async () => {
    await renderPage();
    rpc.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /^Revoke Delegation$/i }));
    expect(rpc.mock.calls.some((c) => c[0] === 'revoke_approval_delegation')).toBe(false);
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Confirm Revoke/i }));
    await waitFor(() => {
      const call = rpc.mock.calls.find((c) => c[0] === 'revoke_approval_delegation');
      expect(call).toBeTruthy();
      expect((call![1] as Record<string, unknown>).p_id).toBe('d-live');
    });
  });

  it('offers nothing to press on a delegation that has already stopped', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delegation History/i }));
    // One live row and one expired one: exactly one Revoke control in the
    // table, and it is not the expired row's.
    const revokes = screen.getAllByRole('button', { name: /^Revoke$/i });
    expect(revokes).toHaveLength(1);
  });

  // ── Who may delegate at all ───────────────────────────────────────────────
  // `list_delegation_candidates` refuses anyone who does not HOLD an office, so
  // a current delegate gets no form. That is an answer,
  // not an error: they may act for the office but may not hand it on.
  it('draws no form for a stand-in, and does not report their refusal as a failure', async () => {
    candidatesFail = true;
    await renderPage();
    expect(screen.queryByLabelText(/Delegate To/i)).toBeNull();
    expect(screen.getByText(/nothing here for you to delegate onward/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create Delegation/i })).toBeNull();
    // The history button stays: their own (empty) history still reads.
    expect(screen.getByRole('button', { name: /Delegation History/i })).toBeTruthy();
  });

  // An account with no office cannot reach this route through App.tsx at all
  // (`APPROVER_ROUTES` is granted by holding one), so this is the belt to that
  // braces. It draws the reason and nothing else — no form, no history button,
  // nothing to press.
  //
  // ⚠ IT DOES STILL READ `list_my_delegations`, and that is the rules of hooks,
  // not an oversight: the hook cannot be called conditionally. The RPC is
  // scoped to `auth.uid()` server-side and hands such a caller an empty list, so
  // the cost is one wasted round trip on a screen nobody routes to.
  it('shows an account with no office the reason and nothing to press', () => {
    rpc.mockClear();
    render(<ApprovalDelegation office={null} />);
    expect(screen.getByText(/does not hold an approval office/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Delegate To/i)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(rpc.mock.calls.some((c) => c[0] === 'create_approval_delegation')).toBe(false);
  });
});

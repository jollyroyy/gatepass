// THE BELL COUNTS WHAT IS WAITING ON THIS OFFICE (client, 2026-08-20: "Suppose
// I am the CEO. On the top right corner in the Bell notification it should show
// the number of the pending approvals for me in red colour across all the
// approvers").
//
// It is derived, not pushed: a pass raised while the approver was signed out
// emits no realtime event they ever saw, so the queue is READ on mount — the
// same argument the mismatch/expiry derivation is built on. And it is the SAME
// rule the queue screen draws (`inMyQueue`), so the badge and the list under it
// cannot disagree: a badge saying 3 over a screen listing 2 is the exact defect
// the board invariant exists to prevent.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { NotificationProvider } from '../../src/lib/notifications';
import NotificationBell from '../../src/components/layout/NotificationBell';

const approvals: Record<string, unknown>[] = [];
const passes: Record<string, unknown>[] = [];

function table(name: string) {
  const rows = name === 'pass_approvals' ? approvals : passes;
  const res = { data: rows, error: null };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.is = () => q;
  q.order = () => q;
  q.in = () => q;
  q.then = (fn: (r: unknown) => unknown) => Promise.resolve(res).then(fn);
  return q;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: (name: string) => table(name), rpc: () => Promise.resolve({ data: [], error: null }) }),
  supabase: {
    channel: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch: any = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => undefined,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'coo-1' } } }) },
  },
}));

function fakeSession(): Session {
  return { user: { id: 'coo-1' } } as unknown as Session;
}

function pass(id: string, no: string) {
  return {
    id,
    pass_number: no,
    status: 'pending',
    created_at: '2026-08-20T04:00:00Z',
    type: 'RGP',
  };
}

function ladder(passId: string, statuses: Record<string, string>) {
  const levels: Record<string, number> = { security_head: 1, coo: 2, finance_head: 3, ceo: 4 };
  return Object.entries(statuses).map(([role_key, status]) => ({
    gate_pass_id: passId,
    role_key,
    level_no: levels[role_key],
    status,
    routed_to: null,
    decided_by: status === 'pending' ? null : 'someone',
    decided_at: status === 'pending' ? null : '2026-08-20T05:00:00Z',
    reason: null,
    created_at: '2026-08-20T04:00:00Z',
  }));
}

function renderBell(office: string | null) {
  return render(
    <MemoryRouter>
      <NotificationProvider session={fakeSession()} role={null} office={office as never}>
        <NotificationBell />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  approvals.length = 0;
  passes.length = 0;
  window.localStorage.clear();
});

describe("the bell's pending-approval count", () => {
  it('shows the number of passes waiting on this office', async () => {
    passes.push(pass('p1', 'RGP-20260820-0001'), pass('p2', 'RGP-20260820-0002'));
    approvals.push(
      ...ladder('p1', { security_head: 'approved', coo: 'pending', finance_head: 'pending', ceo: 'pending' }),
      ...ladder('p2', { security_head: 'approved', coo: 'pending', finance_head: 'pending', ceo: 'pending' }),
    );
    renderBell('coo');
    await waitFor(() => {
      expect(screen.getByLabelText(/2 unread/i)).toBeInTheDocument();
    });
  });

  // THE TURN IS PART OF THE COUNT (061): a pass the Security Head has not
  // signed is not waiting on the COO, and counting it would send an approver
  // to a queue with nothing in it.
  it('does not count a pass whose earlier office has not signed', async () => {
    passes.push(pass('p1', 'RGP-20260820-0001'));
    approvals.push(...ladder('p1', { security_head: 'pending', coo: 'pending', finance_head: 'pending', ceo: 'pending' }));
    renderBell('coo');
    await waitFor(() => {
      expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/unread/i)).toBeNull();
  });

  it('names the pass and opens it, so the count is actionable', async () => {
    passes.push(pass('p1', 'RGP-20260820-0001'));
    approvals.push(...ladder('p1', { security_head: 'approved', coo: 'pending', finance_head: 'pending', ceo: 'pending' }));
    renderBell('coo');
    await waitFor(() => expect(screen.getByLabelText(/1 unread/i)).toBeInTheDocument());
    screen.getByLabelText(/1 unread/i).click();
    expect(await screen.findByText(/RGP-20260820-0001/)).toBeInTheDocument();
  });

  it('counts nothing for a reader who holds no office', async () => {
    passes.push(pass('p1', 'RGP-20260820-0001'));
    approvals.push(...ladder('p1', { security_head: 'approved', coo: 'pending', finance_head: 'pending', ceo: 'pending' }));
    renderBell(null);
    await waitFor(() => expect(screen.getByLabelText('Notifications')).toBeInTheDocument());
    expect(screen.queryByLabelText(/unread/i)).toBeNull();
  });
});

// THE MISMATCH LOOP, from the gate back to the HOD who raised the pass.
//
// Client, 2026-08-17: when a pass is mismatched at the gate, "just notify the
// respective HOD that their gate passes were mismatched at the gate and ask him
// to review and raise it again… this should appear as a notification in the
// HOD's notification bell icon and he can also see the details of that."
//
// WHAT THIS FILE PINS, AND WHY EACH PART CAN BREAK SILENTLY:
//
//   1. The bell is fed from the DATABASE on mount, not only from realtime. The
//      old provider had realtime alone, so a mismatch raised while the HOD was
//      signed out was announced to nobody and never appeared again — an empty
//      bell precisely when it had the most to say. That failure is invisible in
//      a browser, because a signed-in tester always sees the realtime event.
//   2. A mismatch notice opens the REVIEW screen, not the pass detail. The
//      detail page is a record; the client asked for a decision.
//   3. Dismissal is persisted. With (1) in place, an in-memory dismissal comes
//      straight back on the next load and the bell becomes un-clearable.
//   4. A guard is NOT given the derivation. Their bell is about the queue in
//      front of them.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { GatePassView, UserRole } from '../../src/types';

const flaggedRows: GatePassView[] = [
  {
    id: 'p-flagged',
    pass_number: 'RGP-OUT-20260817-0009',
    type: 'RGP',
    direction: 'out',
    status: 'flagged',
    flag_reason: 'Two ladders loaded, three on the slip',
    verified_by_name: 'Guard One',
    flagged_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
];

const expiredRows: GatePassView[] = [
  {
    id: 'p-expired',
    pass_number: 'NRGP-OUT-20260816-0004',
    type: 'NRGP',
    direction: 'out',
    status: 'pending',
    is_expired: true,
    expires_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
];

/** Records the filters every read applied, so a test can prove each query is
 *  scoped to this reader's own passes rather than to everything RLS allows.
 *
 *  The provider now fires TWO reads in parallel — flagged, and expired-pending —
 *  so the mock answers PER QUERY from the filters that query applied. A mock
 *  that returned the same array to both would invent an expiry notice for every
 *  mismatch and hide the bug where one query's filters went missing. */
const filters: [string, unknown][] = [];

function rowsFor(own: [string, unknown][]): unknown[] {
  const has = (col: string, val: unknown) => own.some(([c, v]) => c === col && v === val);
  if (!has('raised_by', 'hod-1')) return [];
  if (has('status', 'flagged')) return flaggedRows;
  if (has('status', 'pending') && has('is_expired', true)) return expiredRows;
  return [];
}

function thenable() {
  const own: [string, unknown][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rowsFor(own), error: null }).then(ok, bad),
  };
  obj.select = () => obj;
  obj.order = () => obj;
  obj.limit = () => obj;
  obj.eq = (col: string, val: unknown) => {
    own.push([col, val]);
    filters.push([col, val]);
    return obj;
  };
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => thenable() }),
  supabase: {
    channel: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch: any = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

import { NotificationProvider } from '../../src/lib/notifications';
import NotificationBell from '../../src/components/layout/NotificationBell';

function fakeSession(userId: string): Session {
  return { user: { id: userId } } as unknown as Session;
}

/** Prints the current pathname, so a click's destination is assertable without
 *  mocking the router. */
function Here(): React.ReactElement {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderBell(role: UserRole) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <NotificationProvider session={fakeSession('hod-1')} role={role}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<Here />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  filters.length = 0;
  window.localStorage.clear();
});

describe('the HOD is told about a mismatch even if they were signed out', () => {
  it('derives a notice from the database on mount, scoped to their own flagged passes', async () => {
    renderBell('hod' as UserRole);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Notifications \(2 unread\)/ })).toBeInTheDocument(),
    );
    // Scoped SERVER-side on both axes: someone else's flagged pass must not be
    // downloaded in order to be hidden.
    expect(filters).toContainEqual(['raised_by', 'hod-1']);
    expect(filters).toContainEqual(['status', 'flagged']);
    // The expiry read is scoped server-side on all three axes, and `is_expired`
    // is the VIEW's derivation — never a client-side comparison against
    // `expires_at`, which would disagree with `match_pass` about every pass
    // raised after 18:30 IST.
    expect(filters).toContainEqual(['status', 'pending']);
    expect(filters).toContainEqual(['is_expired', true]);
  });

  it('names the reason and the guard, because a mismatch with no author is not reviewable', async () => {
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const notice = await screen.findByText(/Two ladders loaded, three on the slip/);
    expect(notice.textContent).toMatch(/RGP-OUT-20260817-0009/);
    expect(notice.textContent).toMatch(/Guard One/);
  });

  it('opens the REVIEW screen, not the pass record', async () => {
    // `/pass/:id` is a record. The client asked the notice to lead to a
    // decision: reject the pass, or raise it again.
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Mismatched'));

    expect(screen.getByTestId('where').textContent).toBe('/mismatch/p-flagged');
  });

  it('does not clear the notice merely because it was looked at', async () => {
    // A mismatch is cleared by being DECIDED. Dropping it on a glance would let
    // an HOD lose the only pointer to a pending decision by mis-tapping.
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Mismatched'));

    expect(screen.getByRole('button', { name: /2 unread/ })).toBeInTheDocument();
  });

  it('a guard gets no mismatch derivation — their bell is the queue in front of them', async () => {
    renderBell('guard' as UserRole);
    // Give the effect a turn to run before concluding it did not.
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    expect(filters).toEqual([]);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('a dismissed notice stays dismissed', () => {
  it('survives a reload, or the bell would be un-clearable', async () => {
    // THE BUG THIS EXISTS FOR: the notice is derived on every mount, so an
    // in-memory dismissal comes straight back on the next page load.
    const first = renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /unread/ })).not.toBeInTheDocument());
    first.unmount();

    renderBell('hod' as UserRole);
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /unread/ })).not.toBeInTheDocument();
  });
});

describe('a pass that expired without reaching the gate', () => {
  // NOTHING IS WRITTEN TO THE DATABASE WHEN A PASS EXPIRES — `expires_at` simply
  // falls behind `now()` — so realtime could never have announced this. The
  // mount-time query is the only mechanism there is, which is exactly why it is
  // pinned here.
  it('reaches the HOD as its own notice, saying it is null and void', async () => {
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const notice = await screen.findByText(/expired without reaching the gate/);
    expect(notice.textContent).toMatch(/NRGP-OUT-20260816-0004/);
    expect(notice.textContent).toMatch(/null and void/);
    // The two decisions the client asked for, named in the notice itself.
    expect(notice.textContent).toMatch(/raise it again/i);
    expect(notice.textContent).toMatch(/void it permanently/i);
  });

  it('opens the EXPIRED decision screen, not the pass record', async () => {
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Expired'));

    expect(screen.getByTestId('where').textContent).toBe('/expired/p-expired');
  });

  it('is not cleared merely because it was looked at', async () => {
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /2 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Expired'));

    expect(screen.getByRole('button', { name: /2 unread/ })).toBeInTheDocument();
  });
});

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

/** Records the filters a read applied, so a test can prove the query is scoped
 *  to this reader's own flagged passes rather than to everything RLS allows. */
const filters: [string, unknown][] = [];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(ok, bad),
  };
  obj.select = () => obj;
  obj.order = () => obj;
  obj.limit = () => obj;
  obj.eq = (col: string, val: unknown) => {
    filters.push([col, val]);
    return obj;
  };
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => thenable(flaggedRows) }),
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
      expect(screen.getByRole('button', { name: /Notifications \(1 unread\)/ })).toBeInTheDocument(),
    );
    // Scoped SERVER-side on both axes: someone else's flagged pass must not be
    // downloaded in order to be hidden.
    expect(filters).toContainEqual(['raised_by', 'hod-1']);
    expect(filters).toContainEqual(['status', 'flagged']);
  });

  it('names the reason and the guard, because a mismatch with no author is not reviewable', async () => {
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /1 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const notice = await screen.findByText(/Two ladders loaded, three on the slip/);
    expect(notice.textContent).toMatch(/RGP-OUT-20260817-0009/);
    expect(notice.textContent).toMatch(/Guard One/);
  });

  it('opens the REVIEW screen, not the pass record', async () => {
    // `/pass/:id` is a record. The client asked the notice to lead to a
    // decision: reject the pass, or raise it again.
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /1 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Mismatched'));

    expect(screen.getByTestId('where').textContent).toBe('/mismatch/p-flagged');
  });

  it('does not clear the notice merely because it was looked at', async () => {
    // A mismatch is cleared by being DECIDED. Dropping it on a glance would let
    // an HOD lose the only pointer to a pending decision by mis-tapping.
    renderBell('hod' as UserRole);
    await waitFor(() => screen.getByRole('button', { name: /1 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByText('Gate Pass Mismatched'));

    expect(screen.getByRole('button', { name: /1 unread/ })).toBeInTheDocument();
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
    await waitFor(() => screen.getByRole('button', { name: /1 unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /1 unread/ })).not.toBeInTheDocument());
    first.unmount();

    renderBell('hod' as UserRole);
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /unread/ })).not.toBeInTheDocument();
  });
});

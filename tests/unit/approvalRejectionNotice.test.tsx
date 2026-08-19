// The bell tells the raising HOD that an approval office rejected their pass
// (migration 046).
//
// A REJECTION IS THE ONE DECISION IN THIS APP WITH NOWHERE ELSE TO SURFACE.
// `reject_pass_level` closes the pass — status 'cancelled' — and the HOD is not
// looking at their own dashboard when it happens. Realtime alone would announce
// it only to an HOD who is signed in at that moment, which is why it is derived
// from the database on every mount, the same mechanism the mismatch and expiry
// notices use.
//
// THE HARD PART IS TELLING IT APART FROM THE HOD'S OWN DECISIONS. 'cancelled'
// is also where `hod_void_expired_pass` and an HOD upholding a security flag
// leave a pass, and announcing those back to the person who made them is noise.
// `flag_reason is null` is what separates them: a pass rejected on the ladder
// never reached the gate, so nothing ever wrote it one. These cases pin exactly
// that filter, on the query as well as on the screen — a client-side filter
// would download a decision in order to hide it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

/** Every `.eq()` / `.is()` narrowing one query asked for, in order. */
type Filters = [string, unknown][];

const queries: { table: string; filters: Filters }[] = [];
let rows: Record<string, unknown[]> = {};

/** A thenable query builder: every method returns itself, and awaiting it
 *  resolves to the rows registered for the filter set it accumulated. */
function builder(table: string) {
  const filters: Filters = [];
  const rec = { table, filters };
  queries.push(rec);
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.order = self;
  chain.in = self;
  chain.eq = (col: string, val: unknown) => {
    filters.push([col, val]);
    return chain;
  };
  chain.is = (col: string, val: unknown) => {
    filters.push([col, val]);
    return chain;
  };
  chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
    const key = filters.map(([c, v]) => `${c}=${String(v)}`).join('&');
    return Promise.resolve({ data: rows[key] ?? [], error: null }).then(resolve);
  };
  return chain;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: (table: string) => builder(table) }),
  supabase: {
    channel: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch: any = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => undefined,
  },
}));

// eslint-disable-next-line import/first
import { NotificationProvider, useNotifications, rejectedMessage } from '../../src/lib/notifications';

const REJECTED_KEY = 'raised_by=hod-1&status=cancelled&flag_reason=null';

function pass(over: Record<string, unknown> = {}) {
  return {
    id: 'p-rej',
    pass_number: 'RGP-20260819-0007',
    status: 'cancelled',
    flag_reason: null,
    created_at: '2026-08-19T04:00:00Z',
    updated_at: '2026-08-19T09:15:00Z',
    ...over,
  };
}

function Consumer(): React.ReactElement {
  const { notifications } = useNotifications();
  return (
    <ul>
      {notifications.map((n) => (
        <li key={n.id} data-testid={`notif-${n.type}`}>
          <span data-testid="title">{n.title}</span>
          <span data-testid="msg">{n.message}</span>
        </li>
      ))}
    </ul>
  );
}

function renderHod() {
  const session = { user: { id: 'hod-1', email: 'hod@x.com' } } as unknown as Session;
  return render(
    <MemoryRouter>
      <NotificationProvider session={session} role="hod">
        <Consumer />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

describe('the bell announces an approval rejection to the HOD who raised it', () => {
  beforeEach(() => {
    queries.length = 0;
    rows = {};
    try {
      window.localStorage.clear();
    } catch {
      /* Safari private mode throws; the provider survives it and so does this. */
    }
  });

  it('narrows to the HOD`s own cancelled passes that never carried a flag — SERVER-SIDE', () => {
    renderHod();
    const q = queries.find((x) => x.filters.some(([c, v]) => c === 'status' && v === 'cancelled'));
    expect(q, 'no query asked for cancelled passes').toBeTruthy();
    expect(q!.table).toBe('v_gate_passes');
    expect(q!.filters).toContainEqual(['raised_by', 'hod-1']);
    expect(q!.filters).toContainEqual(['flag_reason', null]);
  });

  it('shows one Gate Pass Rejected notice, pointing the HOD at the record', () => {
    rows = { [REJECTED_KEY]: [pass()] };
    renderHod();
    return waitFor(() => {
      expect(screen.getByTestId('notif-rejected')).toBeInTheDocument();
      expect(screen.getByTestId('title').textContent).toBe('Gate Pass Rejected');
      expect(screen.getByTestId('msg').textContent).toBe(rejectedMessage('RGP-20260819-0007'));
    });
  });

  it('does not quote the reason — the ladder names the office that wrote it', () => {
    // A sentence repeated in the bell is a sentence that can be read without
    // knowing who said it.
    expect(rejectedMessage('RGP-1')).not.toMatch(/reason:/i);
    expect(rejectedMessage('RGP-1')).toMatch(/rejected/i);
    expect(rejectedMessage('RGP-1')).toMatch(/closed/i);
  });

  it('a guard gets no such notice — it is a decision waiting on the raiser', () => {
    rows = { [REJECTED_KEY]: [pass()] };
    const session = { user: { id: 'g-1', email: 'g@x.com' } } as unknown as Session;
    render(
      <MemoryRouter>
        <NotificationProvider session={session} role="guard">
          <Consumer />
        </NotificationProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('notif-rejected')).toBeNull();
    expect(queries.some((q) => q.filters.some(([c, v]) => c === 'status' && v === 'cancelled'))).toBe(false);
  });
});

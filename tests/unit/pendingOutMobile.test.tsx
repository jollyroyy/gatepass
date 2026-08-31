// THE GUARD'S QUEUE ON A PHONE (client, 2026-08-31: "approve out button is not
// appearing in mobile pwa").
//
// The Pending OUT list is an eleven-column table and Approve OUT is the last
// column of it. Inside `overflow-x: auto` on a 390px screen that column is
// roughly 800px past the right edge: the button is in the DOM, and no guard
// standing at the barrier will ever find it. The queue is the ONE screen this
// app exists for, so a control that is only reachable by scrolling a table
// sideways is a control that does not exist.
//
// Below `lg` the list is therefore the stacked card instead — `PassStack` with
// `matchAction`, the same pair the global search answer uses — and the action
// is on the face of every card. `useIsNarrow` picks ONE of the two layouts, so
// these cases also hold that the table is not merely hidden: it is not built.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-IT-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234', purpose: 'Formwork Support',
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: FUTURE, created_at: '2026-08-19T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 3, total_quantity: 200, returned_quantity: 0, total_value: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gp: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {};
    for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq', 'in', 'ilike']) obj[m] = () => obj;
    obj.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return { from: () => obj, rpc: () => Promise.resolve({ data: [], error: null }) };
  },
  pub: () => ({ from: () => ({ select: () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }) }) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import PendingOutPanel from '../../src/components/guard/PendingOutPanel';

const ROWS = [
  pass({ id: 'q1', pass_number: 'RGP-ENG-0057' }),
  // Expired, so `match_pass` would refuse it: the card degrades to a link that
  // works rather than a button that always fails — the table's own rule.
  pass({ id: 'q2', pass_number: 'RGP-ENG-0058', expires_at: '2026-01-01T00:00:00Z' }),
];

/** Answers the narrow query the way a phone does. */
function setViewport(narrow: boolean): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = (q: string) => ({
    matches: narrow && q.includes('max-width'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalMatchMedia = (window as any).matchMedia;
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = originalMatchMedia;
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <PendingOutPanel rows={ROWS} loading={false} initialTab="all" />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('the Pending OUT queue on a phone', () => {
  it('draws every waiting pass as a card carrying Approve OUT, not an off-screen column', () => {
    setViewport(true);
    renderPanel();

    const cards = screen.getByTestId('pending-out-cards');
    const approve = within(cards).getByRole('link', { name: /Approve OUT/i });
    expect(approve).toHaveAttribute('href', '/verify/q1');
  });

  it('builds no wide table at all on a phone — the action is not merely hidden', () => {
    setViewport(true);
    renderPanel();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Vehicle No.' })).not.toBeInTheDocument();
  });

  it('offers a pass the gate can no longer clear as View pass, on the card too', () => {
    setViewport(true);
    renderPanel();

    const card = screen.getByText('RGP-ENG-0058').closest('li') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'View pass' })).toHaveAttribute('href', '/pass/q2');
    expect(within(card).queryByRole('link', { name: /Approve OUT/i })).not.toBeInTheDocument();
  });

  it('keeps the eleven-column table on a desk, where it fits', () => {
    setViewport(false);
    renderPanel();

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-out-cards')).not.toBeInTheDocument();
  });
});

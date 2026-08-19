// The guard's board after the 2026-08-19 revamp: a greeting, two figures, the
// two lists those figures count, and three quick actions.
//
// What these cases exist to hold:
//   * The RGP/NRGP split of Pending OUT sums to the rows in the panel below it.
//   * Pending RGP Return is due-today and overdue material — NOT everything
//     still outside, because /returns and /overdue are the only two pages that
//     can record a return and neither would take an October date today.
//   * Every action goes somewhere that works: Verify at Gate only while
//     `match_pass` would accept the pass, Record Return to the page that grades
//     that row.
//   * Nothing from the old seven-drill board survives — no KPI drill, no pass
//     cards, no "Today's Summary".
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES } from '../../src/lib/roleRoutes';
import type { GatePassView } from '../../src/types';

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: FUTURE, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// The gate queue — one RGP and two NRGP, so the card's two figures are
// distinguishable from each other and from the list length.
let QUEUE: GatePassView[] = [];
// Everything still out, of any date. The board cuts it to what is due.
let OPEN_RETURNS: GatePassView[] = [];

function resetRows(): void {
  QUEUE = [
    pass({ id: 'q1', pass_number: 'RGP-20260819-0057', type: 'RGP',
           visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}' }),
    pass({ id: 'q2', pass_number: 'NRGP-20260819-0081', type: 'NRGP', direction: 'out',
           material_summary: 'Cement Bags', total_quantity: 500 }),
    pass({ id: 'q3', pass_number: 'NRGP-20260819-0080', type: 'NRGP', direction: 'out',
           material_summary: 'Bricks', total_quantity: 10000 }),
  ];
  OPEN_RETURNS = [
    pass({ id: 'r1', pass_number: 'RGP-20260518-0056', status: 'matched',
           return_status: 'awaiting_return', expected_return_date: '2026-08-19',
           due_state: 'due_today', material_summary: 'Scaffolding Pipes',
           total_quantity: 200, returned_quantity: 0 }),
    pass({ id: 'r2', pass_number: 'RGP-20260517-0055', status: 'matched',
           return_status: 'partially_returned', expected_return_date: '2026-05-18',
           due_state: 'overdue', is_overdue: true, material_summary: 'Timber Planks',
           total_quantity: 150, returned_quantity: 50 }),
    // Due in October: a real obligation, deliberately on neither list.
    pass({ id: 'r3', pass_number: 'RGP-20261001-0099', status: 'matched',
           return_status: 'awaiting_return', expected_return_date: '2026-10-01',
           material_summary: 'Wall Putty', due_state: 'ok' }),
  ];
}

/** The board issues exactly two queries, told apart by which column the
 *  `.in()` names. `expires_at` rides along with the queue's `.in('status', …)`
 *  and must not select a set of its own. */
function builder() {
  let axis: 'status' | 'return_status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq']) obj[m] = () => obj;
  obj.in = (col: string) => {
    if (col === 'status') axis = 'status';
    if (col === 'return_status') axis = 'return_status';
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = axis === 'return_status' ? OPEN_RETURNS : QUEUE;
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => builder(),
    rpc: () => ({
      maybeSingle: () => Promise.resolve({
        data: { id: 'u1', email: 'g@x.z', full_name: 'Ravi Kumar', role: 'guard', department_id: null,
                created_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    }),
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';

async function renderBoard() {
  render(
    <MemoryRouter>
      <GuardDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('RGP-20260819-0057')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('The greeting', () => {
  it('greets the signed-in guard by first name', async () => {
    await renderBoard();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Hello, Ravi/);
  });
});

describe('Pending OUT (Needs Approval)', () => {
  it('splits the queue into RGP and NRGP, and the two sum to the list below', async () => {
    await renderBoard();

    expect(screen.getByTestId('guard-figure-RGP').querySelector('.gb-figure-value')!.textContent).toBe('1');
    expect(screen.getByTestId('guard-figure-NRGP').querySelector('.gb-figure-value')!.textContent).toBe('2');

    // The panel renders all three — the figures are a split of one array.
    for (const n of ['RGP-20260819-0057', 'NRGP-20260819-0081', 'NRGP-20260819-0080']) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  it('names the party, the material and the quantity on each row', async () => {
    await renderBoard();
    expect(screen.getByText('LMN Contractors')).toBeInTheDocument();
    expect(screen.getByText('Steel Props')).toBeInTheDocument();
    expect(screen.getByText('10000')).toBeInTheDocument();
  });

  it('offers Verify at Gate while match_pass would still accept the pass', async () => {
    await renderBoard();
    const links = screen.getAllByRole('link', { name: 'Verify at Gate' });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', '/verify/q1');
  });

  it('degrades an expired pass to a link that works instead of a button that cannot', async () => {
    QUEUE = [pass({ id: 'q1', pass_number: 'RGP-20260819-0057', expires_at: '2026-01-01T00:00:00Z' })];
    await renderBoard();
    expect(screen.queryByRole('link', { name: 'Verify at Gate' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View pass' })).toHaveAttribute('href', '/pass/q1');
  });

  it('says so plainly when the queue is clear', async () => {
    QUEUE = [];
    render(
      <MemoryRouter>
        <GuardDashboard />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Queue clear — nothing is waiting at the gate/)).toBeInTheDocument());
  });
});

describe('Pending RGP Return (Needs Verification)', () => {
  it('counts and lists due-today and overdue material, not everything outside', async () => {
    await renderBoard();

    expect(screen.getByText('RGP-20260518-0056')).toBeInTheDocument();
    expect(screen.getByText('RGP-20260517-0055')).toBeInTheDocument();
    // Due in October: still out, nothing to verify today.
    expect(screen.queryByText('RGP-20261001-0099')).not.toBeInTheDocument();

    expect(screen.getByTestId('guard-figure-Due back').querySelector('.gb-figure-value')!.textContent).toBe('2');
  });

  it('states lateness in words, never in colour alone', async () => {
    await renderBoard();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Due Today')).toBeInTheDocument();
  });

  it('shows what has come back against what went out', async () => {
    await renderBoard();
    expect(screen.getByText('50 / 150')).toBeInTheDocument();
    expect(screen.getByText('0 / 200')).toBeInTheDocument();
  });

  it('sends each row to the page that can record it', async () => {
    await renderBoard();
    const actions = screen.getAllByRole('link', { name: 'Record Return' });
    // Oldest expected date first, so the overdue row leads.
    expect(actions[0]).toHaveAttribute('href', '/overdue');
    expect(actions[1]).toHaveAttribute('href', '/returns');
  });
});

describe('The panels expand in place', () => {
  it('shows five rows, then the rest when asked', async () => {
    QUEUE = Array.from({ length: 7 }, (_, i) =>
      pass({ id: `q${i}`, pass_number: `RGP-20260819-005${i}`, created_at: `2026-08-19T0${i}:00:00Z` }));
    render(
      <MemoryRouter>
        <GuardDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('RGP-20260819-0050')).toBeInTheDocument());

    expect(screen.queryByText('RGP-20260819-0056')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View All (7)'));
    expect(screen.getByText('RGP-20260819-0056')).toBeInTheDocument();
  });
});

describe('The summary cards', () => {
  // The chevrons scrolled to the panel each figure counted. The client removed
  // them (2026-08-19): that panel is directly underneath on every width, so the
  // control was a button to scroll one screen. The cards are now the number and
  // nothing else — no link, no button, no scroll target.
  it('carry no chevron, and no control of any kind', async () => {
    await renderBoard();
    const card = screen.getByTestId('guard-figure-Due back').closest('.gb-card')!;
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('a')).toBeNull();
    expect(screen.queryByLabelText('Go to the pending RGP return list')).not.toBeInTheDocument();
  });
});

describe('The mock-up skin', () => {
  // The client asked for this ONE screen in their own palette and type, not the
  // house Quest gold / Antic Didone. These two assertions are what stops a
  // later tidy-up from "restoring consistency" and undoing it.
  it('renders on the scoped .gb-board skin, and its h1 is not the gold display serif', async () => {
    await renderBoard();
    expect(document.querySelector('.gb-board')).not.toBeNull();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('gb-hello');
    expect(h1.className).not.toContain('page-title');
  });

  it('colours a pass number and its type chip by type — RGP blue, NRGP green', async () => {
    await renderBoard();
    expect(screen.getByText('RGP-20260819-0057').className).toContain('gb-pill-blue');
    expect(screen.getByText('NRGP-20260819-0081').className).toContain('gb-pill-green');
  });
});

describe('Quick actions', () => {
  it('offers only routes this role can actually open', async () => {
    await renderBoard();
    for (const [name, href] of [
      ['Scan QR / Pass No.', '/console'],
      ['Returns Due Today', '/returns'],
      ['Overdue Returns', '/overdue'],
    ] as const) {
      const link = screen.getByText(name).closest('a')!;
      expect(link).toHaveAttribute('href', href);
      expect(ROLE_ROUTES.guard).toContain(href);
    }
  });
});

describe('The old drill board is gone, not hidden', () => {
  it('renders no KPI drill labels and no pass cards', async () => {
    await renderBoard();
    for (const label of ['RGP Raised', 'Mismatch at Gate', 'Returned & Closed', 'Awaiting Return',
                         "Today's Summary", 'Pending for Gate Approval']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(document.querySelector('[data-testid="pass-card-header"]')).toBeNull();
  });

  it('leaves the guard sidebar untouched — Dashboard, Search Pass, Overdue Items', () => {
    const guardTabs = ALL_LINKS.filter((l) => l.roles.includes('guard'));
    expect(guardTabs.map((l) => l.to)).toEqual(['/guard-dashboard', '/console', '/overdue']);
  });
});

// The HOD dashboard — the client's own mock-up (2026-08-19): a greeting, four
// drillable figures, Quick Actions and the Approval Pending strip.
//
// FIVE THINGS THIS FILE EXISTS TO PIN, in order of how quietly they could break:
//
//   1. THE PERSON SCOPE. The client asked for a board that is "only for their
//      department and only for her or him". Department is RLS's job and this
//      test cannot see it; the PERSON half is this page's, and it is a
//      `.eq('raised_by', …)` on the one read. The mock below RECORDS the filters
//      a query was built with and hands a colleague's pass to any read that did
//      NOT ask for one — so forgetting the filter shows up as a stranger's pass
//      on the board, not as a silent widening nobody notices.
//   2. THE FIGURE/DRILL AGREEMENT. Read what a card prints, press it, count the
//      stack underneath. Pressing again closes it.
//   3. THE TWO SCOPES ON ONE ROW. Cards 1–3 are TODAY; card 4 and the "pending
//      at the gate" note are RUNNING. A five-day-old overdue pass must be in the
//      Pending Return figure and in NO today figure.
//   4. WHAT THE CLIENT ASKED TO GO: the Alerts card, and with the old board the
//      trend, the status ring, the return watch, the top-items ring and the
//      flagged-review queue.
//   5. THE APPROVAL PENDING STRIP IS REAL (migration 046): a pending
//      `pass_approvals` row on a pass still `pending` counts under its office;
//      a rejected pass's leftover pending rows count nowhere; HOD Approval
//      stays structurally zero because nothing is ever routed to it. See
//      src/lib/hodApprovals.ts for the office mapping and the double-count
//      rule for "Other Approvers".
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const ME = 'hod-1';
const COLLEAGUE = 'hod-2';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: ME, raised_by_name: 'P M Sharma',
    visitor_name: 'Alice', visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Bolts', flagged_at: null, hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const now = new Date();
const TODAY = now.toISOString();
const TODAY_0900 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString();
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// This HOD's own passes: three RGP and one NRGP raised today, plus one RGP
// still out — and late — from five days ago.
const MINE: GatePassView[] = [
  pass({ id: 't1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  pass({
    id: 't2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', verified_at: TODAY_0900,
    return_status: 'awaiting_return', material_summary: 'Ladder',
  }),
  pass({ id: 't3', visitor_name: 'Eve', created_at: TODAY, status: 'flagged', flag_reason: 'Qty short' }),
  pass({
    id: 't4', visitor_name: 'Nina', created_at: TODAY, status: 'pending',
    type: 'NRGP', pass_number: 'NRGP-20260819-0001', material_summary: 'Scrap',
  }),
  pass({
    id: 'o1', visitor_name: 'Gus', created_at: FIVE_DAYS_AGO, status: 'matched', verified_at: FIVE_DAYS_AGO,
    return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    expected_return_date: '2026-01-02', material_summary: 'Hydraulic Pump',
  }),
  // Four more, all dated FIVE_DAYS_AGO so none moves a today figure — and p1 /
  // p2 are typed NRGP so a `status: 'pending'` row does not also inflate the
  // RGP card's unrelated "pending at the gate" note. They exist only to carry
  // `pass_approvals` rows for the strip below.
  // Both carry `awaits_approval: true` — they have pending `pass_approvals`
  // rows below, so `gatepass.pass_awaits_approval` really would answer true for
  // them, and the Pending Approvals card's two sub-figures are only meaningful
  // when the fixture contains one of each kind.
  pass({
    id: 'p1', visitor_name: 'Priya', created_at: FIVE_DAYS_AGO, status: 'pending',
    type: 'NRGP', pass_number: 'NRGP-20260814-0001', awaits_approval: true,
  }),
  pass({
    id: 'p2', visitor_name: 'Qasim', created_at: FIVE_DAYS_AGO, status: 'pending',
    type: 'NRGP', pass_number: 'NRGP-20260814-0002', awaits_approval: true,
  }),
  pass({ id: 'p3', visitor_name: 'Ravi', created_at: FIVE_DAYS_AGO, status: 'cancelled' }),
  pass({ id: 'p4', visitor_name: 'Sana', created_at: FIVE_DAYS_AGO, status: 'matched', verified_at: FIVE_DAYS_AGO }),
];

// `gatepass.pass_approvals` rows for the four passes above.
//   p1 — one pending Security Head row, pass still climbing: counts.
//   p2 — pending COO and pending CEO rows, pass still climbing: TWO counts
//        under "Other Approvers" (see hodApprovals.ts for why one row = one
//        count rather than one pass = one count).
//   p3 — Security Head rejected it: the pass moved to `cancelled`, and its
//        leftover pending Finance HOD row must count NOWHERE.
//   p4 — Finance HOD already approved: an `approved` row never counts.
const PENDING_APPROVAL_ROWS = [
  { gate_pass_id: 'p1', role_key: 'security_head', status: 'pending' },
  { gate_pass_id: 'p2', role_key: 'coo', status: 'pending' },
  { gate_pass_id: 'p2', role_key: 'ceo', status: 'pending' },
  { gate_pass_id: 'p3', role_key: 'security_head', status: 'rejected' },
  { gate_pass_id: 'p3', role_key: 'finance_head', status: 'pending' },
  { gate_pass_id: 'p4', role_key: 'finance_head', status: 'approved' },
];

/** Answers `gp().from('pass_approvals').select(…).in('gate_pass_id', ids)`. */
function approvalsQuery() {
  let ids: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  obj.select = () => obj;
  obj.in = (col: string, vals: string[]) => {
    if (col === 'gate_pass_id') ids = vals;
    return obj;
  };
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
    const data = PENDING_APPROVAL_ROWS.filter((r) => ids.includes(r.gate_pass_id));
    return Promise.resolve({ data, error: null }).then(ok, err);
  };
  return obj;
}

// Never raised by this HOD. RLS would hand it over (same department), so only
// the page's own `.eq('raised_by', …)` keeps it off the board. It is `pending`
// and raised TODAY, so a missing filter would move three figures at once.
const THEIRS = pass({
  id: 'c1', visitor_name: 'Zara', pass_number: 'RGP-20260819-0099', created_at: TODAY,
  status: 'pending', raised_by: COLLEAGUE, raised_by_name: 'Someone Else',
});

/** Records the `.eq()` filters a query was built with, and answers accordingly. */
function passQuery() {
  const eqs: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in']) obj[m] = () => obj;
  obj.eq = (col: string, val: string) => {
    eqs[col] = val;
    return obj;
  };
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
    let data = eqs.raised_by === ME ? MINE : [...MINE, THEIRS];
    if (eqs.status) data = data.filter((r) => r.status === eqs.status);
    return Promise.resolve({ data, error: null }).then(ok, err);
  };
  return obj;
}

function simple(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) obj[m] = () => obj;
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) =>
      table === 'v_gate_passes' ? passQuery() : table === 'pass_approvals' ? approvalsQuery() : simple([]),
    rpc: () => ({
      maybeSingle: () =>
        Promise.resolve({
          data: { id: ME, full_name: 'Rahul Sharma', email: 'r@x.z', role: 'hod' },
          error: null,
        }),
    }),
  }),
  pub: () => ({ from: () => simple([]) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ME } }, error: null }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import Dashboard from '../../src/pages/HOD/Dashboard';

function renderBoard() {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

/** The card whose label starts with `label`. Every one of the four is a button —
 *  the WHOLE card is the drill control, not just the number. */
function card(label: string): HTMLElement {
  const group = screen.getByRole('group', { name: 'Dashboard figures' });
  // Matched on the NAME element, not the card's whole text: "RGP Issued" is a
  // substring of "NRGP Issued", and a loose `includes` picks the wrong card.
  const found = within(group)
    .getAllByRole('button')
    .find((b) => b.querySelector('.gb-kpi-name')?.textContent === label);
  if (!found) throw new Error(`no "${label}" card`);
  return found;
}

function expectFigure(label: string, value: number): void {
  const el = card(label);
  expect(el.querySelector('.gb-kpi-figure')?.textContent).toBe(String(value));
}

function stack(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

async function loaded(): Promise<void> {
  await waitFor(() => expectFigure('Total Passes', 4));
}

describe('the HOD dashboard is scoped to this HOD', () => {
  it('counts only passes this HOD raised', async () => {
    renderBoard();
    await loaded();

    // The colleague's pending RGP raised today would push Total to 5, RGP
    // Issued to 4 and Pending Approvals to 5.
    //
    // REWRITTEN 2026-08-20: the "N pending at the gate" note used to sit on the
    // RGP Issued card. It is the Pending Approvals card now, is not narrowed to
    // RGP, and is split in two — see the case below.
    expectFigure('RGP Issued', 3);
    expectFigure('Pending Approvals', 4);
    expect(screen.queryByText('RGP-20260819-0099')).not.toBeInTheDocument();
  });

  it("never lists a colleague's pass in a drill", async () => {
    renderBoard();
    await loaded();

    fireEvent.click(card('Total Passes'));
    expect(within(stack()).getByText('Alice')).toBeInTheDocument();
    expect(within(stack()).queryByText('Zara')).not.toBeInTheDocument();
    // The drill draws no `N passes` count any more (see the case below); the
    // scope is proved by the cards it lists, which is what it always meant.
    expect(within(stack()).getAllByTestId('pass-ordinal').length).toBe(4);
  });

  it('greets the reader by name', async () => {
    renderBoard();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Rahul Sharma/),
    );
  });
});

describe("the four figures, and the two scopes they mix", () => {
  it('matches the fixture', async () => {
    renderBoard();
    await loaded();

    expectFigure('Total Passes', 4); // t1 t2 t3 t4
    expectFigure('NRGP Issued', 1); // t4
    expectFigure('RGP Issued', 3); // t1 t2 t3
    expectFigure('Pending Return', 1); // o1 — five days old, and RUNNING
  });

  it('the five-day-old overdue pass is in no today figure but is still counted', async () => {
    renderBoard();
    await loaded();

    fireEvent.click(card('Total Passes'));
    expect(within(stack()).queryByText('Gus')).not.toBeInTheDocument();

    fireEvent.click(card('Pending Return'));
    expect(within(stack()).getByText('Gus')).toBeInTheDocument();
  });

  // 2026-08-19, client: "I need to put zero overdue multiple times — show it
  // only once", and "remove the bottom All types", and "remove Material past
  // its return date / 0 passes". A figure that is already drawn once in
  // 32px type does not need restating in a note under it, or again as a
  // heading over the list it opens.
  it('states each figure ONCE — no repeated note, no drill heading', async () => {
    renderBoard();
    await loaded();

    expect(screen.queryByText('All types')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ overdue/)).not.toBeInTheDocument();

    fireEvent.click(card('Pending Return'));
    expect(screen.queryByText('Material past its return date')).not.toBeInTheDocument();
    expect(within(stack()).queryByText(/\d+ passe?s?$/)).not.toBeInTheDocument();
  });

  it('pressing the open card again closes the stack', async () => {
    renderBoard();
    await loaded();

    fireEvent.click(card('NRGP Issued'));
    expect(within(stack()).getByText('Nina')).toBeInTheDocument();
    expect(card('NRGP Issued')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(card('NRGP Issued'));
    expect(screen.queryByRole('region', { name: 'Selected passes' })).not.toBeInTheDocument();
  });

  it("a drill row does not repeat the reader's own name back at them", async () => {
    renderBoard();
    await loaded();
    fireEvent.click(card('Total Passes'));
    expect(within(stack()).queryByText(/P M Sharma/)).not.toBeInTheDocument();
  });
});

describe('Quick Actions and the Approval Pending strip', () => {
  it('offers ONE Raise tile, opening the raise form with no pass type pre-chosen', async () => {
    // 2026-08-19: the client dropped the two Raise NRGP / Raise RGP tiles for
    // a single "Raise Gate Pass" tile — the pass type moved onto the form
    // itself (PassTypeSelector), so the dashboard no longer answers a
    // question the next screen asks again.
    renderBoard();
    await loaded();

    expect(screen.queryByRole('link', { name: /Raise NRGP/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Raise RGP/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Raise Gate Pass/ })).toHaveAttribute('href', '/raise');
  });

  it('counts real pending signatures per office, off the pass_approvals fixture', async () => {
    renderBoard();
    await loaded();

    function value(office: string): string | undefined {
      const slot = screen.getByText(office).closest('.gb-approval');
      expect(slot).not.toBeNull();
      return slot?.querySelector('.gb-approval-value')?.textContent;
    }

    // p1's pending security_head row, on a pass still `pending`.
    expect(value('Security Approval')).toBe('1');
    // p2's pending coo AND pending ceo rows both land on "Other Approvers" —
    // one pass, two outstanding signatures, two counts.
    expect(value('Other Approvers')).toBe('2');
    // p3's pending finance_head row is leftover on a `cancelled` pass (its
    // security_head row was rejected first) and must count nowhere.
    expect(value('Finance Approval')).toBe('0');
    // Nothing is ever routed to the issuing HOD's own office — raising the
    // pass IS that approval (see approvalLadder.ts's "Raised By" rung).
    expect(value('HOD Approval')).toBe('0');

    // REWRITTEN 2026-08-20: the NRGP Issued and RGP Issued cards used to repeat
    // this strip's roll-up ("3 pending approval") as a note each. They carry no
    // note at all now — the Pending Approvals card counts PASSES, which is a
    // different question from how many SIGNATURES are owed, and printing the
    // signature figure on three cards was the repetition the client asked to
    // stop. The strip is the one place that question is answered.
    expect(card('NRGP Issued').textContent).not.toContain('pending approval');
    expect(card('RGP Issued').textContent).not.toContain('pending approval');

    // No "View all" — this page's own drillable KPI cards already open the
    // very passes an office is waiting on.
    expect(screen.queryByRole('link', { name: /View all/i })).not.toBeInTheDocument();
  });

  it('an approved row never counts, on either the strip or the note', async () => {
    renderBoard();
    await loaded();
    // p4's finance_head row is `approved`, not `pending` — Finance stays at the
    // 0 the previous test already pins; asserted again here as its own case so
    // an "approved counts as waiting" regression fails on its own name.
    const slot = screen.getByText('Finance Approval').closest('.gb-approval');
    expect(slot?.querySelector('.gb-approval-value')?.textContent).toBe('0');
  });
});

describe('what the client asked to go', () => {
  it('carries no Alerts card and none of the old board’s panels', async () => {
    renderBoard();
    await loaded();

    expect(screen.queryByText('Alerts')).not.toBeInTheDocument();
    expect(screen.queryByText('Mismatches needing review')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'RGP Overview figures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'NRGP Overview figures' })).not.toBeInTheDocument();
    expect(screen.queryByText('Return Watch')).not.toBeInTheDocument();
  });

  it('links only to routes an HOD may open', async () => {
    renderBoard();
    await loaded();

    for (const link of screen.getAllByRole('link')) {
      expect((link.getAttribute('href') ?? '').startsWith('/all-passes')).toBe(false);
    }
  });
});

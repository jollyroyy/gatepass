// MY PASSES — the client's list mock-up (2026-08-20).
//
// REWRITTEN. This file used to hold that the period presets were seven buttons
// in the `.page-header`, that the RGP/NRGP choice was a `tab-group` segmented
// toggle beside them, and that the calendar sat between the two. The client
// redrew the screen: the tabs are now All / RGP / NRGP with their counts under
// the title, the period is a DROPDOWN on top beside the calendar ("same drop
// down, like the selection date on top ... last 30 days, last three months, six
// months"), and everything else the page narrows by moved behind a Filters
// button. The behaviour those cases protected — a period actually scoping the
// stack, a picked date beating the period, and a period click clearing the date
// — is all still pinned below, through the new controls.
//
// Two rules from the same pass are pinned here for the first time: the
// department is drawn for an ADMIN and never for an HOD, and a card unfolds its
// own material lines.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260810-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Raw Materials - Production', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 6, total_quantity: 6, returned_quantity: 0,
    material_summary: 'Drill', total_value: 25000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const TODAY = pass({ id: 'p1', pass_number: 'TODAY-0001', purpose: 'Ladder' });
const SIXTY_DAYS_OLD = pass({
  id: 'p2',
  pass_number: 'OLD-0001',
  created_at: new Date(NOW - 60 * DAY_MS).toISOString(),
  purpose: 'Coil',
});

let rows: GatePassView[] = [];
let items: unknown[] = [];
/** What `my_profile()` answers — the page asks it to decide the department. */
let role = 'hod';

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order', 'gte', 'lt']) o[m] = () => o;
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'v_gate_passes' ? rows : table === 'v_gate_pass_items' ? items : [],
        error: null,
      }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({
      from: (t: string) => builder(t),
      // `fetchMyProfile` chains `.maybeSingle()` onto the RPC, so the mock has
      // to be a builder rather than a bare promise.
      rpc: (fn: string) => {
        const row = fn === 'my_profile'
          ? { id: 'u1', email: 'hod@x.y', full_name: 'HOD One', role, department_id: 'd1', created_at: '2026-01-01' }
          : null;
        const res = { data: row, error: null };
        return {
          maybeSingle: () => Promise.resolve(res),
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
            Promise.resolve(res).then(ok, err),
        };
      },
    }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      channel: vi.fn(),
      removeChannel: () => undefined,
    },
  };
});

async function renderPage() {
  const MyPasses = (await import('../../src/pages/HOD/MyPasses')).default;
  return render(
    <MemoryRouter>
      <MyPasses />
    </MemoryRouter>
  );
}

beforeEach(() => {
  rows = [TODAY, SIXTY_DAYS_OLD];
  items = [];
  role = 'hod';
  vi.clearAllMocks();
});

describe('MyPasses period dropdown', () => {
  it('is a select on top, offering every period, opening on Last 30 Days', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const select = screen.getByLabelText('Period') as HTMLSelectElement;
    expect(container.querySelector('.gb-page-head')).toContainElement(select);
    expect(select.value).toBe('last30');
    for (const label of ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 3 Months', 'Last 6 Months', 'Weekly', 'Monthly', 'Yearly']) {
      expect(within(select).getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('Last 30 Days (the default) hides a pass raised 60 days ago', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();
  });

  it('Today narrows the stack, Yearly brings the old pass back', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'today' } });
    await waitFor(() => expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument());
    expect(screen.getByText('TODAY-0001')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'yearly' } });
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());
  });
});

describe('MyPasses date picker', () => {
  const OLD_DATE = (() => {
    const d = new Date(NOW - 60 * DAY_MS);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  it('sits on top beside the period, empty by default', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'date');
    expect(container.querySelector('.gb-page-head')).toContainElement(input);
    expect(input.value).toBe('');
  });

  it('a picked date shows that day alone, overriding the period window', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: OLD_DATE } });

    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());
    expect(screen.queryByText('TODAY-0001')).not.toBeInTheDocument();
  });

  it('picking a period clears the date — the two are ONE choice', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: OLD_DATE } });
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'today' } });

    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('');
  });
});

describe('MyPasses type tabs', () => {
  beforeEach(() => {
    rows = [TODAY, pass({ id: 'p3', pass_number: 'NRGP-0001', type: 'NRGP', purpose: 'Scrap' })];
  });

  it('are All / RGP / NRGP with counts that add up', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const strip = screen.getByRole('tablist', { name: 'Pass type' });
    expect(within(strip).getByRole('tab', { name: 'All (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(within(strip).getByRole('tab', { name: 'RGP (1)' })).toBeInTheDocument();
    expect(within(strip).getByRole('tab', { name: 'NRGP (1)' })).toBeInTheDocument();
  });

  it('a tab narrows the stack to its own type', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('NRGP-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'RGP (1)' }));

    await waitFor(() => expect(screen.queryByText('NRGP-0001')).not.toBeInTheDocument());
    expect(screen.getByText('TODAY-0001')).toBeInTheDocument();
  });
});

describe('MyPasses card facts', () => {
  it('an HOD is never shown the department, and always the value', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    expect(screen.queryByText('Department')).not.toBeInTheDocument();
    expect(screen.queryByText('Engineering')).not.toBeInTheDocument();
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹25,000').length).toBeGreaterThan(0);
  });

  it('an admin IS shown the department', async () => {
    role = 'admin';
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    await waitFor(() => expect(screen.getAllByText('Department').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
  });

  it('an unpriced pass reads as a dash, never ₹0', async () => {
    rows = [pass({ id: 'p9', pass_number: 'FREE-0001', total_value: 0 })];
    await renderPage();
    await waitFor(() => expect(screen.getByText('FREE-0001')).toBeInTheDocument());
    expect(screen.queryByText('₹0')).not.toBeInTheDocument();
  });

  it('the whole face links to the pass record, and carries no control', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const face = container.querySelector('.mp-face') as HTMLAnchorElement;
    expect(face).toHaveAttribute('href', '/pass/p1');
    expect(face.querySelector('button')).toBeNull();
  });
});

describe('MyPasses item disclosure', () => {
  it('a card unfolds its own material lines, and folds them away again', async () => {
    items = [
      { id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill', description: 'Bosch GSB', quantity: 2, unit: 'nos', approx_value: 12000 },
    ];
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /Show items on TODAY-0001/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Bosch GSB')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Bosch GSB')).toBeInTheDocument());
    expect(screen.getByText('₹12,000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide items on TODAY-0001/ }));
    await waitFor(() => expect(screen.queryByText('Bosch GSB')).not.toBeInTheDocument());
  });

  it('opening a second card closes the first — one open table at a time', async () => {
    items = [];
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'yearly' } });
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Show items on TODAY-0001/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hide items on TODAY-0001/ })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /Show items on OLD-0001/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Show items on TODAY-0001/ })).toBeInTheDocument()
    );
  });
});

describe('MyPasses filters panel', () => {
  it('keeps the status choice, Awaiting Return and Export CSV behind one button', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const button = screen.getByRole('button', { name: /Filters/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Awaiting Return' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('the status choice actually scopes the stack', async () => {
    rows = [TODAY, pass({ id: 'p4', pass_number: 'FLAG-0001', status: 'flagged' })];
    await renderPage();
    await waitFor(() => expect(screen.getByText('FLAG-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'flagged' } });

    await waitFor(() => expect(screen.queryByText('TODAY-0001')).not.toBeInTheDocument());
    expect(screen.getByText('FLAG-0001')).toBeInTheDocument();
  });
});

describe('MyPasses search and pager', () => {
  it('the search bar carries the mock-up placeholder and narrows the stack', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const input = screen.getByLabelText('Search by GP No. or Purpose');
    expect(input).toHaveAttribute('placeholder', 'Search by GP No. or Purpose...');

    fireEvent.change(input, { target: { value: 'ladder' } });
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'nothing-here' } });
    await waitFor(() => expect(screen.queryByText('TODAY-0001')).not.toBeInTheDocument());
  });

  it('states what it is showing, out of the whole filtered set', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.getByText(/Showing 1 to 1 of 1 entries/)).toBeInTheDocument();
  });
});

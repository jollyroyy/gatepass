// The My Passes period filter: rendered top-right with the same premium
// control the dashboards use, offering the seven periods, defaulting to Last
// 30 Days, and actually scoping the stack.
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
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill', total_value: 25000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const TODAY = pass({ id: 'p1', pass_number: 'TODAY-0001', material_summary: 'Ladder' });
const SIXTY_DAYS_OLD = pass({
  id: 'p2',
  pass_number: 'OLD-0001',
  created_at: new Date(NOW - 60 * DAY_MS).toISOString(),
  material_summary: 'Coil',
});
let rows: GatePassView[] = [];

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order', 'gte', 'lt']) o[m] = () => o;
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_gate_passes' ? rows : [], error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      channel: vi.fn(),
      removeChannel: () => undefined,
    },
  };
});

describe('MyPasses period filter', () => {
  beforeEach(() => {
    rows = [TODAY, SIXTY_DAYS_OLD];
    vi.clearAllMocks();
  });

  async function renderPage() {
    const MyPasses = (await import('../../src/pages/HOD/MyPasses')).default;
    render(
      <MemoryRouter>
        <MyPasses />
      </MemoryRouter>
    );
  }

  it('offers all seven periods, with Last 30 Days pressed by default', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const buttons = ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 6 Months', 'Weekly', 'Monthly', 'Yearly'];
    for (const label of buttons) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Last 30 Days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Last 30 Days (the default) hides a pass raised 60 days ago', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.getByText('Ladder')).toBeInTheDocument();
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();
  });

  it('Today narrows the stack to passes raised today', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() => expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument());
    expect(screen.getByText('TODAY-0001')).toBeInTheDocument();
  });

  it('Yearly brings back the 60-day-old pass', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());
    expect(screen.getByText('TODAY-0001')).toBeInTheDocument();
  });
});

// The RGP/NRGP choice was a dropdown down in the filter row, hiding two of its
// three states behind a click. It is the same segmented toggle the Reports page
// got, in the same place: the page header, top right.
describe('MyPasses pass-type toggle', () => {
  beforeEach(() => {
    rows = [
      TODAY,
      pass({ id: 'p3', pass_number: 'NRGP-0001', type: 'NRGP', material_summary: 'Scrap' }),
    ];
    vi.clearAllMocks();
  });

  async function renderPage() {
    const MyPasses = (await import('../../src/pages/HOD/MyPasses')).default;
    return render(
      <MemoryRouter>
        <MyPasses />
      </MemoryRouter>
    );
  }

  it('sits in the page header and offers All / RGP / NRGP', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const group = screen.getByRole('group', { name: 'Pass type' });
    expect(container.querySelector('.page-header')).toContainElement(group);
    for (const label of ['All', 'RGP', 'NRGP']) {
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrows the stack to one type', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('NRGP-0001')).toBeInTheDocument());

    const group = screen.getByRole('group', { name: 'Pass type' });
    fireEvent.click(within(group).getByRole('button', { name: 'RGP' }));

    await waitFor(() => expect(screen.queryByText('NRGP-0001')).not.toBeInTheDocument());
    expect(screen.getByText('TODAY-0001')).toBeInTheDocument();
  });

  it('drops the old All Types dropdown', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: /All Types/ })).not.toBeInTheDocument();
  });
});

// A calendar, so the HOD can pull one specific day rather than only the rolling
// windows — and the CSV export follows it, because the export writes the rows
// the stack is showing.
describe('MyPasses date picker', () => {
  const OLD_DATE = (() => {
    const d = new Date(NOW - 60 * DAY_MS);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  beforeEach(() => {
    rows = [TODAY, SIXTY_DAYS_OLD];
    vi.clearAllMocks();
  });

  async function renderPage() {
    const MyPasses = (await import('../../src/pages/HOD/MyPasses')).default;
    return render(
      <MemoryRouter>
        <MyPasses />
      </MemoryRouter>
    );
  }

  it('renders a date input in the page header, empty by default', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'date');
    expect(container.querySelector('.page-header')).toContainElement(input);
    expect(input.value).toBe('');
  });

  it('a picked date shows that day alone, overriding the period window', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: OLD_DATE } });

    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());
    expect(screen.queryByText('TODAY-0001')).not.toBeInTheDocument();
  });

  it('clicking a period clears the picked date', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: OLD_DATE } });
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    await waitFor(() => expect(screen.getByText('TODAY-0001')).toBeInTheDocument());
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('');
  });
});
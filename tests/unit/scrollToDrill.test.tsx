// Clicking a KPI reveals a drill list below the cards; on a tall board that
// list can land below the fold. useScrollIntoViewOnChange (src/lib/useScrollIntoViewOnChange.ts)
// scrolls the results container into view when the selected drill changes —
// but never on first mount. This exercises the hook directly (unit-level,
// cheapest and least brittle) and GuardDashboard end-to-end (integration,
// proves it is actually wired up), reusing the mocking pattern already
// established in tests/unit/guardDashboard.test.tsx.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useScrollIntoViewOnChange } from '../../src/lib/useScrollIntoViewOnChange';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 2, total_quantity: 3, returned_quantity: 0,
    material_summary: 'Drill, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const RAISED_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending', type: 'RGP', direction: 'out' }),
];
const VERIFIED_TODAY: GatePassView[] = [
  pass({ id: 'f1', pass_number: 'FLAG-0001', status: 'flagged', flag_reason: 'Qty short',
         verified_at: new Date().toISOString() }),
];
const OPEN_OBLIGATIONS: GatePassView[] = [];

function builder() {
  let axis: 'created_at' | 'verified_at' | 'return_status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'lte', 'lt']) obj[m] = () => obj;
  obj.gte = (col: string) => { axis = col as typeof axis; return obj; };
  obj.eq = (col: string) => { if (col === 'return_status') axis = 'return_status'; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data =
      axis === 'verified_at' ? VERIFIED_TODAY :
      axis === 'return_status' ? OPEN_OBLIGATIONS :
      RAISED_TODAY;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: () => ({ then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) }),
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';

function renderAt(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

describe('useScrollIntoViewOnChange (unit)', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not scroll on initial render', () => {
    const { result } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    const div = document.createElement('div');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('scrolls when the key changes', () => {
    const div = document.createElement('div');
    const { result, rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;

    rerender({ key: 'flagged' });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('uses behavior "auto" when prefers-reduced-motion matches', () => {
    matchMediaMock.mockReturnValue({ matches: true });
    const div = document.createElement('div');
    const { result, rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;

    rerender({ key: 'flagged' });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('does nothing when key changes but ref has no element attached', () => {
    const { rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    rerender({ key: 'flagged' });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

describe('GuardDashboard — scrolls results into view on KPI click', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not scroll on initial load', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('scrolls the results section into view after clicking a KPI', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mismatch at Gate'));

    await waitFor(() => expect(screen.getByText('FLAG-0001')).toBeInTheDocument());
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: expect.stringMatching(/smooth|auto/), block: 'start' }),
    );
  });
});

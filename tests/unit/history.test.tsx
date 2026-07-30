// History is Security's log of PAST verifications. Today's matched/mismatched
// counts belong on GateConsole (KpiCard) and its "today only" deep link — the
// plain /history route (sidebar nav) must never include today's own passes,
// or a guard sees the same pass counted on both screens.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

interface Call {
  method: string;
  args: unknown[];
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['from', 'select', 'in', 'order', 'limit', 'gte', 'lt']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  builder.__calls = calls;
  return builder;
}

let query: ReturnType<typeof makeQuery>;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => query,
}));

import History from '../../src/pages/Security/History';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <History />
    </MemoryRouter>
  );
}

beforeEach(() => {
  query = makeQuery({ data: [], error: null });
});

describe('History date scoping', () => {
  it('excludes today by default — plain /history is the past log, not a live view', async () => {
    renderAt('/history');
    await waitFor(() => expect(query.__calls.some((c: Call) => c.method === 'lt' || c.method === 'gte')).toBe(true));
    const dateCall = query.__calls.find((c: Call) => c.method === 'lt' || c.method === 'gte');
    expect(dateCall?.method).toBe('lt');
    expect(dateCall?.args[0]).toBe('verified_at');
  });

  it('shows ONLY today when the GateConsole KPI deep-link passes today=1', async () => {
    renderAt('/history?status=matched&today=1');
    await waitFor(() => expect(query.__calls.some((c: Call) => c.method === 'gte')).toBe(true));
    const dateCall = query.__calls.find((c: Call) => c.method === 'gte');
    expect(dateCall?.args[0]).toBe('verified_at');
  });
});

const MATCHED_ROW = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260730-0001',
  type: 'RGP',
  visitor_name: 'Alice',
  material_summary: 'Bolts',
  item_count: 2,
  status: 'matched',
  verified_by_name: 'Guard One',
  verified_at: '2026-07-29T10:00:00Z',
  flag_reason: null,
  vehicle_number: null,
} as unknown as GatePassView;

const FLAGGED_ROW = {
  ...MATCHED_ROW,
  id: 'p2',
  pass_number: 'RGP-OUT-20260730-0002',
  status: 'flagged',
  flag_reason: 'Quantity mismatch',
} as unknown as GatePassView;

describe('History Mismatch Reason column', () => {
  it('hides the Mismatch Reason column on the Matched tab — every row would just read "—"', async () => {
    query = makeQuery({ data: [MATCHED_ROW], error: null });
    renderAt('/history?status=matched');
    await screen.findByText('RGP-OUT-20260730-0001');
    expect(screen.queryByText('Mismatch Reason')).not.toBeInTheDocument();
  });

  it('keeps the Mismatch Reason column on the Mismatched tab', async () => {
    query = makeQuery({ data: [FLAGGED_ROW], error: null });
    renderAt('/history?status=flagged');
    await screen.findByText('RGP-OUT-20260730-0002');
    expect(screen.getByText('Mismatch Reason')).toBeInTheDocument();
  });

  it('keeps the Mismatch Reason column on the All tab, where flagged rows can also appear', async () => {
    query = makeQuery({ data: [MATCHED_ROW, FLAGGED_ROW], error: null });
    renderAt('/history');
    await screen.findByText('RGP-OUT-20260730-0001');
    expect(screen.getByText('Mismatch Reason')).toBeInTheDocument();
  });
});

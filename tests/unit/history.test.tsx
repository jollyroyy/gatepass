// History is Security's log of PAST verifications. Today's matched/mismatched
// counts belong on GateConsole (KpiCard) and its "today only" deep link — the
// plain /history route (sidebar nav) must never include today's own passes,
// or a guard sees the same pass counted on both screens.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

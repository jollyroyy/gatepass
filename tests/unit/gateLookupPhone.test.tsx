// The gate can find a pass by the mobile number of the person who took the
// material, and act on the result without a second search.
//
// Three things are pinned here, and each has a way of silently regressing:
//   * a mobile number must NOT go through `lookup_pass` (one row, one outcome,
//     a logged scan attempt — none of which fits a person with three passes);
//   * a pass number must still go through it;
//   * every result carries its own action, and that action is Verify only when
//     the gate can still act on the pass.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260818-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi',
    visitor_company: JSON.stringify({ n: 'BSC', a: 'Kolkata', v: '+91 98765-43210' }),
    vehicle_number: 'WB01AB1234', purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString(),
    created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    flagged_at: null, hod_reviewed_at: null,
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill', total_value: 0,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let queueRows: GatePassView[] = [];
let searchRows: GatePassView[] = [];
const ilikeCalls: { col: string; pattern: string }[] = [];
const rpcCalls: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => {
  const builder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    let isSearch = false;
    for (const m of ['select', 'eq', 'order', 'gte', 'lt', 'in', 'limit']) o[m] = () => o;
    o.ilike = (col: string, pattern: string) => {
      ilikeCalls.push({ col, pattern });
      isSearch = true;
      return o;
    };
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: isSearch ? searchRows : queueRows, error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({
      from: () => builder(),
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve({ data: [{ outcome: 'not_found', pass_id: null }], error: null });
      },
    }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      channel: vi.fn(() => ch),
      removeChannel: () => undefined,
    },
  };
});

async function renderConsole() {
  const GateConsole = (await import('../../src/pages/Security/GateConsole')).default;
  render(
    <MemoryRouter>
      <GateConsole />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId('gate-lookup')).toBeInTheDocument());
}

async function search(text: string) {
  fireEvent.change(screen.getByLabelText('Find a Pass'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
}

describe('gate lookup by mobile number', () => {
  beforeEach(() => {
    queueRows = [];
    searchRows = [];
    ilikeCalls.length = 0;
    rpcCalls.length = 0;
    vi.clearAllMocks();
  });

  it('searches the register instead of calling lookup_pass', async () => {
    searchRows = [pass({ id: 'a', pass_number: 'RGP-OUT-20260818-0009' })];
    await renderConsole();
    await search('9876543210');

    await waitFor(() => expect(screen.getByTestId('phone-search-results')).toBeInTheDocument());
    expect(rpcCalls).not.toContain('lookup_pass');
    expect(ilikeCalls).toEqual([{ col: 'visitor_company', pattern: '%3210%' }]);
    expect(screen.getByText('RGP-OUT-20260818-0009')).toBeInTheDocument();
  });

  it('still sends a pass number to lookup_pass', async () => {
    await renderConsole();
    await search('RGP-OUT-20260726-0001');

    await waitFor(() => expect(rpcCalls).toContain('lookup_pass'));
    expect(ilikeCalls).toHaveLength(0);
    expect(screen.queryByTestId('phone-search-results')).toBeNull();
  });

  it('drops a row the ilike over-matched on some other field', async () => {
    searchRows = [
      pass({ id: 'a', pass_number: 'KEEP-0001' }),
      pass({
        id: 'b',
        pass_number: 'DROP-0001',
        // Same last four digits in the ADDRESS, a different phone entirely.
        visitor_company: JSON.stringify({ n: 'Other', a: 'Plot 3210', v: '9000000000' }),
      }),
    ];
    await renderConsole();
    await search('9876543210');

    await waitFor(() => expect(screen.getByText('KEEP-0001')).toBeInTheDocument());
    expect(screen.queryByText('DROP-0001')).toBeNull();
  });

  it('offers Verify at Gate on an actionable result, and details on one the gate cannot act on', async () => {
    searchRows = [
      pass({ id: 'a', pass_number: 'LIVE-0001' }),
      pass({ id: 'b', pass_number: 'DONE-0001', status: 'matched' }),
    ];
    await renderConsole();
    await search('9876543210');

    await waitFor(() => expect(screen.getByTestId('phone-search-results')).toBeInTheDocument());
    const verify = screen.getByRole('link', { name: /Verify at gate — LIVE-0001/ });
    expect(verify).toHaveAttribute('href', '/verify/a');
    const details = screen.getByRole('link', { name: /View details — DONE-0001/ });
    expect(details).toHaveAttribute('href', '/pass/b');
  });

  it('says so plainly when nobody holds that number, and can be cleared', async () => {
    searchRows = [];
    await renderConsole();
    await search('9876543210');

    await waitFor(() => expect(screen.getByText(/No gate pass carries that mobile number/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByTestId('phone-search-results')).toBeNull();
  });
});

// The gate can find a pass by the mobile number of the person who took the
// material, and act on the result without a second search.
//
// Three things are pinned here, and each has a way of silently regressing:
//   * a mobile number must NOT go through `lookup_pass` (one row, one outcome,
//     a logged scan attempt — none of which fits a person with three passes);
//   * a pass number must still go through it;
//   * every result carries its own action, and that action is Approve OUT only
//     when the gate can still act on the pass, else Record Return when it owes
//     material back, else View pass.
//
// The mobile-number branch is one of THREE now (client, 2026-08-24): search
// grew a free-text branch (`searchPassesByText`, pinned in its own tests) for
// a name, a vendor, an order number or a make/model. That branch is not
// exercised here — this file stays about the phone branch and the boundary
// between it and the pass-code branch — but the sr-only label and the results
// panel below are shared with it, so both moved with the client's copy.
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

// The sr-only label grew the other query shapes into its own wording
// (client, 2026-08-24) — the searchable field is the same one input.
async function search(text: string) {
  fireEvent.change(
    screen.getByLabelText('Find a pass by number, mobile, name, vendor, requester, order number or make and model'),
    { target: { value: text } }
  );
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

  // Two rows on purpose: ONE match opens the full record in place instead of
  // a list (that path is pinned in gateConsoleSearch.test.tsx), so the list
  // itself can only be asserted on a number two passes carry.
  it('searches the register instead of calling lookup_pass', async () => {
    searchRows = [
      pass({ id: 'a', pass_number: 'RGP-OUT-20260818-0009' }),
      pass({ id: 'b', pass_number: 'RGP-OUT-20260818-0010' }),
    ];
    await renderConsole();
    await search('9876543210');

    // Renamed from `phone-search-results`: the same stacked-card panel now
    // answers all three search branches, not just a mobile number
    // (`SearchMatches`, testid `guard-search-results`).
    await waitFor(() => expect(screen.getByTestId('guard-search-results')).toBeInTheDocument());
    expect(rpcCalls).not.toContain('lookup_pass');
    expect(ilikeCalls).toEqual([{ col: 'visitor_company', pattern: '%3210%' }]);
    expect(screen.getByText('RGP-OUT-20260818-0009')).toBeInTheDocument();
  });

  it('still sends a pass number to lookup_pass', async () => {
    await renderConsole();
    await search('RGP-OUT-20260726-0001');

    await waitFor(() => expect(rpcCalls).toContain('lookup_pass'));
    expect(ilikeCalls).toHaveLength(0);
    expect(screen.queryByTestId('guard-search-results')).toBeNull();
  });

  it('drops a row the ilike over-matched on some other field', async () => {
    searchRows = [
      pass({ id: 'a', pass_number: 'KEEP-0001' }),
      pass({ id: 'c', pass_number: 'KEEP-0002' }),
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

  // Labels changed from "Verify at Gate" / "View Details" to "Approve OUT" /
  // "View pass" (client, 2026-08-24) — one stacked card format now answers
  // every search branch, and each card's one action is the same one the
  // guard's drilled KPI list would offer for that pass (`matchAction` in
  // `src/components/guard/SearchMatches.tsx`), addressed by href rather than
  // by a pass number in the link's own name.
  it('offers Approve OUT on an actionable result, and View pass on one the gate cannot act on', async () => {
    searchRows = [
      pass({ id: 'a', pass_number: 'LIVE-0001' }),
      pass({ id: 'b', pass_number: 'DONE-0001', status: 'matched' }),
    ];
    await renderConsole();
    await search('9876543210');

    await waitFor(() => expect(screen.getByTestId('guard-search-results')).toBeInTheDocument());
    const approve = screen.getByRole('link', { name: 'Approve OUT' });
    expect(approve).toHaveAttribute('href', '/verify/a');
    const viewPass = screen.getByRole('link', { name: 'View pass' });
    expect(viewPass).toHaveAttribute('href', '/pass/b');
  });

  it('says so plainly when nobody holds that number, and can be cleared', async () => {
    searchRows = [];
    await renderConsole();
    await search('9876543210');

    // The empty state is `SearchMatches`'s own — shared with the free-text
    // branch, so it names every shape a query can be, not just a mobile
    // number (client, 2026-08-24).
    await waitFor(() =>
      expect(
        screen.getByText(
          /No gate pass matches that pass number, mobile number, name, vendor, requester, order number or make and model/
        )
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByTestId('guard-search-results')).toBeNull();
  });
});

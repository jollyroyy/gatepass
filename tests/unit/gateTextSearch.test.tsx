// SEARCHING BY WHAT SOMEBODY ACTUALLY KNOWS (client, 2026-08-24: search by
// "the pass number, phone number, name, the vendor name, the person who took
// the item out" and "any order number or a laptop make and model … the results
// may be more than one as there are maybe five passes in for Dell").
//
// Two things are pinned here, and they are the two halves of that instruction:
//
//   1. THE QUERY REACHES BOTH TABLES. A vendor, a name, a requester and a
//      vehicle are columns of `v_gate_passes`; a make / model, an invoice
//      (order) number and a serial are columns of a MATERIAL LINE and are NOT
//      rolled into `material_summary`, which is `string_agg(i.name)` and
//      nothing more. A search that read only the pass row would find no
//      "Latitude 5440" anywhere in the register.
//
//   2. THE ANSWER IS A LIST OF STACKED CARDS, EACH CARRYING THE ACTION THE
//      GUARD'S OWN DRILLED KPI LIST WOULD OFFER IT. Approve OUT on a pass the
//      gate can still clear (the same `canVerifyAtGate` rule `match_pass`
//      enforces, so a button that could only fail is never drawn), Record
//      Return on one that still owes material, View pass on anything settled.
//
// A NAME NO LONGER GOES TO `lookup_pass`. That RPC writes a scan record, fires
// the blacklist alert and answers with one row or `not_found`; all three are
// right for a scanned code and wrong for a typed word. `isPassCodeQuery` is a
// shape test now, and this file fails if it ever goes back to "contains a
// letter".
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260824-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'IT', department_code: 'IT',
    raised_by: 'u1', raised_by_name: 'Ravi Kumar',
    visitor_name: 'Suresh', visitor_company: '{"n":"Dell India","a":"Pune","v":"9876543210"}',
    vehicle_number: 'MH12AB1234', purpose: 'Repair',
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2099-01-01T00:00:00Z',
    created_at: '2026-08-24T09:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'none', awaits_approval: false,
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Laptop', flagged_at: null, hod_reviewed_at: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Matched on the PASS row (its vendor blob holds "Dell").
const BY_PASS = pass({ id: 'p1', pass_number: 'RGP-OUT-20260824-0001' });
// Matched only through a LINE — `make_model: 'Dell Latitude 5440'`. Its own
// columns say nothing about Dell, which is the point.
const BY_LINE = pass({
  id: 'p2', pass_number: 'RGP-OUT-20260824-0002',
  visitor_company: '{"n":"Contractor Co","a":"Pune","v":"9000000000"}',
  material_summary: 'Machine', status: 'matched', return_status: 'partially_returned',
  created_at: '2026-08-24T08:00:00Z',
});

const rpc = vi.fn();
/** Every `.or(...)` string the search sent, in order — the proof that both
 *  tables were asked, and what they were asked. */
let ORS: { table: string; filter: string }[] = [];
/** Ids handed to the follow-up `.in('id', …)` read. */
let INS: string[] = [];

function builder(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  let mode: 'or' | 'in' | null = null;
  for (const m of ['select', 'order', 'limit', 'ilike', 'eq', 'gte']) obj[m] = () => obj;
  obj.or = (filter: string) => { ORS.push({ table, filter }); mode = 'or'; return obj; };
  obj.in = (_col: string, ids: string[]) => { INS = ids; mode = 'in'; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    let data: unknown[] = [];
    if (table === 'v_gate_passes' && mode === 'or') data = [BY_PASS];
    if (table === 'v_gate_pass_items' && mode === 'or') data = [{ gate_pass_id: 'p2' }];
    if (table === 'v_gate_passes' && mode === 'in') data = [BY_LINE];
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  };
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }),
  pub: () => ({ from: () => builder('profiles') }),
  supabase: {
    channel: () => { throw new Error('no realtime'); },
    removeChannel: () => undefined,
  },
}));

vi.mock('../../src/lib/usePassItems', () => ({
  usePassItems: () => ({ items: undefined, error: null }),
}));

import GateLookup from '../../src/pages/Security/GateLookup';
import SearchMatches from '../../src/components/guard/SearchMatches';

function Harness(): React.ReactElement {
  const [rows, setRows] = React.useState<GatePassView[] | null>(null);
  return (
    <MemoryRouter>
      <GateLookup onListResults={(_q, r) => setRows(r)} />
      {rows && <SearchMatches query="Dell" rows={rows} onClear={() => setRows(null)} />}
    </MemoryRouter>
  );
}

function search(text: string): void {
  fireEvent.change(screen.getByLabelText(/Find a pass by number/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
}

beforeEach(() => {
  ORS = [];
  INS = [];
  rpc.mockReset();
});

describe('a typed word is a text search, not a code lookup', () => {
  it('never calls lookup_pass for a vendor name', async () => {
    render(<Harness />);
    search('Dell');
    await waitFor(() => expect(ORS.length).toBeGreaterThan(0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks the pass row about the party, the carrier, the requester and the vehicle', async () => {
    render(<Harness />);
    search('Dell');
    await waitFor(() => expect(ORS.some((o) => o.table === 'v_gate_passes')).toBe(true));
    const filter = ORS.find((o) => o.table === 'v_gate_passes')!.filter;
    for (const field of [
      'pass_number', 'visitor_name', 'visitor_company', 'raised_by_name',
      'material_summary', 'vehicle_number', 'purpose',
    ]) {
      expect(filter).toContain(`${field}.ilike.*Dell*`);
    }
  });

  it('asks the MATERIAL LINES about the make / model, the order number and the serial', async () => {
    render(<Harness />);
    search('Dell');
    await waitFor(() => expect(ORS.some((o) => o.table === 'v_gate_pass_items')).toBe(true));
    const filter = ORS.find((o) => o.table === 'v_gate_pass_items')!.filter;
    for (const field of ['name', 'description', 'make_model', 'invoice_no', 'serial_no']) {
      expect(filter).toContain(`${field}.ilike.*Dell*`);
    }
  });

  it('brings back the pass a LINE matched, alongside the one the pass row matched', async () => {
    render(<Harness />);
    search('Dell');
    // The line read named p2; the follow-up read fetches exactly that pass.
    await waitFor(() => expect(INS).toEqual(['p2']));
    await waitFor(() => expect(screen.getByTestId('pass-stack')).toBeTruthy());
    expect(screen.getByText('RGP-OUT-20260824-0001')).toBeTruthy();
    expect(screen.getByText('RGP-OUT-20260824-0002')).toBeTruthy();
  });

  it('still sends a WHOLE pass number to lookup_pass', async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: 'ok', pass_id: 'p1', blacklist_match: null }], error: null,
    });
    render(<Harness />);
    search('RGP-OUT-20260824-0001');
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('lookup_pass', { p_code: 'RGP-OUT-20260824-0001' })
    );
  });
});

describe('several results are stacked cards, each with the gate own action', () => {
  it('offers Approve OUT on a pass the gate can still clear, and Record Return on one still owing', async () => {
    render(<Harness />);
    search('Dell');
    await waitFor(() => expect(screen.getByTestId('pass-stack')).toBeTruthy());
    // p1 is pending, unexpired and fully approved — the Pending OUT action.
    expect(screen.getByRole('link', { name: /Approve OUT/i })).toBeTruthy();
    // p2 has left the gate and still owes lines — the return action.
    expect(screen.getByRole('link', { name: /Record Return/i })).toBeTruthy();
  });

  it('drops to View pass on a pass with nothing left to do', () => {
    render(
      <MemoryRouter>
        <SearchMatches
          query="Dell"
          rows={[pass({ id: 'p3', status: 'matched', return_status: 'returned' })]}
          onClear={() => undefined}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'View pass' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Approve OUT/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Record Return/i })).toBeNull();
  });

  it('says plainly, and in the vocabulary of the search, when nothing matches', () => {
    render(
      <MemoryRouter>
        <SearchMatches query="Dell" rows={[]} onClear={() => undefined} />
      </MemoryRouter>
    );
    expect(screen.getByText(/No gate pass matches that/i)).toBeTruthy();
    expect(screen.queryByTestId('pass-stack')).toBeNull();
  });
});

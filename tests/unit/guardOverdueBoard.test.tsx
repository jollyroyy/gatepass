// OVERDUE RGP GATE PASSES — the guard's screen (client, 2026-08-19).
//
// The two things the client asked to be true, and one thing they asked to be
// gone, are all asserted here:
//
//   1. ONE CARD, AND ITS COUNT IS RELIABLE. The figure is passes, not lines,
//      and it is the length of the very list the card opens — so a pass with
//      three late lines counts once, and the tile cannot say 5 over a stack
//      of 4.
//   2. EVERY CARD IN THE STACK IS A LINK to that pass's record, which is why
//      the menu no longer carries "View Pass Details".
//   3. NOTHING ELSE IS ON THE PAGE: no second KPI tile, no Guard Actions block.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc: () => Promise.resolve({ data: [], error: null }) }),
  supabase: { channel: () => ({ on: () => ({ subscribe: () => undefined }) }), removeChannel: () => undefined },
}));

import GuardOverdueBoard from '../../src/components/guard/GuardOverdueBoard';
import { buildOverduePasses } from '../../src/lib/overduePasses';

/** Days before today, as a local `YYYY-MM-DD` — the shape of the real column. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260517-0078', type: 'RGP', direction: 'out', status: 'matched',
    return_status: 'awaiting_return', department_id: 'd1', department_name: 'Engineering',
    visitor_name: 'Ramesh Yadav', visitor_company: 'TechFix Solutions', raised_by_name: 'Ramesh Yadav',
    expected_return_date: daysAgo(2), due_state: 'overdue', verified_at: '2026-05-17T10:15:00Z',
    item_count: 2,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Fluke Multimeter', quantity: 2,
    unit: 'nos', returned_qty: 0, outstanding_qty: 2, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function draw(passes: GatePassView[], items: GatePassItemView[]) {
  return render(
    <MemoryRouter>
      <GuardOverdueBoard passes={passes} items={items} loading={false} error={null} />
    </MemoryRouter>,
  );
}

describe('buildOverduePasses — the count behind the card', () => {
  it('counts a pass ONCE however many of its lines are late', () => {
    const p = pass({});
    const rows = buildOverduePasses(
      [p],
      [item({ id: 'i1', line_no: 1 }), item({ id: 'i2', line_no: 2 }), item({ id: 'i3', line_no: 3 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pendingItems).toBe(3);
    expect(rows[0].pendingQty).toBe(6);
  });

  it('takes the OLDEST missed date on the pass as the delay for the whole pass', () => {
    const p = pass({ expected_return_date: daysAgo(1) });
    const rows = buildOverduePasses(
      [p],
      [
        item({ id: 'i1', line_no: 1, expected_return_date: daysAgo(5) }),
        item({ id: 'i2', line_no: 2 }),
      ],
    );
    expect(rows[0].daysLate).toBe(5);
    expect(rows[0].severity).toBe('critical');
  });

  it('drops a pass whose lines are all back, and one that is not late yet', () => {
    const back = pass({ id: 'p2', pass_number: 'RGP-2' });
    const early = pass({ id: 'p3', pass_number: 'RGP-3', expected_return_date: daysAgo(-2) });
    const rows = buildOverduePasses(
      [pass({}), back, early],
      [
        item({}),
        item({ id: 'i9', gate_pass_id: 'p2', returned_qty: 2, outstanding_qty: 0 }),
        item({ id: 'i8', gate_pass_id: 'p3' }),
      ],
    );
    expect(rows.map((r) => r.pass.id)).toEqual(['p1']);
  });

  it('orders worst delay first', () => {
    const rows = buildOverduePasses(
      [pass({}), pass({ id: 'p2', pass_number: 'RGP-2', expected_return_date: daysAgo(9) })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
    );
    expect(rows.map((r) => r.pass.id)).toEqual(['p2', 'p1']);
  });
});

describe('GuardOverdueBoard — one card, and the stack it opens', () => {
  it('the figure on the card is the number of cards in the stack', () => {
    draw(
      [pass({}), pass({ id: 'p2', pass_number: 'RGP-20260518-0056', expected_return_date: daysAgo(1) })],
      [item({}), item({ id: 'i2', line_no: 2 }), item({ id: 'i3', gate_pass_id: 'p2' })],
    );

    const card = screen.getByRole('button', { name: /Overdue Passes/i });
    expect(within(card).getByText('2')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('every card in the stack links to that pass, and nothing offers View Pass Details', async () => {
    draw([pass({})], [item({})]);

    const link = screen.getByRole('link', { name: /RGP-20260517-0078/ });
    expect(link.getAttribute('href')).toBe('/pass/p1');

    fireEvent.click(screen.getByRole('button', { name: /Actions for RGP-20260517-0078/i }));
    // Awaited, not asserted synchronously: opening the menu fires the contact
    // lookup, and settling it here is what keeps the state update inside act().
    expect(await screen.findByRole('menuitem', { name: /Process RGP Return/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Contact Vendor/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Add Guard Remark/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Export Pass PDF/i })).toBeTruthy();
    expect(screen.queryByText(/View Pass Details/i)).toBeNull();
  });

  it('carries no second KPI tile and no Guard Actions block', () => {
    draw([pass({})], [item({})]);

    expect(screen.queryByText(/Total Pending Items/i)).toBeNull();
    expect(screen.queryByText(/Oldest Overdue/i)).toBeNull();
    expect(screen.queryByText(/Due Today/i)).toBeNull();
    expect(screen.queryByText(/Guard Actions/i)).toBeNull();
  });

  it('the card toggles the stack shut and open again', () => {
    draw([pass({})], [item({})]);
    const card = screen.getByRole('button', { name: /Overdue Passes/i });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(card);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(card);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says so plainly when nothing is late, and opens nothing', () => {
    draw([], []);
    const card = screen.getByRole('button', { name: /Overdue Passes/i });
    expect(within(card).getByText('0')).toBeTruthy();
    expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nothing is overdue/i)).toBeTruthy();
  });
});

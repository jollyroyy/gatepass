// A DESK LINE MUST OPEN ITS OWN QUEUE, NOT THE CARD IT SITS UNDER.
//
// Client, 2026-08-23: filtering the admin board to Today showed a "Pending
// approval" figure, and pressing it opened a list of completed and returned
// passes. It did, and by construction: the two desk lines were READINGS inside
// the card's own anchor, so a press anywhere on the card — the sub-figure
// included — opened the card's drill, which is every RGP raised in the window
// whatever became of it. The count was right and the list was somebody else's.
//
// So each desk line is now a control of its own, carrying the very rows it
// counted (`pendingSplit`), and the two scopes stay honest: the FIGURE is
// windowed, the DESK LINES are running, and the page a desk opens says so.
import { describe, it, expect } from 'vitest';
import { buildOverviewCards } from '../../src/lib/adminOverview';
import { buildHodKpis } from '../../src/lib/hodBoard';
import { pendingSplit } from '../../src/lib/pendingSplit';
import { drillFor } from '../../src/lib/boardDrills';
import { isWaitingAtGate } from '../../src/lib/gateQueue';
import type { GatePassView } from '../../src/types';

const NOW = new Date('2026-08-23T10:00:00+05:30').getTime();
const DAY = 86_400_000;

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: Math.random().toString(36).slice(2), pass_number: 'RGP-1', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'IT', department_code: 'IT',
    raised_by: 'u1', raised_by_name: 'HOD',
    visitor_name: 'V', visitor_company: 'C', vehicle_number: null,
    purpose: 'p', expected_return_date: '2026-09-01', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: '2099-01-01T00:00:00Z',
    created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'm', awaits_approval: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// The exact shape the client was looking at: TODAY holds one pass still
// climbing the ladder and three that are long since finished, so a desk line
// that opened the card's drill would show the finished ones.
const ROWS: GatePassView[] = [
  pass({ pass_number: 'RGP-WAIT', awaits_approval: true }),
  pass({ pass_number: 'RGP-GATE' }),
  pass({ pass_number: 'RGP-DONE', status: 'matched', return_status: 'returned' }),
  pass({ pass_number: 'RGP-BACK', status: 'matched', return_status: 'returned' }),
  pass({ pass_number: 'NRGP-WAIT', type: 'NRGP', return_status: 'not_applicable', awaits_approval: true }),
  // Yesterday, still unsigned: outside Today's window, ON the desk. The desk
  // lines are running, so this one must be in the list a desk opens.
  pass({
    pass_number: 'RGP-OLD', awaits_approval: true,
    created_at: new Date(NOW - DAY).toISOString(),
  }),
];

describe('the admin Overview desk lines', () => {
  const cards = buildOverviewCards(ROWS, 1, NOW);
  const rgp = cards.find((c) => c.key === 'rgp');
  const notes = rgp?.notes ?? [];

  it('gives every desk line a page of its own', () => {
    expect(notes.map((n) => [n.key, n.to])).toEqual([
      ['rgpPendingGate', '/admin-dashboard/rgpPendingGate'],
      ['rgpPendingApproval', '/admin-dashboard/rgpPendingApproval'],
    ]);
  });

  it('opens the rows it counted — never the card it sits under', () => {
    for (const n of notes) {
      expect(n.drill.rows.length, n.key).toBe(n.value);
      expect(n.drill.rows.every(isWaitingAtGate), n.key).toBe(true);
    }
    const approval = notes.find((n) => n.key === 'rgpPendingApproval');
    expect(approval?.drill.rows.map((p) => p.pass_number).sort())
      .toEqual(['RGP-OLD', 'RGP-WAIT']);
    // The bug, stated: the card's own drill DOES hold finished passes, which is
    // exactly why a desk line must not open it.
    expect(rgp?.drill?.rows.some((p) => p.return_status === 'returned')).toBe(true);
  });

  it('says out loud that a desk is running while the figure above it is windowed', () => {
    expect(notes.every((n) => Boolean(n.drill.scopeNote))).toBe(true);
  });

  it('is reachable from the drill page by key, card or desk alike', () => {
    expect(drillFor(cards, 'rgpPendingApproval')?.rows.length)
      .toBe(pendingSplit(ROWS.filter((p) => p.type === 'RGP')).awaitingApproval.length);
    expect(drillFor(cards, 'rgp')?.rows).toEqual(cards.find((c) => c.key === 'rgp')?.drill?.rows);
    expect(drillFor(cards, 'nonsense')).toBeUndefined();
  });
});

describe('the HOD board desk lines', () => {
  const cards = buildHodKpis(ROWS, NOW);
  const notes = cards.find((c) => c.key === 'rgpIssued')?.notes ?? [];

  it('opens the same queues under the HOD board`s own path', () => {
    expect(notes.map((n) => [n.key, n.to])).toEqual([
      ['rgpPendingGate', '/dashboard/rgpPendingGate'],
      ['rgpPendingApproval', '/dashboard/rgpPendingApproval'],
    ]);
    expect(drillFor(cards, 'rgpPendingGate')?.rows.map((p) => p.pass_number)).toEqual(['RGP-GATE']);
  });
});

// THE TWO PENDING DESKS: SUB-LINES OF THE PASS-TYPE CARDS, ON EVERY BOARD.
//
// They have moved three times and this is the fourth shape. One card with the
// split under it → a card each (client, 2026-08-22: "separate the pending at
// gate review and pending for approvals") → back to one card with the split
// under it, on the HOD board only (2026-08-23 morning) → and now, on the same
// day: "instead of making it as a separate pending card, make the similar type
// of pending gate approval and pending approval under each NRGP and RGP …
// remove all those two pending cards completely. Do this across all the views."
//
// So NO board carries a pending card of any kind, and each pass-type card
// carries the two desks OF ITS OWN TYPE.
//
// WHAT THE SPLIT COUNTS HAS NOT MOVED ACROSS ANY OF THAT: `pendingSplit` is
// unchanged, and `pendingNotes` is that function applied to one type's rows —
// so the two lines under a card sum to that type's waiting set by construction,
// and the two cards' lines together sum to the board's whole waiting set.
import { describe, it, expect } from 'vitest';
import { buildOverviewCards } from '../../src/lib/adminOverview';
import { buildHodKpis } from '../../src/lib/hodBoard';
import { pendingSplit } from '../../src/lib/pendingSplit';
import type { GatePassView } from '../../src/types';

const NOW = new Date('2026-08-22T10:00:00+05:30').getTime();

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

// Two RGP at the gate, three RGP still climbing the ladder — and one NRGP on
// each desk, so a card that counted the whole board rather than its own type
// would read 3 and 4 instead of 2 and 3.
const ROWS: GatePassView[] = [
  pass(), pass(),
  pass({ awaits_approval: true }), pass({ awaits_approval: true }), pass({ awaits_approval: true }),
  pass({ type: 'NRGP', pass_number: 'NRGP-1', return_status: 'not_applicable' }),
  pass({ type: 'NRGP', pass_number: 'NRGP-2', return_status: 'not_applicable', awaits_approval: true }),
];

const desks = (notes?: { label: string; value: number }[]) =>
  (notes ?? []).map((n) => [n.label, n.value]);

describe('the admin Overview', () => {
  const cards = buildOverviewCards(ROWS, 7, NOW);
  const rgp = cards.find((c) => c.key === 'rgp');
  const nrgp = cards.find((c) => c.key === 'nrgp');

  it('carries no pending card of any kind', () => {
    expect(cards.map((c) => c.key)).toEqual(['rgp', 'nrgp', 'overdue']);
  });

  it('prints the two desks under each pass type, counting only that type', () => {
    expect(desks(rgp?.notes)).toEqual([
      ['Pending gate approval', 2],
      ['Pending approval', 3],
    ]);
    expect(desks(nrgp?.notes)).toEqual([
      ['Pending gate approval', 1],
      ['Pending approval', 1],
    ]);
  });

  it('still sums to what the removed pending cards counted', () => {
    const total = [rgp, nrgp].flatMap((c) => c?.notes ?? []).reduce((t, n) => t + n.value, 0);
    expect(total).toBe(pendingSplit(ROWS).waiting.length);
  });

  it('leaves Overdue Returns a navigation, with no rows and no desks of its own', () => {
    const overdue = cards.find((c) => c.key === 'overdue');
    expect(overdue?.to).toBe('/overdue');
    expect(overdue?.drill).toBeUndefined();
    expect(overdue?.notes).toBeUndefined();
  });
});

describe('the HOD board', () => {
  const cards = buildHodKpis(ROWS, NOW);
  const nrgp = cards.find((c) => c.key === 'nrgpIssued');
  const rgp = cards.find((c) => c.key === 'rgpIssued');

  it('carries no pending card of any kind', () => {
    expect(cards.map((c) => c.key)).toEqual(['nrgpIssued', 'rgpIssued', 'pendingReturn', 'overdue']);
  });

  it('prints the same two desks under each pass type, at the HOD scope it was handed', () => {
    expect(desks(rgp?.notes)).toEqual([
      ['Pending gate approval', 2],
      ['Pending approval', 3],
    ]);
    expect(desks(nrgp?.notes)).toEqual([
      ['Pending gate approval', 1],
      ['Pending approval', 1],
    ]);
  });

  it('sums to the same waiting set the admin board reads', () => {
    const total = [rgp, nrgp].flatMap((c) => c?.notes ?? []).reduce((t, n) => t + n.value, 0);
    expect(total).toBe(pendingSplit(ROWS).waiting.length);
  });

  it('has no Rejected card, and its Overdue card navigates rather than drilling', () => {
    expect(cards.some((c) => c.key === 'rejected')).toBe(false);
    const overdue = cards.find((c) => c.key === 'overdue');
    expect(overdue?.to).toBe('/overdue');
    expect(overdue?.drill).toBeUndefined();
  });

  it('gives every other card a drill AND the page that opens it', () => {
    for (const c of cards.filter((c) => c.key !== 'overdue')) {
      expect(c.drill, c.key).toBeDefined();
      expect(c.to, c.key).toBe(`/dashboard/${c.key}`);
    }
  });
});

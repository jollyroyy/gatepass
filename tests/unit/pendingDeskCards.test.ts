// THE TWO PENDING DESKS: TWO CARDS ON THE ADMIN'S BOARD, ONE ON THE HOD'S.
//
// They were one card with the split under it until 2026-08-22, when the client
// separated them ("in the dashboard make sure you separate the pending at gate
// review and pending for approvals, and remove those subtext"), and on
// 2026-08-23 the HOD's board took the opposite instruction ("merge both the
// pending gate approval and pending approval into one total card. Below the
// card you put it in two subtexts"). The admin's board was not named and keeps
// its two cards.
//
// WHAT THE SPLIT COUNTS HAS NOT MOVED ACROSS ANY OF THAT: `pendingSplit` is
// unchanged, so one card plus its two notes and two cards side by side are the
// same three numbers, and both boards still read the same function.
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

// Two at the gate, three still climbing the ladder.
const ROWS: GatePassView[] = [
  pass(), pass(),
  pass({ awaits_approval: true }), pass({ awaits_approval: true }), pass({ awaits_approval: true }),
];

describe('the admin Overview', () => {
  const cards = buildOverviewCards(ROWS, 7, NOW);
  const gate = cards.find((c) => c.key === 'pendingGate');
  const approval = cards.find((c) => c.key === 'pendingApproval');

  it('draws a card per desk, each over its own rows', () => {
    expect(gate?.label).toBe('Pending Gate Review');
    expect(gate?.value).toBe(2);
    expect(gate?.drill.rows).toHaveLength(2);
    expect(approval?.label).toBe('Pending Approval');
    expect(approval?.value).toBe(3);
    expect(approval?.drill.rows).toHaveLength(3);
  });

  it('no longer carries the combined card, nor any note property under a figure', () => {
    // REWRITTEN 2026-08-22: it used to assert `c.notes.length === 0`. The
    // client's instruction that day ("remove running and all kinds of
    // subtext from kpi card from all dashboards ... across all views")
    // deleted OverviewCard.note/notes outright, so there is no `notes`
    // array left to be empty — the property itself is gone.
    expect(cards.some((c) => c.key === 'pending')).toBe(false);
    expect(cards.every((c) => !('notes' in c) && !('note' in c))).toBe(true);
  });

  it('still sums to what the one card counted', () => {
    const split = pendingSplit(ROWS);
    expect((gate?.value ?? 0) + (approval?.value ?? 0)).toBe(split.waiting.length);
  });
});

describe('the HOD board', () => {
  const cards = buildHodKpis(ROWS, NOW);
  const pending = cards.find((c) => c.key === 'pendingApprovals');

  it('draws ONE card over both desks, with the HOD wording of the empty list', () => {
    expect(pending?.label).toBe('Pending Approvals');
    expect(pending?.value).toBe(5);
    expect(pending?.drill?.rows).toHaveLength(5);
    expect(pending?.drill?.empty).toBe('Nothing of yours is waiting.');
    expect(cards.some((c) => c.key === 'pendingGate' || c.key === 'pendingApproval')).toBe(false);
  });

  it('prints the two desks under it, and they sum to the figure above', () => {
    expect(pending?.notes?.map((n) => [n.label, n.value])).toEqual([
      ['Pending gate approval', 2],
      ['Pending approval', 3],
    ]);
    const split = pendingSplit(ROWS);
    expect((pending?.notes ?? []).reduce((t, n) => t + n.value, 0)).toBe(split.waiting.length);
  });

  it('has no Rejected card, and its Overdue card navigates rather than drilling', () => {
    expect(cards.some((c) => c.key === 'rejected')).toBe(false);
    const overdue = cards.find((c) => c.key === 'overdue');
    expect(overdue?.to).toBe('/overdue');
    expect(overdue?.drill).toBeUndefined();
  });

  it('leaves every other card a drill and no notes', () => {
    for (const c of cards.filter((c) => c.key !== 'pendingApprovals' && c.key !== 'overdue')) {
      expect(c.drill, c.key).toBeDefined();
      expect(c.notes, c.key).toBeUndefined();
    }
  });
});

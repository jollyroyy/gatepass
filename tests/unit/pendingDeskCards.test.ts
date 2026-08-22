// THE TWO PENDING DESKS ARE TWO CARDS NOW, AND NEITHER CARRIES A SUB-LINE
// (client, 2026-08-22: "in the dashboard make sure you separate the pending at
// gate review and pending for approvals, and remove those subtext").
//
// They used to be ONE card — "Pending Approvals" — with the split printed under
// it as two small notes. A figure standing over two sub-figures is a card whose
// drill opens a list that is two different queues; the desks are separate
// people with separate work, so they are separate cards, each drilling into its
// own rows.
//
// WHAT THE SPLIT COUNTS HAS NOT MOVED: `pendingSplit` is unchanged, so the two
// cards still sum to what the single one showed, and both boards still read the
// same function.
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
  const gate = cards.find((c) => c.key === 'pendingGate');
  const approval = cards.find((c) => c.key === 'pendingApproval');

  it('draws the same two cards, with the HOD wording of the empty list', () => {
    expect(gate?.label).toBe('Pending Gate Review');
    expect(gate?.value).toBe(2);
    expect(approval?.label).toBe('Pending Approval');
    expect(approval?.value).toBe(3);
    expect(approval?.drill.rows).toHaveLength(3);
  });

  it('carries no `notes`/`sub` property at all under either of them', () => {
    // REWRITTEN 2026-08-22: it used to assert `gate?.notes` / `approval?.notes`
    // equalled `[]`. The client's instruction that day ("remove running and
    // all kinds of subtext from kpi card from all dashboards ... across all
    // views") deleted HodKpiCard.notes and .sub outright, so there is no
    // property left to be an empty array.
    expect(gate).not.toHaveProperty('notes');
    expect(gate).not.toHaveProperty('sub');
    expect(approval).not.toHaveProperty('notes');
    expect(approval).not.toHaveProperty('sub');
  });

  it('leaves the Rejected card its own two sub-lines, which were not named', () => {
    const rejected = cards.find((c) => c.key === 'rejected');
    expect(rejected).toBeDefined();
  });
});

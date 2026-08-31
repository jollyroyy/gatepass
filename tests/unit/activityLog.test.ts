// THE ACTIVITY LOG's derivations. Everything this screen shows already existed
// in three tables; what these cases pin is that merging them tells the truth.
//
// The one that matters most is the emergency case: `decided_by` on a released
// level is the SUPER ADMIN who overrode the ladder, not an approver, and a log
// that reads "Approved — CEO · Sudeshna Pal" against an office Sudeshna does
// not hold is a fabricated audit trail — the exact thing migration 046 refuses
// to do when it declines to backfill the grandfathered passes.
import { describe, it, expect } from 'vitest';
import {
  buildActivityLog,
  applyActivityFilters,
  localDay,
  GATE_EVENT_LABELS,
  type ApprovalEvent,
  type GateEvent,
} from '../../src/lib/activityLog';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1',
    pass_number: 'RGP-20260820-0001',
    type: 'RGP',
    direction: 'out',
    status: 'pending',
    return_status: 'awaiting_return',
    created_at: '2026-08-20T10:00:00Z',
    department_name: 'Engineering',
    raised_by_name: 'Ravi Menon',
    material_summary: 'Lift controller',
    is_overdue: false,
    is_expired: false,
    due_state: 'ok',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...over,
  } as any;
}

const NAMES = new Map([
  ['u-coo', 'Sudeshna Pal'],
  ['u-sec', 'Demi'],
  ['u-super', 'Root Admin'],
]);

function approval(over: Partial<ApprovalEvent> = {}): ApprovalEvent {
  return {
    gate_pass_id: 'p1',
    role_key: 'security_head',
    status: 'approved',
    decided_by: 'u-sec',
    decided_at: '2026-08-20T11:00:00Z',
    reason: null,
    emergency: false,
    ...over,
  };
}

function gate(over: Partial<GateEvent> = {}): GateEvent {
  return {
    id: 'v1',
    gate_pass_id: 'p1',
    action: 'matched',
    security_name: 'Guard One',
    remarks: null,
    gate_name: 'Loading Bay',
    created_at: '2026-08-20T12:00:00Z',
    ...over,
  };
}

describe('buildActivityLog', () => {
  it('merges all three sources onto one timeline, newest first', () => {
    const rows = buildActivityLog([pass()], [approval()], [gate()], NAMES);
    expect(rows.map((r) => r.event)).toEqual([
      'Cleared at the gate',
      'Approved — Security Head',
      'Raised',
    ]);
    expect(rows.every((r) => r.passNumber === 'RGP-20260820-0001')).toBe(true);
  });

  it('names the person for every kind of event', () => {
    const rows = buildActivityLog([pass()], [approval()], [gate()], NAMES);
    expect(rows.find((r) => r.event === 'Raised')!.who).toBe('Ravi Menon');
    expect(rows.find((r) => r.event.startsWith('Approved'))!.who).toBe('Demi');
    expect(rows.find((r) => r.event.startsWith('Cleared'))!.who).toBe('Guard One');
  });

  it('does not record an undecided level as an event', () => {
    // A pending approval is the ABSENCE of an event, not an event.
    const rows = buildActivityLog(
      [pass()],
      [approval({ status: 'pending', decided_by: null, decided_at: null })],
      [],
      NAMES,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe('Raised');
  });

  it('carries the written reason on a rejection', () => {
    const rows = buildActivityLog(
      [pass()],
      [approval({ status: 'rejected', reason: 'Vendor not cleared.' })],
      [],
      NAMES,
    );
    const rejected = rows.find((r) => r.event.startsWith('Rejected'))!;
    expect(rejected.event).toBe('Rejected — Security Head');
    expect(rejected.detail).toBe('Vendor not cleared.');
  });

  it('NEVER reads an emergency release as an approval', () => {
    // decided_by there is the super admin who overrode the ladder. Reading it
    // as "Approved — CEO · Root Admin" would credit them with a signature they
    // never gave, on an office they do not hold.
    const rows = buildActivityLog(
      [pass()],
      [approval({
        role_key: 'ceo',
        decided_by: 'u-super',
        emergency: true,
        reason: 'Nobody reachable overnight; lift repair.',
      })],
      [],
      NAMES,
    );
    const row = rows.find((r) => r.event !== 'Raised')!;
    expect(row.event).toBe('Released without CEO approval');
    expect(row.event).not.toMatch(/approved/i);
    expect(row.who).toBe('Root Admin');
    expect(row.detail).toBe('Nobody reachable overnight; lift repair.');
  });

  it('tones every verification action, so no gate event renders blank', () => {
    for (const action of Object.keys(GATE_EVENT_LABELS)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = buildActivityLog([pass()], [], [gate({ action: action as any })], NAMES);
      const row = rows.find((r) => r.event !== 'Raised')!;
      expect(row.event).toBeTruthy();
      expect(row.event).not.toBe(action);
    }
  });

  it('leaves `who` null rather than inventing an actor', () => {
    const rows = buildActivityLog([pass()], [approval({ decided_by: 'nobody-knows' })], [], NAMES);
    expect(rows.find((r) => r.event.startsWith('Approved'))!.who).toBeNull();
  });
});

describe('applyActivityFilters', () => {
  const rows = buildActivityLog([pass()], [approval()], [gate()], NAMES);

  it('searches the pass number, the person and the event alike', () => {
    expect(applyActivityFilters(rows, { search: 'demi', day: '' })).toHaveLength(1);
    expect(applyActivityFilters(rows, { search: 'RGP-20260820', day: '' })).toHaveLength(3);
    expect(applyActivityFilters(rows, { search: 'cleared', day: '' })).toHaveLength(1);
    expect(applyActivityFilters(rows, { search: 'nothing here', day: '' })).toHaveLength(0);
  });

  it('filters by a LOCAL day, not a UTC one', () => {
    // A day means the day the reader lives in. localDay is what the filter
    // compares against, so the two cannot drift apart.
    const day = localDay(rows[0].at);
    expect(applyActivityFilters(rows, { search: '', day })).not.toHaveLength(0);
    expect(applyActivityFilters(rows, { search: '', day: '1999-01-01' })).toHaveLength(0);
  });
});

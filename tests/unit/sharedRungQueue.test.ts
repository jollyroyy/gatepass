// THE CEO's QUEUE DOES NOT CARRY A PASS THE COO STILL HAS TIME ON (063).
//
// Client, 2026-08-22: "level three approval approver will be either co or CEO.
// If the [COO] has given the approval then it will not go to the CEO. … if the
// [COO] has not given the approval within one or two days then it will escalate
// to CEO."
//
// `inMyQueue` is the list at /approvals, and it is the same predicate the
// Approve / Reject bar on the record uses — so a pass that would be refused by
// `approve_pass_level` is never drawn with a button on it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { inMyQueue, type PassApproval } from '../../src/lib/pendingApprovals';
import type { GatePassView } from '../../src/types';

afterEach(() => {
  vi.useRealTimers();
});

const RAISED = '2026-08-20T09:00:00.000Z';
const REACHED = '2026-08-21T09:00:00.000Z';

const PASS = {
  id: 'p1',
  status: 'pending',
  pass_number: 'RGP-20260820-0001',
  created_at: RAISED,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as GatePassView;

const ON_LAST_RUNG: PassApproval[] = [
  { gate_pass_id: 'p1', role_key: 'security_head', level_no: 1, status: 'approved', decided_at: RAISED },
  { gate_pass_id: 'p1', role_key: 'finance_head', level_no: 2, status: 'approved', decided_at: REACHED },
  { gate_pass_id: 'p1', role_key: 'coo', level_no: 3, status: 'pending' },
  { gate_pass_id: 'p1', role_key: 'ceo', level_no: 3, status: 'pending' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any as PassApproval[];

describe('the shared last rung, on the approver queue', () => {
  it('is in the COO queue at once and in nobody else\'s', () => {
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'coo', 48)).toHaveLength(1);
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'ceo', 48)).toHaveLength(0);
  });

  it('reaches the CEO queue once the window has run out', () => {
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'));
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'ceo', 48)).toHaveLength(1);
    // AND STAYS IN THE COO'S. Escalation adds a signatory; it does not take
    // the rung away from the office whose rung it is.
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'coo', 48)).toHaveLength(1);
  });

  it('honours a shorter window an admin has set', () => {
    vi.setSystemTime(new Date('2026-08-21T14:00:00.000Z'));
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'ceo', 48)).toHaveLength(0);
    // Four hours after the rung was reached, with the window set to 2 hours.
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'ceo', 2)).toHaveLength(1);
  });

  it('leaves the CEO\'s queue empty once the COO has signed', () => {
    vi.setSystemTime(new Date('2026-08-25T10:00:00.000Z'));
    const decided = ON_LAST_RUNG.map((r) =>
      r.role_key === 'coo'
        ? { ...r, status: 'approved' as const, decided_at: '2026-08-21T10:00:00.000Z' }
        : r.role_key === 'ceo'
          ? { ...r, status: 'not_required' as const, decided_at: '2026-08-21T10:00:00.000Z' }
          : r,
    );
    expect(inMyQueue([PASS], decided, 'ceo', 48)).toHaveLength(0);
    expect(inMyQueue([PASS], decided, 'coo', 48)).toHaveLength(0);
  });
});

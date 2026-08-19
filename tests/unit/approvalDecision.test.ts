// WHO MAY PRESS APPROVE ON ONE PASS — the slip-order rule, stated once
// (migration 046, `approve_pass_level`'s own guard) and read by both the
// approver's queue and the CTA bar at the foot of the gate pass record.
import { describe, it, expect } from 'vitest';
import {
  canDecideApproval,
  heldByOffice,
  lowestPendingLevel,
  myStep,
  type ApprovalStepRow,
} from '../../src/lib/approvalDecision';

function row(over: Partial<ApprovalStepRow>): ApprovalStepRow {
  return { role_key: 'security_head', level_no: 1, status: 'pending', ...over };
}

const LADDER: ApprovalStepRow[] = [
  row({ role_key: 'security_head', level_no: 1 }),
  row({ role_key: 'coo', level_no: 2 }),
  row({ role_key: 'ceo', level_no: 3 }),
  row({ role_key: 'finance_head', level_no: 4 }),
];

describe('lowestPendingLevel', () => {
  it('is the first rung nobody has signed', () => {
    expect(lowestPendingLevel(LADDER)).toBe(1);
    expect(lowestPendingLevel([row({ level_no: 1, status: 'approved' }), row({ role_key: 'coo', level_no: 2 })])).toBe(2);
  });

  it('is null when every rung is decided, and null on a pass with no ladder', () => {
    expect(lowestPendingLevel(LADDER.map((r) => ({ ...r, status: 'approved' as const })))).toBeNull();
    expect(lowestPendingLevel([])).toBeNull();
  });
});

describe('myStep', () => {
  it('finds my office s row, and is null when the pass is not routed to me', () => {
    expect(myStep(LADDER, 'ceo')?.level_no).toBe(3);
    expect(myStep(LADDER, null)).toBeNull();
    expect(myStep([row({ role_key: 'coo', level_no: 2 })], 'ceo')).toBeNull();
  });
});

describe('canDecideApproval', () => {
  it('is true only for the LOWEST still-pending office on a pending pass', () => {
    expect(canDecideApproval('pending', LADDER, 'security_head')).toBe(true);
    // The slip order: the COO cannot sign before the Security Head has.
    expect(canDecideApproval('pending', LADDER, 'coo')).toBe(false);
  });

  it('follows the ladder up as each rung is signed', () => {
    const signed = LADDER.map((r) => (r.level_no === 1 ? { ...r, status: 'approved' as const } : r));
    expect(canDecideApproval('pending', signed, 'security_head')).toBe(false);
    expect(canDecideApproval('pending', signed, 'coo')).toBe(true);
  });

  it('is false once the pass has left the ladder, whatever the rows say', () => {
    // `reject_pass_level` cancels the pass and leaves the rungs below pending;
    // `match_pass` moves it to matched. Neither may be signed afterwards.
    expect(canDecideApproval('cancelled', LADDER, 'security_head')).toBe(false);
    expect(canDecideApproval('matched', LADDER, 'security_head')).toBe(false);
  });

  it('is false with no office, and false on a pass carrying no ladder at all', () => {
    expect(canDecideApproval('pending', LADDER, null)).toBe(false);
    expect(canDecideApproval('pending', [], 'security_head')).toBe(false);
  });

  it('is false when my own rung is already decided', () => {
    const mine = LADDER.map((r) => (r.level_no === 1 ? { ...r, status: 'approved' as const } : r));
    expect(canDecideApproval('pending', mine, 'security_head')).toBe(false);
  });
});

describe('heldByOffice', () => {
  it('names the office holding the pass up when it is not mine to sign', () => {
    expect(heldByOffice(LADDER, 'coo')).toBe('security_head');
  });

  it('is null when it IS mine, and null when nothing is pending', () => {
    expect(heldByOffice(LADDER, 'security_head')).toBeNull();
    expect(heldByOffice(LADDER.map((r) => ({ ...r, status: 'approved' as const })), 'coo')).toBeNull();
  });
});

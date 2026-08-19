// src/lib/hodApprovals.ts, in isolation from the dashboard that renders it.
//
// The four cases that decide what a "Waiting" figure on the HOD dashboard's
// Approval Pending strip means:
//
//   1. a pending row on a pass still climbing counts, under its own office;
//   2. a pass's own status gates it — a rejected pass's leftover pending rows
//      (reject_pass_level, 046, leaves the lower levels untouched) count
//      NOWHERE, because that pass is never climbing again;
//   3. COO and CEO both fold into "Other Approvers", and EACH pending row is
//      its own count — a pass owing both counts twice, not once;
//   4. HOD Approval is structurally zero — nothing in `pass_approvals` is ever
//      keyed to it, so no fixture can make it anything else.
import { describe, it, expect } from 'vitest';
import { approvalWaiting, approvalWaitingTotal, APPROVAL_SLOTS, type PendingApprovalRow } from '../../src/lib/hodApprovals';
import type { GatePassView } from '../../src/types';

function pass(id: string, status: GatePassView['status']): GatePassView {
  return { id, status } as GatePassView;
}

describe('approvalWaiting', () => {
  it('counts a pending row on a pass that is still pending, under its own office', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals)).toEqual({ hod: 0, security: 1, finance: 0, other: 0 });
  });

  it('finance_head maps to the Finance slot alone', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'finance_head', status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals).finance).toBe(1);
  });

  it('coo and ceo both fold into Other Approvers, and each pending row counts once', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'coo', status: 'pending' },
      { gate_pass_id: 'a', role_key: 'ceo', status: 'pending' },
    ];
    // One pass, two outstanding signatures at two different offices that share
    // one slot: this counts TWO things waiting on "Other Approvers", not one.
    expect(approvalWaiting(passes, approvals).other).toBe(2);
  });

  it("a rejected pass's leftover pending rows count nowhere", () => {
    const passes = [pass('a', 'cancelled')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', status: 'rejected' },
      { gate_pass_id: 'a', role_key: 'finance_head', status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals)).toEqual({ hod: 0, security: 0, finance: 0, other: 0 });
  });

  it('an approved row never counts, regardless of the pass status', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'coo', status: 'approved' },
    ];
    expect(approvalWaiting(passes, approvals).other).toBe(0);
  });

  it('HOD Approval is structurally zero — no role key maps to it', () => {
    const passes = [pass('a', 'pending'), pass('b', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', status: 'pending' },
      { gate_pass_id: 'b', role_key: 'coo', status: 'pending' },
      { gate_pass_id: 'b', role_key: 'ceo', status: 'pending' },
      { gate_pass_id: 'b', role_key: 'finance_head', status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals).hod).toBe(0);
  });

  it('a row addressed to a pass id absent from the passes array is ignored', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'stranger', role_key: 'security_head', status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals).security).toBe(0);
  });
});

describe('approvalWaitingTotal', () => {
  it('is the sum of the four office counts', () => {
    const waiting = { hod: 0, security: 2, finance: 1, other: 3 };
    expect(approvalWaitingTotal(waiting)).toBe(6);
  });

  it('agrees with approvalWaiting on a mixed fixture', () => {
    const passes = [pass('a', 'pending'), pass('b', 'cancelled'), pass('c', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', status: 'pending' },
      { gate_pass_id: 'b', role_key: 'finance_head', status: 'pending' }, // dead: b is cancelled
      { gate_pass_id: 'c', role_key: 'coo', status: 'pending' },
      { gate_pass_id: 'c', role_key: 'ceo', status: 'pending' },
    ];
    const waiting = approvalWaiting(passes, approvals);
    expect(waiting).toEqual({ hod: 0, security: 1, finance: 0, other: 2 });
    expect(approvalWaitingTotal(waiting)).toBe(3);
  });
});

describe('APPROVAL_SLOTS', () => {
  it('is still the mock-up’s four, in its own order', () => {
    expect(APPROVAL_SLOTS.map((s) => s.key)).toEqual(['hod', 'security', 'finance', 'other']);
  });
});

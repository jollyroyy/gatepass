// src/lib/hodApprovals.ts, in isolation from the dashboard that renders it.
//
// REWRITTEN 2026-08-21 (thirty-ninth pass). This file used to hold the
// OPPOSITE rule: that the Approval Pending strip counted every SIGNATURE still
// owed, so one pass owing four of them appeared four times and a pass owing a
// pending COO row and a pending CEO row counted TWICE under "Other Approvers".
// The client read a board whose Pending Approvals card said 1 over a strip
// summing to 4 and asked for the two to agree ("it should match, right?").
//
// The rule now is ONE PASS, ONE DESK — the desk that can actually act on it,
// which `approve_pass_level` (046) defines as the lowest still-pending rung and
// migration 061 turned into RLS: an office cannot even SEE a pass until every
// rung below it is approved. The cases that decide what a "Waiting" figure on
// that strip means:
//
//   1. a pass still climbing counts ONCE, under the office whose rung is the
//      lowest one still pending;
//   2. an office higher up the ladder counts NOTHING on that pass — the pass
//      has not reached it, and naming it would say a person is holding up a
//      document they cannot open;
//   3. a pass's own status gates it — a rejected pass's leftover pending rows
//      (reject_pass_level, 046, leaves the lower levels untouched) count
//      NOWHERE, because that pass is never climbing again, and an EXPIRED pass
//      counts nowhere either, because the card beside the strip excludes it;
//   4. a pass with no pending rung at all is at the GATE, not with an approver,
//      and this strip counts no gate row;
//   5. HOD Approval is structurally zero — nothing in `pass_approvals` is ever
//      keyed to it, so no fixture can make it anything else.
import { describe, it, expect } from 'vitest';
import {
  approvalWaiting,
  approvalWaitingTotal,
  APPROVAL_SLOTS,
  type PendingApprovalRow,
} from '../../src/lib/hodApprovals';
import { pendingSplit } from '../../src/lib/pendingSplit';
import type { GatePassView } from '../../src/types';

function pass(
  id: string,
  status: GatePassView['status'],
  over: Partial<GatePassView> = {},
): GatePassView {
  return { id, status, is_expired: false, ...over } as GatePassView;
}

describe('approvalWaiting', () => {
  it('counts a pass still climbing ONCE, under the office whose rung is lowest still pending', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals)).toEqual({ hod: 0, security: 1, finance: 0, other: 0 });
  });

  it('names only the desk that can act — an office further up the ladder counts nothing', () => {
    // One pass owing all four signatures. Only the Security Head can act on it
    // (061: the other three cannot even read it), so it is waiting with exactly
    // one desk and the strip sums to one, not four.
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'coo', level_no: 2, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'finance_head', level_no: 3, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'ceo', level_no: 4, status: 'pending' },
    ];
    const waiting = approvalWaiting(passes, approvals);
    expect(waiting).toEqual({ hod: 0, security: 1, finance: 0, other: 0 });
    expect(approvalWaitingTotal(waiting)).toBe(1);
  });

  it('moves the pass up a desk as each rung is signed', () => {
    const passes = [pass('a', 'pending')];
    const rows: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'approved' },
      { gate_pass_id: 'a', role_key: 'coo', level_no: 2, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'finance_head', level_no: 3, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'ceo', level_no: 4, status: 'pending' },
    ];
    expect(approvalWaiting(passes, rows)).toEqual({ hod: 0, security: 0, finance: 0, other: 1 });

    rows[1] = { ...rows[1], status: 'approved' };
    expect(approvalWaiting(passes, rows)).toEqual({ hod: 0, security: 0, finance: 1, other: 0 });

    rows[2] = { ...rows[2], status: 'approved' };
    expect(approvalWaiting(passes, rows)).toEqual({ hod: 0, security: 0, finance: 0, other: 1 });
  });

  it('coo and ceo both fold into Other Approvers', () => {
    const passes = [pass('a', 'pending'), pass('b', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'coo', level_no: 2, status: 'pending' },
      { gate_pass_id: 'b', role_key: 'ceo', level_no: 4, status: 'pending' },
    ];
    // TWO passes, each waiting with one of the two offices that share the slot.
    expect(approvalWaiting(passes, approvals).other).toBe(2);
  });

  it('a rejected pass leftover pending rows count nowhere', () => {
    const passes = [pass('a', 'cancelled')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'rejected' },
      { gate_pass_id: 'a', role_key: 'finance_head', level_no: 3, status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals)).toEqual({ hod: 0, security: 0, finance: 0, other: 0 });
  });

  it('an EXPIRED pass counts nowhere, exactly as the card beside the strip excludes it', () => {
    const passes = [pass('a', 'pending', { is_expired: true })];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'pending' },
    ];
    expect(approvalWaitingTotal(approvalWaiting(passes, approvals))).toBe(0);
  });

  it('a pass whose ladder is finished is at the GATE, and this strip counts no gate row', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'approved' },
    ];
    expect(approvalWaitingTotal(approvalWaiting(passes, approvals))).toBe(0);
  });

  it('a pass with NO ladder at all counts nowhere either', () => {
    // Every pass raised before an office was designated, and every level closed
    // by 058's rollout. `awaits_approval` is false on all of them.
    const passes = [pass('a', 'pending')];
    expect(approvalWaitingTotal(approvalWaiting(passes, []))).toBe(0);
  });

  it('HOD Approval is structurally zero, no role key maps to it', () => {
    const passes = [pass('a', 'pending'), pass('b', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'pending' },
      { gate_pass_id: 'b', role_key: 'coo', level_no: 2, status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals).hod).toBe(0);
  });

  it('a row addressed to a pass id absent from the passes array is ignored', () => {
    const passes = [pass('a', 'pending')];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'stranger', role_key: 'security_head', level_no: 1, status: 'pending' },
    ];
    expect(approvalWaiting(passes, approvals).security).toBe(0);
  });
});

describe('approvalWaitingTotal', () => {
  it('is the sum of the four office counts', () => {
    const waiting = { hod: 0, security: 2, finance: 1, other: 3 };
    expect(approvalWaitingTotal(waiting)).toBe(6);
  });

  // THE INVARIANT THE CLIENT ASKED FOR, 2026-08-21: the strip and the Pending
  // Approvals card above it must agree. The card's own second sub-figure is the
  // passes still climbing the ladder (`pendingSplit`), and this strip is those
  // same passes filed by the desk each is sitting with — so the four figures
  // SUM to that line, on any fixture.
  it('sums to the Pending Approvals card pending-approval sub-figure', () => {
    const passes = [
      pass('a', 'pending', { awaits_approval: true }), // with the Security Head
      pass('b', 'pending', { awaits_approval: true }), // with the COO
      pass('c', 'pending'), // ladder done — at the gate
      pass('d', 'pending', { is_expired: true, awaits_approval: true }), // dead
      pass('e', 'cancelled', { awaits_approval: true }), // rejected
      pass('f', 'matched'),
    ];
    const approvals: PendingApprovalRow[] = [
      { gate_pass_id: 'a', role_key: 'security_head', level_no: 1, status: 'pending' },
      { gate_pass_id: 'a', role_key: 'coo', level_no: 2, status: 'pending' },
      { gate_pass_id: 'b', role_key: 'security_head', level_no: 1, status: 'approved' },
      { gate_pass_id: 'b', role_key: 'coo', level_no: 2, status: 'pending' },
      { gate_pass_id: 'c', role_key: 'security_head', level_no: 1, status: 'approved' },
      { gate_pass_id: 'd', role_key: 'security_head', level_no: 1, status: 'pending' },
      { gate_pass_id: 'e', role_key: 'finance_head', level_no: 3, status: 'pending' },
    ];
    const waiting = approvalWaiting(passes, approvals);
    expect(waiting).toEqual({ hod: 0, security: 1, finance: 0, other: 1 });
    expect(approvalWaitingTotal(waiting)).toBe(2);
    expect(approvalWaitingTotal(waiting)).toBe(pendingSplit(passes).awaitingApproval.length);
  });
});

describe('APPROVAL_SLOTS', () => {
  it('is still the mock-up four, in its own order', () => {
    expect(APPROVAL_SLOTS.map((s) => s.key)).toEqual(['hod', 'security', 'finance', 'other']);
  });
});

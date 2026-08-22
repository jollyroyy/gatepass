// THE LADDER IS CLIMBED ONE RUNG AT A TIME, IN THE CLIENT'S ORDER.
//
// Client, 2026-08-20:
//   "make sure you make the approval process linear, one by one: 1. The
//    security head has to approve 2. COO 3. Finance 4. CEO. The approval cannot
//    progress until the first, second, third, and fourth levels are approved.
//    Until the first level is approved, the second level cannot progress..."
//
// The one-at-a-time rule was already true and is pinned in
// `approvalDecision.test.ts` — this file pins the ORDER it is true in, which
// changed: 043 took `Security Head → COO → CEO → Finance HOD` off the printed
// A5 slip, and the CEO now signs LAST, after finance has costed the pass.
//
// Three surfaces state that order and they must agree, or a guard comparing the
// slip in their hand to the record on the tablet finds a level on one that is
// missing from the other:
//
//   * `APPROVAL_LADDER`      — the screen's rungs and their numbers
//   * migration 057          — `pass_approvals.level_no` and its CHECK
//
// THERE USED TO BE A THIRD: `SIGNATURE_ROWS`, the printed slip's seven empty
// boxes, and the case below pinned that its four office labels ran in ladder
// order. That file is DELETED (2026-08-22) — the slip prints the record's own
// `buildApprovalSteps` now, so the paper cannot state an order of its own to
// disagree with, and the property is satisfied by construction rather than by
// an assertion.
//
// It also pins the SECOND half of the same client message — the error the
// Security Head hit after approving. See `canVerifyAtGate` below.
import { describe, it, expect } from 'vitest';
import { APPROVAL_LADDER, APPROVAL_ROLE_TITLES } from '../../src/lib/approvalLadder';
import { canVerifyAtGate } from '../../src/lib/phoneSearch';
import { canDecideApproval, lowestPendingLevel } from '../../src/lib/approvalDecision';
import type { GatePassView } from '../../src/types';

/** A pass at the gate: pending, unexpired, and — unless a case says otherwise —
 *  carrying no unsigned approval level. */
function gatePass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1',
    status: 'pending',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  } as GatePassView;
}

const rungs = (decided: Record<string, 'pending' | 'approved'> = {}) =>
  APPROVAL_LADDER.map(({ key, level }) => ({
    role_key: key,
    level_no: level,
    status: decided[key] ?? ('pending' as const),
  }));

describe('the approval ladder is Security Head → COO → Finance HOD → CEO', () => {
  it('numbers the four offices in the order the client dictated', () => {
    expect(APPROVAL_LADDER).toEqual([
      { key: 'security_head', level: 1 },
      { key: 'coo', level: 2 },
      { key: 'finance_head', level: 3 },
      { key: 'ceo', level: 4 },
    ]);
  });

  // REWRITTEN 2026-08-22: the slip no longer states an order of its own — it
  // renders the ladder itself. What is left to pin is that the titles the
  // printed trail names each office by are the ladder's own, so the paper and
  // the screen cannot call the same office two different things.
  it('names the four offices by their slip titles, finance BEFORE the ceo', () => {
    expect(APPROVAL_LADDER.map(({ key }) => APPROVAL_ROLE_TITLES[key])).toEqual([
      'Security Head', 'COO', 'Finance HOD', 'CEO',
    ]);
  });
});

describe('a rung cannot be climbed before the one below it', () => {
  it('offers the decision to the security head alone on a fresh pass', () => {
    const rows = rungs();
    expect(lowestPendingLevel(rows)).toBe(1);
    expect(canDecideApproval('pending', rows, 'security_head')).toBe(true);
    for (const office of ['coo', 'finance_head', 'ceo'] as const) {
      expect(canDecideApproval('pending', rows, office)).toBe(false);
    }
  });

  it('hands each office its turn only once every office below it has signed', () => {
    // The whole client instruction, walked rung by rung. At every step exactly
    // ONE office may act, and it is the next one in the ladder.
    const signed: Record<string, 'approved'> = {};
    for (const { key } of APPROVAL_LADDER) {
      const rows = rungs(signed);
      const allowed = APPROVAL_LADDER.map(({ key: k }) => k).filter((k) =>
        canDecideApproval('pending', rows, k),
      );
      expect(allowed).toEqual([key]);
      signed[key] = 'approved';
    }
    // Every rung signed: nobody is owed anything and nobody may act again.
    expect(lowestPendingLevel(rungs(signed))).toBeNull();
  });

  it('does not let finance jump the coo, which is where the order changed', () => {
    const rows = rungs({ security_head: 'approved' });
    expect(canDecideApproval('pending', rows, 'coo')).toBe(true);
    expect(canDecideApproval('pending', rows, 'finance_head')).toBe(false);
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(false);
  });

  it('leaves the ceo last, after finance has signed', () => {
    const rows = rungs({ security_head: 'approved', coo: 'approved', finance_head: 'approved' });
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(true);
    expect(lowestPendingLevel(rows)).toBe(4);
  });
});

describe('a pass still climbing the ladder is never offered a gate action', () => {
  // THE CLIENT'S ERROR, reproduced as a unit. The Security Head on this
  // deployment is a `guard` account (043 allows it), so after approving level 1
  // they could still see the pass on their own gate screens — and pressing
  // Approve OUT ran `match_pass`, which `block_unapproved_gate_move` refused
  // with "This gate pass has not been approved by every level yet."
  it('withholds Approve OUT while any level is unsigned', () => {
    expect(canVerifyAtGate(gatePass({ awaits_approval: true }))).toBe(false);
  });

  it('offers it again the moment the last level signs', () => {
    expect(canVerifyAtGate(gatePass({ awaits_approval: false }))).toBe(true);
  });

  it('leaves a pass with no ladder at all exactly as it was', () => {
    // The 60-odd passes raised before an office was designated carry no
    // approval rows, and the column is absent from every fixture written
    // before migration 057. Neither may become unclearable.
    expect(canVerifyAtGate(gatePass())).toBe(true);
  });

  it('still refuses an expired pass, and an already-decided one', () => {
    expect(
      canVerifyAtGate(gatePass({ expires_at: new Date(Date.now() - 1000).toISOString() })),
    ).toBe(false);
    expect(canVerifyAtGate(gatePass({ status: 'matched' }))).toBe(false);
  });
});

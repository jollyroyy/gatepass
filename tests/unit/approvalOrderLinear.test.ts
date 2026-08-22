// THE LADDER IS CLIMBED ONE RUNG AT A TIME, IN THE CLIENT'S ORDER.
//
// REWRITTEN 2026-08-22. This file used to hold the 2026-08-20 order — "1. The
// security head has to approve 2. COO 3. Finance 4. CEO" — with four offices on
// four levels. The client changed it the same week:
//
//   "Level one approver will be the security head. Level two approver will be
//    the finance head and level three approval approver will be either co or
//    CEO. If the [COO] has given the approval then it will not go to the CEO.
//    … if the [COO] has not given the approval within one or two days then it
//    will escalate to CEO."
//
// So there are FOUR OFFICES ON THREE LEVELS now, and the last rung is shared.
// The one-at-a-time rule is unchanged and is still pinned in
// `approvalDecision.test.ts`; this file pins the ORDER, and — since 063 — the
// escalation that decides which of the two offices on the last rung may act.
//
// Three surfaces state that order and they must agree, or a guard comparing the
// slip in their hand to the record on the tablet finds a level on one that is
// missing from the other:
//
//   * `APPROVAL_LADDER`      — the screen's rungs and their numbers
//   * migration 063          — `pass_approvals.level_no` and its CHECK
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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { APPROVAL_LADDER, APPROVAL_ROLE_TITLES } from '../../src/lib/approvalLadder';
import { canVerifyAtGate } from '../../src/lib/phoneSearch';
import {
  canDecideApproval,
  lowestPendingLevel,
  withEscalation,
} from '../../src/lib/approvalDecision';
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

afterEach(() => {
  vi.useRealTimers();
});

const rungs = (decided: Record<string, 'pending' | 'approved'> = {}) =>
  APPROVAL_LADDER.map(({ key, level }) => ({
    role_key: key,
    level_no: level,
    status: decided[key] ?? ('pending' as const),
  }));

describe('the approval ladder is Security Head then Finance HOD then COO or CEO', () => {
  it('numbers the offices in the order the client dictated', () => {
    expect(APPROVAL_LADDER).toEqual([
      { key: 'security_head', level: 1 },
      { key: 'finance_head', level: 2 },
      { key: 'coo', level: 3 },
      { key: 'ceo', level: 3 },
    ]);
  });

  it('puts the COO and the CEO on ONE rung - four offices, three levels', () => {
    expect(new Set(APPROVAL_LADDER.map((r) => r.level)).size).toBe(3);
    expect(APPROVAL_LADDER.filter((r) => r.level === 3).map((r) => r.key))
      .toEqual(['coo', 'ceo']);
  });

  // REWRITTEN 2026-08-22: the slip no longer states an order of its own — it
  // renders the ladder itself. What is left to pin is that the titles the
  // printed trail names each office by are the ladder's own, so the paper and
  // the screen cannot call the same office two different things.
  it('names the offices by their slip titles, finance SECOND', () => {
    expect(APPROVAL_LADDER.map(({ key }) => APPROVAL_ROLE_TITLES[key])).toEqual([
      'Security Head', 'Finance HOD', 'COO', 'CEO',
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

  // REWRITTEN 2026-08-22: this used to walk four offices and expect exactly ONE
  // to be allowed at each of four steps. The last rung is now shared, so the
  // walk is over LEVELS - on the last one both offices hold the same rung, and
  // which of the two may act is the escalation's business, pinned below.
  it('hands each level its turn only once every level below it has signed', () => {
    const levels = [...new Set(APPROVAL_LADDER.map((r) => r.level))].sort();
    const signed: Record<string, 'approved'> = {};
    for (const level of levels) {
      const rows = rungs(signed);
      const allowed = APPROVAL_LADDER
        .filter(({ key }) => canDecideApproval('pending', rows, key))
        .map((r) => r.level);
      expect([...new Set(allowed)]).toEqual([level]);
      for (const r of APPROVAL_LADDER.filter((x) => x.level === level)) {
        signed[r.key] = 'approved';
      }
    }
    // Every rung signed: nobody is owed anything and nobody may act again.
    expect(lowestPendingLevel(rungs(signed))).toBeNull();
  });

  it('does not let the coo jump finance, which is where the order changed', () => {
    const rows = rungs({ security_head: 'approved' });
    expect(canDecideApproval('pending', rows, 'finance_head')).toBe(true);
    expect(canDecideApproval('pending', rows, 'coo')).toBe(false);
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(false);
  });

  it('leaves the shared rung last, after finance has signed', () => {
    const rows = rungs({ security_head: 'approved', finance_head: 'approved' });
    expect(canDecideApproval('pending', rows, 'coo')).toBe(true);
    expect(lowestPendingLevel(rows)).toBe(3);
  });
});

// The shared rung, and the clock on it (migration 063). Client: "level three
// approval approver will be either co or CEO. If the [COO] has given the
// approval then it will not go to the CEO … if the [COO] has not given the
// approval within one or two days then it will escalate to CEO."
describe('the last rung is the COO first, and the CEO only after the window', () => {
  const RAISED = '2026-08-20T09:00:00.000Z';
  const REACHED = '2026-08-21T09:00:00.000Z';

  /** The pass sitting on the shared rung: finance signed at REACHED, which is
   *  the moment the rung was reached and the clock started. */
  const onLastRung = () => withEscalation(
    [
      { role_key: 'security_head' as const, level_no: 1, status: 'approved' as const, decided_at: RAISED },
      { role_key: 'finance_head' as const, level_no: 2, status: 'approved' as const, decided_at: REACHED },
      { role_key: 'coo' as const, level_no: 3, status: 'pending' as const },
      { role_key: 'ceo' as const, level_no: 3, status: 'pending' as const },
    ],
    RAISED,
    48,
  );

  it('gives the COO the rung immediately and withholds it from the CEO', () => {
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    const rows = onLastRung();
    expect(canDecideApproval('pending', rows, 'coo')).toBe(true);
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(false);
  });

  it('counts the window from when the rung was REACHED, not from the raise', () => {
    const ceo = onLastRung().find((r) => r.role_key === 'ceo');
    // Finance signed at 09:00 on the 21st; 48 hours later is 09:00 on the 23rd.
    expect(ceo?.escalates_at).toBe('2026-08-23T09:00:00.000Z');
  });

  it('hands the rung to the CEO once the window has run out', () => {
    vi.setSystemTime(new Date('2026-08-23T09:00:01.000Z'));
    const rows = onLastRung();
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(true);
    // AND THE COO DOES NOT LOSE IT. Escalation adds a signatory; it does not
    // take the rung away from the office whose rung it is.
    expect(canDecideApproval('pending', rows, 'coo')).toBe(true);
  });

  it('marks nobody as waiting once the COO has decided', () => {
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    const rows = withEscalation(
      [
        { role_key: 'coo' as const, level_no: 3, status: 'approved' as const, decided_at: REACHED },
        { role_key: 'ceo' as const, level_no: 3, status: 'not_required' as const, decided_at: REACHED },
      ],
      RAISED,
      48,
    );
    expect(rows.every((r) => !r.escalates_at)).toBe(true);
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(false);
  });

  it('lets the CEO act at once when no COO was designated on the pass', () => {
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    // A vacant office is never snapshotted (046), so the CEO alone holds the
    // rung - waiting for a decision nobody can make would strand the pass.
    const rows = withEscalation(
      [{ role_key: 'ceo' as const, level_no: 3, status: 'pending' as const }],
      RAISED,
      48,
    );
    expect(rows[0].escalates_at).toBeUndefined();
    expect(canDecideApproval('pending', rows, 'ceo')).toBe(true);
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

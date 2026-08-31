// WHO A PASS IS WAITING WITH — the strip at the foot of both dashboards
// (client, 2026-08-20). The load-bearing property is that ONE PASS COUNTS
// ONCE: the office that can actually act on it, never every office it still
// owes. See `src/lib/waitingWith.ts` for why that differs from the Approval
// Pending strip beside it.
//
// THE DAY CUT IS GONE (client, 2026-08-21: "it should not be only the passes
// which were raised today, but all the passes which are pending for all those
// approvals accordingly"). `passesRaisedToday` is DELETED with its last caller,
// and its case below is replaced by the one that proves the opposite: a pass
// raised weeks ago and still climbing IS on the strip. A queue does not empty
// because the day rolled over — that was the "KNOWN COST, FLAGGED" line the
// 2026-08-20 pass wrote against this module, and this is it being paid.
import { describe, expect, it } from 'vitest';
import type { GatePassView } from '../../src/types';
import type { ApprovalRoleRow } from '../../src/lib/approvalLadder';
import {
  buildWaitingWith,
  GATE_KEY,
  waitingPersonLabel,
  waitingWithTotal,
  type WaitingApprovalRow,
} from '../../src/lib/waitingWith';

const NOW = new Date(2026, 7, 20, 11, 0).getTime();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1',
    status: 'pending',
    is_expired: false,
    created_at: new Date(NOW).toISOString(),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function step(over: Partial<WaitingApprovalRow>): WaitingApprovalRow {
  return {
    gate_pass_id: 'p1',
    role_key: 'security_head',
    level_no: 1,
    status: 'pending',
    ...over,
  };
}

function role(over: Partial<ApprovalRoleRow>): ApprovalRoleRow {
  return {
    role_key: 'security_head',
    user_id: 'u1',
    full_name: 'Demi',
    department_name: null,
    designated_at: '2026-08-19T00:00:00Z',
    ...over,
  };
}

/** The whole four-rung ladder on one pass, none of it signed. */
function fullLadder(id: string): WaitingApprovalRow[] {
  return [
    step({ gate_pass_id: id, role_key: 'security_head', level_no: 1 }),
    step({ gate_pass_id: id, role_key: 'coo', level_no: 2 }),
    step({ gate_pass_id: id, role_key: 'finance_head', level_no: 3 }),
    step({ gate_pass_id: id, role_key: 'ceo', level_no: 4 }),
  ];
}

const ROLES = [
  role({ role_key: 'security_head', full_name: 'Demi' }),
  role({ role_key: 'coo', user_id: 'u2', full_name: 'Sudeshna Pal' }),
  role({ role_key: 'finance_head', user_id: 'u3', full_name: 'GUARDSOHAM' }),
  role({ role_key: 'ceo', user_id: 'u4', full_name: 'Sid' }),
];

describe('buildWaitingWith', () => {
  it('counts a climbing pass ONCE, against the office that can act on it', () => {
    const rows = buildWaitingWith([pass({})], fullLadder('p1'), ROLES);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.count]));
    expect(byKey.security_head).toBe(1);
    // The three offices above it are NOT waiting — the pass has not reached them.
    expect(byKey.coo).toBe(0);
    expect(byKey.finance_head).toBe(0);
    expect(byKey.ceo).toBe(0);
    expect(waitingWithTotal(rows)).toBe(1);
  });

  it('moves the pass to the next office as each rung is signed', () => {
    const ladder = fullLadder('p1');
    ladder[0].status = 'approved';
    const rows = buildWaitingWith([pass({})], ladder, ROLES);
    expect(rows.find((r) => r.key === 'coo')?.count).toBe(1);
    expect(rows.find((r) => r.key === 'security_head')?.count).toBe(0);
  });

  it('files a pass with no pending rung under the gate — ladder finished, or never had one', () => {
    const done = fullLadder('p1').map((r) => ({ ...r, status: 'approved' as const }));
    expect(buildWaitingWith([pass({})], done, ROLES).find((r) => r.key === GATE_KEY)?.count).toBe(1);
    // A pass raised before any office was designated carries no rows at all.
    expect(buildWaitingWith([pass({})], [], ROLES).find((r) => r.key === GATE_KEY)?.count).toBe(1);
  });

  it('counts nothing for a pass nobody is waiting on', () => {
    const decided: GatePassView[] = [
      pass({ id: 'a', status: 'matched' }),
      pass({ id: 'b', status: 'flagged' }),
      pass({ id: 'c', status: 'cancelled' }),
      // Dead paperwork: `match_pass` refuses an expired pass forever, so no
      // signature and no guard can move it.
      pass({ id: 'd', status: 'pending', is_expired: true }),
    ];
    expect(waitingWithTotal(buildWaitingWith(decided, [], ROLES))).toBe(0);
  });

  it('the rows sum to the waiting passes — nothing falls between the ladder and the gate', () => {
    const passes = [pass({ id: 'a' }), pass({ id: 'b' }), pass({ id: 'c' }), pass({ id: 'd', status: 'matched' })];
    const approvals = [...fullLadder('a'), ...fullLadder('b')];
    approvals.find((r) => r.gate_pass_id === 'b' && r.level_no === 1)!.status = 'approved';
    const rows = buildWaitingWith(passes, approvals, ROLES);
    expect(waitingWithTotal(rows)).toBe(3); // a, b and c — never the matched one.
  });

  // REWRITTEN 2026-08-22: this used to hold the 057 order (Security Head, COO,
  // Finance HOD, CEO). The client moved Finance to level 2 and put the COO and
  // the CEO on one shared level 3, and the strip reads the ladder itself, so it
  // follows for free.
  it('reads in ladder order and ends at the gate', () => {
    expect(buildWaitingWith([], [], ROLES).map((r) => r.key)).toEqual([
      'security_head', 'finance_head', 'coo', 'ceo', GATE_KEY,
    ]);
  });

  // ONE PASS, ONE DESK, EVEN WHEN TWO OFFICES SHARE THE RUNG (063). The COO
  // gets first refusal, so a pass on the shared rung is waiting with them and
  // not with the CEO — counting it against both would double the strip, and
  // counting it against the CEO would name a desk that cannot act yet.
  it('files a pass on the shared last rung against the COO, once', () => {
    const passes = [pass({ id: 'a' })];
    const approvals = [
      { gate_pass_id: 'a', role_key: 'security_head' as const, level_no: 1, status: 'approved' as const },
      { gate_pass_id: 'a', role_key: 'finance_head' as const, level_no: 2, status: 'approved' as const },
      { gate_pass_id: 'a', role_key: 'coo' as const, level_no: 3, status: 'pending' as const },
      { gate_pass_id: 'a', role_key: 'ceo' as const, level_no: 3, status: 'pending' as const },
    ];
    const rows = buildWaitingWith(passes, approvals, ROLES);
    expect(rows.find((r) => r.key === 'coo')?.count).toBe(1);
    expect(rows.find((r) => r.key === 'ceo')?.count).toBe(0);
    expect(waitingWithTotal(rows)).toBe(1);
  });

  it('names the holder, and says so when nobody holds the office', () => {
    const rows = buildWaitingWith([], [], [role({ role_key: 'coo', full_name: 'Sudeshna Pal' })]);
    expect(waitingPersonLabel(rows.find((r) => r.key === 'coo')!)).toBe('Sudeshna Pal');
    expect(waitingPersonLabel(rows.find((r) => r.key === 'ceo')!)).toBe('Not designated yet');
    // The gate names no individual — which guard is on the barrier is not
    // recorded anywhere in this database.
    expect(waitingPersonLabel(rows.find((r) => r.key === GATE_KEY)!)).toBe('Guard on duty');
  });

});

describe('the strip counts every pending pass, whatever day it was raised', () => {
  it('counts a pass raised weeks ago that is still climbing', () => {
    const rows = [
      pass({ id: 'today', created_at: new Date(NOW).toISOString() }),
      pass({ id: 'old', created_at: new Date(2026, 6, 3, 9, 0).toISOString() }),
    ];
    const approvals = [
      step({ gate_pass_id: 'old', role_key: 'security_head', level_no: 1, status: 'approved' }),
      step({ gate_pass_id: 'old', role_key: 'coo', level_no: 2, status: 'pending' }),
    ];
    const built = buildWaitingWith(rows, approvals, []);
    const at = (key: string) => built.find((r) => r.key === key)?.count;
    expect(at('coo')).toBe(1);
    expect(at(GATE_KEY)).toBe(1);
    expect(waitingWithTotal(built)).toBe(2);
  });

  it('still counts nothing for a pass that is no longer pending, of any age', () => {
    const rows = [
      pass({ id: 'done', status: 'matched', created_at: new Date(2026, 6, 3).toISOString() }),
      pass({ id: 'dead', status: 'pending', is_expired: true, created_at: new Date(2026, 6, 3).toISOString() }),
    ];
    expect(waitingWithTotal(buildWaitingWith(rows, [], []))).toBe(0);
  });
});

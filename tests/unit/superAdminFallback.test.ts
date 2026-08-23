// Migration 067 — the super admin is the COO and the CEO, and what it takes for
// a pass to be theirs to release.
//
// THE DATABASE IS THE AUTHORITY for every rule below: `holds_fallback_office`,
// `pass_is_stuck` and `emergency_release_pass` re-check all of it, and the
// select policies decide separately whether the reader may even see the pass.
// These functions exist so a control is never DRAWN where the RPC would only
// refuse the press — the same belt-and-braces `approvalDecision.ts` uses.
import { describe, it, expect } from 'vitest';
import {
  FALLBACK_OFFICES,
  holdsFallbackOffice,
  isPassStuck,
  rungReachedAt,
} from '../../src/lib/superAdminFallback';
import { canReleaseUnderEmergency } from '../../src/lib/emergencyRelease';
import type { ApprovalStepRow } from '../../src/lib/approvalDecision';
import type { ApprovalRoleKey } from '../../src/lib/approvalLadder';

const RAISED = '2026-08-20T09:00:00Z';
const HOUR = 3600_000;
const NOW = Date.parse('2026-08-24T09:00:00Z');

/** A ladder in the shape 063 leaves it: Security Head 1, Finance HOD 2, and the
 *  COO and the CEO sharing 3. */
function ladder(over: Partial<Record<ApprovalRoleKey, Partial<ApprovalStepRow>>> = {}): ApprovalStepRow[] {
  const base: ApprovalStepRow[] = [
    { role_key: 'security_head', level_no: 1, status: 'pending' },
    { role_key: 'finance_head', level_no: 2, status: 'pending' },
    { role_key: 'coo', level_no: 3, status: 'pending' },
    { role_key: 'ceo', level_no: 3, status: 'pending' },
  ];
  return base.map((r) => ({ ...r, ...(over[r.role_key] ?? {}) }));
}

describe('holdsFallbackOffice', () => {
  it('is the two offices that share the last rung, and nobody else', () => {
    expect(FALLBACK_OFFICES).toEqual(['coo', 'ceo']);
    expect(holdsFallbackOffice('coo')).toBe(true);
    expect(holdsFallbackOffice('ceo')).toBe(true);
    // The Security Head verifies material at the gate and the Finance HOD signs
    // level 2. Neither may skip the ladder they sit inside.
    expect(holdsFallbackOffice('security_head')).toBe(false);
    expect(holdsFallbackOffice('finance_head')).toBe(false);
    expect(holdsFallbackOffice(null)).toBe(false);
  });
});

describe('rungReachedAt', () => {
  it('is when the pass was raised while its first rung is still open', () => {
    expect(rungReachedAt(ladder(), RAISED)).toBe(RAISED);
  });

  it('is the latest decision BELOW the lowest pending rung', () => {
    const rows = ladder({
      security_head: { status: 'approved', decided_at: '2026-08-21T10:00:00Z' },
      finance_head: { status: 'approved', decided_at: '2026-08-22T11:00:00Z' },
    });
    expect(rungReachedAt(rows, RAISED)).toBe('2026-08-22T11:00:00Z');
  });

  it('counts a rung closed as not_required as one that has passed', () => {
    // 063 closes the sibling of a signed shared rung as `not_required`. It was
    // never signed, but the pass is past it.
    const rows: ApprovalStepRow[] = [
      { role_key: 'coo', level_no: 1, status: 'not_required', decided_at: '2026-08-23T08:00:00Z' },
      { role_key: 'ceo', level_no: 2, status: 'pending' },
    ];
    expect(rungReachedAt(rows, RAISED)).toBe('2026-08-23T08:00:00Z');
  });

  it('is null when nothing is pending — a pass that owes nothing waits nowhere', () => {
    const rows = ladder({
      security_head: { status: 'approved', decided_at: RAISED },
      finance_head: { status: 'approved', decided_at: RAISED },
      coo: { status: 'approved', decided_at: RAISED },
      ceo: { status: 'not_required', decided_at: RAISED },
    });
    expect(rungReachedAt(rows, RAISED)).toBeNull();
  });
});

describe('isPassStuck', () => {
  it('needs the WHOLE window to have elapsed on the current rung', () => {
    const rows = ladder();
    const reached = Date.parse(RAISED);
    expect(isPassStuck('pending', rows, RAISED, 48, reached + 47 * HOUR)).toBe(false);
    expect(isPassStuck('pending', rows, RAISED, 48, reached + 48 * HOUR)).toBe(true);
  });

  it('restarts the clock when the pass moves up a rung', () => {
    // Signed 47 hours ago at level 1: the pass has been in the system for days,
    // but it has been on the rung that is holding it for under two.
    const moved = new Date(NOW - 47 * HOUR).toISOString();
    const rows = ladder({ security_head: { status: 'approved', decided_at: moved } });
    expect(isPassStuck('pending', rows, RAISED, 48, NOW)).toBe(false);
  });

  it('is never true of a pass that is no longer pending', () => {
    // A cancelled pass was REJECTED, in writing. Overturning that is a
    // different and much larger power, and this system does not have it.
    for (const status of ['cancelled', 'matched', 'flagged', 'held']) {
      expect(isPassStuck(status, ladder(), RAISED, 48, NOW)).toBe(false);
    }
  });

  it('reads the admin’s own window, not a constant', () => {
    const rows = ladder();
    const reached = Date.parse(RAISED);
    expect(isPassStuck('pending', rows, RAISED, 24, reached + 25 * HOUR)).toBe(true);
    expect(isPassStuck('pending', rows, RAISED, 72, reached + 25 * HOUR)).toBe(false);
  });
});

describe('canReleaseUnderEmergency — the second pool (067)', () => {
  const owed = ladder();
  const ctx = (office: ApprovalRoleKey | null, now = NOW) => ({
    office,
    approvals: owed,
    passCreatedAt: RAISED,
    escalationHours: 48,
    now,
  });

  it('lets the sitting COO or CEO release a pass nobody has approved in time', () => {
    expect(canReleaseUnderEmergency('pending', owed, 'staff', ctx('coo'))).toBe(true);
    expect(canReleaseUnderEmergency('pending', owed, 'staff', ctx('ceo'))).toBe(true);
  });

  it('refuses them a pass that has not waited out the window', () => {
    // Colleagues who are still reading a pass are not colleagues who cannot be
    // reached. The wait is what makes skipping them the office's business.
    const early = Date.parse(RAISED) + 2 * HOUR;
    expect(canReleaseUnderEmergency('pending', owed, 'staff', ctx('coo', early))).toBe(false);
  });

  it('refuses every other office, however long the pass has waited', () => {
    for (const office of ['security_head', 'finance_head', null] as (ApprovalRoleKey | null)[]) {
      expect(canReleaseUnderEmergency('pending', owed, 'staff', ctx(office))).toBe(false);
    }
  });

  it('leaves the VMS super admin exactly as 055 had it — no wait required', () => {
    const early = Date.parse(RAISED) + 2 * HOUR;
    expect(canReleaseUnderEmergency('pending', owed, 'super_admin', ctx(null, early))).toBe(true);
    expect(canReleaseUnderEmergency('pending', owed, 'super_admin')).toBe(true);
  });

  it('still refuses a pass that owes nothing, to either pool', () => {
    const settled: ApprovalStepRow[] = [{ role_key: 'coo', level_no: 3, status: 'approved' }];
    expect(canReleaseUnderEmergency('pending', settled, 'super_admin')).toBe(false);
    expect(canReleaseUnderEmergency('pending', settled, 'staff', {
      ...ctx('coo'), approvals: settled,
    })).toBe(false);
  });
});

// Migration 055 — the two rules a screen must not get wrong about an emergency
// release, and the letter it sends.
//
// The DATABASE is the authority for both rules (`emergency_release_pass` checks
// super_admin and a still-owed ladder; `review_emergency_release` refuses the
// releaser). These functions exist so a button is never DRAWN where the RPC
// would refuse the press — the same belt-and-braces `approvalDecision.ts` and
// `checkReturnQty` use — and `tests/security/sqlInvariants.test.ts` is where
// the server side is pinned.
import { describe, it, expect } from 'vitest';
import {
  canReleaseUnderEmergency,
  canReviewRelease,
  isReasonWritten,
  EMERGENCY_REASON_MIN,
  type EmergencyReleaseRow,
} from '../../src/lib/emergencyRelease';
import { buildEmergencyNotices, type NoticeApproval, type NoticePass } from '../../src/lib/approvalNotice';

const OWED = [
  { status: 'approved' as const },
  { status: 'pending' as const },
];

describe('canReleaseUnderEmergency', () => {
  it('is for a super admin and nobody else', () => {
    // An ordinary admin already creates users and resets passwords. Handing
    // them the ladder as well would make the override the easy path.
    expect(canReleaseUnderEmergency('pending', OWED, 'super_admin')).toBe(true);
    for (const role of ['admin', 'hod', 'guard', 'staff', null]) {
      expect(canReleaseUnderEmergency('pending', OWED, role)).toBe(false);
    }
  });

  it('refuses a pass that owes nothing — there is nothing to release', () => {
    expect(canReleaseUnderEmergency('pending', [{ status: 'approved' }], 'super_admin')).toBe(false);
    expect(canReleaseUnderEmergency('pending', [], 'super_admin')).toBe(false);
  });

  it('refuses a pass that is no longer pending', () => {
    // A cancelled pass was REJECTED by an office, with a written reason.
    // Overturning that is a different and much larger power than unsticking a
    // silent queue, and this system deliberately does not have it.
    for (const status of ['cancelled', 'matched', 'flagged', 'held']) {
      expect(canReleaseUnderEmergency(status, OWED, 'super_admin')).toBe(false);
    }
  });
});

describe('canReviewRelease — the four-eyes rule', () => {
  const row = (over: Partial<EmergencyReleaseRow> = {}): EmergencyReleaseRow => ({
    gate_pass_id: 'p1',
    pass_number: 'RGP-20260820-0001',
    released_by: 'super1',
    released_name: 'Sudeshna Pal',
    reason: 'Four approvers unreachable overnight; material needed for a lift repair.',
    released_at: '2026-08-20T18:00:00Z',
    reviewed_by: null,
    reviewed_name: null,
    reviewed_at: null,
    review_note: null,
    ...over,
  });

  it('lets a DIFFERENT admin review it', () => {
    expect(canReviewRelease(row(), 'admin', 'admin2')).toBe(true);
    expect(canReviewRelease(row(), 'super_admin', 'admin2')).toBe(true);
  });

  it('refuses the person who made the release', () => {
    // Without this the whole control collapses: release, then self-review.
    expect(canReviewRelease(row(), 'super_admin', 'super1')).toBe(false);
  });

  it('refuses a non-admin, and an already-reviewed release', () => {
    expect(canReviewRelease(row(), 'hod', 'hod1')).toBe(false);
    expect(canReviewRelease(row({ reviewed_at: '2026-08-21T09:00:00Z' }), 'admin', 'admin2')).toBe(false);
  });
});

describe('isReasonWritten', () => {
  it('wants a real sentence, not an acknowledgement', () => {
    for (const junk of ['', '   ', 'ok', 'urgent', 'asap']) {
      expect(isReasonWritten(junk)).toBe(false);
    }
    expect(isReasonWritten('Lift repair, CEO unreachable')).toBe(true);
    expect('x'.repeat(EMERGENCY_REASON_MIN)).toHaveLength(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const PASS: NoticePass = {
  id: 'p1',
  pass_number: 'RGP-20260820-0001',
  type: 'RGP',
  status: 'pending',
  visitor_name: 'Acme Lifts',
  purpose: 'Lift controller swap',
  department_name: 'Engineering',
  raised_by_name: 'Ravi Menon',
  item_count: 2,
  total_value: 45000,
  expected_return_date: '2026-08-27',
  created_at: '2026-08-20T10:00:00Z',
};

function approval(over: Partial<NoticeApproval> = {}): NoticeApproval {
  return {
    role_key: 'security_head',
    level_no: 1,
    status: 'approved',
    approver_id: 'u-sec',
    approver_name: 'Demi',
    approver_email: 'demi@example.com',
    decided_at: null,
    reason: null,
    ...over,
  };
}

describe('buildEmergencyNotices — telling the offices that were skipped', () => {
  const LADDER = [
    approval(),
    approval({ role_key: 'coo', level_no: 2, approver_id: 'u-coo', approver_name: 'Sudeshna', approver_email: 'coo@example.com' }),
  ];
  const REASON = 'Four approvers unreachable overnight; material needed for a lift repair.';

  it('writes to every office on the ladder, holders and deputies alike', () => {
    const withDeputy = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya', deputy_email: 'priya@example.com' } : a,
    );
    const out = buildEmergencyNotices(PASS, withDeputy, 'Sudeshna Pal', REASON, 'https://x.test');
    expect(out.map((m) => m.to)).toEqual(['demi@example.com', 'priya@example.com', 'coo@example.com']);
    expect(out.every((m) => m.kind === 'emergency_release')).toBe(true);
  });

  it('quotes the reason verbatim and names who did it', () => {
    // A reader deciding whether to challenge the release needs the actual
    // words, not a summary of them.
    const [first] = buildEmergencyNotices(PASS, LADDER, 'Sudeshna Pal', REASON, 'https://x.test');
    expect(first.text).toContain(REASON);
    expect(first.text).toMatch(/Sudeshna Pal \(super admin\)/);
    expect(first.subject).toBe('Released without approval — RGP-20260820-0001 (RGP)');
  });

  it('never writes twice to one mailbox', () => {
    const shared = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya', deputy_email: 'DEMI@example.com' } : a,
    );
    expect(buildEmergencyNotices(PASS, shared, null, REASON, 'https://x.test')).toHaveLength(2);
  });

  it('sends nothing when no office on the ladder has an address', () => {
    const noAddress = LADDER.map((a) => ({ ...a, approver_email: null }));
    expect(buildEmergencyNotices(PASS, noAddress, null, REASON, 'https://x.test')).toEqual([]);
  });
});

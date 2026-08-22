// The approval ladder printed beside a gate pass record.
//
// The ladder is the printed slip's own chain (signatureBlocks.ts) — Issuing HOD
// → Security Head → COO → CEO → Finance HOD, then the gate. These cases pin the
// two things that make it honest:
//
//   * an office nobody has been designated to reads "Not designated" and does
//     NOT count towards "N of 5 approved" — the alternative is a screen that
//     claims four signatures the paper does not have;
//   * nothing invents a timestamp. The four offices sign on paper and this
//     database records no moment for it, so those steps carry a name and no
//     time. Only the two moments the database actually stamps — the raise and
//     the gate clearance — print a date.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  APPROVAL_LADDER,
  APPROVAL_ROLE_TITLES,
  buildApprovalSteps,
  approverLine,
  canRecordReturns,
  isReturnClosed,
  type ApprovalRoleRow,
  type PassApprovalRow,
} from '../../src/lib/approvalLadder';
import { GRANDFATHERED_NOTE } from '../../src/lib/passApprovalState';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24',
    actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T06:15:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2026-08-19T18:30:00Z',
    created_at: '2026-08-18T05:00:00Z', updated_at: '2026-08-18T06:15:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 3, total_quantity: 3, returned_quantity: 1, total_value: 5000,
    material_summary: 'Hydraulic Spanner Set',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...over,
  } as any;
}

function role(key: string, name: string, dept: string | null = 'Security'): ApprovalRoleRow {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    role_key: key as any,
    user_id: `u-${key}`,
    full_name: name,
    department_name: dept,
    designated_at: '2026-08-01T00:00:00Z',
    deputy_id: null,
    deputy_name: null,
  };
}

const FULL: ApprovalRoleRow[] = [
  role('security_head', 'Arun Kumar', 'Security'),
  role('coo', 'Vikram Singh', 'Operations'),
  role('finance_head', 'Sameer Khan', 'Finance & Accounts'),
  role('ceo', 'Neha Sharma', 'Executive'),
];

describe('the ladder mirrors the printed slip', () => {
  // REWRITTEN 2026-08-20. This case used to hold the order 043 took off the
  // printed slip — Security Head, COO, **CEO**, Finance HOD. The client moved
  // the CEO to LAST ("1. The security head has to approve 2. COO 3. Finance
  // 4. CEO"), so the CEO now signs on a pass finance has already costed, and
  // `signatureBlocks.ts` and migration 057 moved with it.
  it('is Security Head, COO, Finance HOD, CEO — in slip order', () => {
    expect(APPROVAL_LADDER.map((l) => l.key)).toEqual([
      'security_head', 'coo', 'finance_head', 'ceo',
    ]);
    expect(APPROVAL_LADDER.map((l) => APPROVAL_ROLE_TITLES[l.key])).toEqual([
      'Security Head', 'COO', 'Finance HOD', 'CEO',
    ]);
  });

  it('names the office and puts the person in brackets', () => {
    expect(approverLine('COO', 'Vikram Singh')).toBe('COO (Vikram Singh)');
    expect(approverLine('COO', null)).toBe('COO');
  });
});

describe('buildApprovalSteps', () => {
  it('opens with the raising HOD — name, department, and the raise time', () => {
    const [first] = buildApprovalSteps(pass(), FULL);
    expect(first.label).toBe('Raised By');
    expect(first.who).toBe('Ramesh Yadav');
    expect(first.detail).toBe('Engineering (MEP)');
    expect(first.at).toBe('2026-08-18T05:00:00Z');
    expect(first.state).toBe('done');
  });

  it('numbers the four offices Level 1 to Level 4 and carries no invented time', () => {
    const steps = buildApprovalSteps(pass(), FULL);
    const levels = steps.filter((s) => s.label.startsWith('Level'));
    expect(levels.map((s) => s.label)).toEqual([
      'Level 1 Approval', 'Level 2 Approval', 'Level 3 Approval', 'Level 4 Approval',
    ]);
    expect(levels.map((s) => s.who)).toEqual([
      'Security Head (Arun Kumar)',
      'COO (Vikram Singh)',
      'Finance HOD (Sameer Khan)',
      'CEO (Neha Sharma)',
    ]);
    expect(levels.map((s) => s.at)).toEqual([null, null, null, null]);
    expect(levels.every((s) => s.state === 'done')).toBe(true);
  });

  it('an office nobody holds reads "Not designated" and is not approved', () => {
    const steps = buildApprovalSteps(pass(), [FULL[0]]);
    const coo = steps.find((s) => s.label === 'Level 2 Approval');
    expect(coo?.who).toBe('COO');
    expect(coo?.state).toBe('unset');
    expect(coo?.note).toMatch(/not designated/i);
  });

  // Client, 2026-08-19: "only the approved ones will be appearing in the
  // guard's view — mark them so that they have been approved by those
  // approvers." The signed slip travels with the material, so at the barrier
  // the four offices are settled whether or not anybody has been designated.
  it('reads every level as approved for a GUARD, even a vacant office', () => {
    const steps = buildApprovalSteps(pass(), [], 'guard');
    const levels = steps.filter((s) => s.key.startsWith('level-'));
    expect(levels).toHaveLength(4);
    expect(levels.every((s) => s.state === 'done')).toBe(true);
    expect(levels.every((s) => /signed on the printed pass/i.test(s.note ?? ''))).toBe(true);
    expect(levels.map((s) => s.who)).toEqual(['Security Head', 'COO', 'Finance HOD', 'CEO']);
  });

  it('still names the holder for a guard when the office IS held', () => {
    const coo = buildApprovalSteps(pass(), FULL, 'guard').find((s) => s.label === 'Level 2 Approval');
    expect(coo?.who).toBe('COO (Vikram Singh)');
    expect(coo?.state).toBe('done');
  });

  it.each(['hod', 'admin', null] as const)(
    'keeps a vacant office unset for %s — their fix is a designation, not a truck at the gate',
    (role) => {
      const coo = buildApprovalSteps(pass(), [], role).find((s) => s.label === 'Level 2 Approval');
      expect(coo?.state).toBe('unset');
    }
  );

  it('counts a cleared gate as its own step, naming the guard', () => {
    const gate = buildApprovalSteps(pass(), FULL).find((s) => s.key === 'gate');
    expect(gate?.label).toBe('Cleared by Security');
    expect(gate?.who).toBe('Guard One');
    expect(gate?.at).toBe('2026-08-18T06:15:00Z');
    expect(gate?.state).toBe('done');
  });

  it('an uncleared pass waits at the gate rather than claiming it left', () => {
    const gate = buildApprovalSteps(pass({ status: 'pending', verified_at: null, verified_by_name: null }), FULL)
      .find((s) => s.key === 'gate');
    expect(gate?.label).toBe('Security Verification');
    expect(gate?.state).toBe('pending');
    expect(gate?.at).toBeNull();
  });

  it('a mismatch at the gate is blocked, not pending', () => {
    const gate = buildApprovalSteps(
      pass({ status: 'flagged', flag_reason: 'Count did not match' }), FULL,
    ).find((s) => s.key === 'gate');
    expect(gate?.state).toBe('blocked');
    expect(gate?.label).toBe('Rejected at the security gate');
  });

  it('an RGP still out ends on "To Be Returned" with its deadline', () => {
    const last = buildApprovalSteps(pass(), FULL).at(-1);
    expect(last?.label).toBe('To Be Returned');
    expect(last?.state).toBe('pending');
    expect(last?.note).toMatch(/before/i);
  });

  it('an overdue RGP is blocked, so the deadline reads as missed', () => {
    const last = buildApprovalSteps(pass({ is_overdue: true, due_state: 'overdue' }), FULL).at(-1);
    expect(last?.state).toBe('blocked');
  });

  it('a fully returned RGP ends on Returned, with the date it came back', () => {
    const last = buildApprovalSteps(
      pass({ return_status: 'returned', actual_return_date: '2026-08-20T04:00:00Z' }), FULL,
    ).at(-1);
    expect(last?.label).toBe('Returned');
    expect(last?.state).toBe('done');
    expect(last?.at).toBe('2026-08-20T04:00:00Z');
  });

  it('an NRGP has no return step at all — it is closed at the gate', () => {
    const steps = buildApprovalSteps(pass({ type: 'NRGP', return_status: 'not_applicable' }), FULL);
    expect(steps.some((s) => s.key === 'return')).toBe(false);
    expect(steps.at(-1)?.key).toBe('gate');
  });
});

describe('what may still be edited', () => {
  it('only the gate records a return, and only while one is owed', () => {
    expect(canRecordReturns(pass({ return_status: 'awaiting_return' }), 'guard')).toBe(true);
    expect(canRecordReturns(pass({ return_status: 'partially_returned' }), 'guard')).toBe(true);
    expect(canRecordReturns(pass({ return_status: 'returned' }), 'guard')).toBe(false);
    expect(canRecordReturns(pass({ type: 'NRGP', return_status: 'not_applicable' }), 'guard')).toBe(false);
  });

  it('refuses an HOD and an admin — apply_item_returns would refuse them too', () => {
    expect(canRecordReturns(pass(), 'hod')).toBe(false);
    expect(canRecordReturns(pass(), 'admin')).toBe(false);
    expect(canRecordReturns(pass(), null)).toBe(false);
  });

  it('a returned pass is closed for good', () => {
    expect(isReturnClosed(pass({ return_status: 'returned' }))).toBe(true);
    expect(isReturnClosed(pass({ return_status: 'partially_returned' }))).toBe(false);
    expect(isReturnClosed(pass({ type: 'NRGP', return_status: 'not_applicable' }))).toBe(false);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Migration 046: a pass that carries its OWN ladder is graded from it.
//
// Before 046 this module could only ask "is the seat filled?", because nothing
// in the database recorded a decision. Now `gatepass.pass_approvals` holds one
// row per office the pass actually owes, snapshotted the day it was raised, and
// those rows outrank every inference below.
// ─────────────────────────────────────────────────────────────────────────────
function approval(over: Partial<PassApprovalRow> = {}): PassApprovalRow {
  return {
    role_key: 'security_head',
    level_no: 1,
    status: 'pending',
    routed_name: 'Sanjay Rao',
    decided_name: null,
    decided_at: null,
    reason: null,
    decided_as_deputy: false,
    ...over,
  };
}

const HELD: ApprovalRoleRow[] = [
  { role_key: 'security_head', user_id: 'u9', full_name: 'Sanjay Rao', department_name: 'Security', designated_at: '2026-08-19T04:00:00Z', deputy_id: null, deputy_name: null },
];

describe('buildApprovalSteps — a pass with a real ladder of its own (046)', () => {
  it('grades an approved level from the decision, naming who pressed it and when', () => {
    // `decided_name` and not the current office holder: the person who signed
    // is the fact, and the office may have changed hands since.
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [
      approval({ status: 'approved', decided_name: 'Sanjay Rao', decided_at: '2026-08-19T05:30:00Z' }),
    ]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.state).toBe('done');
    expect(level.note).toBe('Approved');
    expect(level.who).toBe(approverLine(APPROVAL_ROLE_TITLES.security_head, 'Sanjay Rao'));
    // A real moment, unlike the paper signature this module used to infer.
    expect(level.at).toBe('2026-08-19T05:30:00Z');
  });

  it('an undecided level says it is waiting, and carries no time', () => {
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [approval()]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.state).toBe('pending');
    expect(level.note).toBe('Waiting for this approval');
    expect(level.at).toBeNull();
  });

  it('a rejected level is blocked and its NOTE IS THE REASON somebody typed', () => {
    // The reason is the only answer the raising HOD gets, so it must be the
    // sentence on the rung rather than a generic "Rejected".
    const steps = buildApprovalSteps(pass({ status: 'cancelled' }), HELD, 'hod', [
      approval({
        status: 'rejected',
        decided_name: 'Sanjay Rao',
        decided_at: '2026-08-19T06:00:00Z',
        reason: 'Vendor invoice does not match the material listed.',
      }),
    ]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.state).toBe('blocked');
    expect(level.note).toBe('Vendor invoice does not match the material listed.');
  });

  it('an office this pass was never routed to is NOT DRAWN AT ALL', () => {
    // It was vacant the day the pass was raised, so nothing waits on it.
    // "Not designated yet" there would describe a problem that does not exist.
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [approval()]);
    expect(steps.filter((s) => s.key.startsWith('level-'))).toHaveLength(1);
    expect(steps.some((s) => s.note === 'Not designated yet')).toBe(false);
  });

  it('THE GUARD`S PAPER FICTION DOES NOT OVERRIDE A REAL PENDING ROW', () => {
    // A pass that still owes a signature under 046 is one a guard cannot even
    // see. Drawing its levels as signed would be a screen contradicting the
    // policy that hid it.
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'guard', [approval()]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.state).toBe('pending');
    expect(level.note).not.toBe('Signed on the printed pass');
  });

  it('a pass with NO ladder still reads exactly as it did before 046', () => {
    // Every one of the 60 passes on this database predates the workflow.
    // Nobody signed those levels in this system, and back-filling them would be
    // inventing an audit trail.
    const steps = buildApprovalSteps(pass({ status: 'pending' }), [], 'hod', []);
    const levels = steps.filter((s) => s.key.startsWith('level-'));
    expect(levels).toHaveLength(APPROVAL_LADDER.length);
    expect(levels.every((l) => l.state === 'unset' && l.note === 'Not designated yet')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 054 — a STANDING DEPUTY may sign in the holder's place, and the rung says so.
// The stamp is read off the decision (`decided_as_deputy`), never off today's
// ladder: both seats move, and re-pointing an office next month must not
// rewrite who signed a pass last month.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalSteps — a level signed by the office deputy (054)', () => {
  it('names the seat that signed, in place of the department', () => {
    // Workday's "On Behalf Of" line. An unlabelled deputy reads as the office
    // holder, which is the one thing an audit trail must not let happen — and
    // the deputy's own department is not the fact this rung is about.
    const steps = buildApprovalSteps(
      pass(),
      HELD,
      'hod',
      [approval({ status: 'approved', decided_name: 'Priya Nair', decided_as_deputy: true, decided_at: '2026-08-20T05:30:00Z' })],
    );
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.detail).toBe('Standing deputy for the Security Head');
    expect(level.who).toBe('Security Head (Priya Nair)');
    expect(level.state).toBe('done');
  });

  it('still shows the department when the holder signed it themselves', () => {
    const steps = buildApprovalSteps(
      pass(),
      HELD,
      'hod',
      [approval({ status: 'approved', decided_name: 'Sanjay Rao', decided_as_deputy: false })],
    );
    expect(steps.find((s) => s.key === 'level-1')!.detail).toBe('Security');
  });

  it('says so on a REJECTION too, without displacing the reason', () => {
    // The reason is the only answer the raising HOD gets, so it keeps the note;
    // the seat goes where the department was.
    const steps = buildApprovalSteps(
      pass(),
      HELD,
      'hod',
      [approval({
        status: 'rejected',
        decided_name: 'Priya Nair',
        decided_as_deputy: true,
        reason: 'Vendor not cleared for this material.',
      })],
    );
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.detail).toBe('Standing deputy for the Security Head');
    expect(level.note).toBe('Vendor not cleared for this material.');
    expect(level.state).toBe('blocked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A LEVEL CLOSED BY THE ROLLOUT (migration 058)
//
// The client asked for every pass raised before the approval workflow began to
// read as approved. It does — but it must not read as approved BY SOMEBODY.
// `decided_by` is null on such a row by design, and the ordinary fall-back
// (`decided_name ?? routed_name ?? current holder`) would print whoever held
// the office the day the pass was raised, saying they signed a pass they were
// never shown. That is the fabricated audit trail 046 refused to write.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalSteps — a level closed by the 058 rollout', () => {
  const ROLLED = approval({
    status: 'approved',
    grandfathered: true,
    decided_name: null,
    routed_name: 'Sanjay Rao',
    decided_at: '2026-08-20T06:20:00Z',
    reason: 'Approved on rollout — this pass was raised before the approval workflow began.',
  });

  it('reads as approved, and names NOBODY', () => {
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [ROLLED]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.state).toBe('done');
    expect(level.who).toBe('Security Head');
    expect(level.who).not.toContain('Sanjay Rao');
    expect(level.detail).toBeNull();
  });

  it('says why in words, so an authorless approval is not mistaken for a bug', () => {
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [ROLLED]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.note).toBe(GRANDFATHERED_NOTE);
    expect(level.note).toMatch(/before the approval workflow began/i);
  });

  it('leaves an ordinary decision on the same pass exactly as it was', () => {
    // The rollout closed the levels nobody had reached; a level somebody really
    // did press keeps its name, its department and its moment.
    const steps = buildApprovalSteps(pass({ status: 'pending' }), HELD, 'hod', [
      approval({ status: 'approved', decided_name: 'Sanjay Rao', decided_at: '2026-08-19T05:30:00Z' }),
      { ...ROLLED, role_key: 'coo', level_no: 2 },
    ]);
    expect(steps.find((s) => s.key === 'level-1')!.who).toBe('Security Head (Sanjay Rao)');
    expect(steps.find((s) => s.key === 'level-2')!.who).toBe('COO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A DELEGATED SIGNATURE NAMES THE PERSON WHO DELEGATED IT (migration 062;
// client, 2026-08-22: "whenever we are seeing in the timeline for any details,
// it should completely reflect that the person who has approved, if he is a
// delegated person, in the bracket. It should be mentioned that the person has
// this approver who was delegated by the original approver and the approver's
// name").
//
// IT IS THE BRACKET AND NOT ONLY THE LINE BENEATH IT, because `who` is what the
// merged timeline and the pass record show at a glance — and "who actually
// signed this" is exactly the question a stand-in's signature makes ambiguous.
// Read off the DECISION (`decided_as_delegate`), never off today's delegation
// table: a delegation expires, and a rung must not re-credit the holder the day
// after the window closed.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalSteps — a delegated decision (062)', () => {
  const DELEGATED = approval({
    status: 'approved',
    decided_name: 'Priya Mehta',
    decided_as_delegate: true,
    delegated_by_name: 'Sanjay Rao',
    decided_at: '2026-08-26T05:30:00Z',
  });

  it('puts both names in the bracket — who signed, and who delegated it', () => {
    const steps = buildApprovalSteps(pass(), HELD, 'hod', [DELEGATED]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.who).toBe('Security Head (Priya Mehta — delegated by Sanjay Rao)');
    expect(level.state).toBe('done');
  });

  it('says so on the line beneath as well, where the department would sit', () => {
    const steps = buildApprovalSteps(pass(), HELD, 'hod', [DELEGATED]);
    expect(steps.find((s) => s.key === 'level-1')!.detail)
      .toBe('Delegated Security Head — signed for Sanjay Rao');
  });

  it('says so on a REJECTION too, without displacing the reason', () => {
    const steps = buildApprovalSteps(pass(), HELD, 'hod', [
      { ...DELEGATED, status: 'rejected', reason: 'Vendor not cleared for this material.' },
    ]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.who).toContain('delegated by Sanjay Rao');
    expect(level.note).toBe('Vendor not cleared for this material.');
    expect(level.state).toBe('blocked');
  });

  // A delegator name VMS could not resolve must not print as "(null)" or strip
  // the signer: the rung still says who signed, and simply cannot say for whom.
  it('degrades to the plain bracket when the delegator name is missing', () => {
    const steps = buildApprovalSteps(pass(), HELD, 'hod', [
      { ...DELEGATED, delegated_by_name: null },
    ]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.who).toBe('Security Head (Priya Mehta)');
    expect(level.who).not.toContain('null');
    expect(level.detail).toBe('Delegated Security Head — signed for the office holder');
  });

  // A decision taken by the holder themselves is untouched by any of this, and
  // a deputy's rung still reads as a deputy's (054).
  it('leaves an ordinary decision and a deputy decision exactly as they were', () => {
    const own = buildApprovalSteps(pass(), HELD, 'hod', [
      approval({ status: 'approved', decided_name: 'Sanjay Rao' }),
    ]).find((s) => s.key === 'level-1')!;
    expect(own.who).toBe('Security Head (Sanjay Rao)');
    expect(own.detail).toBe('Security');

    const deputy = buildApprovalSteps(pass(), HELD, 'hod', [
      approval({ status: 'approved', decided_name: 'Priya Nair', decided_as_deputy: true }),
    ]).find((s) => s.key === 'level-1')!;
    expect(deputy.detail).toBe('Standing deputy for the Security Head');
  });

  // A ROLLOUT-CLOSED RUNG STILL NAMES NOBODY (058). That precedence is what
  // stops a grandfathered row acquiring a bracket it has no author for.
  it('a grandfathered rung outranks the delegation label and stays anonymous', () => {
    const steps = buildApprovalSteps(pass(), HELD, 'hod', [
      { ...DELEGATED, grandfathered: true, decided_name: null },
    ]);
    const level = steps.find((s) => s.key === 'level-1')!;
    expect(level.who).toBe('Security Head');
    expect(level.detail).toBeNull();
  });
});

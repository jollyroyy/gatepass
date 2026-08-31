// THE CEO'S BOX IS ONLY ON THE SLIP WHEN THE CEO IS THE ONE SIGNING IT
// (src/lib/printCeoBox.ts).
//
// Client, 2026-08-31: "remove CEO from print pass page if he is not approving.
// When the COO is absent and is unable to approve, only that time show CEO
// approval in the print pass page."
//
// Level 3 is ONE rung the COO and the CEO share (migration 063): the COO gets
// first refusal and the CEO inherits the rung only once the escalation window
// has run out. So the CEO's box belongs on the paper exactly when the CEO is
// the office that has signed it, refused it, or is now the one being waited on
// — and nowhere else. Every other case printed a box for an office that was
// never going to sign this pass.
import { describe, it, expect } from 'vitest';
import { printedSteps } from '../../src/lib/printCeoBox';
import type { ApprovalStep } from '../../src/lib/passLadderLegs';
import type { PassApprovalRow } from '../../src/lib/passApprovalState';

const RAISED = '2026-08-20T06:00:00Z';
const HOURS = 48;
/** Two hours after the pass was raised — the COO's window is wide open. */
const EARLY = new Date('2026-08-20T08:00:00Z');
/** Three days after — the COO let the window run out. */
const LATE = new Date('2026-08-23T08:00:00Z');

function step(office: string, over: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    key: `level-${office}`,
    office,
    label: 'Level 3 Approval',
    who: office.toUpperCase(),
    detail: null,
    at: null,
    state: 'pending',
    ...over,
  };
}

function row(over: Partial<PassApprovalRow> & Pick<PassApprovalRow, 'role_key'>): PassApprovalRow {
  return {
    level_no: 3,
    status: 'pending',
    routed_name: null,
    decided_name: null,
    decided_at: null,
    reason: null,
    ...over,
  } as PassApprovalRow;
}

const LADDER = [step('security_head'), step('finance_head'), step('coo'), step('ceo')];
const offices = (steps: ApprovalStep[]) => steps.map((s) => s.office);

describe('the CEO box on the printed slip', () => {
  it('is dropped while the COO still has the rung', () => {
    const rows = [row({ role_key: 'coo' }), row({ role_key: 'ceo' })];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, EARLY)))
      .toEqual(['security_head', 'finance_head', 'coo']);
  });

  it('appears once the COO has let the escalation window run out', () => {
    const rows = [row({ role_key: 'coo' }), row({ role_key: 'ceo' })];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, LATE)))
      .toEqual(['security_head', 'finance_head', 'coo', 'ceo']);
  });

  it('is dropped when the COO signed the shared rung', () => {
    const rows = [
      row({ role_key: 'coo', status: 'approved', decided_name: 'Vikram Singh', decided_at: RAISED }),
      row({ role_key: 'ceo', status: 'not_required', reason: 'Not required — level 3 was approved by the COO.' }),
    ];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, LATE))).not.toContain('ceo');
  });

  it('stays when the CEO actually signed it', () => {
    const rows = [
      row({ role_key: 'coo', status: 'not_required', reason: 'Not required — level 3 was approved by the CEO.' }),
      row({ role_key: 'ceo', status: 'approved', decided_name: 'Anita Rao', decided_at: LATE.toISOString() }),
    ];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, LATE))).toContain('ceo');
  });

  it('stays when the CEO refused it', () => {
    const rows = [
      row({ role_key: 'ceo', status: 'rejected', decided_name: 'Anita Rao', decided_at: LATE.toISOString(), reason: 'No' }),
    ];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, EARLY))).toContain('ceo');
  });

  it('stays when there is no COO on the pass at all — the CEO is level 3 alone', () => {
    const rows = [row({ role_key: 'ceo' })];
    expect(offices(printedSteps(LADDER, rows, RAISED, HOURS, EARLY))).toContain('ceo');
  });

  it('leaves every other rung alone', () => {
    const rows = [row({ role_key: 'coo' }), row({ role_key: 'ceo' })];
    const kept = printedSteps(
      [step('raised', { key: 'raised', office: undefined }), ...LADDER, step('gate', { key: 'gate', office: undefined })],
      rows, RAISED, HOURS, EARLY,
    );
    expect(kept.map((s) => s.key)).toEqual([
      'raised', 'level-security_head', 'level-finance_head', 'level-coo', 'gate',
    ]);
  });

  it('drops the CEO on a pre-workflow pass whose COO office is filled', () => {
    // No approval rows at all: the ladder is graded from the org chart, and a
    // filled COO office means level 3 was never the CEO's to sign.
    expect(offices(printedSteps(LADDER, [], RAISED, HOURS, EARLY))).not.toContain('ceo');
  });

  it('keeps the CEO on a pre-workflow pass with no COO rung drawn', () => {
    const noCoo = [step('security_head'), step('finance_head'), step('ceo')];
    expect(offices(printedSteps(noCoo, [], RAISED, HOURS, EARLY))).toContain('ceo');
  });
});

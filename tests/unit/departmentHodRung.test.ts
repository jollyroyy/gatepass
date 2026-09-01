// THE LEVEL-0 RUNG ON THE RECORD, THE STRIP AND THE PAPER (migration 077).
//
// A pass raised by somebody an HOD authorised owes that HOD's signature before
// the Security Head's. Three surfaces have to agree about it — the ladder on the
// record, the HOD board's "waiting with" strip, and the printed slip's boxes —
// and they agree by all reading the pass's own rows rather than the org chart.
import { describe, it, expect } from 'vitest';
import {
  buildApprovalSteps,
  DEPARTMENT_HOD_RUNG,
  rungTitle,
  RUNG_TITLES,
  APPROVAL_ROLE_TITLES,
  type PassApprovalRow,
} from '../../src/lib/approvalLadder';
import { ROLE_TO_SLOT } from '../../src/lib/hodApprovals';
import { buildSignatureBoxes } from '../../src/lib/printSignatureBoxes';
import type { GatePassView } from '../../src/types';

const PASS = {
  id: 'p1',
  pass_number: 'RGP-IT-0007',
  type: 'RGP',
  direction: 'out',
  status: 'pending',
  return_status: 'awaiting_return',
  department_name: 'IT',
  raised_by_name: 'Anita Rao',
  created_at: '2026-09-01T04:30:00Z',
  expected_return_date: null,
  actual_return_date: null,
  is_overdue: false,
  is_expired: false,
} as unknown as GatePassView;

function approval(over: Partial<PassApprovalRow> = {}): PassApprovalRow {
  return {
    role_key: DEPARTMENT_HOD_RUNG,
    level_no: 0,
    status: 'pending',
    routed_name: 'Sudeshna Pal',
    decided_name: null,
    decided_at: null,
    reason: null,
    ...over,
  };
}

const SECURITY = approval({ role_key: 'security_head', level_no: 1, routed_name: 'R Kumar' });

describe('the rung on the record', () => {
  it('is drawn directly under Raised By and above every office', () => {
    const steps = buildApprovalSteps(PASS, [], 'hod', [approval(), SECURITY]);
    expect(steps[0].key).toBe('raised');
    expect(steps[1].key).toBe(`level-${DEPARTMENT_HOD_RUNG}`);
    expect(steps[1].label).toBe('Level 0 Approval');
    expect(steps[2].key).toBe('level-security_head');
  });

  it('is absent from a pass that carries no such row — every pass an HOD raised themselves', () => {
    const steps = buildApprovalSteps(PASS, [], 'hod', [SECURITY]);
    expect(steps.some((s) => s.key === `level-${DEPARTMENT_HOD_RUNG}`)).toBe(false);
    expect(steps[1].key).toBe('level-security_head');
  });

  it('names the person who SIGNED it, and the HOD it was routed to until somebody has', () => {
    const waiting = buildApprovalSteps(PASS, [], 'hod', [approval()])[1];
    expect(waiting.who).toBe('Department HOD (Sudeshna Pal)');
    expect(waiting.state).toBe('pending');
    expect(waiting.note).toBe('Waiting for this approval');

    // Any active HOD of the department may sign it, so the signer is not always
    // the person the row was addressed to — and the record must say who pressed.
    const signed = buildApprovalSteps(PASS, [], 'hod', [approval({
      status: 'approved',
      decided_name: 'Vikram Singh',
      decided_at: '2026-09-01T06:00:00Z',
    })])[1];
    expect(signed.who).toBe('Department HOD (Vikram Singh)');
    expect(signed.state).toBe('done');
    expect(signed.at).toBe('2026-09-01T06:00:00Z');
  });

  it("makes a rejection's own words the note — it is the only answer the raiser gets", () => {
    const step = buildApprovalSteps(PASS, [], 'hod', [approval({
      status: 'rejected',
      decided_name: 'Sudeshna Pal',
      decided_at: '2026-09-01T06:00:00Z',
      reason: 'Raise this against the AMC contract, not a fresh pass.',
    })])[1];
    expect(step.state).toBe('blocked');
    expect(step.note).toBe('Raise this against the AMC contract, not a fresh pass.');
  });
});

describe('the rung is not an office', () => {
  it('has a title of its own, and leaves the four offices alone', () => {
    expect(rungTitle(DEPARTMENT_HOD_RUNG)).toBe('Department HOD');
    expect(RUNG_TITLES.coo).toBe(APPROVAL_ROLE_TITLES.coo);
    expect(Object.keys(APPROVAL_ROLE_TITLES)).not.toContain(DEPARTMENT_HOD_RUNG);
  });

  it('prints an unknown key rather than "undefined"', () => {
    // A row from a database ahead of this bundle must still render.
    expect(rungTitle('some_future_rung')).toBe('some_future_rung');
  });
});

describe("the HOD board's own strip", () => {
  it('files the rung under HOD Approval — the slot that was structurally zero', () => {
    expect(ROLE_TO_SLOT[DEPARTMENT_HOD_RUNG]).toBe('hod');
    expect(ROLE_TO_SLOT.security_head).toBe('security');
    expect(ROLE_TO_SLOT.coo).toBe('other');
  });
});

describe('the printed slip', () => {
  it('heads the box "Department HOD" and gives it the signature slot of that rung', () => {
    const steps = buildApprovalSteps(PASS, [], 'hod', [approval({
      status: 'approved',
      decided_name: 'Sudeshna Pal',
      decided_at: '2026-09-01T06:00:00Z',
    }), SECURITY]);
    // `get_pass_signatures` (075) returns a signer's mark under the rung key
    // itself, so the box finds it with no SQL and no special case.
    const boxes = buildSignatureBoxes(steps, null, true, { department_hod: 'https://sig/hod.png' });
    const hod = boxes.find((b) => b.key === `level-${DEPARTMENT_HOD_RUNG}`);
    expect(hod?.label).toBe('Department HOD');
    expect(hod?.state).toBe('signed');
    expect(hod?.signatureUrl).toBe('https://sig/hod.png');
  });

  it('shows no signature on the box while the rung is still waiting', () => {
    const steps = buildApprovalSteps(PASS, [], 'hod', [approval(), SECURITY]);
    const boxes = buildSignatureBoxes(steps, null, true, { department_hod: 'https://sig/hod.png' });
    const hod = boxes.find((b) => b.key === `level-${DEPARTMENT_HOD_RUNG}`);
    expect(hod?.state).toBe('awaiting');
    expect(hod?.signatureUrl).toBeNull();
  });
});

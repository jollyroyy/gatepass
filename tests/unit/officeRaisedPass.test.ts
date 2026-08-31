// A PASS THE COO OR THE CEO RAISED SAYS SO, ON EVERY TIMELINE.
//
// Migration 069 let the sitting COO and CEO raise for a department they do not
// head. Nothing said so afterwards: `raised_by_name` is a person's name, and
// beside a department they head none of, every timeline in the app read as
// though that department's own HOD had raised it — the card strip's "RAISED",
// the pass record's "Raised By" rung, the admin activity log's "Raised" row and
// the printed slip's box headed "Issuing HOD", which was the plainest lie of
// the four because a person signs paper under that heading.
//
// The office is a SNAPSHOT on the pass (migration 071, `raised_by_office`), not
// a lookup against today's designations: `approval_roles` keeps only the
// CURRENT holder, so deriving it later would relabel every past pass the day
// the office changes hands.
//
// All four surfaces take their words from `src/lib/raisedByOffice.ts` — one
// module, so a card, a rail, a log row and a printed box cannot disagree about
// who raised the material.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { passTimeline } from '../../src/lib/passTimeline';
import { buildApprovalSteps } from '../../src/lib/approvalLadder';
import { buildActivityLog } from '../../src/lib/activityLog';
import { buildSignatureBoxes } from '../../src/lib/printSignatureBoxes';
import { RAISING_OFFICE_TITLE, raisingOfficeOf } from '../../src/lib/raisedByOffice';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'NRGP-HK-0007', type: 'NRGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Housekeeping', department_code: 'HK',
    raised_by: 'u-coo', raised_by_name: 'Vikram Singh', raised_by_office: null,
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Scrap removal', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2026-09-01T18:30:00Z',
    created_at: '2026-08-31T05:00:00Z', updated_at: '2026-08-31T05:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 500,
    material_summary: 'Scrap cable',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...over,
  } as any;
}

describe('raisingOfficeOf', () => {
  it('reads the snapshotted office and nothing else', () => {
    expect(raisingOfficeOf({ raised_by_office: 'coo' })).toBe('coo');
    expect(raisingOfficeOf({ raised_by_office: 'ceo' })).toBe('ceo');
    expect(raisingOfficeOf({ raised_by_office: null })).toBeNull();
    // A value the database's CHECK does not admit is not a title to print.
    expect(raisingOfficeOf({ raised_by_office: 'security_head' })).toBeNull();
    // A row read before 071 shipped carries no such key at all.
    expect(raisingOfficeOf({})).toBeNull();
  });

  it('titles both offices the way the ladder does', () => {
    expect(RAISING_OFFICE_TITLE).toEqual({ coo: 'COO', ceo: 'CEO' });
  });
});

describe('the card strip', () => {
  it('names the office in the raise moment', () => {
    expect(passTimeline(pass({ raised_by_office: 'coo' }))[0].label).toBe('Raised by COO');
    expect(passTimeline(pass({ raised_by_office: 'ceo' }))[0].label).toBe('Raised by CEO');
  });

  it('leaves an HOD-raised pass reading exactly as it always has', () => {
    expect(passTimeline(pass())[0].label).toBe('Raised');
  });
});

describe('the pass record rail', () => {
  const raise = (p: GatePassView) => buildApprovalSteps(p, [], null, [])[0];

  it('says which office raised it, and for whom', () => {
    const step = raise(pass({ raised_by_office: 'coo' }));
    expect(step.who).toBe('Vikram Singh');
    // The department is still the fact the rung is about — the office is added
    // to it, never in place of it.
    expect(step.detail).toBe('Housekeeping');
    expect(step.note).toBe('Raised by the COO for this department — approved on raising');
    expect(step.label).toBe('Raised By (COO)');
  });

  it('leaves an HOD-raised rung untouched', () => {
    const step = raise(pass());
    expect(step.label).toBe('Raised By');
    expect(step.note).toBe('Approved on raising');
  });
});

describe('the admin activity log', () => {
  it('names the office on the raise event', () => {
    const [entry] = buildActivityLog([pass({ raised_by_office: 'ceo' })], [], [], new Map());
    expect(entry.event).toBe('Raised — CEO');
    expect(entry.who).toBe('Vikram Singh');
  });

  it('leaves an HOD-raised event reading "Raised"', () => {
    const [entry] = buildActivityLog([pass()], [], [], new Map());
    expect(entry.event).toBe('Raised');
  });
});

describe('the printed slip', () => {
  const headings = (p: GatePassView) =>
    buildSignatureBoxes(buildApprovalSteps(p, [], null, []), null, false).map((b) => b.label);

  it('heads the issuing box with the office that actually raised it', () => {
    expect(headings(pass({ raised_by_office: 'coo' }))[0]).toBe('Issuing COO');
    expect(headings(pass({ raised_by_office: 'ceo' }))[0]).toBe('Issuing CEO');
  });

  it('still heads an HOD-raised slip "Issuing HOD"', () => {
    expect(headings(pass())[0]).toBe('Issuing HOD');
  });

  it('prints the raiser inside the box, not the office repeated', () => {
    const [box] = buildSignatureBoxes(
      buildApprovalSteps(pass({ raised_by_office: 'coo' }), [], null, []), null, false,
    );
    expect(box.signer).toBe('Vikram Singh');
    expect(box.state).toBe('signed');
  });
});

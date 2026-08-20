// Deleting a department needs the HOD's approval (migration 060).
//
// Two client instructions are pinned here, 2026-08-20: "the admin should not
// be able to delete the department. He needs approval from the HOD", and "if
// it does not have any HOD then the admin can delete the department".
import { describe, it, expect } from 'vitest';
import {
  DEPT_DELETE_STATUS_LABEL,
  decidableRequests,
  deleteOutcomeNotice,
  deletionReasonError,
  pendingRequestFor,
  type DepartmentDeleteRequest,
} from '../../src/lib/departmentDeleteRequests';

function req(over: Partial<DepartmentDeleteRequest> = {}): DepartmentDeleteRequest {
  return {
    id: 'r1',
    department_id: 'd1',
    department_name: 'Marketing',
    department_code: 'MR',
    requested_by: 'admin-1',
    requested_name: 'Admin One',
    reason: 'Merged into Retail Ops',
    status: 'pending',
    decided_by: null,
    decided_name: null,
    decided_at: null,
    decision_reason: null,
    created_at: '2026-08-20T06:00:00Z',
    can_decide: true,
    ...over,
  };
}

describe('deletionReasonError — the same 5..500 the CHECK enforces', () => {
  it('refuses a short reason', () => {
    expect(deletionReasonError('no')).toContain('5 characters');
  });

  // A box of spaces is not a reason, and the database agrees: 060 measures
  // `length(btrim(reason))`.
  it('refuses whitespace', () => {
    expect(deletionReasonError('        ')).not.toBeNull();
  });

  it('accepts a real one', () => {
    expect(deletionReasonError('Merged into Retail Ops')).toBeNull();
  });

  it('refuses more than 500 characters', () => {
    expect(deletionReasonError('x'.repeat(501))).toContain('500');
  });

  it('names what is being asked for', () => {
    expect(deletionReasonError('no', 'reason for refusing')).toContain('reason for refusing');
  });
});

describe('decidableRequests — what the HOD is actually being asked', () => {
  it('keeps a pending request this reader may decide', () => {
    expect(decidableRequests([req()])).toHaveLength(1);
  });

  // The authority comes from the database (`hod_departments`, read at the
  // moment of the press), never from the role: an HOD moved off the department
  // may not decide its deletion.
  it('drops one routed to somebody else', () => {
    expect(decidableRequests([req({ can_decide: false })])).toHaveLength(0);
  });

  it('drops one already decided', () => {
    expect(decidableRequests([req({ status: 'approved', can_decide: true })])).toHaveLength(0);
  });
});

describe('pendingRequestFor — the admin department card', () => {
  it('finds the live request against that department', () => {
    expect(pendingRequestFor([req()], 'd1')?.id).toBe('r1');
  });

  it('ignores a decided one, so a refused request does not freeze the card', () => {
    expect(pendingRequestFor([req({ status: 'rejected' })], 'd1')).toBeNull();
  });

  it('ignores another department', () => {
    expect(pendingRequestFor([req()], 'd2')).toBeNull();
  });
});

describe('deleteOutcomeNotice — the admin is told which of the two happened', () => {
  it('says it was deleted when nobody heads the department', () => {
    const msg = deleteOutcomeNotice({ deleted: true, requested: false }, 'Marketing');
    expect(msg).toContain('was deleted');
    expect(msg).toContain('no active HOD');
  });

  // The name is load-bearing: "sent for approval" with nobody named leaves an
  // admin unable to chase it, and no other screen says who heads a department.
  it('names the HOD the request went to, and says the department is still there', () => {
    const msg = deleteOutcomeNotice(
      { deleted: false, requested: true, hods: ['Priya Nair'] },
      'Marketing',
    );
    expect(msg).toContain('Priya Nair');
    expect(msg).toContain('not deleted');
  });

  it('says so when a request was already waiting', () => {
    const msg = deleteOutcomeNotice(
      { deleted: false, requested: false, already_pending: true, hods: ['Priya Nair'] },
      'Marketing',
    );
    expect(msg).toContain('already waiting');
  });

  it('never claims a deletion it was not told about', () => {
    expect(deleteOutcomeNotice({}, 'Marketing')).toContain('not deleted');
  });
});

describe('the status words', () => {
  it('an approved request says the department is gone', () => {
    expect(DEPT_DELETE_STATUS_LABEL.approved).toContain('deleted');
  });

  it('a pending one names who it is with', () => {
    expect(DEPT_DELETE_STATUS_LABEL.pending).toContain('HOD');
  });
});

// Deleting a department is a REQUEST when somebody heads it (migration 060).
//
// The client's rule, 2026-08-20: "the admin should not be able to delete the
// department. He needs approval from the HOD ... if it does not have any HOD
// then the admin can delete the department." So one press on Delete has two
// possible outcomes, and the screen must be able to tell them apart — which is
// why `admin_delete_department` now answers with a json object rather than
// with nothing at all.
//
// Every rule stated here is ALSO enforced in 060. This module exists so the
// screen refuses what the RPC would refuse, in the same words, before the round
// trip — never as the only place a rule lives.
export type DeptDeleteStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** One row of `gatepass.list_department_delete_requests()`. The department's
 *  name and code are the SNAPSHOT taken when the request was raised, not a
 *  join — an approved request has outlived the row it points at. */
export interface DepartmentDeleteRequest {
  id: string;
  department_id: string | null;
  department_name: string;
  department_code: string;
  requested_by: string;
  requested_name: string | null;
  reason: string;
  status: DeptDeleteStatus;
  decided_by: string | null;
  decided_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
  /** Is the READER the person this request is waiting on, right now? Answered
   *  by the database from `hod_departments`, never derived here — an HOD moved
   *  off the department since the request was raised may not decide it. */
  can_decide: boolean;
}

/** What `admin_delete_department` answers with. `deleted` and `requested` are
 *  never both true, and both are false when a request was already waiting. */
export interface DeleteDepartmentOutcome {
  deleted?: boolean;
  requested?: boolean;
  already_pending?: boolean;
  request_id?: string;
  hods?: string[];
}

export const DEPT_DELETE_STATUS_LABEL: Record<DeptDeleteStatus, string> = {
  pending: 'Waiting for the HOD',
  approved: 'Approved — department deleted',
  rejected: 'Refused by the HOD',
  withdrawn: 'Withdrawn by the admin',
};

export const DEPT_DELETE_STATUS_CHIP: Record<DeptDeleteStatus, string> = {
  pending: 'bg-pending-50 text-pending-700 border border-pending-500/25',
  approved: 'bg-matched-50 text-matched-700 border border-matched-500/25',
  rejected: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  withdrawn: 'bg-surface-100 text-navy-600 border border-surface-200',
};

/** The written reason both ends require. Mirrors 060's CHECK exactly
 *  (5..500 on the TRIMMED string) — a box of spaces is not a reason. */
export function deletionReasonError(text: string, label = 'reason'): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 5) return `Give a ${label} of at least 5 characters.`;
  if (trimmed.length > 500) return `Keep the ${label} to 500 characters or fewer.`;
  return null;
}

/** The requests this reader is being asked to decide — the HOD dashboard card.
 *  `can_decide` already carries the authority test, so the status check here is
 *  belt and braces for a row the database decided but the page has not reloaded. */
export function decidableRequests(rows: DepartmentDeleteRequest[]): DepartmentDeleteRequest[] {
  return rows.filter((r) => r.status === 'pending' && r.can_decide);
}

/** The live request against one department, for the admin's department card. */
export function pendingRequestFor(
  rows: DepartmentDeleteRequest[],
  departmentId: string,
): DepartmentDeleteRequest | null {
  return rows.find((r) => r.status === 'pending' && r.department_id === departmentId) ?? null;
}

/**
 * What the admin reads after pressing Delete.
 *
 * It NAMES THE PEOPLE the request went to. "Sent for approval" with no name
 * leaves an admin unable to chase it, and this app has no other screen that
 * says who heads a department while a request is open.
 */
export function deleteOutcomeNotice(
  outcome: DeleteDepartmentOutcome,
  departmentName: string,
): string {
  const who = (outcome.hods ?? []).filter(Boolean).join(', ');
  if (outcome.deleted) {
    return `${departmentName} was deleted. It had no active HOD, so no approval was needed.`;
  }
  if (outcome.already_pending) {
    return `A deletion request for ${departmentName} is already waiting${who ? ` with ${who}` : ''}.`;
  }
  if (outcome.requested) {
    return `${departmentName} has an active HOD, so it was not deleted. A deletion request has been sent${who ? ` to ${who}` : ''} — the department goes only once they approve it.`;
  }
  // Neither flag came back. Say what is certainly true rather than guessing.
  return `${departmentName} was not deleted.`;
}

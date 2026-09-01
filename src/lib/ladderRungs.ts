// A RUNG IS NOT AN OFFICE — the one distinction migration 077 introduced, held
// in its own module so that nothing which merely needs to NAME a rung has to
// import the whole ladder.
//
// Until 077 every rung of the approval ladder belonged to one of the four
// offices in `gatepass.approval_roles`, so `ApprovalRoleKey` served as both "who
// holds a seat" and "what a pass owes a signature to". A pass raised by somebody
// an HOD authorised (`gatepass.pass_raisers`) owes one more, at level 0, and it
// belongs to NO OFFICE: the authority behind it is heading the department the
// pass was raised for, which is a fact about a person and a pass, not a seat.
//
// SO THE TWO TYPES DIVERGE, and deliberately:
//
//   * `ApprovalRoleKey` — the four offices. Still what `approval_roles`,
//     `approval_delegations`, the admin's ladder card, the Delegation tab and
//     `my_approval_roles()` all speak in. NOTHING is added to it, so no screen
//     that seats an office can accidentally offer "Department HOD" as one.
//   * `LadderRungKey` — what a `pass_approvals` row can be. The four, plus the
//     HOD's. Anything reading a pass's own ladder speaks in this.
//
// `RUNG_TITLES` is a Record over the wider type, so a rung added to the database
// without a name here is a compile error rather than a blank cell.
import type { ApprovalRoleKey } from './approvalLadder';
import { APPROVAL_NOTE, APPROVAL_STATE, type PassApprovalRow } from './passApprovalState';
import type { ApprovalStep } from './passLadderLegs';

/** The title printed beside the level. "Finance HOD" and not "Finance Head"
 *  because that is the word on the slip, and the two documents must agree. */
export const APPROVAL_ROLE_TITLES: Record<ApprovalRoleKey, string> = {
  security_head: 'Security Head',
  coo: 'COO',
  ceo: 'CEO',
  finance_head: 'Finance HOD',
};

/** "COO (Vikram Singh)" — the office first, the person in brackets (client).
 *  The office is the fact that matters on an audit trail; the holder changes.
 *  A vacant office prints its own title alone, never "COO (—)". */
export function approverLine(title: string, name: string | null | undefined): string {
  return name && name.trim() ? `${title} (${name.trim()})` : title;
}

/** The level-0 rung a pass carries when it was raised under an HOD's authority
 *  (migration 077). It is `pass_approvals.role_key` and nothing else — never a
 *  row in `approval_roles`, never an `ApprovalRoleKey`. */
export const DEPARTMENT_HOD_RUNG = 'department_hod';

export type LadderRungKey = ApprovalRoleKey | typeof DEPARTMENT_HOD_RUNG;

/** What each rung is called on screen and on paper. The four offices' titles are
 *  spread from `APPROVAL_ROLE_TITLES` rather than restated — a name in two
 *  places is a name that can drift, and these two are compared by the printed
 *  slip and the record on the tablet side by side. */
export const RUNG_TITLES: Record<LadderRungKey, string> = {
  [DEPARTMENT_HOD_RUNG]: 'Department HOD',
  ...APPROVAL_ROLE_TITLES,
};

/** Is this rung the HOD's own? A narrowing helper, so no call site tests the
 *  string literal and no call site has to remember that the four offices are
 *  everything else. */
export function isDepartmentHodRung(key: LadderRungKey | string): key is typeof DEPARTMENT_HOD_RUNG {
  return key === DEPARTMENT_HOD_RUNG;
}

/** The title of any rung, including one this build has never heard of — an
 *  unknown key prints itself rather than `undefined`. The Record above is the
 *  compile-time guarantee; this is the runtime one, for a row that arrived from
 *  a database ahead of this bundle. */
export function rungTitle(key: LadderRungKey | string): string {
  return RUNG_TITLES[key as LadderRungKey] ?? key;
}

/**
 * THE HOD'S OWN RUNG, as one step of a pass's ladder (migration 077; client,
 * 2026-09-01: "those passes should be approved by the HOD as first-level
 * approver and the following is routine, followed as usual").
 *
 * Built here rather than in `buildApprovalSteps` because it is the one step that
 * is not an office's: it is drawn from the PASS'S OWN ROW and never from the org
 * chart, so a pass without one shows nothing — which is every pass an HOD raised
 * themselves, and every pass raised before this migration.
 *
 * WHO IT NAMES IS THE SIGNER, not the person the row was routed to. `routed_to`
 * is the HOD who wrote the authority, and any active HOD of the department may
 * sign it instead (the database's rule, because a department may host several
 * and one of them may be away) — so falling back to the routed name only when
 * nobody has signed yet is the honest order.
 */
export function departmentHodStep(
  row: PassApprovalRow | undefined,
  departmentName: string | null,
): ApprovalStep | null {
  if (!row) return null;
  const title = RUNG_TITLES[DEPARTMENT_HOD_RUNG];
  return {
    key: `level-${DEPARTMENT_HOD_RUNG}`,
    // THE RUNG KEY TRAVELS ON THE STEP (071's field, 075's slot). The printed
    // box is HEADED by it, and `get_pass_signatures` returns the signer's mark
    // under this very string for an approved row — so the HOD's signature
    // appears on the slip with no SQL and no special case anywhere.
    office: DEPARTMENT_HOD_RUNG,
    label: 'Level 0 Approval',
    who: approverLine(title, row.decided_name ?? row.routed_name),
    // The department, as every other rung carries it — an HOD signs for the
    // department, and the material is moving for it.
    detail: departmentName,
    at: row.decided_at,
    state: APPROVAL_STATE[row.status],
    // A rejection's reason IS the note: it is the sentence somebody typed, and
    // the only answer the person who raised the pass gets.
    note: row.status === 'rejected' && row.reason ? row.reason : APPROVAL_NOTE[row.status],
    boxLabel: title,
  };
}

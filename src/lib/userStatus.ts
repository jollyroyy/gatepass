// Whether an account is usable, and what to call its role — one derivation,
// read by the admin portal's table and by the app gate in App.tsx.
//
// Before migration 040 these were the same question: suspending someone wrote
// `public.profiles.role = 'staff'`, so "Inactive" appeared in the Role column
// and the person's real role was destroyed by the act of suspending them.
// Now the role is a role, and the suspension is `gatepass.user_status`.
import type { UserRole } from '../types';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from './approvalLadder';

/**
 * What a role is called on screen. `staff` is VMS's role for someone who does
 * not use GatePass at all — it is labelled honestly rather than dressed up as
 * a status, because it is a fact about a shared directory this app does not own.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  guard: 'Guard',
  hod: 'HOD',
  staff: 'Staff',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

export const ROLE_CHIP: Record<UserRole, string> = {
  guard: 'bg-brand-50 text-brand-700 border border-brand-500/25',
  hod: 'bg-matched-50 text-matched-700 border border-matched-500/25',
  admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  super_admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  staff: 'bg-surface-100 text-navy-600 border border-surface-200',
};

/**
 * The roles the admin portal may assign.
 *
 * Guard and HOD only, mirroring what `admin_create_user` / `admin_update_user`
 * accept server-side since 040: admin/super_admin need the service-role key
 * (021), and `staff` stopped being this app's off switch.
 */
export const ASSIGNABLE_ROLES: { key: Extract<UserRole, 'guard' | 'hod'>; label: string }[] = [
  { key: 'guard', label: 'Guard' },
  { key: 'hod', label: 'HOD' },
];

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]['key'];

export function isAssignableRole(role: UserRole): role is AssignableRole {
  return ASSIGNABLE_ROLES.some((r) => r.key === role);
}

/**
 * Migration 046: an admin creates a Security Head / COO / CEO / Finance HOD
 * account exactly like a guard or HOD one — `admin_create_user` now accepts
 * the office key directly as `p_role`, creates the account as VMS `staff`
 * (they use no VMS screen) and designates them in `gatepass.approval_roles`
 * in the same transaction. So the ADD-USER role control offers six things,
 * not two; the EDIT-USER one is unchanged (see `AssignableRole` above) —
 * `admin_update_user` was not extended, and moving an office is still only
 * `set_approval_role` / `clear_approval_role`, behind the "Gate pass approval
 * ladder" card.
 */
export type CreatableRole = AssignableRole | ApprovalRoleKey;

/** Labels are read from `APPROVAL_ROLE_TITLES` (the printed-slip words), never
 *  restated here — a name in two places is a name that can drift. */
export const CREATABLE_ROLES: { key: CreatableRole; label: string; kind: 'role' | 'office' }[] = [
  ...ASSIGNABLE_ROLES.map((r) => ({ ...r, kind: 'role' as const })),
  { key: 'security_head', label: APPROVAL_ROLE_TITLES.security_head, kind: 'office' },
  { key: 'coo', label: APPROVAL_ROLE_TITLES.coo, kind: 'office' },
  { key: 'ceo', label: APPROVAL_ROLE_TITLES.ceo, kind: 'office' },
  { key: 'finance_head', label: APPROVAL_ROLE_TITLES.finance_head, kind: 'office' },
];

const APPROVAL_OFFICE_KEYS: Record<ApprovalRoleKey, true> = {
  security_head: true,
  coo: true,
  ceo: true,
  finance_head: true,
};

/** A `Record` lookup, not an `includes()` chain — a fifth office added to
 *  `ApprovalRoleKey` without a matching entry here is a compile error. */
export function isApprovalOffice(role: string): role is ApprovalRoleKey {
  return Object.prototype.hasOwnProperty.call(APPROVAL_OFFICE_KEYS, role);
}

/**
 * Can this account reach the app at all?
 *
 * Two independent reasons it cannot, and both have to be here or a screen
 * reports someone Active who cannot sign in to anything:
 *
 *   1. An admin suspended them — `gatepass.user_status.is_active` is false.
 *   2. Their role has no place in this app (`staff`): no routes in
 *      ROLE_ROUTES, no policy grants in Postgres. That was true before 040
 *      and is unchanged by it.
 *
 * @param flag  the raw `is_active` column. `undefined`/`null` means the person
 *              has no user_status row, which 040 defines as active — a row is
 *              written only when someone is actually suspended.
 */
export function isAccountActive(role: UserRole, flag: boolean | null | undefined): boolean {
  if (flag === false) return false;
  return role !== 'staff';
}

/**
 * The same question, asked by the admin DIRECTORY, which knows one more fact
 * than `isAccountActive` can see from a role and a flag.
 *
 * Migration 046 creates a Security Head / COO / CEO / Finance HOD as VMS
 * `staff` — the role for "does not use VMS" — and their row in
 * `gatepass.approval_roles` is what grants them their route and their queue.
 * So an office holder is a `staff` row who signs in perfectly well, and
 * `isAccountActive` would file them under Inactive on the strength of a role
 * that was never meant to describe them.
 *
 * It is a SECOND function rather than a third parameter on the first: the app
 * gate in App.tsx asks about the signed-in user and has no office map to hand,
 * and widening the signature there would make every caller answer a question
 * only this screen is asking.
 *
 * @param hasOffice  does this person hold one of the four approval offices?
 */
export function isDirectoryActive(
  role: UserRole,
  flag: boolean | null | undefined,
  hasOffice: boolean,
): boolean {
  // A suspension outranks an office: the flag is what app_role() reads, so a
  // suspended office holder reaches nothing either.
  if (flag === false) return false;
  if (hasOffice) return true;
  return isAccountActive(role, flag);
}

export function accountStatusLabel(role: UserRole, flag: boolean | null | undefined): string {
  return isAccountActive(role, flag) ? 'Active' : 'Inactive';
}

export function accountStatusChip(role: UserRole, flag: boolean | null | undefined): string {
  return isAccountActive(role, flag)
    ? 'bg-matched-50 text-matched-700 border border-matched-500/25'
    : 'bg-surface-100 text-navy-600 border border-surface-200';
}

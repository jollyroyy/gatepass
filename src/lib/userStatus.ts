// Whether an account is usable, and what to call its role — one derivation,
// read by the admin portal's table and by the app gate in App.tsx.
//
// Before migration 040 these were the same question: suspending someone wrote
// `public.profiles.role = 'staff'`, so "Inactive" appeared in the Role column
// and the person's real role was destroyed by the act of suspending them.
// Now the role is a role, and the suspension is `gatepass.user_status`.
import type { UserRole } from '../types';

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

export function accountStatusLabel(role: UserRole, flag: boolean | null | undefined): string {
  return isAccountActive(role, flag) ? 'Active' : 'Inactive';
}

export function accountStatusChip(role: UserRole, flag: boolean | null | undefined): string {
  return isAccountActive(role, flag)
    ? 'bg-matched-50 text-matched-700 border border-matched-500/25'
    : 'bg-surface-100 text-navy-600 border border-surface-200';
}

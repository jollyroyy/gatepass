// EVERY FUNCTIONAL ROLE IN THIS SYSTEM, AND WHAT EACH ONE IS FOR.
//
// Client, 2026-08-20: a tab beside Users and Departments where the roles can be
// created and assigned, and where "all the functional role list should be
// mentioned there and what is the purpose".
//
// ⚠ THE LIST IS FIXED, AND THE SCREEN SAYS SO. A role here is one of two things,
// and neither is free text:
//
//   * a VMS role — `public.profiles.role`, a Postgres ENUM owned by the visitor
//     system. This app never adds to it (CLAUDE.md, the two-schema rule), and a
//     new label could not be used in the transaction that added it anyway.
//   * a GATE PASS APPROVAL OFFICE — a row in `gatepass.approval_roles`, keyed by
//     `role_key` with a CHECK constraint (043). Four keys, one holder each (049)
//     and one optional standing deputy (054).
//
// So "create a role" means CREATE SOMEBODY IN A ROLE — an account carrying that
// grant — not invent a new kind of authority. Anything else would be a lie told
// by a dropdown.
//
// The capabilities are written from the policies and RPCs that actually enforce
// them, not from intent: `ROLE_ROUTES` for what opens, `gate_passes_select` for
// what is readable, and the RPC guards for what may be pressed.
import type { UserRole } from '../types';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from './approvalLadder';

export type FunctionalRoleKey = UserRole | ApprovalRoleKey;

/** How a person comes to hold this role, which is also where an admin goes to
 *  grant it. `not_from_portal` means no screen in this app can do it — an admin
 *  account needs the server-side key (migration 021), and the word for that key
 *  is banned under `src/` by tests/security/clientSecrets.test.ts, comments
 *  included. */
export type RoleGrantedBy = 'users_tab' | 'approval_ladder' | 'not_from_portal';

export interface FunctionalRole {
  key: FunctionalRoleKey;
  title: string;
  /** Which of the two systems this role lives in — the honest answer to "why
   *  can I not just type a new one". */
  kind: 'VMS role' | 'Gate pass approval office';
  /** One sentence: what this role EXISTS for. */
  purpose: string;
  /** What holding it actually lets a person do, as enforced. */
  can: string[];
  grantedBy: RoleGrantedBy;
}

export const GRANT_NOTE: Record<RoleGrantedBy, string> = {
  users_tab: 'Assigned in Admin → Users, when the account is created or edited.',
  approval_ladder:
    'Assigned on the Gate pass approval ladder below — one holder, plus an optional standing deputy.',
  not_from_portal:
    'Cannot be granted from this portal. An admin account is created with the server-side key from the command line (migration 021), never from a screen.',
};

/**
 * The whole list, in the order it is read: the people who move material, then
 * the people who sign for it, then the people who run the system.
 *
 * A `FunctionalRoleKey` with no entry here is a compile error at
 * `FUNCTIONAL_ROLES`'s type, which is what stops a fifth office being added to
 * the ladder and never described to anybody.
 */
export const FUNCTIONAL_ROLES: FunctionalRole[] = [
  {
    key: 'hod',
    title: 'HOD (Head of Department)',
    kind: 'VMS role',
    purpose: 'Raises gate passes for their own department and answers for the material that leaves under them.',
    can: [
      'Raise an RGP or an NRGP for their department',
      'See every pass raised in their department, at every stage of approval',
      'Decide a pass the gate rejected, and void one that expired unused',
      'Approve or refuse the deletion of a department they head',
    ],
    grantedBy: 'users_tab',
  },
  {
    key: 'guard',
    title: 'Security Guard',
    kind: 'VMS role',
    purpose: 'Stands at the gate: checks the material against the pass and either approves it out or rejects it.',
    can: [
      'Search a pass by number, QR or mobile number',
      'Approve a pass out at the gate, or reject it with a written reason',
      'Record returned material line by line, quantity by quantity',
      'Nothing at all on a pass that has not finished the approval ladder — such a pass is invisible to the gate',
    ],
    grantedBy: 'users_tab',
  },
  {
    key: 'security_head',
    title: APPROVAL_ROLE_TITLES.security_head,
    kind: 'Gate pass approval office',
    purpose: 'Signs first on every gate pass: nothing moves up the ladder until this office approves it.',
    can: [
      'See a pass the moment it is raised, and approve or reject it',
      'See nothing else — no department, no site-wide register, no gate screens',
    ],
    grantedBy: 'approval_ladder',
  },
  {
    key: 'finance_head',
    title: APPROVAL_ROLE_TITLES.finance_head,
    kind: 'Gate pass approval office',
    purpose: 'Signs second, costing the movement once the Security Head has approved it.',
    can: [
      'See and decide a pass only after the Security Head has approved it',
      'Read back everything this office has already signed',
    ],
    grantedBy: 'approval_ladder',
  },
  {
    key: 'coo',
    title: APPROVAL_ROLE_TITLES.coo,
    kind: 'Gate pass approval office',
    purpose: 'Signs last, jointly with the CEO: whichever of the two signs releases the pass to the gate.',
    can: [
      'See and decide a pass only after Finance has approved it',
      'Sign the last level first — it escalates to the CEO only if this office has not decided it in time',
      'Carry the super admin fallback, and delegate this office to the CEO alone (067)',
    ],
    grantedBy: 'approval_ladder',
  },
  {
    key: 'ceo',
    title: APPROVAL_ROLE_TITLES.ceo,
    kind: 'Gate pass approval office',
    purpose: 'Shares the last level with the COO, and signs it once the COO has run out of time.',
    can: [
      'See a pass on the last level, and decide it once the COO has not approved it in the escalation window',
      'Reject it at any time it is on that level, escalation or not',
      'Decide whitelist requests for blacklisted vendors (migration 053)',
      'Carry the super admin fallback, and delegate this office to the COO alone (067)',
    ],
    grantedBy: 'approval_ladder',
  },
  {
    key: 'admin',
    title: 'Administrator',
    kind: 'VMS role',
    purpose: 'Runs the system: departments, accounts, the approval ladder, reports and the activity log.',
    can: [
      'See every gate pass at every stage, including one stuck mid-ladder',
      'Create and edit accounts, and designate the four approval offices',
      'Request the deletion of a department — which its HOD must approve',
      'Review an emergency release, unless they were the one who made it',
    ],
    grantedBy: 'not_from_portal',
  },
  {
    // SINCE 067 THIS IS NOT A PERSON, IT IS THE TOP TWO SEATS. The client
    // removed the standing super admin account and gave the fallback to the COO
    // and the CEO, alongside their office rather than instead of it: "in the
    // case where nobody is able to approve, in those scenarios the Superadmin
    // can take charge and get it approved." The VMS role still exists and still
    // works — this app does not own that column — but nobody holds it.
    key: 'super_admin',
    title: 'Super Administrator',
    kind: 'VMS role',
    purpose: 'A fallback, held by the COO and the CEO alongside their own office: the one door that gets a stuck gate pass past an approval ladder nobody is answering. It opens no admin screen.',
    can: [
      'Release a pass past every unsigned office once it has waited longer than the escalation window, with a written reason an admin reviews afterwards (migrations 055, 067)',
      'See a pass that is stuck on a level below their own, which the ladder otherwise hides from them (061, 067)',
    ],
    grantedBy: 'approval_ladder',
  },
  {
    key: 'staff',
    title: 'Staff (no gate pass access)',
    kind: 'VMS role',
    purpose: 'The visitor system’s role for somebody who does not use GatePass. It opens nothing here on its own.',
    can: [
      'Nothing in this app — unless the person also holds an approval office, which is carried beside the role, not instead of it',
    ],
    grantedBy: 'users_tab',
  },
];

/** The four offices, in ladder order — the ones this screen can actually seat
 *  somebody in. Derived, so it can never disagree with the list above. */
export function approvalOfficeRoles(): FunctionalRole[] {
  return FUNCTIONAL_ROLES.filter((r) => r.kind === 'Gate pass approval office');
}

/** How many ACTIVE accounts hold a VMS role today. Offices are counted by their
 *  seat, not by this — an office has one holder by primary key, and counting
 *  `staff` rows would say four people are "CEO" the moment four approvers
 *  exist. */
export function roleHeadcount(
  roles: { role: UserRole; is_active?: boolean | null }[],
  key: FunctionalRoleKey,
): number | null {
  if (!FUNCTIONAL_ROLES.some((r) => r.key === key && r.kind === 'VMS role')) return null;
  return roles.filter((p) => p.role === key && p.is_active !== false).length;
}

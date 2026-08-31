// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';
// TYPE-ONLY, and it must stay that way: this module is what route protection is
// verified against, and it must not drag a live Supabase client into a test
// that only asks which paths a role may reach. `import type` is erased at
// compile time, so nothing `approvalLadder.ts` imports is pulled in here.
import type { ApprovalRoleKey } from './approvalLadder';

/**
 * THE WHOLE OF WHAT AN APPROVAL OFFICE HOLDER MAY REACH. Since 2026-08-22 this
 * REPLACES the reader's role routes rather than adding to them — see
 * `isForbidden` below for the client instruction and the argument.
 * Declared here rather than in `approverAccess.ts` so this module stays
 * import-free: it is the one thing route protection is verified against, and it
 * must not drag a live Supabase client into a test that only asks which paths a
 * role may reach. See `approverAccess.ts` for why an office is not a role.
 */
// `/whitelist` is the CEO's blacklist-removal queue (client, 2026-08-20;
// migration 053). It is listed for EVERY office because this file knows a
// role and a boolean, not which office is held — and route access is UX
// defence in depth: `list_whitelist_requests` shows a COO nothing, and
// `approve_whitelist_request` refuses anyone but the CEO. The link into it is
// drawn for the CEO alone.
// `/delegation` is the office holder's OWN screen (062; client, 2026-08-22):
// they hand their office to a stand-in for a stated period and revoke it
// themselves. It is listed for every office because every office may delegate,
// and — as with `/whitelist` — the route is UX defence in depth: the page shows
// a delegate no form at all, because `create_approval_delegation`
// admits only somebody who HOLDS an office.
export const APPROVER_ROUTES: string[] = ['/approvals', '/delegation', '/whitelist', '/pass', '/profile'];

/**
 * THE TWO OFFICES THAT MAY ALSO RAISE A PASS, and the two screens that gives
 * them (client, 2026-08-31: "make sure CEO and COO has the ability to raise
 * pass on behalf of any department in their logins").
 *
 * ONLY THESE TWO, and deliberately the same pair migration 067 already trusts
 * with the emergency release: the Security Head clears material at the barrier
 * and the Finance HOD signs level 2, so letting either originate the material
 * they vet is the collision `officeReplacesRole` exists to prevent. The COO and
 * the CEO share ONE rung (063), which is why the pair is a pair at all.
 *
 * `/my-passes` comes with `/raise` because it has to: an office holder heads no
 * department, so `gate_passes_select` admits their own pass only through
 * migration 069's `raised_by = auth.uid()` arm and no board of theirs lists it.
 * Without the register, a pass they raised is unreachable the moment they close
 * the confirmation.
 *
 * THIS IS UX DEFENCE IN DEPTH, as the rest of this module is: `raise_pass`
 * (069) refuses anyone who is neither an HOD nor the sitting COO/CEO, whatever
 * this list says.
 */
export const RAISING_OFFICES: ApprovalRoleKey[] = ['coo', 'ceo'];
export const RAISING_OFFICE_ROUTES: string[] = ['/raise', '/my-passes'];

/** Where an office holder with no other role in this app lands. */
export const APPROVER_HOME = '/approvals';

/**
 * What this reader holds, as the two functions below take it.
 *
 * A BOOLEAN IS STILL ACCEPTED, and means "an office, unspecified" — every
 * caller that only knows whether a queue exists keeps working, and gets the
 * narrow answer (no `/raise`), which is the safe one. Pass the OFFICE KEY to
 * get the COO's and the CEO's extra screens.
 */
export type OfficeHeld = ApprovalRoleKey | boolean | null;

function holdsOffice(office: OfficeHeld): boolean {
  return office === true || typeof office === 'string';
}

/** Does the office this reader holds carry the raise screens? */
export function officeRaises(office: OfficeHeld): boolean {
  return typeof office === 'string' && (RAISING_OFFICES as string[]).includes(office);
}

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate. THE ORDER OF THIS LIST IS THE ORDER OF THE SIDEBAR
  // (Sidebar.tsx sorts by it).
  // `/pending-out` and `/pending-returns` ARE GONE (client, 2026-08-22): the
  // two lists are no longer pages at all — a dashboard figure opens its own
  // rows in place, on `/guard-dashboard`, and closes them again. See
  // `GuardDashboard`.
  // `/console` is still routed but is NOT A TAB (client, 2026-08-19: the search
  // moved into the guard's own screen, where they are already standing).
  // Verify's post-decision redirect still lands on it, and the dashboard's Scan
  // QR quick action still opens it.
  // `/overdue` is today's overdue material, the same page the HOD and the admin
  // get at their own scope. `/returns` is where a board's "due today" figure
  // navigates, on every role.
  guard: ['/guard-dashboard', '/overdue', '/console', '/returns', '/verify', '/pass', '/profile'],
  // Department heads raise passes for their own departments
  // `/mismatch/:id` and `/expired/:id` are where the bell's two decision notices
  // land — the review screens that offer "void it" or "raise it again". HOD-only:
  // those decisions are the raising HOD's, and `hod_review_flagged_pass` /
  // `hod_void_expired_pass` refuse anyone else regardless of what this list says.
  // `/reports` is the HOD's own copy of the admin's Gate Pass Report screen
  // (client, 2026-08-20), scoped to their own department by RLS alone — see
  // `src/pages/HOD/HodReports.tsx`. It sits right after `/overdue`, so the
  // sidebar reads Dashboard · Overdue Items · Reports.
  // `/my-passes` IS GONE (client, 2026-08-23: "remove my passes"). The page,
  // its route and its tab went together — the HOD's register is Reports, and
  // every dashboard figure opens the very rows it counted.
  hod: ['/dashboard', '/raise', '/overdue', '/reports', '/returns', '/mismatch', '/expired', '/pass', '/profile'],
  // Admin manages departments, users, and sees everything. THE ORDER OF THIS
  // LIST IS THE ORDER OF THE SIDEBAR (Sidebar.tsx sorts by it), so `/overdue`
  // sits second, straight under the board — client, 2026-08-18: "make the
  // overdue item the second tab in the admin view, keep the dashboard first".
  admin: ['/admin-dashboard', '/overdue', '/admin', '/all-passes', '/activity', '/returns', '/pass', '/profile'],
  super_admin: ['/admin-dashboard', '/overdue', '/admin', '/all-passes', '/activity', '/returns', '/pass', '/profile'],
  // Staff have no business in this app at all.
  staff: [],
};

/**
 * Where each role lands after signing in.
 *
 * Admin lands on the KPI board, not the Departments & Users screen: managing
 * people is an occasional errand, while the state of the gate is what an admin
 * opens the app to check.
 *
 * The guard lands on the KPI board too, and since 2026-08-18 that is where the
 * pending queue lives as well — Search Pass is search and nothing else. The
 * board is also the only route to the two return pages: Awaiting Return opens
 * `/returns` and Overdue opens `/overdue`, which is where a return is recorded,
 * line by line.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  guard: '/guard-dashboard',
  hod: '/dashboard',
  admin: '/admin-dashboard',
  super_admin: '/admin-dashboard',
  staff: '/no-access',
};

/**
 * AN APPROVAL OFFICE REPLACES THE ROLE'S ACCESS — it does not add to it.
 *
 * THIS REVERSES THE 2026-08-19 RULE, on the client's instruction (2026-08-22):
 * "all those approvers (COO, CEO, security, and the other financial one) should
 * not have any option to raise a gate pass or to see the status … I do see that
 * the security head is able to do all the returns. This is a flag flag
 * completely so please remove all the tabs. Only keep my approvals and the
 * delegation."
 *
 * Migration 043 lets the Security Head be a `guard` account and 046 lets an HOD
 * hold an office, and until now such a person KEPT every screen their role
 * gave them — so the Security Head could clear material at the barrier and an
 * approver who was an HOD could raise the very passes they sign. Those are two
 * halves of one decision sitting in one pair of hands, which is exactly what an
 * approval ladder exists to prevent, and it is what the client stopped.
 *
 * ADMIN AND SUPER ADMIN ARE DELIBERATELY EXEMPT. Nothing in the schema forbids
 * designating an admin to an office (049 only forbids holding two), and an
 * admin who lost `/admin` to a designation would be locked out of the only
 * screen that could undo it — a one-way door with no key. The four offices are
 * created as VMS `staff` by `admin_create_user`, so this exemption should never
 * fire in practice; it exists so that a mistake stays recoverable.
 */
function officeReplacesRole(role: UserRole | null, isApprover: boolean): boolean {
  if (!isApprover) return false;
  return role !== 'admin' && role !== 'super_admin';
}

export function isForbidden(
  pathname: string,
  role: UserRole | null,
  office: OfficeHeld = false,
): boolean {
  const isApprover = holdsOffice(office);
  if (role === null && !isApprover) return false; // still resolving; App renders a loader
  // The COO's and the CEO's two extra screens ride on BOTH arms: the office
  // replaces a `staff` holder's (empty) routes and adds to an admin's, and in
  // either case raising a pass is something the office grants, not the role.
  const raising = officeRaises(office) ? RAISING_OFFICE_ROUTES : [];
  const allowed = officeReplacesRole(role, isApprover)
    ? [...APPROVER_ROUTES, ...raising]
    : [
      ...(role ? ROLE_ROUTES[role] : []),
      ...(isApprover ? [...APPROVER_ROUTES, ...raising] : []),
    ];
  if (allowed.length === 0) return true;
  return !allowed.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** Where this reader lands. AN OFFICE HOLDER LANDS ON THEIR QUEUE, whatever
 *  their VMS role says (client, 2026-08-22) — it is now the whole of what they
 *  do here, so it is also the only home they can have. An admin keeps their
 *  own board, for the reason `officeReplacesRole` gives. */
export function homeFor(role: UserRole | null, office: OfficeHeld = false): string {
  const isApprover = holdsOffice(office);
  if (officeReplacesRole(role, isApprover)) return APPROVER_HOME;
  if (role && ROLE_ROUTES[role].length > 0) return ROLE_HOME[role];
  if (isApprover) return APPROVER_HOME;
  return role ? ROLE_HOME[role] : '/login';
}

/**
 * Whether a sidebar nav link should render as active for a given pathname.
 *
 * Exact match wins; a pathname also activates the link of any parent segment
 * (`/pass/<uuid>` activates `/pass`). A naive `startsWith(to)` is NOT used —
 * it would activate `/admin` for the pathname `/admin-dashboard` and light up
 * two sidebar links at once on the admin screens.
 */
export function isNavActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

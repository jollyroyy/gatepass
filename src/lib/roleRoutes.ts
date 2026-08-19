// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';

/**
 * What an APPROVAL OFFICE grants, on top of whatever the reader's role already
 * allows. Declared here rather than in `approverAccess.ts` so this module stays
 * import-free: it is the one thing route protection is verified against, and it
 * must not drag a live Supabase client into a test that only asks which paths a
 * role may reach. See `approverAccess.ts` for why an office is not a role.
 */
export const APPROVER_ROUTES: string[] = ['/approvals', '/pass', '/profile'];

/** Where an office holder with no other role in this app lands. */
export const APPROVER_HOME = '/approvals';

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate. THE ORDER OF THIS LIST IS THE ORDER OF THE SIDEBAR
  // (Sidebar.tsx sorts by it).
  // `/pending-out` and `/pending-returns` are the two lists the dashboard's
  // figures drill into (client, 2026-08-19) — each figure opens the page that
  // holds the very rows it counted.
  // `/console` is still routed but is NO LONGER A TAB (same client pass: the
  // search moved to the top right of both list pages, where a guard is already
  // standing). Verify's post-decision redirect still lands on it, and the
  // dashboard's Scan QR quick action still opens it.
  // `/overdue` is today's overdue material, the same page the HOD and the admin
  // get at their own scope. `/returns` is where a board's "due today" figure
  // navigates, on every role.
  guard: ['/guard-dashboard', '/pending-out', '/pending-returns', '/overdue', '/console', '/returns', '/verify', '/pass', '/profile'],
  // Department heads raise passes for their own departments
  // `/mismatch/:id` and `/expired/:id` are where the bell's two decision notices
  // land — the review screens that offer "void it" or "raise it again". HOD-only:
  // those decisions are the raising HOD's, and `hod_review_flagged_pass` /
  // `hod_void_expired_pass` refuse anyone else regardless of what this list says.
  hod: ['/dashboard', '/raise', '/my-passes', '/overdue', '/returns', '/mismatch', '/expired', '/pass', '/profile'],
  // Admin manages departments, users, and sees everything. THE ORDER OF THIS
  // LIST IS THE ORDER OF THE SIDEBAR (Sidebar.tsx sorts by it), so `/overdue`
  // sits second, straight under the board — client, 2026-08-18: "make the
  // overdue item the second tab in the admin view, keep the dashboard first".
  admin: ['/admin-dashboard', '/overdue', '/admin', '/all-passes', '/returns', '/pass', '/profile'],
  super_admin: ['/admin-dashboard', '/overdue', '/admin', '/all-passes', '/returns', '/pass', '/profile'],
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
 * True if this pathname is forbidden for this reader.
 *
 * `isApprover` is a SECOND, INDEPENDENT grant, not a role (see
 * `approverAccess.ts`): migration 043 lets the Security Head be a `guard`
 * account, so an office is added to whatever the role already allows rather
 * than replacing it. A `staff` account with an office therefore reaches
 * `/approvals` and nothing else, and a guard who holds one keeps every gate
 * screen and gains the queue.
 */
export function isForbidden(
  pathname: string,
  role: UserRole | null,
  isApprover = false,
): boolean {
  if (role === null && !isApprover) return false; // still resolving; App renders a loader
  const allowed = [
    ...(role ? ROLE_ROUTES[role] : []),
    ...(isApprover ? APPROVER_ROUTES : []),
  ];
  if (allowed.length === 0) return true;
  return !allowed.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** Where this reader lands. Their ROLE's home wins when they have one — an
 *  office is an extra errand, not a new job — and the approvals queue is home
 *  only for someone whose role gives them nowhere else to be. */
export function homeFor(role: UserRole | null, isApprover = false): string {
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

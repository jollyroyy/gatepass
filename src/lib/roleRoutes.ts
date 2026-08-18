// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate.
  // `/overdue` is the guard's third tab (2026-08-18) — today's overdue material,
  // the same page the HOD and the admin get at their own scope. `/returns` is
  // still routed but is no longer a tab: it is where the boards' "due today"
  // figures navigate, on every role.
  guard: ['/guard-dashboard', '/console', '/overdue', '/returns', '/verify', '/pass', '/profile'],
  // Department heads raise passes for their own departments
  // `/mismatch/:id` and `/expired/:id` are where the bell's two decision notices
  // land — the review screens that offer "void it" or "raise it again". HOD-only:
  // those decisions are the raising HOD's, and `hod_review_flagged_pass` /
  // `hod_void_expired_pass` refuse anyone else regardless of what this list says.
  hod: ['/dashboard', '/raise', '/my-passes', '/overdue', '/returns', '/mismatch', '/expired', '/pass', '/profile'],
  // Admin manages departments, users, and sees everything
  admin: ['/admin-dashboard', '/admin', '/all-passes', '/overdue', '/returns', '/pass', '/profile'],
  super_admin: ['/admin-dashboard', '/admin', '/all-passes', '/overdue', '/returns', '/pass', '/profile'],
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

/** True if this pathname is forbidden for this role. */
export function isForbidden(pathname: string, role: UserRole | null): boolean {
  if (role === null) return false; // still resolving; App renders a loader
  const allowed = ROLE_ROUTES[role];
  if (!allowed || allowed.length === 0) return true;
  return !allowed.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function homeFor(role: UserRole | null): string {
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

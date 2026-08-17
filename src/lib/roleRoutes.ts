// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate
  // `/history` retired. Pending Returns is its own tab again (2026-08-08):
  // everything still out, all-time, with per-line and Return All actions.
  guard: ['/guard-dashboard', '/returns', '/console', '/verify', '/pass', '/profile'],
  // Department heads raise passes for their own departments
  // `/mismatch/:id` is where a mismatch notification lands — the review screen
  // that offers "reject permanently" or "raise it again". HOD-only: the two
  // decisions on it are the raising HOD's, and `hod_review_flagged_pass` refuses
  // anyone else regardless of what this list says.
  hod: ['/dashboard', '/raise', '/my-passes', '/mismatch', '/pass', '/profile'],
  // Admin manages departments, users, and sees everything
  admin: ['/admin-dashboard', '/admin', '/all-passes', '/pass', '/profile'],
  super_admin: ['/admin-dashboard', '/admin', '/all-passes', '/pass', '/profile'],
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
 * The guard lands on the KPI board too. The console is still where the shift is
 * spent, but it shows only the pending queue — Expired, Awaiting Return and
 * Overdue appear nowhere else in the guard's UI, and `mark_returned` is
 * reachable only from a dashboard drill. Landing on the queue meant those were
 * seen only if someone thought to click across.
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

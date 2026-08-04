// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate
  // `/returns` and `/history` retired. Pending Returns folded into the guard
  // dashboard, which carries both its KPIs and the Mark Returned action;
  // Verification History was removed with its sidebar tab.
  guard: ['/guard-dashboard', '/console', '/verify', '/pass', '/profile'],
  // Department heads raise passes for their own departments
  hod: ['/dashboard', '/raise', '/my-passes', '/vendors', '/pass', '/profile'],
  // Admin manages departments, users, and sees everything
  admin: ['/admin', '/admin-dashboard', '/all-passes', '/pass', '/profile'],
  super_admin: ['/admin', '/admin-dashboard', '/all-passes', '/pass', '/profile'],
  // Staff have no business in this app at all.
  staff: [],
};

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<UserRole, string> = {
  guard: '/console',
  hod: '/dashboard',
  admin: '/admin',
  super_admin: '/admin',
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
 * (`/raise/bulk` activates `/raise`). A naive `startsWith(to)` is NOT used —
 * it would activate `/admin` for the pathname `/admin-dashboard` and light up
 * two sidebar links at once on the admin screens.
 */
export function isNavActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

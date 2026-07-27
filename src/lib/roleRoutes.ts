// Single source of truth for role-based route access.
// Imported by App.tsx (enforcement) and tests/security/routeProtection.test.ts
// (verification). NEVER duplicate this list in application code — import it.
//
// This is defence in depth, not the security boundary. RLS in the database is the
// authority; this only stops a wrong-role user seeing a broken screen.
import type { UserRole } from '../types/index';

export const ROLE_ROUTES: Record<UserRole, string[]> = {
  // Security at the gate
  guard: ['/console', '/verify', '/returns', '/history', '/pass'],
  // Department heads raise passes for their own departments
  hod: ['/dashboard', '/raise', '/my-passes', '/analytics', '/pass'],
  // Admin manages departments, users, and sees everything
  admin: ['/admin', '/all-passes', '/pass'],
  super_admin: ['/admin', '/all-passes', '/pass'],
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

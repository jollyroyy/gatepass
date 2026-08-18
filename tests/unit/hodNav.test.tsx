// Pins the HOD navigation surface after the Vendors (`/vendors`) and Bulk
// Create (`/raise/bulk`) tabs were removed from the HOD sidebar, so neither
// can silently come back via a stray sidebar entry, a re-added ROLE_ROUTES
// segment, or a route guard regression.
import { describe, it, expect } from 'vitest';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES, isForbidden } from '../../src/lib/roleRoutes';

describe('HOD sidebar navigation', () => {
  // Overdue Items joined the list on 2026-08-18 — the same page the guard and
  // the admin get, narrowed to this HOD's own passes.
  it('shows exactly Dashboard, Raise Gate Pass, My Passes and Overdue Items, in that order', () => {
    const hodLabels = ALL_LINKS.filter((n) => n.roles.includes('hod')).map((n) => n.label);
    expect(hodLabels).toEqual(['Dashboard', 'Raise Gate Pass', 'My Passes', 'Overdue Items']);
  });

  it('has no HOD nav link pointing at /vendors', () => {
    const hasVendorsLink = ALL_LINKS.some((n) => n.roles.includes('hod') && n.to === '/vendors');
    expect(hasVendorsLink).toBe(false);
  });

  it('has no HOD nav link pointing at /raise/bulk', () => {
    const hasBulkLink = ALL_LINKS.some((n) => n.roles.includes('hod') && n.to === '/raise/bulk');
    expect(hasBulkLink).toBe(false);
  });

  it('has no nav link anywhere, for any role, labelled Vendors or Bulk Create', () => {
    // These labels were HOD-only, so if they survive at all they must not have
    // been silently reassigned to another role's sidebar.
    const strayLabels = ALL_LINKS.filter((n) => n.label === 'Vendors' || n.label === 'Bulk Create');
    expect(strayLabels).toEqual([]);
  });

  it('does not list /vendors among the HOD role routes', () => {
    expect(ROLE_ROUTES.hod).not.toContain('/vendors');
  });

  it('forbids an HOD from navigating to /vendors', () => {
    expect(isForbidden('/vendors', 'hod')).toBe(true);
  });

  it('still permits the HOD routes that remain', () => {
    const remaining = ['/dashboard', '/raise', '/my-passes', '/profile'];
    for (const path of remaining) {
      expect(isForbidden(path, 'hod')).toBe(false);
    }
  });

  it('does not forbid /raise/bulk for an HOD, even though the page is gone', () => {
    // ROLE_ROUTES.hod still contains '/raise', and isForbidden() matches on
    // parent segments (see roleRoutes.ts), so '/raise/bulk' stays permitted
    // by the guard even though the Bulk Create page and its <Route> were
    // deleted. React Router then falls through to the catch-all `path="*"`
    // route, which redirects to the role's home. The route guard is
    // deliberately NOT what removes Bulk Create — the deleted route is.
    expect(isForbidden('/raise/bulk', 'hod')).toBe(false);
  });
});

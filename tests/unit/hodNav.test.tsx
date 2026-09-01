// Pins the HOD navigation surface after the Vendors (`/vendors`) and Bulk
// Create (`/raise/bulk`) tabs were removed from the HOD sidebar, so neither
// can silently come back via a stray sidebar entry, a re-added ROLE_ROUTES
// segment, or a route guard regression.
import { describe, it, expect } from 'vitest';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES, isForbidden } from '../../src/lib/roleRoutes';

describe('HOD sidebar navigation', () => {
  // Overdue Items joined the list on 2026-08-18 and left it on 2026-08-23
  // ("remove ... the tab name from the left-hand side panel"). The page is
  // unchanged and still narrowed to this HOD's own passes; the dashboard's
  // Overdue card is the door to it.
  it('shows exactly Dashboard, Pending for My Approval, Pass Raisers and Reports, in that order', () => {
    // Raise Gate Pass was a tab until 2026-08-20; the client removed it, and
    // the dashboard's Quick Action tile is now the only way into the form.
    // Reports was ADDED the same day — the HOD's own copy of the admin's
    // report screen, scoped to their own department by RLS (see
    // src/pages/HOD/HodReports.tsx).
    const hodLabels = ALL_LINKS.filter((n) => n.roles.includes('hod')).map((n) => n.label);
    // MY PASSES IS GONE (client, 2026-08-23: "remove my passes"). The page,
    // its route and its sidebar tab went together; the HOD's own register is
    // Reports, and the dashboard's figures open the rows they counted.
    // TWO TABS ARRIVED WITH MIGRATION 077 (client, 2026-09-01: "the HOD of all
    // the departments should be able to delegate the pass creation capabilities
    // in his left-hand side panel"). Pass Raisers is where that delegation is
    // written and revoked; Pending for My Approval is the queue the passes it
    // produces wait in, because such a pass carries a level-0 rung addressed to
    // this department's HODs. Neither is Raise Gate Pass, which is still not a
    // tab — the dashboard tile is still the only way into the form.
    expect(hodLabels).toEqual(['Dashboard', 'Pending for My Approval', 'Pass Raisers', 'Reports']);
  });

  it('has no nav link anywhere pointing at /my-passes', () => {
    expect(ALL_LINKS.some((n) => n.to === '/my-passes')).toBe(false);
    expect(ALL_LINKS.some((n) => n.label === 'My Passes')).toBe(false);
  });

  it('does not list /my-passes among the HOD role routes, and forbids it', () => {
    expect(ROLE_ROUTES.hod).not.toContain('/my-passes');
    expect(isForbidden('/my-passes', 'hod')).toBe(true);
  });

  it('has no nav link anywhere pointing at /raise', () => {
    expect(ALL_LINKS.some((n) => n.to === '/raise')).toBe(false);
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
    const remaining = ['/dashboard', '/raise', '/reports', '/profile'];
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

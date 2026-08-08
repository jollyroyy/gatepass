// src/lib/roleRoutes.ts is the single source of truth for route access —
// defence in depth, not the security boundary (RLS is). Its header comment
// promises a test at tests/security/routeProtection.test.ts; that path
// doesn't exist yet, so this suite lives here instead until it does.
import { describe, it, expect } from 'vitest';
import { ROLE_ROUTES, ROLE_HOME, isForbidden, homeFor, isNavActive } from '../../src/lib/roleRoutes';
import type { UserRole } from '../../src/types';

const ALL_ROLES = Object.keys(ROLE_ROUTES) as UserRole[];

describe('isForbidden — a role may reach every path in its own list', () => {
  for (const role of ALL_ROLES) {
    for (const base of ROLE_ROUTES[role]) {
      it(`${role} may reach ${base}`, () => {
        expect(isForbidden(base, role)).toBe(false);
      });

      it(`${role} may reach a nested child of ${base}`, () => {
        // e.g. '/pass/abc-123' for a guard, '/verify/xyz' — detail routes
        // hang off the base path and must not be blocked by it.
        expect(isForbidden(`${base}/some-id-123`, role)).toBe(false);
      });
    }
  }
});

describe('isForbidden — cross-role denial, driven from the map itself', () => {
  // Every path that appears in ANY role's list. Looping over this (rather
  // than hand-written cases) means a future edit to ROLE_ROUTES is checked
  // automatically instead of silently going untested.
  const allPaths = Array.from(new Set(ALL_ROLES.flatMap((r) => ROLE_ROUTES[r])));

  for (const role of ALL_ROLES) {
    for (const path of allPaths) {
      const owns = ROLE_ROUTES[role].includes(path);
      it(`isForbidden(${path}, ${role}) is ${!owns} (owns: ${owns})`, () => {
        expect(isForbidden(path, role)).toBe(!owns);
      });
    }
  }
});

describe('staff', () => {
  it('has an empty route list', () => {
    expect(ROLE_ROUTES.staff).toEqual([]);
  });

  it('is forbidden every known path', () => {
    const allPaths = Array.from(new Set(ALL_ROLES.flatMap((r) => ROLE_ROUTES[r])));
    for (const path of allPaths) {
      expect(isForbidden(path, 'staff')).toBe(true);
    }
  });
});

describe('isForbidden — null role', () => {
  it('is never forbidden while the role is still resolving (App.tsx renders a loader instead)', () => {
    const allPaths = Array.from(new Set(ALL_ROLES.flatMap((r) => ROLE_ROUTES[r])));
    for (const path of [...allPaths, '/anything', '/']) {
      expect(isForbidden(path, null)).toBe(false);
    }
  });
});

describe('isForbidden — prefix boundary', () => {
  it('does not treat a path that merely starts with an allowed prefix as allowed', () => {
    // Guards against a naive `startsWith` bug: '/console' is allowed for a
    // guard, but '/consolexyz' is a different route entirely and must still
    // be blocked.
    expect(isForbidden('/console', 'guard')).toBe(false);
    expect(isForbidden('/consolexyz', 'guard')).toBe(true);
  });
});

describe('isNavActive — the sidebar lights up exactly one admin link', () => {
  it('exact match activates its own link', () => {
    expect(isNavActive('/admin', '/admin')).toBe(true);
    expect(isNavActive('/admin-dashboard', '/admin-dashboard')).toBe(true);
  });

  it('does NOT activate /admin when on /admin-dashboard (the naive startsWith collision)', () => {
    expect(isNavActive('/admin-dashboard', '/admin')).toBe(false);
    expect(isNavActive('/admin', '/admin-dashboard')).toBe(false);
  });

  it('activates a parent link for a nested child route', () => {
    expect(isNavActive('/raise/bulk', '/raise')).toBe(true);
    expect(isNavActive('/pass/abc-123', '/pass')).toBe(true);
  });

  it('does not activate /raise/bulk when on /raise', () => {
    expect(isNavActive('/raise', '/raise/bulk')).toBe(false);
  });

  it('treats / as exact-match only', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/dashboard', '/')).toBe(false);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(isNavActive('/consolexyz', '/console')).toBe(false);
    expect(isNavActive('/all-passes', '/all')).toBe(false);
  });
});

describe('homeFor', () => {  for (const role of ALL_ROLES) {
    it(`returns ROLE_HOME for ${role}`, () => {
      expect(homeFor(role)).toBe(ROLE_HOME[role]);
    });
  }

  it('returns /login for a null role', () => {
    expect(homeFor(null)).toBe('/login');
  });

  // A role must never land on a page it is itself forbidden from — catches a
  // future edit to either ROLE_ROUTES or ROLE_HOME that drifts out of sync.
  // staff's home ('/no-access') is deliberately outside its (empty) route
  // list, so it is excluded here.
  for (const role of ALL_ROLES) {
    if (role === 'staff') continue;
    it(`${role}'s home page is itself permitted for ${role}`, () => {
      expect(isForbidden(ROLE_HOME[role], role)).toBe(false);
    });
  }
});

// An admin signing in must see the operational KPI board first, not the
// Departments & Users administration screen. Managing people is an occasional
// errand; the state of the gate is what an admin opens the app to check.
describe('admin lands on the KPI dashboard', () => {
  for (const role of ['admin', 'super_admin'] as const) {
    it(`${role} lands on /admin-dashboard, not /admin`, () => {
      expect(ROLE_HOME[role]).toBe('/admin-dashboard');
      expect(homeFor(role)).toBe('/admin-dashboard');
    });

    it(`${role} can still reach /admin directly`, () => {
      expect(isForbidden('/admin', role)).toBe(false);
    });

    // ROLE_ROUTES is documented as "first entry is the landing page"
    // (Profile.tsx relies on the same convention). Keep it true.
    it(`${role}'s route list leads with its landing page`, () => {
      expect(ROLE_ROUTES[role][0]).toBe(ROLE_HOME[role]);
    });
  }

  it('leaves the other roles landing where they were', () => {
    expect(ROLE_HOME.hod).toBe('/dashboard');
    expect(ROLE_HOME.staff).toBe('/no-access');
  });
});

// A guard signing in sees the KPI board first. The console is still one click
// away and is where they spend the shift, but the dashboard answers "what is
// waiting for me right now" — including the Expired, Awaiting Return and
// Overdue counts that exist nowhere else in the guard's UI.
describe('guard lands on the KPI dashboard', () => {
  it('lands on /guard-dashboard, not /console', () => {
    expect(ROLE_HOME.guard).toBe('/guard-dashboard');
    expect(homeFor('guard')).toBe('/guard-dashboard');
  });

  it('can still reach /console directly', () => {
    expect(isForbidden('/console', 'guard')).toBe(false);
  });

  // Same "first entry is the landing page" convention the admin rows pin.
  it('route list leads with its landing page', () => {
    expect(ROLE_ROUTES.guard[0]).toBe(ROLE_HOME.guard);
  });
});

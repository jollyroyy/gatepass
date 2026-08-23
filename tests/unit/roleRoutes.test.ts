// src/lib/roleRoutes.ts is the single source of truth for route access —
// defence in depth, not the security boundary (RLS is). Its header comment
// promises a test at tests/security/routeProtection.test.ts; that path
// doesn't exist yet, so this suite lives here instead until it does.
import { describe, it, expect } from 'vitest';
import { APPROVER_HOME, APPROVER_ROUTES, ROLE_ROUTES, ROLE_HOME, isForbidden, homeFor, isNavActive } from '../../src/lib/roleRoutes';
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


// ─────────────────────────────────────────────────────────────────────────────
// An APPROVAL OFFICE is a second, independent grant — not a role (migration
// 046, and src/lib/approverAccess.ts for the argument). `public.profiles.role`
// is VMS's enum and this app never adds to it, so an office holder's role
// really is `staff`; the row in `gatepass.approval_roles` is what lets them in.
//
// THIS BLOCK IS REWRITTEN (2026-08-22). It used to hold that an office is added
// to whatever the role already allows — "a guard who holds an office KEEPS
// every gate screen and gains the queue", and "the office does not move a
// working role's home — it is an extra errand". The client reversed both by
// name: "all those approvers … should not have any option to raise a gate pass
// or to see the status … I do see that the security head is able to do all the
// returns. This is a flag flag completely so please remove all the tabs. Only
// keep my approvals and the delegation."
// ─────────────────────────────────────────────────────────────────────────────
describe('an approval office REPLACES the role`s access', () => {
  it('a `staff` account with an office reaches the queue, and NOTHING else', () => {
    // Without this the one screen such an account exists to use is unreachable:
    // ROLE_ROUTES.staff is deliberately empty.
    expect(isForbidden('/approvals', 'staff', true)).toBe(false);
    expect(isForbidden('/delegation', 'staff', true)).toBe(false);
    expect(isForbidden('/pass/abc', 'staff', true)).toBe(false);
    expect(isForbidden('/dashboard', 'staff', true)).toBe(true);
    expect(isForbidden('/guard-dashboard', 'staff', true)).toBe(true);
    expect(isForbidden('/admin', 'staff', true)).toBe(true);
  });

  it('a `staff` account WITHOUT one still reaches nothing at all', () => {
    for (const path of [...APPROVER_ROUTES, '/dashboard', '/admin']) {
      expect(isForbidden(path, 'staff', false), path).toBe(true);
    }
  });

  it('a guard who holds an office LOSES every gate screen — including the returns', () => {
    // The client's own flag: migration 043 lets the Security Head be a guard
    // account, and until 2026-08-22 that person could clear material at the
    // barrier on the very passes they sign.
    for (const path of ['/guard-dashboard', '/overdue', '/console', '/returns', '/verify']) {
      expect(isForbidden(path, 'guard', true), path).toBe(true);
    }
    expect(isForbidden('/approvals', 'guard', true)).toBe(false);
    expect(isForbidden('/delegation', 'guard', true)).toBe(false);
    // …and a guard who holds none does not get it, nor lose anything.
    expect(isForbidden('/approvals', 'guard', false)).toBe(true);
    for (const path of ROLE_ROUTES.guard) {
      expect(isForbidden(path, 'guard', false), path).toBe(false);
    }
  });

  it('an HOD who holds an office can no longer raise a pass or read the register', () => {
    for (const path of ['/dashboard', '/raise', '/reports', '/overdue']) {
      expect(isForbidden(path, 'hod', true), path).toBe(true);
    }
    expect(isForbidden('/approvals', 'hod', true)).toBe(false);
  });

  it('an office holder`s home is their queue, whatever their VMS role says', () => {
    expect(homeFor('guard', true)).toBe(APPROVER_HOME);
    expect(homeFor('hod', true)).toBe(APPROVER_HOME);
    expect(homeFor('staff', true)).toBe(APPROVER_HOME);
    expect(homeFor(null, true)).toBe(APPROVER_HOME);
  });

  it('an ADMIN is exempt — a designation must never lock them out of /admin', () => {
    // Nothing in the schema forbids designating an admin to an office (049 only
    // forbids holding two), and the Users tab is the ONLY screen that can undo
    // one. Stripping it would be a one-way door with no key.
    for (const role of ['admin', 'super_admin'] as const) {
      for (const path of ROLE_ROUTES[role]) {
        expect(isForbidden(path, role, true), `${role} ${path}`).toBe(false);
      }
      expect(isForbidden('/approvals', role, true)).toBe(false);
      expect(homeFor(role, true)).toBe(ROLE_HOME[role]);
    }
  });

  it('every existing role is unchanged when no office is held', () => {
    // The default argument is what keeps every other caller honest.
    for (const role of ALL_ROLES) {
      for (const path of ROLE_ROUTES[role]) {
        expect(isForbidden(path, role), `${role} ${path}`).toBe(false);
      }
      if (ROLE_ROUTES[role].length > 0) expect(homeFor(role)).toBe(ROLE_HOME[role]);
    }
  });
});

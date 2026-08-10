// "Are all the links working?" — the audit nothing covered.
//
// tests/unit/roleRoutes.test.ts already proves ROLE_ROUTES is internally
// consistent with isForbidden/isNavActive. What it CANNOT see is whether a
// link in the sidebar corresponds to anything real. Three ways a nav link
// silently breaks, none of which any existing test catches:
//
//   1. the link points at a path App.tsx has no <Route> for  -> clicking it
//      lands on the NotFound page;
//   2. the link is shown to a role that ROLE_ROUTES forbids -> clicking it
//      bounces the user straight back, which reads as "the button is dead";
//   3. a route exists and is permitted, but no link reaches it -> the feature
//      is only findable by typing a URL.
//
// This reads the sources rather than rendering, because the failure is a
// mismatch BETWEEN three files (Sidebar.tsx, App.tsx, roleRoutes.ts) and no
// single component render can observe all three.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES, isForbidden } from '../../src/lib/roleRoutes';
import type { UserRole } from '../../src/types';

const appSrc = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8');

/** Every `path="..."` App.tsx declares, including the `*` catch-all. */
const declaredRoutes = new Set(
  [...appSrc.matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/g)].map((m) => m[1]),
);

/**
 * Does App.tsx serve this path? A declared route may be parameterised
 * (`/pass/:id`), so compare segment by segment and let a `:param` segment
 * match anything.
 */
function isServed(path: string): boolean {
  if (declaredRoutes.has(path)) return true;
  const want = path.split('/').filter(Boolean);
  for (const route of declaredRoutes) {
    if (route === '*') continue; // the catch-all is NotFound — it serves nothing
    const have = route.split('/').filter(Boolean);
    if (have.length !== want.length) continue;
    if (have.every((seg, i) => seg.startsWith(':') || seg === want[i])) return true;
  }
  return false;
}

describe('every sidebar link goes somewhere real', () => {
  it.each(ALL_LINKS.map((l) => [l.label, l.to] as const))(
    '"%s" (%s) has a matching <Route> in App.tsx',
    (_label, to) => {
      expect(isServed(to), `no <Route> serves ${to} — this link lands on NotFound`).toBe(true);
    },
  );

  it.each(
    ALL_LINKS.flatMap((l) => l.roles.map((r) => [l.label, l.to, r] as const)),
  )('"%s" (%s) is actually permitted for %s', (_label, to, role) => {
    expect(
      isForbidden(to, role as UserRole),
      `${role} is shown "${_label}" but ROLE_ROUTES forbids ${to} — clicking it bounces`,
    ).toBe(false);
  });
});

describe('every permitted route is reachable without typing a URL', () => {
  // Deliberately NOT a blanket assertion. Several paths are legitimately
  // link-less: detail pages reached by clicking a row, the print sheet opened
  // from a pass, the profile page reached from the sidebar's profile block
  // rather than a nav link, and the forced password-change gate. Anything else
  // with no link is a feature nobody can find.
  const REACHED_WITHOUT_A_NAV_LINK = new Set([
    '/pass',            // opened by clicking a pass row
    '/verify',          // opened from the gate queue
    '/print',           // opened from a pass
    '/profile',         // the sidebar profile block, not a nav link
    '/reset-password',  // arrives from an email link
  ]);

  const linked = new Set(ALL_LINKS.map((l) => l.to));

  const orphans = Object.entries(ROLE_ROUTES).flatMap(([role, paths]) =>
    (paths as string[])
      .filter((p) => !linked.has(p) && !REACHED_WITHOUT_A_NAV_LINK.has(p))
      .map((p) => `${role}: ${p}`),
  );

  it('no role has a permitted route with no way to reach it', () => {
    expect(orphans, `permitted but unreachable: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('no link is shown to a role that has no routes at all', () => {
  it('staff (no access) is offered nothing', () => {
    const shownToStaff = ALL_LINKS.filter((l) => (l.roles as string[]).includes('staff'));
    expect(shownToStaff.map((l) => l.label)).toEqual([]);
  });
});

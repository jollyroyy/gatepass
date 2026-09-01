// WHAT AN HOD'S AUTHORISED RAISER MAY REACH, AND WHAT THE HOD GAINED (077).
//
// Route protection is UX defence in depth and never the security boundary —
// `raise_pass` admits a raiser for the ONE department their HOD named whatever
// this list says, and RLS shows them no pass but their own. What this file pins
// is the other failure: a screen offered to somebody the database will refuse,
// or a screen withheld from somebody who needs it.
import { describe, it, expect } from 'vitest';
import {
  homeFor,
  isForbidden,
  RAISER_HOME,
  RAISER_ROUTES,
  ROLE_ROUTES,
} from '../../src/lib/roleRoutes';

// The ordinary shape of such an account: VMS `staff` — the role for "does not
// use VMS" — with no approval office. The grant is the whole of their access.
const STAFF = 'staff' as const;

describe('a raiser reaches the form, the register and nothing else', () => {
  it.each(RAISER_ROUTES)('admits %s', (path) => {
    expect(isForbidden(path, STAFF, false, true)).toBe(false);
  });

  it.each([
    '/dashboard',
    '/reports',
    '/overdue',
    '/returns',
    '/raisers',
    '/approvals',
    '/delegation',
    '/admin',
    '/guard-dashboard',
    '/verify/abc',
  ])('still forbids %s', (path) => {
    expect(isForbidden(path, STAFF, false, true)).toBe(true);
  });

  it('admits the sub-paths of what it admits, and only those', () => {
    expect(isForbidden('/pass/8ac1f0e2-0000-4000-8000-000000000000', STAFF, false, true)).toBe(false);
    expect(isForbidden('/pass/8ac1f0e2-0000-4000-8000-000000000000/print', STAFF, false, true)).toBe(false);
    expect(isForbidden('/dashboard/pending', STAFF, false, true)).toBe(true);
  });

  it('lands them on the form — raising is what the account exists for', () => {
    expect(homeFor(STAFF, false, true)).toBe(RAISER_HOME);
    expect(RAISER_HOME).toBe('/raise');
  });
});

describe('without the grant, nothing about the account has changed', () => {
  it('leaves a plain staff account with no access at all', () => {
    for (const path of RAISER_ROUTES) {
      expect(isForbidden(path, STAFF)).toBe(true);
    }
  });

  it('does not touch what a guard or an admin may reach', () => {
    expect(isForbidden('/guard-dashboard', 'guard')).toBe(false);
    expect(isForbidden('/raise', 'guard')).toBe(true);
    expect(isForbidden('/admin', 'admin')).toBe(false);
  });

  it('AN OFFICE STILL REPLACES EVERYTHING, grant included', () => {
    // The two cannot be held at once — `create_pass_raiser` refuses an office
    // holder and a live delegate outright — and if the database is ever wrong
    // about that, the narrow answer is the safe one.
    expect(isForbidden('/approvals', STAFF, 'security_head', true)).toBe(false);
    expect(isForbidden('/raise', STAFF, 'security_head', true)).toBe(true);
    expect(isForbidden('/my-passes', STAFF, 'security_head', true)).toBe(true);
    // …and the COO's own raise screens are still the COO's.
    expect(isForbidden('/raise', STAFF, 'coo', false)).toBe(false);
  });
});

describe('what the HOD gained', () => {
  it('routes the two new screens, in sidebar order', () => {
    // The order of this list IS the order of the sidebar (Sidebar.tsx sorts by
    // it): the board first, then the queue that can hold up their department's
    // material, then where the authority is written.
    expect(ROLE_ROUTES.hod.slice(0, 4)).toEqual(['/dashboard', '/approvals', '/raise', '/raisers']);
  });

  it('admits every HOD to the queue, not only one who has authorised somebody', () => {
    // Any active HOD of the department may sign the level-0 rung
    // (`heads_pass_department`, 077), so the colleague covering an absence must
    // be able to reach it. The page and RLS both show them an empty queue when
    // there is nothing waiting.
    expect(isForbidden('/approvals', 'hod')).toBe(false);
    expect(isForbidden('/raisers', 'hod')).toBe(false);
  });

  it('gives it to nobody else', () => {
    expect(isForbidden('/raisers', 'guard')).toBe(true);
    expect(isForbidden('/raisers', 'admin')).toBe(true);
    expect(isForbidden('/raisers', STAFF, false, true)).toBe(true);
  });
});

// A DEEP LINK SURVIVES THE SIGN-IN (client, 2026-08-20: the approval emails
// carry Approve and Reject buttons, and "once it is clicked on any of those
// links, it should directly open up the portal … of course it will ask for the
// username and password").
//
// Until now every unauthenticated request was answered with a bare
// `<Navigate to="/login">`, which threw the destination away: an approver who
// pressed Approve in their inbox signed in and landed on their queue with no
// idea which of the passes there was the one they had just been asked about.
// The attempted path is carried across the sign-in on `?next=`.
//
// THE PARAMETER IS UNTRUSTED — it comes off the URL bar and is therefore
// attacker-supplied. `nextAfterLogin` accepts a SAME-DOCUMENT path only: one
// leading slash, no second one (`//evil.example` is a protocol-relative URL and
// a real open redirect), no backslash (browsers normalise `\` to `/`), and no
// scheme. Anything else degrades to null and the reader lands on their own home
// — a lost destination is a nuisance, an open redirect is a phishing tool.
import { describe, it, expect } from 'vitest';
import { isResumableTarget, loginPathFor, nextAfterLogin } from '../../src/lib/postLoginRedirect';
import { ROLE_HOME, ROLE_ROUTES } from '../../src/lib/roleRoutes';

describe('loginPathFor', () => {
  it('carries the attempted path and its query', () => {
    expect(loginPathFor('/pass/abc', '?decide=approve'))
      .toBe('/login?next=%2Fpass%2Fabc%3Fdecide%3Dapprove');
  });

  it('adds nothing for the root or for the login page itself', () => {
    expect(loginPathFor('/', '')).toBe('/login');
    expect(loginPathFor('/login', '?next=%2Fpass%2Fabc')).toBe('/login');
  });
});

describe('nextAfterLogin', () => {
  it('gives back the path it was handed', () => {
    expect(nextAfterLogin('?next=%2Fpass%2Fabc%3Fdecide%3Dreject')).toBe('/pass/abc?decide=reject');
  });

  it('refuses a protocol-relative URL, an absolute one, and a backslash', () => {
    expect(nextAfterLogin('?next=%2F%2Fevil.example%2Fx')).toBeNull();
    expect(nextAfterLogin('?next=https%3A%2F%2Fevil.example')).toBeNull();
    expect(nextAfterLogin('?next=%5C%5Cevil.example')).toBeNull();
  });

  it('refuses a path that is not a path, and an absent one', () => {
    expect(nextAfterLogin('?next=pass%2Fabc')).toBeNull();
    expect(nextAfterLogin('')).toBeNull();
  });

  it('never sends anybody back to the login page', () => {
    expect(nextAfterLogin('?next=%2Flogin')).toBeNull();
  });
});

// SIGNING IN LANDS ON THE DASHBOARD, ALWAYS (client, 2026-08-23: "when I'm
// logging in as the HOD of any department it should always open up the page of
// the dashboard … for any of the views, not only the HOD").
//
// `?next=` exists for ONE thing: the approval mails' Approve and Reject
// buttons, which open a pass record. Every other path got carried across the
// sign-in too — a session that expired on Reports sent the reader back to
// Reports — which is exactly what the client stopped. So a resumable target is
// the pass record and nothing else; anything else falls back to `homeFor`.
describe('isResumableTarget', () => {
  it('resumes the emailed pass record', () => {
    expect(isResumableTarget('/pass/abc')).toBe(true);
    expect(isResumableTarget('/pass')).toBe(true);
  });

  it('does not resume any other screen — the reader lands on their board', () => {
    for (const path of ['/reports', '/overdue', '/returns', '/admin', '/console', '/approvals']) {
      expect(isResumableTarget(path), path).toBe(false);
    }
  });
});

describe('every role with screens lands on its own dashboard', () => {
  it('is the first route in its list, and is named a dashboard', () => {
    for (const role of ['guard', 'hod', 'admin', 'super_admin'] as const) {
      expect(ROLE_HOME[role]).toBe(ROLE_ROUTES[role][0]);
      expect(ROLE_HOME[role], role).toMatch(/dashboard/);
    }
  });
});

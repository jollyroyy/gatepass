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
import { loginPathFor, nextAfterLogin } from '../../src/lib/postLoginRedirect';

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

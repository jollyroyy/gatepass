// WHERE A DEEP LINK GOES WHILE SOMEBODY SIGNS IN (client, 2026-08-20).
//
// The approval emails carry Approve and Reject buttons that open the pass
// record itself. The reader is usually signed out — it is their phone, days
// later — so App answers with the login screen; and until this module existed
// that answer was a bare `<Navigate to="/login">`, which threw the destination
// away. They signed in and landed on their own home page with no idea which
// pass they had been asked about.
//
// So the attempted path travels across the sign-in on `?next=`, and App's
// `/login` route reads it back once a session exists.
//
// ⚠ `next` IS ATTACKER-SUPPLIED. It is a query parameter, so anybody can put
// anything in it and mail the result. `nextAfterLogin` therefore accepts a
// SAME-DOCUMENT path and nothing else:
//   * one leading slash and no second one — `//evil.example/x` is a
//     protocol-relative URL and would be a textbook open redirect;
//   * no backslash — browsers normalise `\` to `/`, so `\evil.example` is the
//     same attack wearing a different coat;
//   * no scheme, which the leading-slash rule already refuses.
// Anything else degrades to null and the reader lands on their own home. A lost
// destination is a nuisance; an open redirect out of a login page is a phishing
// tool with this app's name on it.
//
// ROUTE ACCESS IS STILL DECIDED BY `isForbidden` AT THE CALL SITE, and RLS
// behind that. This module answers "is this a path in this app", never "may
// this person go there".

/** `/login`, carrying the path that was asked for. Nothing is carried for the
 *  root or for the login page itself — the first is where everybody lands
 *  anyway, and the second would round-trip. */
export function loginPathFor(pathname: string, search: string): string {
  if (!pathname || pathname === '/' || pathname === '/login') return '/login';
  return `/login?next=${encodeURIComponent(`${pathname}${search || ''}`)}`;
}

/** The path to resume after a successful sign-in, or null. */
export function nextAfterLogin(search: string): string | null {
  const raw = new URLSearchParams(search || '').get('next');
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  const path = raw.split('?')[0].split('#')[0];
  if (path === '/login') return null;
  return raw;
}

/** The pathname half of a `next`, which is what `isForbidden` grades. */
export function pathnameOf(target: string): string {
  return target.split('?')[0].split('#')[0];
}

/**
 * WHETHER A `next=` IS WORTH RESUMING AT ALL (client, 2026-08-23: "when I'm
 * logging in as the HOD of any department it should always open up the page of
 * the dashboard … for any of the views, not only the HOD").
 *
 * `?next=` was built for ONE journey: the approval mails' Approve and Reject
 * buttons, which open a pass record. But `loginPathFor` stamps the parameter on
 * EVERY unauthenticated request, so a session that lapsed while somebody was on
 * Reports sent them back to Reports after signing in — never to their board.
 * That is what this narrows: the pass record resumes, everything else falls
 * back to `homeFor`, which is each role's dashboard.
 *
 * Grade the PATHNAME (`pathnameOf`), never the raw target — the query string
 * carries `?decide=approve` and must not be matched against.
 */
const RESUMABLE_PREFIXES = ['/pass'] as const;

export function isResumableTarget(pathname: string): boolean {
  return RESUMABLE_PREFIXES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

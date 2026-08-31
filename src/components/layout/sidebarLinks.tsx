// THE SIDEBAR'S LINK TABLE, lifted out of Sidebar.tsx for the 300-line cap.
// It is data plus its icons and nothing else — Sidebar owns the filtering, the
// drawer and the profile block. Sidebar re-exports all three constants, so the
// import path a test or a page already uses keeps working.
import React from 'react';
import type { UserRole } from '../../types';

export type NavLink = { to: string; label: string; icon: React.ReactNode; roles: UserRole[] };

const ICON_PROPS = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.7 } as const;

/** The one tab an approval office grants (046). Kept out of ALL_LINKS because
 *  its `roles` array would have to be every role at once and then be filtered
 *  by something else entirely. */
export const APPROVER_LINK: NavLink = {
  to: '/approvals', label: 'Pending for My Approval', roles: [],
  icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l2.25 2.25 4.5-4.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75l7.5 3v5.25c0 4.06-3.1 7.44-7.5 8.25-4.4-.81-7.5-4.19-7.5-8.25V6.75l7.5-3z" /></svg>,
};

/** The second tab an approval office grants (062; client, 2026-08-22: "create a
 *  Delegation Tab for all the approvers"). It sits under Pending Approvals for
 *  the reason that one sits last: the queue is why an office holder opens the
 *  app, and delegating is an errand they run before leave. Kept out of
 *  ALL_LINKS for the same reason APPROVER_LINK is — `NavLink.roles` cannot
 *  express a grant that does not come from `profiles.role`. */
export const DELEGATION_LINK: NavLink = {
  to: '/delegation', label: 'Delegation', roles: [],
  icon: <svg {...ICON_PROPS}><circle cx="8" cy="8" r="3" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.75 19.5a5.25 5.25 0 0110.5 0" /><path strokeLinecap="round" strokeLinejoin="round" d="M14.5 9.75h6.75m0 0l-2.5-2.5m2.5 2.5l-2.5 2.5" /><circle cx="18" cy="17.5" r="2.5" /></svg>,
};

/** THE TWO TABS THE COO AND THE CEO GET ON TOP OF THOSE (069; client,
 *  2026-08-31: "make sure CEO and COO has the ability to raise pass on behalf
 *  of any department in their logins"). Out of ALL_LINKS for the reason the
 *  other two are — the grant comes from `gatepass.approval_roles`, not from
 *  `profiles.role`, and `NavLink.roles` can only express the latter. Which
 *  offices get them is `RAISING_OFFICES` in roleRoutes.ts and is not restated
 *  here: this file is the label and the icon. */
export const OFFICE_RAISE_LINK: NavLink = {
  to: '/raise', label: 'Raise Gate Pass', roles: [],
  icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>,
};

export const OFFICE_PASSES_LINK: NavLink = {
  to: '/my-passes', label: 'Passes I Raised', roles: [],
  icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75h7.5l4.5 4.5v11.25a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5V5.25a1.5 1.5 0 011.5-1.5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14.25 3.75V8.25h4.5M8.25 12.75h7.5M8.25 16.5h4.5" /></svg>,
};

export const ALL_LINKS: NavLink[] = [
  {
    to: '/dashboard', label: 'Dashboard', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
  },
  // RAISE GATE PASS IS NOT A TAB (client, 2026-08-20). The form is opened by
  // the dashboard's own Raise Gate Pass tile, which is where an HOD already
  // is; `/raise` stays in ROLE_ROUTES.hod, so the route, the `?type=` deep
  // link and the re-raise flow are untouched.
  // MY PASSES IS NOT A TAB, AND NOT A PAGE (client, 2026-08-23: "remove my
  // passes"). The register went with it: Reports is the HOD's own list of
  // everything they raised, and each dashboard figure opens the very rows it
  // counted. `/my-passes` is out of ROLE_ROUTES too, so the path is forbidden
  // rather than merely unlinked.
  {
    to: '/guard-dashboard', label: 'Dashboard', roles: ['guard'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
  },
  // PENDING OUT AND PENDING RGP RETURN ARE NOT TABS (client, 2026-08-22).
  // Both lists live on the guard's dashboard now and are opened by pressing the
  // figure that counts them — "there is no need to keep a separate tab … that
  // would only show when the KPI cards have been drilled down". The routes are
  // gone too, so there is nothing here to link to. Search Pass is not a tab
  // either (2026-08-19): the search sits on the dashboard beside Scan QR.
  // OVERDUE ITEMS IS NOT A TAB EITHER (client, 2026-08-23: "remove the overdue
  // items ... the tab name from the left-hand side panel"). `/overdue` is still
  // the page it always was and is still in every one of those roles'
  // `ROLE_ROUTES`; the HOD dashboard's Overdue card is what opens it now.
  // KNOWN COST, flagged to the client: the guard and the admin have no link to
  // it left — their boards count overdue material but drill in place.
  {
    to: '/admin-dashboard', label: 'Dashboard', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5L8.25 8.25l4.5 4.5 6-6L21 9M8.25 8.25V6.75a1.5 1.5 0 011.5-1.5h.75M21 9l-1.5-1.5m3 6.75v4.5a1.5 1.5 0 01-1.5 1.5h-15a1.5 1.5 0 01-1.5-1.5v-4.5" /></svg>,
  },
  {
    // SETTINGS IS WHERE DEPARTMENTS AND USERS LIVE (client, 2026-08-20: "push
    // the department and users under the admin tab to settings on the left-hand
    // side"). The ROUTE is unchanged — `/admin` is still the tab shell holding
    // Departments · Users · Whitelist · Settings — and only the name the
    // sidebar gives it moved, so every deep link and every Quick Action tile
    // still lands where it did.
    to: '/admin', label: 'Settings', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
  {
    to: '/all-passes', label: 'Reports', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><rect x="3" y="4.5" width="18" height="15" rx="1.5" /><path strokeLinecap="round" d="M3 9.75h18M9 9.75V19.5" /></svg>,
  },
  {
    // Every recorded event, across every pass. Admin only, because it reads the
    // whole site — an HOD's own passes already carry their timelines.
    to: '/activity', label: 'Activity Log', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 1.5" /></svg>,
  },
  {
    // The HOD's own copy of the admin's report screen (client, 2026-08-20),
    // scoped to their own department by RLS — see HodReports.tsx. A different
    // route from the admin's `/all-passes` on purpose: the two screens are
    // reached by different roles from different sidebars and must never be
    // confused by a shared URL.
    to: '/reports', label: 'Reports', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5h6l4.5 4.5v10.5a1.5 1.5 0 01-1.5 1.5h-9a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l2 2 4-4.5" /></svg>,
  },

];

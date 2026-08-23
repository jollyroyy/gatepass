import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';
import { isNavActive, ROLE_ROUTES } from '../../lib/roleRoutes';
import { fetchDisplayName } from '../../lib/profiles';
import { useTheme } from '../../lib/theme';
import SidebarProfile from './SidebarProfile';
import { ALL_LINKS, APPROVER_LINK, DELEGATION_LINK } from './sidebarLinks';
import { QuestMark, QuestLockup } from '../QuestMark';
import { useEscapeKey } from '../../lib/useEscapeKey';

// Re-exported: the link table moved to ./sidebarLinks for the file-size cap,
// and every existing importer names it through this module.
export { ALL_LINKS, APPROVER_LINK, DELEGATION_LINK } from './sidebarLinks';

type Props = {
  session: Session;
  role: UserRole | null;
  /** Holds one of the four approval offices (046). Not a role — see
   *  src/lib/approverAccess.ts — so it adds a tab rather than replacing the
   *  set: a guard who is Security Head keeps every gate tab and gains this one. */
  isApprover?: boolean;
  /** WHICH office, not merely whether one is held: the profile block at the
   *  foot of the sidebar prints its title in place of the VMS role. */
  office?: ApprovalRoleKey | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};


const COLLAPSE_KEY = 'gatepass-sidebar-collapsed';

export default function Sidebar({ session, role, isApprover = false, office = null, collapsed: collapsedProp, onCollapsedChange }: Props): React.ReactElement {
  const loc = useLocation();
  const { theme, toggleTheme } = useTheme();
  const email = session.user.email ?? 'User';
  // ORDER COMES FROM ROLE_ROUTES, not from the order of ALL_LINKS: `/overdue`
  // is one entry shared by three roles and cannot sit in the right place for
  // all of them at once. Sorting by the role's own route list puts each tab
  // where that role expects it — admin: Dashboard, Overdue Items, Departments
  // & Users, Reports (client, 2026-08-18). A link the list does not name sorts
  // last rather than first, so an unlisted tab can never displace the home
  // screen at the top.
  const order = role ? ROLE_ROUTES[role] : [];
  const rank = (to: string): number => {
    const i = order.indexOf(to);
    return i === -1 ? order.length : i;
  };
  const roleLinks = ALL_LINKS
    .filter((l) => role && l.roles.includes(role))
    .sort((a, b) => rank(a.to) - rank(b.to));
  // AN OFFICE HOLDER GETS EXACTLY TWO TABS AND NOTHING ELSE (client,
  // 2026-08-22: "remove all the tabs. Only keep my approvals and the
  // delegation"). This REVERSES the rule this block used to carry — that the
  // office tab sorts LAST behind a guard's or an HOD's own tabs, because "their
  // day job is the reason they open the app". Approving IS the job now: an
  // approver may not raise a pass, may not read the register, and may not clear
  // material at the barrier, which is the `officeReplacesRole` rule in
  // roleRoutes.ts made visible. The role's own links are DROPPED rather than
  // hidden, so the sidebar cannot offer a tab the route guard would bounce.
  //
  // An admin who holds an office keeps their own tabs and gains these two, for
  // the reason `officeReplacesRole` gives: their board is the only screen that
  // can undo a mistaken designation.
  const officeOnly = isApprover && role !== 'admin' && role !== 'super_admin';
  const links = officeOnly ? [] : roleLinks;
  if (isApprover) links.push(APPROVER_LINK, DELEGATION_LINK);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileName, setProfileName] = useState<string>('');
  const [collapsedInternal, setCollapsedInternal] = useState<boolean>(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const collapsed = collapsedProp ?? collapsedInternal;
  const setCollapsed = (next: boolean | ((c: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(collapsed) : next;
    setCollapsedInternal(value);
    onCollapsedChange?.(value);
  };
  const initials = profileName
    ? profileName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : (email.split('@')[0] ?? 'U').slice(0, 2).toUpperCase();

  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  useEscapeKey(() => setMobileOpen(false), mobileOpen);

  // Profile name — best effort; falls back to a name derived from the email.
  // Goes through gatepass.my_profile() — never public.profiles, whose policies
  // are VMS's and have recursed (see src/lib/profiles.ts).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const name = await fetchDisplayName(email);
      if (!cancelled) setProfileName(name);
    })();
    return () => { cancelled = true; };
  }, [session.user.id, email]);

  // Sidebar no longer displays count badges. Those are now shown as
  // top-right push notifications via NotificationBell.

  const navContent = (isCollapsed: boolean) => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <Link to="/" className={`flex items-center gap-3 px-4 pt-6 pb-7 shrink-0 group transition-all duration-300 ${isCollapsed ? 'justify-center px-2' : ''}`}>
        {isCollapsed ? (
          <QuestMark size={28} className="text-brand-200" />
        ) : (
          <QuestLockup tone="dark" size="md" subtitle="Gate Pass" />
        )}
      </Link>

      {/* Nav links */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-4">
        {links.map(({ to, label, icon }) => {
          const active = isNavActive(loc.pathname, to);
          return (
            <Link key={to} to={to} title={isCollapsed ? label : undefined}
              className={`sidebar-link px-3 py-2.5 ${isCollapsed ? 'justify-center !px-0' : ''} ${active ? 'sidebar-link-active' : ''}`}>
              <span className="shrink-0">{icon}</span>
              {!isCollapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </div>

      {/* Bottom: theme toggle + profile */}
      <div className="shrink-0 px-3 pb-5 space-y-2">
        <button type="button" onClick={toggleTheme} aria-label="Toggle theme"
          className={`sidebar-link w-full px-3 py-2.5 ${isCollapsed ? 'justify-center !px-0' : ''}`}>
          <span className="shrink-0">
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
            )}
          </span>
          {!isCollapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        <SidebarProfile role={role} office={office} isCollapsed={isCollapsed} profileName={profileName} initials={initials} />

        {/* The collapse control is NOT here. It lives on the sidebar's right
            edge (see the desktop <aside> below) so it reads as a handle on the
            panel itself rather than as another nav item. */}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger.
          `no-print` IS LOAD-BEARING, and its absence was a real bug (client,
          2026-08-21: "on the print page the Quest Malls logo is getting hidden
          under that sandwich bar icon"). This control is `fixed top-3.5 left-4`,
          which on paper is the top-left corner of the sheet — exactly where both
          the gate-pass slip and the report letterhead put the Quest lockup. The
          desktop sidebar below and the notification bell have carried the class
          since they landed; this one never did. The blanket `@media print` rule
          on `.fixed` in index.css now catches it a second way, so forgetting the
          class on a future control cannot reproduce this. */}
      <button type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open menu"
        className="no-print lg:hidden fixed top-3.5 left-4 z-50 h-9 w-9 rounded-xl flex items-center justify-center text-slate-200 shell-sidebar active:scale-95 transition-all">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
        </svg>
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] shell-sidebar animate-slide-down overflow-hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-150"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {navContent(false)}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className={`no-print hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40 shell-sidebar transition-[width] duration-300 ease-in-out ${collapsed ? 'w-[84px]' : 'w-[264px]'}`}>
        {navContent(collapsed)}

        {/* Collapse handle, straddling the panel's right edge.
            A tab on the border is self-explanatory in a way a labelled button in
            the nav list is not — it reads as "grab the panel", so no "Collapse"
            wording is needed. The arrow always points the way the panel will
            move: left to close, right to reopen.
            aria-label carries the meaning for screen readers, since the control
            is now icon-only. */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="sidebar-edge-toggle"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </aside>
    </>
  );
}

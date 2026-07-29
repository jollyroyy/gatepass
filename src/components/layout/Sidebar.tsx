import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import { fetchDisplayName } from '../../lib/profiles';
import { useTheme } from '../../lib/theme';
import SidebarProfile from './SidebarProfile';
import { QuestMark, QuestLockup } from '../QuestMark';

type Props = {
  session: Session;
  role: UserRole | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

type NavLink = { to: string; label: string; icon: React.ReactNode; roles: UserRole[] };

const ICON_PROPS = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.7 } as const;

const ALL_LINKS: NavLink[] = [
  {
    to: '/dashboard', label: 'Dashboard', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
  },
  {
    to: '/raise', label: 'Raise Gate Pass', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" d="M12 8.25v7.5M8.25 12h7.5" /></svg>,
  },
  {
    to: '/my-passes', label: 'My Passes', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V19.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 017 19.5V3.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14.5 3.75V8.25H19M9.5 12.75h5M9.5 15.75h5M9.5 18.75h3" /></svg>,
  },
  {
    to: '/raise/bulk', label: 'Bulk Create', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>,
  },
  {
    to: '/vendors', label: 'Vendors', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
  },
  {
    to: '/analytics', label: 'AI Analytics', roles: ['hod'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
  },
  {
    to: '/console', label: 'Gate Console', roles: ['guard'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
  },
  {
    to: '/returns', label: 'Pending Returns', roles: ['guard'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>,
  },
  {
    to: '/history', label: 'History', roles: ['guard'],
    icon: <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v5.25l3.5 2" /></svg>,
  },
  {
    to: '/admin', label: 'Departments & Users', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
  {
    to: '/all-passes', label: 'Reports', roles: ['admin', 'super_admin'],
    icon: <svg {...ICON_PROPS}><rect x="3" y="4.5" width="18" height="15" rx="1.5" /><path strokeLinecap="round" d="M3 9.75h18M9 9.75V19.5" /></svg>,
  },

];

const COLLAPSE_KEY = 'gatepass-sidebar-collapsed';

export default function Sidebar({ session, role, collapsed: collapsedProp, onCollapsedChange }: Props): React.ReactElement {
  const loc = useLocation();
  const { theme, toggleTheme } = useTheme();
  const email = session.user.email ?? 'User';
  const links = ALL_LINKS.filter((l) => role && l.roles.includes(role));
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
          const active = loc.pathname === to || (to !== '/' && loc.pathname.startsWith(to));
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

        <SidebarProfile role={role} isCollapsed={isCollapsed} profileName={profileName} initials={initials} />

        {/* The collapse control is NOT here. It lives on the sidebar's right
            edge (see the desktop <aside> below) so it reads as a handle on the
            panel itself rather than as another nav item. */}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open menu"
        className="lg:hidden fixed top-3.5 left-4 z-50 h-9 w-9 rounded-xl flex items-center justify-center text-slate-200 shell-sidebar active:scale-95 transition-all">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
        </svg>
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] shell-sidebar animate-slide-down overflow-hidden">
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

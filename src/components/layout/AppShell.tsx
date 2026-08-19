import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SessionTimeout from '../SessionTimeout';
import { NotificationProvider } from '../../lib/notifications';

type Props = {
  session: Session;
  role: UserRole | null;
  children: React.ReactNode;
};

const COLLAPSE_KEY = 'gatepass-sidebar-collapsed';

export default function AppShell({ session, role, children }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <NotificationProvider session={session} role={role}>
      <SessionTimeout />
      <div className="min-h-screen bg-surface-50">
        <Sidebar session={session} role={role} collapsed={collapsed} onCollapsedChange={setCollapsed} />

        <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-[84px]' : 'lg:pl-[264px]'}`}>
          {/* THE GUARD'S SHELL IS THE MOCK-UP'S SKIN, ON EVERY TAB.
              Client, 2026-08-19: the record that Approve OUT / Verify Return
              opens must read in "the same exact typographic colour as the
              dashboard's page", and every page in the guard's view must match.
              `.gb-main` (index.css) is that skin — white ground, Inter,
              near-black ink, the neutral ramp pinned light — and putting it
              HERE rather than on each page is what makes it true of Search
              Pass, Verify, Overdue Items and the pass record without any of
              them knowing about it. The three mock-up screens keep their own
              `.gb-board`, which sits inside this and repaints the same ground. */}
          <main
            className={`flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8 pb-8${
              role === 'guard' ? ' gb-main' : ''
            }`}
          >
            {children}
          </main>

          <footer className="no-print px-8 pb-6">
            <p className="text-center text-[11px] text-navy-300 tracking-wide">
              Quest Mall · Gate Pass
            </p>
          </footer>
        </div>

        {/* Notifications and the identity chip, as one fixed cluster at the
            top right (client, 2026-08-19). Log out is NOT here — it stayed at
            the bottom left of the sidebar, and only there. */}
        <TopBar session={session} role={role} />
      </div>
    </NotificationProvider>
  );
}

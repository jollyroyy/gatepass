import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import SessionTimeout from '../SessionTimeout';
import OfflineBanner from '../OfflineBanner';
import { NotificationProvider } from '../../lib/notifications';

type Props = {
  session: Session;
  role: UserRole | null;
  /** Does this person hold one of the four approval offices (046)? It is not a
   *  role, so it travels beside one — see src/lib/approverAccess.ts. */
  isApprover?: boolean;
  children: React.ReactNode;
};

const COLLAPSE_KEY = 'gatepass-sidebar-collapsed';

export default function AppShell({ session, role, isApprover = false, children }: Props): React.ReactElement {
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
        <Sidebar session={session} role={role} isApprover={isApprover} collapsed={collapsed} onCollapsedChange={setCollapsed} />

        <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-[84px]' : 'lg:pl-[264px]'}`}>
          {/* THE MOCK-UP'S SKIN IS THE WHOLE APP'S SKIN, ON EVERY TAB, FOR
              EVERY ROLE. It arrived as the guard's alone (client, 2026-08-19:
              the record Approve OUT opens must read in "the same exact
              typographic colour as the dashboard's page"); the same client then
              asked for it everywhere — "admin and HOD do not have the same
              typography as the guard … keep the type and the box, everything
              exactly the same as the guard's typography, colour."
              `.gb-main` (index.css) is that skin — white ground, Inter,
              near-black ink, the neutral ramp pinned light, and every `dark:`
              utility inside it switched off — and putting it HERE rather than
              on each page is what makes it true of My Passes, Reports, the
              Admin panel and the pass record without any of them knowing about
              it. The mock-up screens keep their own `.gb-board`, which sits
              inside this and repaints the same ground.
              KNOWN, FLAGGED: the notification bell and its dropdown are OUTSIDE
              `main` (they are `fixed`), so they keep the house theme — the same
              gap the guard's shell has had since the skin landed. */}
          <main className="flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8 pb-8 gb-main">
            {/* Above the content, on every screen: since public/sw.js landed, an
                offline app OPENS instead of erroring, and what it opens is every
                list empty. Renders nothing while online. */}
            <OfflineBanner />
            {children}
          </main>

          <footer className="no-print px-8 pb-6">
            <p className="text-center text-[11px] text-navy-300 tracking-wide">
              Quest Mall · Gate Pass
            </p>
          </footer>
        </div>

        <NotificationBell />
      </div>
    </NotificationProvider>
  );
}

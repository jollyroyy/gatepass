import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import Sidebar from './Sidebar';

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

  // No profile lookup here on purpose. SidebarProfile already renders the name
  // and role in the bottom-left; showing them again in the top-right was the
  // same fact twice on one screen. Removing the lookup as well as the markup
  // means the shell no longer depends on the profile RPC at all, so VMS's
  // recursive public.profiles policy (42P17) cannot reach it.

  return (
    <div className="min-h-screen bg-surface-50">
      <Sidebar session={session} role={role} collapsed={collapsed} onCollapsedChange={setCollapsed} />

      <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-[84px]' : 'lg:pl-[264px]'}`}>
        {/* No top strip. It was a dark, permanently empty band across every page:
            breadcrumbs never landed there, and identity lives in SidebarProfile
            by design, so it carried no information at all. Removing it also
            removes the only dark chrome from the content column, so a page now
            starts at the top of the viewport in the theme's own background.

            pt-20 on mobile replaces the clearance the 64px header used to give
            the fixed hamburger (Sidebar.tsx:217, top-3.5 + h-9). On lg the
            sidebar is a static panel and no hamburger exists, so pt-8 is enough. */}
        <main className="flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8 pb-8">
          {children}
        </main>

        <footer className="no-print px-8 pb-6">
          <p className="text-center text-[11px] text-navy-300 tracking-wide">
            GatePass — Material Movement Control
          </p>
        </footer>
      </div>
    </div>
  );
}

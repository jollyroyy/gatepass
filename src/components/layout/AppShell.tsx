import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
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
      <div className="min-h-screen bg-surface-50">
        <Sidebar session={session} role={role} collapsed={collapsed} onCollapsedChange={setCollapsed} />

        <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-[84px]' : 'lg:pl-[264px]'}`}>
          <main className="flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8 pb-8">
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

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, getUserRole } from './supabaseClient';
import type { UserRole } from './types/index';
import { homeFor, isForbidden } from './lib/roleRoutes';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/AppShell';

import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import HodDashboard from './pages/HOD/Dashboard';
import RaisePass from './pages/HOD/RaisePass';
import MyPasses from './pages/HOD/MyPasses';
import HodAnalytics from './pages/HOD/HodAnalytics';
import GateConsole from './pages/Security/GateConsole';
import Verify from './pages/Security/Verify';
import PendingReturns from './pages/Security/PendingReturns';
import History from './pages/Security/History';
import AdminPanel from './pages/Admin/AdminPanel';
import AllPasses from './pages/Admin/AllPasses';
import PassDetail from './pages/Shared/PassDetail';
import PassPrint from './pages/Shared/PassPrint';

/**
 * Blocks a signed-in user from a route their role has no business on.
 *
 * This is defence in depth and a UX guard — nothing more. The real boundary is
 * RLS in Postgres: an HOD who edits the URL still cannot read another
 * department's rows, because the database refuses, not because this component does.
 */
function RouteGuard({
  role,
  children,
}: {
  role: UserRole | null;
  children: React.ReactNode;
}): React.ReactElement {
  const { pathname } = useLocation();
  if (isForbidden(pathname, role)) {
    return <Navigate to={homeFor(role)} replace />;
  }
  return <>{children}</>;
}

function FullPageLoader(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
        <p className="text-sm text-navy-400">Loading…</p>
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (s: Session | null) => {
      if (!s) {
        if (!cancelled) {
          setRole(null);
          setResolving(false);
        }
        return;
      }
      const r = await getUserRole();
      if (!cancelled) {
        setRole((r as UserRole | null) ?? null);
        setResolving(false);
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void resolve(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setResolving(true);
      void resolve(s);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (resolving) return <FullPageLoader />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Signed in, but the role has no place in this app (e.g. VMS `staff`).
  if (isForbidden('/dashboard', role) && isForbidden('/console', role) && isForbidden('/admin', role)) {
    return <NoAccess />;
  }

  return (
    <AppShell session={session} role={role}>
      <RouteGuard role={role}>
        <Routes>
          <Route path="/login" element={<Navigate to={homeFor(role)} replace />} />

          {/* HOD */}
          <Route path="/dashboard" element={<HodDashboard />} />
          <Route path="/raise" element={<RaisePass />} />
          <Route path="/my-passes" element={<MyPasses />} />
          <Route path="/analytics" element={<HodAnalytics />} />

          {/* Security */}
          <Route path="/console" element={<GateConsole />} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="/returns" element={<PendingReturns />} />
          <Route path="/history" element={<History />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/all-passes" element={<AllPasses />} />

          {/* Shared */}
          <Route path="/pass/:id" element={<PassDetail />} />
          <Route path="/pass/:id/print" element={<PassPrint />} />

          <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
        </Routes>
      </RouteGuard>
    </AppShell>
  );
}

export function Root(): React.ReactElement {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  );
}

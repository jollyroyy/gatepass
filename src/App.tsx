import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, getUserRole } from './supabaseClient';
import type { UserRole } from './types/index';
import { homeFor, isForbidden } from './lib/roleRoutes';
import { fetchMustChangePassword } from './lib/profiles';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/AppShell';

import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ForcePasswordChange from './pages/ForcePasswordChange';
import NoAccess from './pages/NoAccess';
import HodDashboard from './pages/HOD/Dashboard';
import RaisePass from './pages/HOD/RaisePass';
import MyPasses from './pages/HOD/MyPasses';
import GateConsole from './pages/Security/GateConsole';
import Verify from './pages/Security/Verify';
import GuardDashboard from './pages/Security/GuardDashboard';
import PendingReturns from './pages/Security/PendingReturns';
import AdminPanel from './pages/Admin/AdminPanel';
import AdminDashboard from './pages/Admin/AdminDashboard';
import ReportsPage from './pages/Admin/ReportsPage';

import PassDetail from './pages/Shared/PassDetail';
import PassPrint from './pages/Shared/PassPrint';
import ProfilePage from './pages/Shared/Profile';

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
        <p className="text-sm text-navy-500">Loading…</p>
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  const { pathname } = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [resolving, setResolving] = useState(true);
  // Does the signed-in user still owe us a password change (admin reset)?
  // Read fresh on every resolution — it lives only in gatepass.my_profile(),
  // never in the JWT, so it cannot be cached alongside the role. A lookup
  // failure fails OPEN (false) rather than locking out every existing session
  // over a transient network error.
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (s: Session | null) => {
      if (!s) {
        if (!cancelled) {
          setRole(null);
          setMustChangePassword(false);
          setResolving(false);
        }
        return;
      }
      const r = await getUserRole();
      let mustChange = false;
      try {
        mustChange = await fetchMustChangePassword();
      } catch {
        mustChange = false;
      }
      if (!cancelled) {
        setRole((r as UserRole | null) ?? null);
        setMustChangePassword(mustChange);
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
      // Deliberately does NOT set `resolving`. That renders FullPageLoader, which
      // unmounts the whole AppShell tree — including SessionTimeout, whose idle
      // clock then restarts from zero on remount. supabase-js fires
      // TOKEN_REFRESHED / SIGNED_IN on token refresh AND on tab visibility
      // recovery, so switching away from the tab and back silently reset the
      // timer and the idle timeout could never elapse. Only the initial
      // resolution above gates the app; afterwards the role updates in place.
      void resolve(s);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (resolving) return <FullPageLoader />;

  // Password recovery: the emailed link lands here with a recovery token that
  // supabase-js turned into a (temporary) session. That session is real, so the
  // `session` gate below would pump the user straight into the console with no
  // chance to set a password — catch the path first.
  if (pathname === '/reset-password') {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // An administrator reset this person's password. They must choose their own
  // before they can reach ANYTHING else — no role routing, no deep link, no
  // AppShell. This check has no pathname condition, so typing any URL still
  // lands here; it only ever clears via ForcePasswordChange confirming the
  // flag is false after a real set_my_password call.
  if (mustChangePassword) {
    return <ForcePasswordChange onCleared={() => setMustChangePassword(false)} />;
  }

  // Signed in, but the role has no place in this app (e.g. VMS `staff`).
  if (isForbidden('/dashboard', role) && isForbidden('/console', role) && isForbidden('/admin', role)) {
    return <NoAccess />;
  }

  // Print page — outside AppShell so sidebar, notification bell, and all other
  // chrome are completely absent. Clean, full-width print sheet.
  if (pathname.includes('/print')) {
    return (
      <Routes>
        <Route path="/pass/:id/print" element={<PassPrint />} />
      </Routes>
    );
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

          {/* Security */}
          <Route path="/guard-dashboard" element={<GuardDashboard />} />
          <Route path="/returns" element={<PendingReturns />} />
          <Route path="/console" element={<GateConsole />} />
          <Route path="/verify/:id" element={<Verify />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin-dashboard" element={<AdminDashboard />} />
          <Route path="/all-passes" element={<ReportsPage />} />

          {/* Shared */}
          <Route path="/pass/:id" element={<PassDetail />} />
          <Route path="/profile" element={<ProfilePage session={session} role={role} />} />

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

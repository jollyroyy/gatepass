import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, getUserRole } from './supabaseClient';
import type { UserRole } from './types/index';
import { homeFor, isForbidden } from './lib/roleRoutes';
import { isResumableTarget, loginPathFor, nextAfterLogin, pathnameOf } from './lib/postLoginRedirect';
import { fetchMyApprovalRole } from './lib/approverAccess';
import type { ApprovalRoleKey } from './lib/approvalLadder';
import { fetchAccessState } from './lib/profiles';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/AppShell';

import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ForcePasswordChange from './pages/ForcePasswordChange';
import NoAccess from './pages/NoAccess';
import HodDashboard from './pages/HOD/Dashboard';
import HodDashboardDrill from './pages/HOD/DashboardDrill';
import RaisePass from './pages/HOD/RaisePass';
import MismatchReview from './pages/HOD/MismatchReview';
import ExpiredReview from './pages/HOD/ExpiredReview';
import HodReports from './pages/HOD/HodReports';
import GateConsole from './pages/Security/GateConsole';
import Verify from './pages/Security/Verify';
import GuardDashboard from './pages/Security/GuardDashboard';
import GuardDrill from './pages/Security/GuardDrill';
import AdminPanel from './pages/Admin/AdminPanel';
import AdminDashboard from './pages/Admin/AdminDashboard';
import AdminDashboardDrill from './pages/Admin/DashboardDrill';
import SuperAdminDashboard from './pages/Admin/SuperAdminDashboard';
import ReportsPage from './pages/Admin/ReportsPage';
import ActivityLogPage from './pages/Admin/ActivityLogPage';

import PassDetail from './pages/Shared/PassDetail';
import PassPrint from './pages/Shared/PassPrint';
import ProfilePage from './pages/Shared/Profile';
import OverdueItemsPage from './pages/Shared/OverdueItemsPage';
import WhitelistApprovals from './pages/Approver/WhitelistApprovals';
import PendingApprovals from './pages/Approver/PendingApprovals';
import ApprovalDelegation from './pages/Approver/ApprovalDelegation';
import ReturnsDueTodayPage from './pages/Shared/ReturnsDueTodayPage';

/**
 * Blocks a signed-in user from a route their role has no business on.
 *
 * This is defence in depth and a UX guard — nothing more. The real boundary is
 * RLS in Postgres: an HOD who edits the URL still cannot read another
 * department's rows, because the database refuses, not because this component does.
 */
function RouteGuard({
  role,
  isApprover,
  children,
}: {
  role: UserRole | null;
  isApprover: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { pathname } = useLocation();
  if (isForbidden(pathname, role, isApprover)) {
    return <Navigate to={homeFor(role, isApprover)} replace />;
  }
  return <>{children}</>;
}

/** Where a reader goes once they have signed in on a `/login?next=…` URL.
 *
 *  SIGNING IN LANDS ON THE DASHBOARD (client, 2026-08-23), with ONE exception:
 *  the pass record an approval mail's Approve/Reject button opens, which is the
 *  journey `?next=` was built for. `loginPathFor` stamps the parameter on every
 *  unauthenticated request, so without `isResumableTarget` a session that
 *  lapsed on Reports resumed on Reports — never on the reader's own board.
 *
 *  `isForbidden` still grades the destination on top of that: the parameter is
 *  attacker-supplied, and a wrong-role target must land on this reader's home
 *  rather than on a screen that will bounce. */
function resumeAfterLogin(search: string, role: UserRole | null, isApprover: boolean): string {
  const target = nextAfterLogin(search);
  const path = target ? pathnameOf(target) : null;
  if (target && path && isResumableTarget(path) && !isForbidden(path, role, isApprover)) {
    return target;
  }
  return homeFor(role, isApprover);
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
  const { pathname, search } = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [resolving, setResolving] = useState(true);
  // Does the signed-in user still owe us a password change (admin reset)?
  // Read fresh on every resolution — it lives only in gatepass.my_profile(),
  // never in the JWT, so it cannot be cached alongside the role. A lookup
  // failure fails OPEN (false) rather than locking out every existing session
  // over a transient network error.
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Has an admin suspended this account (migration 040)? Read from the same
  // my_profile() call, and fails OPEN for the same reason: a dropped packet is
  // not evidence of a suspension, and RLS refuses a genuinely suspended
  // person's reads whatever this flag says.
  const [deactivated, setDeactivated] = useState(false);
  // Which of the four approval offices, if any, this person holds (046). It is
  // NOT a role — it is an extra grant read alongside one, which is why it has
  // its own piece of state rather than being folded into `role`. See
  // src/lib/approverAccess.ts.
  const [office, setOffice] = useState<ApprovalRoleKey | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (s: Session | null) => {
      if (!s) {
        if (!cancelled) {
          setRole(null);
          setMustChangePassword(false);
          setDeactivated(false);
          setOffice(null);
          setResolving(false);
        }
        return;
      }
      const r = await getUserRole();
      const held = await fetchMyApprovalRole();
      let mustChange = false;
      let active = true;
      try {
        // Suspension only. Whether the ROLE has a place in this app is the
        // separate question the `isForbidden` check below asks, and it has its
        // own sentence — see fetchAccessState.
        const access = await fetchAccessState();
        mustChange = access.mustChangePassword;
        active = access.isActive;
      } catch {
        mustChange = false;
        active = true;
      }
      if (!cancelled) {
        setRole((r as UserRole | null) ?? null);
        setOffice(held);
        setMustChangePassword(mustChange);
        setDeactivated(!active);
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
    // THE DEEP LINK SURVIVES THE SIGN-IN (client, 2026-08-20). The approval
    // emails' Approve and Reject buttons open the pass record itself, and the
    // reader is almost always signed out when they press one — so the path they
    // asked for rides across the login on `?next=` instead of being thrown
    // away. See `postLoginRedirect.ts` for why that parameter is not trusted.
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to={loginPathFor(pathname, search)} replace />} />
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

  // Signed in with a real role, and an admin has suspended the account (040).
  // The role check below cannot catch this any more, by design: deactivation
  // stopped demoting people to `staff`, so the JWT still says `guard`. Without
  // this branch they would reach the console and every panel would render empty,
  // because RLS refuses their reads and nothing on screen would say why.
  if (deactivated) {
    return <NoAccess deactivated />;
  }

  // Signed in, but the role has no place in this app (e.g. VMS `staff`) AND no
  // approval office either. The office is checked here rather than in a fourth
  // `isForbidden` call because it is what an approver's whole account is: their
  // VMS role really is `staff`, and without this line the one screen they exist
  // to use would be unreachable.
  if (
    !office
    && isForbidden('/dashboard', role)
    && isForbidden('/console', role)
    && isForbidden('/admin', role)
  ) {
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
    <AppShell session={session} role={role} isApprover={office !== null} office={office}>
      <RouteGuard role={role} isApprover={office !== null}>
        <Routes>
          {/* Signed in and still on `/login`: this is the moment the emailed
              deep link resumes. `isForbidden` still grades the destination —
              the parameter is untrusted, and a wrong-role target must land on
              this reader's own home rather than on a screen that will bounce. */}
          <Route
            path="/login"
            element={
              <Navigate
                to={resumeAfterLogin(search, role, office !== null)}
                replace
              />
            }
          />

          {/* HOD */}
          <Route path="/dashboard" element={<HodDashboard />} />
          {/* A KPI card's list is a PAGE, on every board (client, 2026-08-23:
              "show it on a new page for all the KPI cards"). Each of these
              rebuilds its board's own row from the same read and renders the
              array the pressed figure counted — see the three DashboardDrill /
              GuardDrill pages. They are sub-paths of the board they belong to,
              so `ROLE_ROUTES` already admits exactly the right role and no
              sidebar tab appears for them. */}
          <Route path="/dashboard/:key" element={<HodDashboardDrill />} />
          <Route path="/raise" element={<RaisePass />} />
          <Route path="/mismatch/:id" element={<MismatchReview />} />
          <Route path="/expired/:id" element={<ExpiredReview />} />
          <Route path="/reports" element={<HodReports />} />

          {/* Security */}
          <Route path="/guard-dashboard" element={<GuardDashboard />} />
          <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
          <Route path="/console" element={<GateConsole role={role} />} />
          <Route path="/verify/:id" element={<Verify />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminPanel />} />
          {/* ONE ROUTE, TWO BOARDS. A super admin gets the guard-styled board
              (client, 2026-08-20: "follow the same dashboard look and feel of
              guard except the functionalities ... for superadmin dashboard");
              an ordinary admin keeps the Overview mock-up unchanged. Dispatching
              here rather than adding a route keeps `ROLE_ROUTES`, `ROLE_HOME`
              and the sidebar untouched — a super admin's "Dashboard" tab simply
              shows their own board. Both read the same `v_gate_passes` and the
              same `buildOverviewCards`, so the figures cannot disagree. */}
          <Route
            path="/admin-dashboard"
            element={role === 'super_admin' ? <SuperAdminDashboard /> : <AdminDashboard />}
          />
          {/* ONE DRILL PAGE FOR BOTH ADMIN BOARDS — the Overview and the super
              admin's guard-styled board are one derivation (`buildOverviewCards`),
              so their figures open the same page. */}
          <Route path="/admin-dashboard/:key" element={<AdminDashboardDrill />} />
          <Route path="/all-passes" element={<ReportsPage />} />
          <Route path="/activity" element={<ActivityLogPage />} />

          {/* Overdue Items and Returns Due Today are ONE page each, scoped by
              role inside — see OverdueItemsPage.tsx. Both are where a board's
              Overdue / Due Today figure navigates, on every board. */}
          <Route path="/overdue" element={<OverdueItemsPage role={role} />} />
          <Route path="/returns" element={<ReturnsDueTodayPage role={role} />} />

          {/* The four approval offices (046). One screen, and it is the whole
              of what an office holder does here. */}
          <Route path="/approvals" element={<PendingApprovals office={office} />} />
          {/* Delegating that office to a stand-in for a stated period (062).
              The approver's own act — no admin is involved at any point. */}
          <Route path="/delegation" element={<ApprovalDelegation office={office} />} />
          {/* The CEO office also decides whitelist requests (053). Any office
              holder may open it; only the CEO sees anything in it. */}
          <Route path="/whitelist" element={<WhitelistApprovals />} />

          {/* Shared */}
          <Route path="/pass/:id" element={<PassDetail role={role} office={office} />} />
          <Route path="/profile" element={<ProfilePage session={session} role={role} office={office} />} />

          <Route path="*" element={<Navigate to={homeFor(role, office !== null)} replace />} />
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

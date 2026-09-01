# P3 — Admin + Super Admin + Auth + Shared E2E Test Plan

Scope owner: Planner agent P3. Covers Admin panel/dashboard/reports, Auth screens, Shared/passview
screens, and layout chrome. No test code is written here — this is the spec a code-generating
agent implements against, verbatim, without reading source.

Sources: `CLAUDE.md` (root), live reads of `src/App.tsx`, `src/lib/roleRoutes.ts`,
`src/lib/errors.ts`, `src/pages/Login.tsx`, `src/components/AuthField.tsx`,
`src/lib/approverAccess.ts`, `src/lib/postLoginRedirect.ts`, plus four parallel research passes
over every file in the P3 scope (Admin tabs; Admin dashboards/reports; Shared/passview; layout,
chrome and auth). Every claim below is cited `file:line` where the source agent gave one; where a
fact came from a research agent's report rather than a direct read in this session, it is marked
`[researched]`.

---

## 0. Index legend

None needed — this document does not abbreviate file names; every reference spells out the full
relative path on first use in each section and repeats it (short files, easy to re-find with Ctrl-F).

---

## 1. Route / Access matrix

Source: `src/lib/roleRoutes.ts` (`ROLE_ROUTES`, `APPROVER_ROUTES`, `ROLE_HOME`, `APPROVER_HOME`,
`officeReplacesRole`, `isForbidden`, `homeFor`) and `src/App.tsx` lines 182–337 (gating order).

### 1.1 Gating order (App.tsx) — test every step in isolation

The app resolves in this exact sequence; each step is a distinct test target because an earlier
gate fully replaces the tree (nothing downstream renders):

1. `resolving === true` → `FullPageLoader` (spinner + "Loading…", `App.tsx:87-96`). No route
   matters yet.
2. `pathname === '/reset-password'` → renders ONLY `<ResetPassword/>`, no matter session state
   (`App.tsx:188-194`). This must be tested with and without a session, and with an unauthenticated
   direct hit — all three render the reset page, not a redirect.
3. `!session` → only `/login` renders `<Login/>`; every other path redirects to
   `loginPathFor(pathname, search)` = `/login?next=<encoded>` (`App.tsx:196-208`,
   `src/lib/postLoginRedirect.ts:31-34`).
4. `mustChangePassword === true` → renders ONLY `<ForcePasswordChange/>` for ANY pathname —
   typing `/admin` while this flag is true still shows the password-change screen
   (`App.tsx:215-217`).
5. `deactivated === true` → renders ONLY `<NoAccess deactivated/>` (`App.tsx:224-226`).
6. `!office && isForbidden('/dashboard',role) && isForbidden('/console',role) && isForbidden('/admin',role)`
   → `<NoAccess/>` (no `deactivated` prop) (`App.tsx:233-240`). This is the `staff`-role-with-no-office
   case.
7. `pathname.includes('/print')` → renders ONLY `<PassPrint/>` at `/pass/:id/print`, entirely
   outside `<AppShell>` — no sidebar, no bell, no timeout modal (`App.tsx:244-250`).
8. Otherwise: full `<AppShell>` + `<RouteGuard>` + `<Routes>` (`App.tsx:252-336`).

### 1.2 Role × route matrix

Legend: **A** = allowed (renders the route's component); **R→X** = redirected to path X
(`Navigate replace`, so back-button does not return to the forbidden URL); role columns are
`guard`, `hod`, `admin`, `super_admin`, `staff`, `office` (an approval-office holder — Security
Head/COO/Finance HOD/CEO — whose own VMS role is `staff` per migration 046, so "office" is
evaluated as `role=staff, isApprover=true`; note migration 043 also permits a Security Head to be
a `guard` account, and `067`'s COO/CEO pairing is the "office" that also carries super-admin
fallback powers — for THIS matrix, "office" means a non-admin office holder, for whom
`officeReplacesRole` is `true` and access is `APPROVER_ROUTES` only, per
`src/lib/roleRoutes.ts:112-126`).

An **office-holding admin/super_admin** is a distinct 7th case — see §1.3.

| Route | guard | hod | admin | super_admin | staff | office |
|---|---|---|---|---|---|---|
| `/login` (unauthenticated) | A | A | A | A | A | A |
| `/login` (authenticated) | R→home | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/reset-password` | A (always, any auth state) | A | A | A | A | A |
| `/dashboard` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/dashboard/:key` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/raise` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals`‡ |
| `/my-passes` | R→home | R→home | R→home | R→home | R→`/no-access` | R→`/approvals`‡ |
| `/mismatch/:id` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/expired/:id` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/reports` | R→home | A | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/guard-dashboard` | A | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/guard-dashboard/:key` | A | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/console` | A | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/verify/:id` | A | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |
| `/admin` | R→home | R→home | A | A | R→`/no-access` | R→`/approvals` |
| `/admin-dashboard` | R→home | R→home | A (`AdminDashboard`) | A (`SuperAdminDashboard`, same route, dispatched by role — `App.tsx:301-304`) | R→`/no-access` | R→`/approvals` |
| `/admin-dashboard/:key` | R→home | R→home | A | A | R→`/no-access` | R→`/approvals` |
| `/all-passes` | R→home | R→home | A | A | R→`/no-access` | R→`/approvals` |
| `/activity` | R→home | R→home | A | A | R→`/no-access` | R→`/approvals` |
| `/overdue` | A | A | A | A | R→`/no-access` | R→`/approvals` |
| `/returns` | A | A | A | A | R→`/no-access` | R→`/approvals` |
| `/approvals` | R→home | R→home | R→home\* | R→home\* | R→`/no-access` | A |
| `/delegation` | R→home | R→home | R→home\* | R→home\* | R→`/no-access` | A |
| `/whitelist` | R→home | R→home | R→home\* | R→home\* | R→`/no-access` | A (content empty unless CEO) |
| `/pass/:id` | A | A | A | A | R→`/no-access` | A |
| `/pass/:id/print` | A (no chrome) | A (no chrome) | A (no chrome) | A (no chrome) | R→`/no-access`† | A (no chrome) |
| `/profile` | A | A | A | A | R→`/no-access` | A |
| any unknown path | R→home | R→home | R→home | R→home | R→`/no-access` | R→`/approvals` |

\* `/approvals`, `/delegation`, `/whitelist` are **not** in `ROLE_ROUTES.admin` /
`ROLE_ROUTES.super_admin` (`src/lib/roleRoutes.ts:74-78`), so a plain admin/super_admin with no
office redirects home from them — they only reach these if they themselves hold an office, which
`officeReplacesRole` explicitly exempts from replacement (`roleRoutes.ts:112-126`), meaning an
admin who ALSO holds an office keeps `/admin` etc. AND gains `/approvals`/`/delegation`/`/whitelist`
— see §1.3.

‡ **UPDATED (migration 069, client 2026-08-31)**: the generic "office" column is no longer
uniform for `/raise` and `/my-passes`. `RAISING_OFFICE_ROUTES = ['/raise', '/my-passes']`
(`roleRoutes.ts:58-59`) is granted only when `officeRaises(office)` is true, which checks the
OFFICE KEY, not just "holds an office" — `RAISING_OFFICES = ['coo', 'ceo']` (`roleRoutes.ts:58`).
So: a Security Head or Finance HOD office holder is R→`/approvals` on both routes (as the table
shows), but the sitting COO or the sitting CEO is **A** on both — "make sure CEO and COO has the
ability to raise pass on behalf of any department in their logins." `/raise` for them renders the
HOD's form plus a `rp-dept` Department select (§ P1 plan, `PassDetailsCards.tsx`); `/my-passes`
(`src/pages/Approver/MyRaisedPasses.tsx`) is their own `raised_by = auth.uid()` register. Not
covered by an implemented spec yet — see the P1 plan's "Planned, not yet written" note.

† The print-route gate at `App.tsx:244` runs BEFORE the `staff`-no-office `NoAccess` check at
line 233 — **verify empirically**: because the print branch is reached only after the deactivated
and no-role checks already ran, a `staff` user with no office is already caught by the
`NoAccess` branch at step 6 and never reaches step 7, so `/pass/:id/print` for a bare `staff`
account renders `NoAccess`, not the print sheet. Table reflects this ordering.

`homeFor(role, isApprover)` (`roleRoutes.ts:145-150`):

| role | home |
|---|---|
| `guard` | `/guard-dashboard` |
| `hod` | `/dashboard` |
| `admin` | `/admin-dashboard` |
| `super_admin` | `/admin-dashboard` |
| `staff` (no office) | `/no-access` |
| any role + `isApprover` (non-admin) | `/approvals` |

### 1.3 Office + admin/super_admin exemption (P3-critical)

`officeReplacesRole(role, isApprover)` returns `false` when `role === 'admin' || role === 'super_admin'`
(`roleRoutes.ts:110-126`) — "ADMIN AND SUPER ADMIN ARE DELIBERATELY EXEMPT" (comment,
`roleRoutes.ts:96-107`). Test: an admin account designated to an office (e.g. Finance HOD) must
retain EVERY admin route (`/admin`, `/admin-dashboard`, `/all-passes`, `/activity`, `/overdue`,
`/returns`, `/pass/:id`, `/profile`) **and additionally** reach `/approvals`, `/delegation`,
`/whitelist` — union, not replacement. This is a one-line branch (`role !== 'admin' && role !== 'super_admin'`)
with no dedicated unit test cited in this research — flag as a P3 case (see P3-04).

### 1.4 `?next=` deep-link resume matrix

Source: `src/lib/postLoginRedirect.ts` (full read), `src/App.tsx:67-85, 260-268`.

| `next` value | `nextAfterLogin` result | Resumed? |
|---|---|---|
| `/pass/abc-123` | `/pass/abc-123` | Yes, if `!isForbidden` for the signed-in role |
| `/pass/abc-123?decide=approve` | same, with query preserved | Yes |
| `//evil.example/x` | `null` (starts with `//`) | No — lands on `homeFor()` |
| `\evil.example` | `null` (contains `\`) | No |
| `https://evil.example` | `null` (doesn't start with `/`) | No |
| `/admin` (HOD session) | `/admin` | **No** — `isResumableTarget` only allows `/pass*` prefixes (`RESUMABLE_PREFIXES = ['/pass']`, `postLoginRedirect.ts:65-73`); an HOD's `next=/admin` is graded resumable-shape but `isForbidden('/admin','hod')` is true anyway, AND even a self-forbidden-clean path outside `/pass` never resumes — always falls back to `homeFor`. |
| `/reports` (own role's report page) | rejected — not `/pass*` | No, even though the HOD IS allowed there — per client instruction 2026-08-23 "always open up the dashboard...for any of the views", cited in file comment `postLoginRedirect.ts` around `isResumableTarget`. |
| absent | `null` | Lands on `homeFor(role, isApprover)` |

---

## 2. Selector inventory

Organized by screen. Every entry: exact text (verbatim from JSX) → preferred Playwright locator →
existing testid/aria-label/id → conditional. **No `data-testid` is invented here** — every one
listed under "existing" was found by grep in the four research passes; anything a test needs that
doesn't exist is listed in §9 "Recommended data-testid additions" with file:line.

### 2.0 Full existing `data-testid` inventory (repo-wide grep, this session)

```
approval-kpis                    src/components/approver/ApprovalKpiCards.tsx:101
guard-figure-${label}            src/components/guard/GuardSummaryCards.tsx:47
guard-search-results             src/components/guard/SearchMatches.tsx:85
dept-delete-requests             src/components/hod/DepartmentDeleteRequests.tsx:44
pass-ordinal                     src/components/PassOrdinal.tsx:19
pass-stack                       src/components/PassStack.tsx:40
pass-ordinal (dup, stack card)   src/components/PassStackCard.tsx:136
pass-stack-card                  src/components/PassStackCard.tsx:217,226
pass-stack-items                 src/components/PassStackItems.tsx:45
pass-timeline (strip)            src/components/PassTimelineStrip.tsx:81,92
record-approval-actions          src/components/passview/ApprovalDecisionBar.tsx:93,131
decide-from-email                src/components/passview/ApprovalDecisionBar.tsx:141
emergency-release                src/components/passview/EmergencyReleaseBar.tsx:80
share-whatsapp                   src/components/passview/PassRecordHeader.tsx:77
items-total-value                src/components/passview/PassRecordItems.tsx:237
return-locked                    src/components/passview/PassRecordReturns.tsx:101
items-need-attention             src/components/passview/PassRecordReturns.tsx:119
record-pass-returns              src/components/passview/PassRecordReturns.tsx:150
pass-record                      src/components/passview/PassRecordView.tsx:136
emergency-banner                 src/components/passview/PassRecordView.tsx:152
record-actions                   src/components/passview/PassRecordView.tsx:235
timeline-return-lines            src/components/passview/PassTimeline.tsx:114
pass-timeline (aside)            src/components/passview/PassTimeline.tsx:153
timeline-detail                  src/components/passview/PassTimelineParts.tsx:97
record-scheduled-returns         src/components/returns/ScheduledReturns.tsx:130
scheduled-returns-table          src/components/returns/ScheduledReturnsTable.tsx:37
super-card-${g.key}              src/components/superadmin/SuperSummaryCards.tsx:49  (→ super-card-raised, super-card-attention)
activity-table                   src/pages/Admin/ActivityLogPage.tsx:135
deactivate-vacates-office        src/pages/Admin/DeactivateUserModal.tsx:37
department-rows                  src/pages/Admin/DepartmentsTab.tsx:349
functional-role-list             src/pages/Admin/FunctionalRolesTab.tsx:84
hod-row                          src/pages/Admin/HodDirectory.tsx:45
super-admins                     src/pages/Admin/SuperAdminsCard.tsx:88
whitelist-kpis                   src/pages/Admin/WhitelistKpiCards.tsx:26
whitelist-request-details        src/pages/Admin/WhitelistRequestCard.tsx:90
gate-lookup                      src/pages/Security/GateLookup.tsx:65
```

**39 total, repo-wide.** Note: `AdminPanel.tsx`, `AdminDashboard.tsx`, `DashboardDrill.tsx`,
`SuperAdminDashboard.tsx`, `ReportsPage.tsx` + all Reports subcomponents, `OverviewCards.tsx`,
`OverviewStatus.tsx`, `OverviewTrend.tsx`, `SuperQuickActions.tsx`, every Admin write-flow modal
(Add/Edit/Deactivate/Reactivate User, Departments create/assign/edit/delete, Blacklist,
Whitelist decision), `AppSettingsCard`, `MailSettingsCard`, `ApprovalLadderCard`,
`SettingField`, `ResetPasswordSection`, `Login.tsx`, `ForcePasswordChange.tsx`,
`ResetPassword.tsx`, `NoAccess.tsx`, `AppShell.tsx`, `Sidebar.tsx`, `SidebarProfile.tsx`,
`NotificationBell.tsx`, `OfflineBanner.tsx`, `ModalShell.tsx`, `KpiCard.tsx`, `Badge.tsx`,
`SessionTimeout.tsx`, all `passview` structural components except the ones listed above — **have
zero `data-testid`**. Selectors for these must use `getByRole`/`getByLabel`/`getByText` per the
tables below.

### 2.1 Login screen (`src/pages/Login.tsx`) — exhaustive

| Element | Exact text/attrs | Locator | Notes |
|---|---|---|---|
| Email field | label "Email", placeholder "you@company.com", `id="email"`, `autoComplete="username"` | `page.getByLabel('Email')` | `Login.tsx:158-167` |
| Password field | label "Password", placeholder "••••••••", `id="password"`, `autoComplete="current-password"` | `page.getByLabel('Password')` | `Login.tsx:169-177` |
| Show/hide toggle | `aria-label="Hide password"` / `"Show password"` (dynamic) | `page.getByRole('button', {name: 'Show password'})` | `Login.tsx:187` |
| Submit button | "Sign In" (idle), "Signing in…" (busy) | `page.getByRole('button', {name: 'Sign In'})` | `Login.tsx:236-255`, `type="submit"` |
| Forgot-password sentence | "Forgot your password? Contact the administrator at admin@demo.vms to have it reset." | `page.getByText('Contact the administrator at')` | mailto link, `ADMIN_CONTACT_EMAIL = 'admin@demo.vms'` (`Login.tsx:16`) — **there is no self-service reset flow/button on this screen**, only a `mailto:` anchor |
| Error banner | dynamic text from `safeErrorMessage` | `page.getByText(<exact message>)` | see §3 for every possible string |
| Heading | "Welcome back" / "Sign in" | `page.getByRole('heading', {name: 'Welcome back'})` | literal-color fixed surface, no `dark:` needed here (exempt per CLAUDE.md) |
| Tagline | "Gate Pass Control" | decorative | `Login.tsx:121` |
| Footer note | "Accounts are provisioned by an administrator." | decorative | `Login.tsx:270` |

**No `data-testid` on this screen** — none found in the fact-dump.

### 2.2 ForcePasswordChange, ResetPassword, NoAccess `[researched]`

| Screen | Element | Exact text | Locator | id/aria |
|---|---|---|---|---|
| ForcePasswordChange | Heading | "Set your password" | `getByRole('heading',{name:'Set your password'})` | — |
| ForcePasswordChange | New password field | label "New password" | `getByLabel('New password')` | `id="new-password"` |
| ForcePasswordChange | Confirm field | label "Confirm new password" | `getByLabel('Confirm new password')` | `id="confirm-password"` |
| ForcePasswordChange | Show/hide (×2, independent) | `aria-label="Hide password"`/`"Show password"` per field | disambiguate by which field's wrapper contains the button | two identical-label buttons exist simultaneously — **strict-mode ambiguity**, scope with `.locator('#new-password').locator('..')` or nearest field container |
| ForcePasswordChange | Submit | "Set new password" / busy "Setting password…" | `getByRole('button',{name:'Set new password'})` | — |
| ForcePasswordChange | Sign out | "Sign out" / busy "Signing out…" | `getByRole('button',{name:'Sign out'})` | — |
| ForcePasswordChange | Validation: too short | "Your new password must be at least 6 characters." | `getByText(...)` | — |
| ForcePasswordChange | Validation: mismatch | "Passwords do not match." | `getByText(...)` | — |
| ForcePasswordChange | Post-RPC re-check failure | "Could not confirm the password change. Please try again." | `getByText(...)` | — |
| ForcePasswordChange | Generic fallback | "Could not set your new password." | `getByText(...)` | via `safeErrorMessage` |
| ResetPassword | status=checking | "Verifying your link…" | `getByText(...)` | — |
| ResetPassword | status=expired heading | "This reset link is invalid" | `getByRole('heading',...)` | — |
| ResetPassword | status=expired body | "The link has expired or was already used. Use "Forgot password?" on the sign-in page to request a fresh one." | `getByText(...)` | — |
| ResetPassword | status=expired link | "Back to sign in" → `/login` | `getByRole('link',{name:'Back to sign in'})` | also appears on `status=done` |
| ResetPassword | status=ready heading | "Choose a new password" | `getByRole('heading',...)` | — |
| ResetPassword | fields | same ids `new-password`/`confirm-password` as ForcePasswordChange | `getByLabel('New password')` etc | **no show/hide toggle here** (plain `type=password`), so no strict-mode ambiguity on this screen unlike ForcePasswordChange |
| ResetPassword | Validation: too short | "Passwords must be at least 6 characters long." | `getByText(...)` | note: DIFFERENT wording than ForcePasswordChange's short-password string — do not conflate |
| ResetPassword | Validation: mismatch | "Passwords do not match." | `getByText(...)` | same string as ForcePasswordChange |
| ResetPassword | Submit | "Set new password" / busy "Saving…" | `getByRole('button',{name:'Set new password'})` | — |
| ResetPassword | Fallback error | "Could not update the password." | `getByText(...)` | — |
| ResetPassword | status=done heading | "Password updated" | `getByRole('heading',...)` | — |
| ResetPassword | status=done body | "Your new password is saved. Sign in with it now." | `getByText(...)` | — |
| NoAccess | Heading (deactivated) | "Account Deactivated" | `getByRole('heading',...)` | — |
| NoAccess | Heading (no role) | "No Gate Pass Access" | `getByRole('heading',...)` | — |
| NoAccess | Body 1 (deactivated, email known) | "Your account (<email>) has been deactivated by an administrator." | `getByText(...)` | interpolated |
| NoAccess | Body 1 (no role, email known) | "Your account (<email>) does not have access to the Quest Gate Pass system." | `getByText(...)` | interpolated |
| NoAccess | Body 2 (deactivated) | "Your role and department are unchanged — an administrator can reactivate the account." | `getByText(...)` | — |
| NoAccess | Body 2 (no role) | "An administrator can grant your account access if you believe this is a mistake." | `getByText(...)` | — |
| NoAccess | Button | "Sign Out" / busy "Signing out…" | `getByRole('button',{name:'Sign Out'})` | note capital O, differs from ForcePasswordChange's lower-case "Sign out" — **verbatim casing matters for exact `getByRole` name matching if not using case-insensitive regex** |

### 2.3 Layout chrome `[researched]`

| Element | Exact text/attrs | Locator | Notes |
|---|---|---|---|
| Theme toggle | `aria-label="Toggle theme"`, visible label "Light Mode" (when dark) / "Dark Mode" (when light) | `getByRole('button',{name:'Toggle theme'})` | `Sidebar.tsx`; label text is the mode you'd switch TO, not current mode — test must assert the OPPOSITE label after toggling |
| Mobile hamburger | `aria-label="Open menu"` | `getByRole('button',{name:'Open menu'})` | mobile viewport only |
| Mobile drawer close | `aria-label="Close"` | ambiguous — see strict-mode note below | |
| Sidebar collapse handle | `aria-label="Expand sidebar"` / `"Collapse sidebar"` (dynamic), `aria-expanded={!collapsed}` | `getByRole('button',{name:'Collapse sidebar'})` | desktop only, persists via `localStorage['gatepass-sidebar-collapsed']` |
| Profile link | `aria-current="page"` when on `/profile`; collapsed variant has `aria-label="My profile"` | `getByRole('link',{name:'My profile'})` (collapsed) or by name text (expanded) | `SidebarProfile.tsx` |
| Sign-out (sidebar) | `title="Sign out"`, **no `aria-label`**, icon-only | `getByRole('button',{name:'Sign out'})` (Playwright computes accessible name from `title` when no text/aria-label) | `SidebarProfile.tsx` — flagged a11y gap, see §5 accessibility cases |
| Notification bell | `aria-label="Notifications"` or `"Notifications (N unread)"` (dynamic) | `getByRole('button',{name:/Notifications/})` | `NotificationBell.tsx` |
| Bell "Dismiss all" | text "Dismiss all" | `getByRole('button',{name:'Dismiss all'})` | only rendered if `notifications.length > 0` |
| Bell dropdown close | `aria-label="Close"` | strict-mode risk if a modal is also open — scope to dropdown panel | |
| Bell per-row dismiss | `aria-label="Dismiss"` | scope with `.locator('li').filter({hasText: ...})` | multiple identical-label buttons if >1 notification |
| Bell empty state | "No notifications" | `getByText('No notifications')` | |
| OfflineBanner | `role="status"`, heading "You are offline", body "Nothing on this screen is being updated. Passes, approvals and figures are as they were when the connection dropped — do not act on them until this clears." | `getByRole('status')` | renders `null` when online — test must force `navigator.onLine=false` and fire an `offline` event |
| ModalShell close (generic) | `aria-label="Close"`, `role="dialog"`, `aria-modal="true"` | `page.getByRole('dialog')` then `.getByRole('button',{name:'Close'})` scoped to that dialog | **every modal in the app reuses this exact string** — always scope to the specific dialog, never a bare page-level `getByRole('button',{name:'Close'})` |
| SessionTimeout modal | heading `id="session-timeout-title"` "Session Timeout", body "Your session has been idle for {N} minutes. Do you want to stay signed in?", countdown "Auto-logout in {countdown}s", buttons "Sign out" / "Keep session" | `getByRole('dialog',{name:'Session Timeout'})` | `IDLE_TIMEOUT_MS` defaults to 5 min (`DEFAULT_SESSION_TIMEOUT_MINUTES`), admin-configurable 5–1440 min; `COUNTDOWN_SEC = 60` |
| Sidebar links (role-ordered) | see `roleRoutes.ts`-derived order per role, §1 | `getByRole('link', {name: <label>})` scoped to `nav`/`aside` | order per role: admin/super_admin = Dashboard, Overdue Items, Settings, Reports, Activity Log, Returns, then (if office) Pending for My Approval, Delegation |
| KpiCard | `.kpi-card` class, no testid; link mode has `href`, button mode has `aria-pressed` | `getByRole('link', {name: <label+value text>})` or `getByRole('button', {name: ...})` | `KpiCard.tsx:1-68` — loading renders literal em-dash `—` in place of the number |

**Strict-mode ambiguities flagged**: (1) `aria-label="Close"` appears on ModalShell's close button
AND Sidebar's mobile-drawer close AND NotificationBell's dropdown close — three unrelated
controls share one accessible name; every test must scope to its container first. (2) The
show/hide password toggle appears twice on `ForcePasswordChange` (email/password... actually two
password fields) with identical dynamic labels — scope per field. (3) "Sign out" text appears in
at least three places (SidebarProfile icon button via `title`, ForcePasswordChange's button,
NoAccess's button, SessionTimeout's button) — never mounted simultaneously except
SidebarProfile+SessionTimeout (both can be on screen at once inside AppShell) — scope to the
specific container (sidebar vs. modal).

### 2.4 Admin Panel — tabs and shared shell `[researched]`

Route `/admin`. `src/pages/Admin/AdminPanel.tsx` (96 lines).

| Element | Exact text | Locator | Notes |
|---|---|---|---|
| Page heading | "Admin" | `getByRole('heading',{name:'Admin'})` | `AdminPanel.tsx:76` |
| Subtitle | "Manage departments, HOD coverage, and view accounts." | `getByText(...)` | `AdminPanel.tsx:77` |
| Tab: Departments | "Departments" | `getByRole('button',{name:'Departments'})` | default active tab |
| Tab: Users | "Users" | `getByRole('button',{name:'Users'})` | renders ApprovalLadderCard, EmergencyReleasesCard, UsersTab in order |
| Tab: Functional Roles | "Functional Roles" | `getByRole('button',{name:'Functional Roles'})` | |
| Tab: Blacklist | "Blacklist" | `getByRole('button',{name:'Blacklist'})` | |
| Tab: Whitelist of Vendors | "Whitelist of Vendors" | `getByRole('button',{name:'Whitelist of Vendors'})` | |
| Tab: Settings | "Settings" | `getByRole('button',{name:'Settings'})` | renders SuperAdminsCard, AppSettingsCard, MailSettingsCard |

No `data-testid`/`aria-label`/`role` on the tab buttons themselves (plain `<button>`, styled via
active/inactive class) — target by role+name text only.

### 2.5 Departments tab `[researched]`

`src/pages/Admin/DepartmentsTab.tsx` (594 lines — **exceeds the project's 300-line cap**, flag as
a landmine for whoever refactors it, not a test finding).

| Element | Exact text | Locator | Notes |
|---|---|---|---|
| KPI: Departments | label "Departments", value `departments.length` | `getByRole('button',{name:/Departments/})` (KpiCard onClick toggles `showList`) | clicking toggles list visibility, does NOT navigate |
| KPI: Heads of Department | label "Heads of Department", value `hodProfiles.length` | same pattern, toggles `showHods` | |
| KPI: Awaiting an HOD | label "Awaiting an HOD", value `unassignedCount`, tone flagged if >0 | **not clickable** — plain div, no onClick | |
| "Add Department" button | "Add Department" | `getByRole('button',{name:'Add Department'})` | opens create modal |
| "Assign HOD" button | "Assign HOD" | `getByRole('button',{name:'Assign HOD'})` | opens assign modal |
| List toggle | "Show All Departments" / "Hide Departments" (dynamic) | `getByRole('button',{name:/Departments$/})` | text flips on click |
| Edit icon (per row) | `title="Edit department"` | `getByTitle('Edit department')` — **strict-mode risk with >1 department row**, scope to the row | |
| Delete icon (per row) | `title="Delete department"` | `getByTitle('Delete department')` | same risk |
| Withdraw request link | "Withdraw request" | `getByRole('button',{name:'Withdraw request'})` (only on rows with a pending deletion) | |
| Delete-notice dismiss | "Dismiss" | `getByRole('button',{name:'Dismiss'})` | |
| List container | `data-testid="department-rows"` | `getByTestId('department-rows')` | EXISTING testid |
| Create modal title | "Add Department" | `getByRole('heading',{name:'Add Department'})` | |
| Create modal fields | (via `DepartmentNameCodeFields.tsx`) label "Department Name" placeholder "e.g. Quality Assurance"; label "Code" placeholder "e.g. QA", `maxLength=10`, uppercased on change | `getByLabel('Department Name')`, `getByLabel('Code')` | |
| Create submit | "Add Department" / busy "Adding…" | `getByRole('button',{name:'Add Department'})` **inside the modal** — same text as the page-level "Add Department" button that opened it; must scope to `getByRole('dialog')` | STRICT-MODE AMBIGUITY: two buttons named "Add Department" exist simultaneously once the modal is open |
| Assign modal title | "Assign HOD" | `getByRole('heading',{name:'Assign HOD'})` | same ambiguity risk vs. the trigger button |
| Assign — HOD select | placeholder option "Select HOD…" | `getByLabel(...)` or `getByRole('combobox')` scoped | options `{full_name} ({email})` |
| Assign — Department select | placeholder option "Select department…" | scoped combobox | options `{name} ({code})` |
| Assign submit | "Assign HOD" / busy "Assigning…" | scope to dialog | |
| Edit modal title | "Edit Department" | `getByRole('heading',{name:'Edit Department'})` | |
| Edit submit | "Save Changes" / busy "Saving…" | `getByRole('button',{name:'Save Changes'})` | |
| Delete modal title | "Delete Department?" | `getByRole('heading',{name:'Delete Department?'})` | |
| Delete modal body (has HODs) | 'This department is headed by **{names}**. It will NOT be deleted now — a deletion request goes to them, and the department goes only once they approve it.' | `getByText(...)` | verbatim, bolded names via `<strong>` |
| Delete modal body (no HODs) | "No HOD is assigned to this department, so it is deleted straight away. A department that has an active HOD needs that HOD's approval instead." | `getByText(...)` | |
| Delete modal warning (always) | 'This will permanently delete "{name}" ({code}). This cannot be undone.' and "All HOD assignments for this department will also be removed, and anybody assigned to it loses their department." | `getByText(...)` | |
| Delete reason textarea | placeholder "e.g. Department merged with Finance", required | `getByPlaceholder('e.g. Department merged with Finance')` | submit disabled while blank |
| Delete submit | "Send Deletion Request" (if hods.length>0) or "Delete Department" (else) / busy "Working…" | `getByRole('button',{name:/Send Deletion Request|Delete Department/})` | text branches on precondition — test BOTH branches |
| Pending-deletion inline banner | "Deletion waiting with the HOD" + reason | `getByText('Deletion waiting with the HOD')` | |
| Create duplicate-code error | 'Department "{code}" already exists.' (PG 23505) | `getByText(...)` | |
| Assign duplicate error | "That HOD is already assigned to this department." (PG 23505) | `getByText(...)` | |
| Loading state | 4 `.skeleton h-32` rows | `page.locator('.skeleton')` | `SKELETON_ROWS=4` |
| List-hidden state | 'Click "Show All Departments" to view the department directory.' | `getByText(...)` | |
| Empty departments | "No departments yet. Add one to get started." | `getByText(...)` | |
| Empty HOD list (per card) | "No HOD assigned" | `getByText(...)` | |
| HodDirectory heading | "Heads of Department" | `getByRole('heading',{name:'Heads of Department'})` | shown when `showHods` |
| HodDirectory count | "{n} person" / "{n} people" | `getByText(...)` | |
| HodDirectory empty | "No HOD accounts yet." | `getByText(...)` | |
| HodDirectory row | `data-testid="hod-row"` | `getByTestId('hod-row')` | EXISTING testid, one per row — use `.nth()` or filter |
| HodDirectory no-dept | "No department assigned" (italic, flagged-600) | `getByText(...)` | |

### 2.6 Users tab `[researched]`

`src/pages/Admin/UsersTab.tsx` (orchestrator, 283 lines) + `UsersTable.tsx` + `AddUserModal.tsx`
+ `EditUserModal.tsx` + `DeactivateUserModal.tsx` + `ReactivateUserModal.tsx` +
`ResetPasswordSection.tsx`.

| Element | Exact text | Locator | Notes |
|---|---|---|---|
| Filter tab: All | "All" | `getByRole('button',{name:'All'})` (or tab role if styled as tabs) | |
| Filter tab: HOD | "HOD" | | |
| Filter tab: Guard | "Guard" | | |
| Filter tab: Admin | "Admin" | | |
| Filter tab: Inactive | "Inactive" | | **only tab showing suspended accounts** — every other tab filters active-only first |
| "Add User" button | "Add User" | `getByRole('button',{name:'Add User'})` | |
| Table columns | Name, Email, Role, Status, Departments, Created, (blank actions header) | `getByRole('columnheader',{name:...})` | |
| Row: office chip | text = `APPROVAL_ROLE_TITLES[office]` | `getByText(...)` | overrides role chip when set |
| Row: status chip | "Active" / "Inactive" | `getByText('Active')` / `getByText('Inactive')` | |
| Row action: Edit | "Edit" (text-link style) | `getByRole('button',{name:'Edit'})` scoped to row | admin/super_admin rows show `—` instead (no action buttons) |
| Row action: Reactivate | "Reactivate" (busy "…") | scoped to row | only if inactive |
| Row action: Deactivate | "Deactivate" (busy "…") | scoped to row | only if active |
| Loading | 6 skeleton rows | `.skeleton` | `SKELETON_ROWS=6` |
| Empty | "No users match this filter." | `getByText(...)` | `.table-wrap.empty-state` |
| AddUserModal title | "Add User" | `getByRole('heading',{name:'Add User'})` | |
| AddUserModal subtitle | "Provision a new guard, HOD, or gate pass approval office account." | `getByText(...)` | |
| Email field | label "Email", placeholder "user@company.com", required | `getByLabel('Email')` scoped to dialog | |
| Password field | label "Password", `minLength=6`, placeholder "Min 6 characters" | `getByLabel('Password')` scoped | |
| Full Name field | label "Full Name", placeholder "Jane Doe" | `getByLabel('Full Name')` scoped | field-error via `nameError` |
| Role select | `id="create-user-role"`, optgroups "Role" (Guard, HOD) and "Gate pass approval office" (Security Head, COO, Finance HOD, CEO) | `getByLabel(...)` or `#create-user-role` | |
| Dept picker (if hod) | pill buttons "{name} ({code})", hint "One department per person — pick a single one." | `getByRole('button',{name: <dept label>})` | |
| Office info box | "This person will only be able to see and act on the gate passes waiting for the {OfficeTitle}'s approval — no department, no Raise Pass, and no gate screens." | `getByText(...)` | if role is office |
| Office displacement warning | "{OfficeTitle} is currently {holder}. Creating this account will move the office to the new person." | `getByText(...)` | if office already held |
| Submit | "Create User" / busy "Creating…" | `getByRole('button',{name:'Create User'})` | |
| EditUserModal title | "Edit User" | `getByRole('heading',{name:'Edit User'})` | subtitle = profile email |
| EditUserModal role select | `id="edit-user-role"` | | same optgroups as Add |
| EditUserModal vacate-office warning | "Saving vacates the {OfficeTitle} office. A pass already waiting on it stays where it is until somebody else is designated." | `getByText(...)` | |
| EditUserModal submit | "Save Changes" / busy "Saving…" | scoped to dialog | note: same text as Departments' edit submit — always scope to the currently-open dialog |
| DeactivateUserModal title | "Deactivate User?" | `getByRole('heading',{name:'Deactivate User?'})` | |
| DeactivateUserModal body | "{full_name} ({email}) will lose all app access." | `getByText(...)` | |
| DeactivateUserModal office warning | `data-testid="deactivate-vacates-office"`, text "This also vacates the {OfficeTitle} office. Until you designate somebody else, a pass raised from now on will not ask that office to sign, and passes already waiting on it stay waiting." | `getByTestId('deactivate-vacates-office')` | EXISTING testid |
| DeactivateUserModal footer | "Their pass history is preserved. Reactivating them restores their access, but not the office — designate that again on the approval ladder." | `getByText(...)` | |
| Deactivate confirm | "Deactivate" / busy "Deactivating…" | `getByRole('button',{name:'Deactivate'})` scoped | `btn-danger` |
| ReactivateUserModal title | "Reactivate User?" | `getByRole('heading',{name:'Reactivate User?'})` | only for staff-role-no-office row |
| ReactivateUserModal note | "This account has no role to restore, so give it one — an account with no role can sign in and still reach nothing." | `getByText(...)` | |
| ReactivateUserModal role select | `id="reactivate-user-role"`, options Guard/HOD only (`ASSIGNABLE_ROLES`) | | portal cannot write `staff` — confirms CLAUDE.md role rule |
| Reactivate confirm | "Reactivate" / busy "Reactivating…" | scoped to dialog | |
| ResetPasswordSection collapsed | "Reset Password" | `getByRole('button',{name:'Reset Password'})` | inside EditUserModal |
| ResetPasswordSection expanded heading | "Reset Password" | `getByRole('heading',{name:'Reset Password'})` — ambiguous vs. the collapsed trigger button text | scope carefully; consider the note text as disambiguator |
| ResetPasswordSection note | "Sets a new password for {email} immediately and signs out all of their existing sessions. They will be required to choose their own password the next time they sign in." | `getByText(...)` | |
| New-password input | `id="reset-password-input"`, `aria-label="New password"` | `getByLabel('New password')` scoped to this section — **note: identical accessible name to ForcePasswordChange/ResetPassword's own "New password" field, but never mounted together** | |
| Show/Hide toggle | "Show" / "Hide" | `getByRole('button',{name:/^(Show|Hide)$/})` | |
| Generate button | "Generate a strong password" | `getByRole('button',{name:'Generate a strong password'})` | CSPRNG, 14 chars, excludes `0O1lI` |
| Length error | "Password must be at least 6 characters." | `getByText(...)` | |
| Cancel | "Cancel" | scoped | |
| Submit | "Set New Password" / busy "Setting…" | `getByRole('button',{name:'Set New Password'})` | |
| Success heading | "Password Reset" | `getByRole('heading',{name:'Password Reset'})` | |
| Success text | "The password for {email} has been set. They can sign in with it immediately, and will be asked to choose their own password on that first sign-in. All of their existing sessions have been signed out." | `getByText(...)` | |
| Copy button | "Copy" / "Copied" | `getByRole('button',{name:/Copy/})` | clipboard write |
| Note | "This password will not be shown again — copy it now and share it with the user directly." | `getByText(...)` | |
| Done button | "Done" | `getByRole('button',{name:'Done'})` | resets section state |

### 2.7 Functional Roles, Approval Ladder, App/Mail Settings, Super Admins card `[researched]`

| Screen | Element | Exact text | Locator |
|---|---|---|---|
| FunctionalRolesTab | Heading | "Functional Roles" | `getByRole('heading',{name:'Functional Roles'})` |
| FunctionalRolesTab | Subtitle | "Every role this system has, what it is for, and who holds it. Roles themselves are fixed — a person is created in a role, and the four approval offices are seated on the ladder below." | `getByText(...)` |
| FunctionalRolesTab | "Create Role Holder" button | "Create Role Holder" | `getByRole('button',{name:'Create Role Holder'})` (opens AddUserModal) |
| FunctionalRolesTab | Card list | `data-testid="functional-role-list"` | `getByTestId('functional-role-list')` — EXISTING |
| FunctionalRolesTab | Card: office not designated | "Not designated yet" (italic, flagged-600) | `getByText('Not designated yet')` |
| FunctionalRolesTab | Card: office held | "Held by {holder}" | `getByText(/Held by/)` |
| FunctionalRolesTab | Card: regular role headcount | "{headcount} active" | `getByText(/active$/)` |
| ApprovalLadderCard | Heading | "Gate pass approval ladder" | `getByRole('heading',{name:'Gate pass approval ladder'})` |
| ApprovalLadderCard | Per-entry label | "Level {level} · {title}" (Security Head L1, Finance HOD L2, COO L3, CEO L3) | `getByText(/Level \d ·/)` |
| ApprovalLadderCard | Holder select | `aria-label="{title} account"`, blank option "Nobody designated" | `getByLabel('{title} account')` |
| ApprovalLadderCard | Not designated | "Not designated yet" (pending-700) | `getByText(...)` |
| AppSettingsCard | Heading | "Application settings" | `getByRole('heading',{name:'Application settings'})` |
| AppSettingsCard | Session timeout field | `id="app-session-timeout"`, label "Sign out after this many minutes of inactivity" | `getByLabel(...)` |
| AppSettingsCard | 2FA checkbox | "Require two-factor authentication for approvers" | `getByRole('checkbox',{name:'Require two-factor authentication for approvers'})` — **CLAUDE.md landmine: this checkbox does NOT enforce anything yet** |
| AppSettingsCard | Details disclosure | summary "What setting this up will involve" | `getByText('What setting this up will involve')` |
| AppSettingsCard | App name field | `id="app-name"`, label "Application name", placeholder "Quest Gate Pass" | `getByLabel('Application name')` |
| AppSettingsCard | Brand colour field | `id="app-brand-color"`, label "Brand colour", placeholder "Hash plus six hex digits" | `getByLabel('Brand colour')` |
| AppSettingsCard | Save button | "Save settings" / busy "Saving…" | `getByRole('button',{name:'Save settings'})` |
| AppSettingsCard | Success | "Saved." | `getByText('Saved.')` |
| AppSettingsCard | Last-changed footer | "Last changed {date} by {name}." | `getByText(/Last changed/)` |
| MailSettingsCard | Heading | "Approval email" | `getByRole('heading',{name:'Approval email'})` |
| MailSettingsCard | Override-to field | `id="mail-override-to"`, label "Send all approval mail to" | `getByLabel(...)` |
| MailSettingsCard | Sender name | `id="mail-from-name"`, label "Sender name" | `getByLabel('Sender name')` |
| MailSettingsCard | Sender address | `id="mail-from-email"`, label "Sender address" | `getByLabel('Sender address')` |
| MailSettingsCard | SMTP host | `id="mail-smtp-host"`, label "SMTP host" | `getByLabel('SMTP host')` |
| MailSettingsCard | SMTP port | `id="mail-smtp-port"`, label "Port" | `getByLabel('Port')` |
| MailSettingsCard | SMTP security | `id="mail-smtp-security"`, label "Security", blank option "Not set" | `getByLabel('Security')` |
| MailSettingsCard | SMTP username | `id="mail-smtp-username"`, label "SMTP username" | `getByLabel('SMTP username')` |
| MailSettingsCard | SMTP password | `id="mail-smtp-password"`, label "SMTP password", `type=password` | `getByLabel('SMTP password')` |
| MailSettingsCard | Save button | "Save mail settings" / busy "Saving…" | `getByRole('button',{name:'Save mail settings'})` |
| MailSettingsCard | Success | "Mail settings saved." | `getByText(...)` |
| LastSendNote | Success text | "Last letter delivered to {recipient}" | `getByText(/Last letter delivered/)` |
| LastSendNote | Failure text | "Last letter was refused" + "Aimed at {recipient}." | `getByText('Last letter was refused')` |
| SuperAdminsCard | Heading | "Super administrators" | `getByRole('heading',{name:'Super administrators'})` |
| SuperAdminsCard | List | `data-testid="super-admins"` | `getByTestId('super-admins')` — EXISTING |
| SuperAdminsCard | Row text | "{title} / Super Admin" then "{full_name}" (+ deactivated note) or "Not designated yet" | `getByText(...)` |
| SuperAdminsCard | Neither-seat-filled error | "Neither office is filled, so nobody can release a gate pass its approval ladder has stopped answering. Designate a CEO or a COO under Users." | `getByText(...)` |

### 2.8 Blacklist / Whitelist tabs `[researched]`

| Screen | Element | Exact text | Locator |
|---|---|---|---|
| BlacklistTab | Heading | "Blacklist" | `getByRole('heading',{name:'Blacklist'})` |
| BlacklistTab | Add toggle | "Add Entry" / "Cancel" (dynamic) | `getByRole('button',{name:/Add Entry|Cancel/})` |
| BlacklistTab | Type chip | "Vendor" (company) / "Vehicle" / "Driver" | `getByText(...)` |
| BlacklistTab | Row action: awaiting | "Awaiting CEO approval" (no button) | `getByText(...)` |
| BlacklistTab | Row action: request form open, textarea | placeholder "Why should this vendor be whitelisted?" | `getByPlaceholder(...)` |
| BlacklistTab | Justification blank error | "A justification is required — say why this vendor should be whitelisted." | `getByText(...)` |
| BlacklistTab | Justification short error | "Please give at least 10 characters of justification." (`MIN_JUSTIFICATION=10`) | `getByText(...)` |
| BlacklistTab | Send button | "Send for CEO Approval" / busy "Sending…" | `getByRole('button',{name:'Send for CEO Approval'})` |
| BlacklistTab | Row action: closed | "Request Whitelist" (link-style) | `getByRole('button',{name:'Request Whitelist'})` |
| BlacklistTab | Loading | 5 skeleton rows | `.skeleton` |
| BlacklistTab | Empty | "No blacklist entries. The blacklist is empty." | `getByText(...)` |
| BlacklistAddForm | Type select | `id="blacklist-type"`, label "Type", single option "Vendor" (value stays `company`) | `getByLabel('Type')` |
| BlacklistAddForm | Value field | `id="blacklist-value"`, label "Vendor Name", placeholder "Vendor name" | `getByLabel('Vendor Name')` |
| BlacklistAddForm | Value error | "Vendor name is required." | `getByText(...)` |
| BlacklistAddForm | Reason field | `id="blacklist-reason"`, label "Reason for blacklisting" | `getByLabel('Reason for blacklisting')` |
| BlacklistAddForm | Reason error | "Reason is required." | `getByText(...)` |
| BlacklistAddForm | Submit | "Add to Blacklist" / busy "Adding…" | `getByRole('button',{name:'Add to Blacklist'})` |
| WhitelistRequestsTab | Heading | "Whitelist of Vendors" | `getByRole('heading',{name:'Whitelist of Vendors'})` |
| WhitelistRequestsTab | Non-CEO note | "Only the designated CEO can approve or reject a whitelist request. You can still review them below." | `getByText(...)` |
| WhitelistRequestsTab | Loading | 3 skeleton rows | `.skeleton` |
| WhitelistRequestsTab | Overall empty | "No whitelist requests." | `getByText(...)` |
| WhitelistRequestsTab | Pending group empty | "No requests are waiting on the CEO." | `getByText(...)` |
| WhitelistKpiCards | Container | `data-testid="whitelist-kpis"`, `role="group"`, `aria-label="Whitelist figures"` | `getByTestId('whitelist-kpis')` — EXISTING; **not clickable, no drill target** |
| WhitelistRequestCard | Toggle | `aria-expanded`, `aria-controls={bodyId}` — real button | `getByRole('button',{name: /Vendor.*Pending|Approved|Rejected/})`, or filter by row content |
| WhitelistRequestCard | Expanded body | `data-testid="whitelist-request-details"`, `id="whitelist-request-${id}"` | `getByTestId('whitelist-request-details')` — EXISTING, one per open card |
| WhitelistDecisionControls | Approve step 1 | "Approve" | `getByRole('button',{name:'Approve'})` |
| WhitelistDecisionControls | Approve step 2 | "Sure?" + "Yes" / "No" | `getByRole('button',{name:'Yes'})` |
| WhitelistDecisionControls | Reject step 1 | "Reject" | `getByRole('button',{name:'Reject'})` |
| WhitelistDecisionControls | Reject textarea | placeholder "Reason for rejecting" | `getByPlaceholder('Reason for rejecting')` |
| WhitelistDecisionControls | Reject error | "A reason is required." | `getByText(...)` |
| WhitelistDecisionControls | Reject submit | "Submit Rejection" / busy "Rejecting…" | `getByRole('button',{name:'Submit Rejection'})` |
| EmergencyReleasesCard | Renders `null` if zero rows ever — no empty state UI | n/a | test must seed at least one release row to see this card at all |
| EmergencyReleasesCard | Heading | "Emergency releases" | `getByRole('heading',{name:'Emergency releases'})` |
| EmergencyReleasesCard | Summary (unreviewed>0) | "{n} still need(s) reviewing by an admin other than the one who released it/them." | `getByText(...)` |
| EmergencyReleasesCard | Summary (all reviewed) | "All of them have been reviewed." | `getByText(...)` |
| EmergencyReleasesCard | Self-released note | "You released this, so somebody else has to review it." — no controls shown (four-eyes rule) | `getByText(...)` |
| EmergencyReleasesCard | Review note input | `aria-label="Review note for {pass_number}"`, placeholder "Note (optional)" | `getByLabel(/Review note for/)` |
| EmergencyReleasesCard | Mark reviewed button | "Mark reviewed" | `getByRole('button',{name:'Mark reviewed'})` |
| EmergencyReleasesCard | Reviewed text | "Reviewed by {reviewed_name} on {date}" + optional " — {review_note}" | `getByText(/Reviewed by/)` |

### 2.9 Admin/Super Admin dashboards `[researched]`

`src/pages/Admin/AdminDashboard.tsx`, `DashboardDrill.tsx`, `SuperAdminDashboard.tsx`.

| Element | Exact text/attrs | Locator | Notes |
|---|---|---|---|
| Date-range select (AdminDashboard, ×2 instances) | `aria-label="Date range"` and `aria-label="Trend window"`, options "Today"/"Last 7 Days"(default)/"Last 30 Days"/"Last 90 Days" | `getByLabel('Date range')`, `getByLabel('Trend window')` | two separate selects bound to the SAME state — changing one must change the other's displayed value too |
| Overview cards group | `role="group" aria-label="Overview figures"` | `getByRole('group',{name:'Overview figures'})` | contains RGP / NRGP / Overdue Returns cards |
| Card label RGP | "RGP" | `getByRole('link',{name:/RGP/})` | value = `rgp.length`, links to `/admin-dashboard/rgp?days=N` |
| Card label NRGP | "NRGP" | `getByRole('link',{name:/NRGP/})` | value = `nrgp.length` |
| Card label Overdue Returns | "Overdue Returns" | `getByRole('link',{name:/Overdue Returns/})` | links to `/overdue` (no `?days=`, no drill object) |
| Desk sub-notes | pendingNotes text under each card, own `<Link>` | `getByText(...)` per card | running (not window-scoped) figures |
| Trend chart | `role="img" aria-label="Gate passes raised per day: RGP, NRGP"` | `getByRole('img',{name:/Gate passes raised per day/})` | |
| Trend day hit-target | `role="button" aria-label="{day.label}: {n} pass(es) raised"` | `getByRole('button',{name:/raised$/})` | full-height transparent rect, exported helper `dayKey(day)="day-{start}"` for internal targeting if needed |
| Status ring | `role="img" aria-label="Passes by status: {total} in total"` | `getByRole('img',{name:/Passes by status/})` | |
| Status slice button (non-zero) | `aria-pressed`, `aria-label="{label}: {value} pass(es), {share}%"` | `getByRole('button',{name:/pass(es)?,/})` | 5 fixed buckets always listed: Approved/Pending/Rejected/Returned/Overdue |
| Status slice (zero value) | non-clickable `<li>`, no button | n/a — assert it is NOT a button | |
| Drill-in-place region | `role="region" aria-label="Selected passes"` | `getByRole('region',{name:'Selected passes'})` | rendered when a trend day or status slice is clicked |
| Loading (cards) | figure text `—` | `getByText('—')` | |
| Loading (drill panel) | 6-row skeleton | `.skeleton` | |
| Empty drill | `def.empty` text (per-drill-type message), `.table-wrap.empty-state` | `getByText(<drill empty text>)` | |
| Error banner | `.gb-alert` div, dynamic text | `getByText(<error>)` | |
| DashboardDrill (`/admin-dashboard/:key`) | back link "Back to dashboard" | `getByRole('link',{name:'Back to dashboard'})` | `backTo=/admin-dashboard` |
| DashboardDrill count | `count={drill?.rows.length}` — **KPI invariant**: this count is the literal length of the array rendered below it, same object reference, no re-derivation | assert `count text === rows rendered` | unknown `:key` → redirect to `/admin-dashboard` |
| SuperAdminDashboard window select | `id="super-window"`, sr-only label "Window" | `getByLabel('Window')` | |
| SuperSummaryCards | `data-testid="super-card-raised"`, `data-testid="super-card-attention"` | `getByTestId('super-card-raised')` — EXISTING | group titles "Gate Passes Raised" / "Needs Attention" |
| SuperSummaryCards figures | RGP/NRGP under "raised"; Overdue Returns under "attention" | `getByRole('link',{name:...})` scoped within each testid group | |
| SuperQuickActions | 4 tiles | "Departments & Users"→`/admin`, "Reports"→`/all-passes`, "Activity Log"→`/activity`, "Emergency Releases"→`/admin` (points at Users tab, no dedicated page) | `getByRole('link',{name:...})` | Emergency Releases tile shows count "N release"/"N releases" only when `!loading` |

**KPI = rows.length invariant, confirmed by source read for this section**: `AdminDashboard`
card values are `rows.filter(...).length` at `src/lib/adminOverview.ts:169,185,208`
`[researched]`, and `DashboardDrill.tsx` re-derives the identical filtered array via the same
pure function rather than reading router state — test by asserting the drilled page's visible
row count equals the number shown on the card BEFORE navigating.

### 2.10 Activity Log `[researched]`

`src/pages/Admin/ActivityLogPage.tsx`, route `/activity`.

| Element | Exact text/attrs | Locator |
|---|---|---|
| Period tabs | `role="group" aria-label="Period"`, buttons "7 days" / "30 days" / "90 days" | `getByRole('group',{name:'Period'})` then `getByRole('button',{name:'7 days'})` etc |
| Export button | "Export CSV", `disabled` when `shown.length===0` | `getByRole('button',{name:'Export CSV'})` |
| Search input | `id="activity-search"`, placeholder "Pass number, person, or what happened…" | `getByPlaceholder('Pass number, person, or what happened…')` |
| Day filter | `id="activity-day"`, `type="date"`, `max={maxDay}` | `getByLabel(...)` or `#activity-day` |
| Reset button | "Reset" | `getByRole('button',{name:'Reset'})` |
| Table | `data-testid="activity-table"` | `getByTestId('activity-table')` — EXISTING |
| Row link | pass-number cell → `/pass/{id}` | `getByRole('link',{name:<pass number>})` |
| Footer count | "Showing {shown.length} of {rows.length} events in the last {days} days" | `getByText(/^Showing/)` |
| Empty | "Nothing was recorded in this window." | `getByText(...)` |
| Loading | 3 skeleton rows | `.skeleton` |
| **CSV columns** | When, Gate Pass, Event, Who, Details (all via `csvText`/`csvDateTime` — empty string for null, never em-dash) | n/a — inspect downloaded file content |
| **Screen/CSV divergence (test target)** | On-screen `Who` cell renders `r.who ?? '—'` (em dash) but `Details` cell renders `r.detail ?? ''` (blank) — inconsistent BETWEEN columns on screen; CSV is blank for both | assert screen Who-column em-dash vs CSV Who-column empty string |

### 2.11 Reports page (`/all-passes`, admin; `/reports`, HOD reuse) `[researched]`

`src/pages/Admin/ReportsPage.tsx` + `ReportsHeader.tsx` + `ReportsFilterBar.tsx` +
`ReportsKpiCards.tsx` + `ReportsTable.tsx`, pager = `src/components/guard/GuardPager.tsx` (NOT
`TablePager.tsx`).

| Element | Exact text/attrs | Locator |
|---|---|---|
| Export dropdown trigger | "Export ▾", `aria-haspopup="menu"`, `aria-expanded` | `getByRole('button',{name:'Export ▾'})` |
| Export menu | `role="menu"`, items `role="menuitem"`: "Spreadsheet (.csv)", "Print / PDF" | `getByRole('menuitem',{name:'Spreadsheet (.csv)'})` |
| Print shortcut | "Print" | `getByRole('button',{name:'Print'})` |
| Download shortcut | "Download" | `getByRole('button',{name:'Download'})` |
| From date | `aria-label="From date"`, `type=date`, `max={filters.to||today}` | `getByLabel('From date')` |
| To date | `aria-label="To date"`, `min={filters.from}`, `max={today}` | `getByLabel('To date')` |
| Quick range select | `aria-label="Quick range"`, options "Custom range" + presets ("Last 7 days"…"Last 1 year") | `getByLabel('Quick range')` |
| Pass Type select | `aria-label="Pass Type"`, options "All (RGP & NRGP)" / "RGP" / "NRGP" | `getByLabel('Pass Type')` |
| Status select | `aria-label="Status"`, options "All" / "Completed" / "Pending" / "Partially Returned" / "Cancelled" / "Pending Gate Review" / "Pending Approval" / "Overdue" / "Expired" | `getByLabel('Status')` |
| Created By select (admin only) | `aria-label="Created By"`, "All Users" + dynamic | `getByLabel('Created By')` |
| Department select (admin only) | `aria-label="Department"`, "All departments" + dynamic | `getByLabel('Department')` |
| Reset button | "Reset", `disabled` unless `type/status/createdBy/department` narrowed — **date range alone does NOT enable Reset** | `getByRole('button',{name:'Reset'})` |
| KPI cards (6, non-clickable) | "Total Passes", "RGP Passes", "NRGP Passes", "Completed", "Pending", "Partially Returned", `role="group" aria-label="Report figures"` | `getByRole('group',{name:'Report figures'})` — assert NO `href`/`onClick` on any card here |
| Table columns | Pass Number, Creation Date, Pass Type, Purpose/Description, Total Number of Items, Total Value of Items, Raised By Department (if showPeople), Status, Created By (if showPeople), kebab `aria-label="Actions"` | `getByRole('columnheader',{name:...})` |
| Row click | whole `<tr onClick>` → `/pass/{id}` | `page.getByRole('row').filter(...).click()` |
| Row kebab | `aria-label="Actions for {pass_number}"`, `aria-haspopup="menu"` | `getByLabel(/Actions for/)` |
| Kebab menu items | "View Details" (→`/pass/{id}`), "Print Pass" (→`/pass/{id}/print`) | `getByRole('menuitem',{name:'View Details'})` |
| Blank cells (department/raised-by) | `??  '—'` on screen | `getByText('—')` scoped to cell |
| CSV blank cells | `csvText` → `''`, never dash — **test the downloaded file, not the screen** | file assertion |
| Value cell | `'—'` on screen if `total<=0`/null; CSV: `String(Math.round(total))` or `''` if `<=0` — never dash in CSV | screen vs. file |
| Pager | GuardPager: "Showing {from} to {to} of {total} entries", `aria-label="Previous page"`/`"Next page"`, numbered buttons `aria-current="page"`, ellipsis as non-button `<span>` when >7 pages, "Rows per page" `aria-label`, options 10/25/50 (default 10) | `getByLabel('Rows per page')`, `getByRole('button',{name:'Next page'})` |
| Loading | `.gb-skeleton` inside `.gb-empty` | `.gb-skeleton` |
| Empty | "No passes match these filters." | `getByText(...)` |

**No `data-testid` anywhere in Reports* files** — target entirely by `aria-label` and text.

### 2.12 Pass record (`src/components/passview/**`, rendered at `/pass/:id`) `[researched]`

| Element | Exact text/attrs | Locator | Notes |
|---|---|---|---|
| Root | `data-testid="pass-record"` | `getByTestId('pass-record')` — EXISTING |
| Emergency banner | `data-testid="emergency-banner"` | `getByTestId('emergency-banner')` — conditional, `released` truthy |
| Send to Vendor | `data-testid="share-whatsapp"`, `<a href target=_blank rel=noopener noreferrer>` | `getByTestId('share-whatsapp')` — only when `whatsapp` prop truthy (readerRole==='hod') |
| Print Pass link | "Print Pass" → `/pass/{id}/print` | `getByRole('link',{name:'Print Pass'})` |
| Clear (stacked context only) | "Clear" (`btn-ghost`) | `getByRole('button',{name:'Clear'})` — not on `/pass/:id` route |
| Copy pass number | `aria-label="Copy pass number"` / `"Pass number copied"` (toggles for 1.5s) | `getByRole('button',{name:/Copy pass number|Pass number copied/})` |
| QR caption | "Scan to view pass" | `getByText('Scan to view pass')` |
| Return-locked banner | `data-testid="return-locked"`, text "Fully returned and closed" | `getByTestId('return-locked')` |
| Items-need-attention | `data-testid="items-need-attention"`, "Review pending items" button | `getByTestId('items-need-attention')` |
| Record N returns button | `data-testid="record-pass-returns"`, text "Record N return(s)" / busy "Recording…" | `getByTestId('record-pass-returns')` |
| Items table Quantity header | bare "Quantity" — **no unit in header**, per-cell via `qtyWithUnit()` | assert header text === "Quantity" exactly, cell text matches `/\d+ \w+/` |
| Items progress text | "X of Y items returned" | `getByText(/of \d+ items returned/)` — only `isRgp && !rejected && items.length>0` |
| Mark/Edit return buttons | "Mark return" / "Edit return" | `getByRole('button',{name:/Mark return|Edit return/})` scoped per row |
| Discard (draft line) | "Discard" | `getByRole('button',{name:'Discard'})` |
| Items total value | `data-testid="items-total-value"` | `getByTestId('items-total-value')` — only if `priced.length>0` |
| PassReturnBox | `role="dialog"`, `aria-label="Add Return ({item.name})"` | `getByRole('dialog',{name:/Add Return/})` |
| Return qty input | `id="pass-return-qty"`, `type=number`, no `min`/`max` HTML attrs (deliberate) | `getByLabel(...)` or `#pass-return-qty` |
| Return remarks input | `id="pass-return-remarks"`, `maxLength=200`, optional | `#pass-return-remarks` |
| Confirm Return | "Confirm Return" (submit) | `getByRole('button',{name:'Confirm Return'})` |
| Cancel (return box) | "Cancel", also closable via Escape (`useEscapeKey`) | `getByRole('button',{name:'Cancel'})` |
| Timeline aside | `data-testid="pass-timeline"` | `getByTestId('pass-timeline')` |
| Timeline return lines | `data-testid="timeline-return-lines"` | conditional `returnLines.length>0` |
| Timeline detail | `data-testid="timeline-detail"` | repeats per step |
| Timeline empty | "Nothing recorded at the gate yet." | `getByText(...)` |
| Emergency release button | `data-testid="emergency-release"` (whole card), button "Release without approval" | `getByTestId('emergency-release')` — whole component returns null if `!mayRelease` |
| Emergency modal title | "Release without the remaining approvals", `id="emergency-release-title"` | `getByRole('dialog',{name:'Release without the remaining approvals'})` |
| Emergency reason field | `id="emergency-reason"`, `maxLength=500` (`EMERGENCY_REASON_MAX`), label "Why is this being released? *" | `getByLabel(/Why is this being released/)` |
| Emergency char counter | "{short} more character(s) needed" (while <10, `EMERGENCY_REASON_MIN`) / "{length}/500" | `getByText(/more character/)` |
| Emergency cancel | "Cancel", disabled while submitting | `getByRole('button',{name:'Cancel'})` |
| Emergency submit | "Release this pass" / busy "Releasing…" | `getByRole('button',{name:'Release this pass'})` |
| Guard action card | `data-testid="record-actions"`, text "Everything on this pass checked? Clear it out at the gate." + link "Approve OUT" → `/verify/{id}` | `getByTestId('record-actions')` — only `canApprove` |
| Approval bar | `data-testid="record-approval-actions"` | `getByTestId('record-approval-actions')` — returns null unless routed pending approver |
| Decide-from-email banner | `data-testid="decide-from-email"` | conditional on `?decide=` query param |
| Approve button | "Approve" / busy "Working…" (`btn-approve`) | `getByTestId('record-approval-actions').getByRole('button',{name:'Approve'})` |
| Reject button | "Reject" (`btn-danger`) | scoped similarly |
| PassDetail dismiss (created banner) | `aria-label="Dismiss"`, × glyph | `getByRole('button',{name:'Dismiss'})` |
| PassDetail print-it-now link | "Print it now" → `/pass/{id}/print` | `getByRole('link',{name:'Print it now'})` |
| PassDetail not-found | "Back to dashboard" link → `/` | `getByRole('link',{name:'Back to dashboard'})` |

### 2.13 Print page (`/pass/:id/print`) `[researched]`

| Element | Exact text/attrs | Locator |
|---|---|---|
| Print trigger | "Print", `onClick={() => window.print()}` — click-triggered, NOT auto-fired | `getByRole('button',{name:'Print'})` |
| Back link | "Back" → `/pass/{id}` | `getByRole('link',{name:'Back'})` |
| No-print wrapper | `.no-print` class hides Back/Print controls when printing | assert via `@media print` emulation |
| Sheet | `.pass-sheet` (`print:p-0 print:max-w-none`), border `border-2 border-black bg-white text-black` — hardcoded literal black/white, not theme tokens | assert computed style, confirms "black-on-white, no colour-dependent info" |
| Qty column | header "Qty" (bare), cell via `quantityCell(item.quantity, item.unit)` | assert cell includes unit text |
| Value cells | local `formatCurrency`, renders `'—'` for null (not `0`) | `getByText('—')` in value column |
| Signature boxes | `PrintSignatureBoxes.tsx`, 3-column grid, all classes literal `text-black`/`border-black`, `aria-hidden` on the tick/cross/dash `Mark` glyph | no interactive elements |
| Sidebar/chrome | absent entirely — page renders outside `<AppShell>` (`App.tsx:244-250`) | assert no `nav`/sidebar element present |

**NEW (client, 2026-08-31): the CEO's signature box is print-only conditional**
(`src/lib/printCeoBox.ts`, `ceoBoxApplies`/`printedSteps`). The record ON SCREEN (`/pass/:id`,
not `/print`) still draws every rung including a skipped CEO one — this rule is print-exclusive.
The box survives printing in exactly four cases: the CEO approved or rejected level 3; the COO's
escalation window (`app_settings.coo_escalation_hours`) has run out with no COO decision; the
pass carries no COO rung at all (office vacant when raised); or a pre-`pass_approvals` pass whose
org-chart-derived ladder draws no COO rung either. Everything else (the COO signed it, still
holds the rung pending, or the rung closed `not_required`) drops the CEO box from the printed
sheet only. **Planned, not yet written**: a spec asserting the common case (COO signs level 3 →
printed sheet omits a CEO box, on-screen record still shows it as `not_required`) is
straightforward against the seeded ladder and belongs in this file's scope; the escalation-window
and vacant-COO-office cases both need state (a pass genuinely past `coo_escalation_hours`, or an
evicted COO seat) this harness's real-time UI driving and singleton-office seeding
(`tests/e2e/CONVENTIONS.md`) cannot safely produce, so those two branches are left as a
documented gap rather than seeded ad hoc.

### 2.14 Profile page `[researched]`

| Element | Exact text/attrs | Locator |
|---|---|---|
| Announce region | `aria-live="polite"`, `.sr-only` | for screen-reader assertions only |
| Name input | `id="profile-name"`, label bound via `htmlFor`, `maxLength=80` | `getByLabel(...)` (label text via ProfileDetails, exact string not captured verbatim by research — confirm at implementation time) |
| Submit | "Save" / busy "Saving…", `disabled` unless `dirty` | `getByRole('button',{name:'Save'})` |
| Error | `role="alert"` | `getByRole('alert')` |
| Read-only fields | Email, Role, Department, Member since (no inputs) | `getByText('Email')` etc |
| Photo upload trigger | "Upload photo" / "Change photo" / busy "Working…" | `getByRole('button',{name:/Upload photo|Change photo/})` |
| Hidden file input | `aria-label="Choose a profile photo"`, `accept="image/*"`, hidden, triggered via ref | `getByLabel('Choose a profile photo')` (Playwright can still set files on a hidden input via this locator) |
| Remove photo | "Remove" (only if `avatarUrl` set) | `getByRole('button',{name:'Remove'})` |
| Photo constraint text | "JPG, PNG or WebP · up to 2 MB" | `getByText(...)` |

---

## 3. Login error strings (from `src/lib/errors.ts`, full read)

`safeErrorMessage(err, fallback)` resolution order: (1) exact constraint-name match →
`CONSTRAINT_MESSAGES`; (2) `err.code` → `CODE_MESSAGES` (SQLSTATE/PostgREST) then
`AUTH_CODE_MESSAGES` (GoTrue); (3) `err.message` if not opaque (`{}`,`[]`,`[object Object]`,
`null`,`undefined`, exact-trimmed match only); (4) fallback string (Login's own fallback:
`'Could not sign in.'`).

| Trigger | Exact message |
|---|---|
| GoTrue `invalid_credentials` | "Incorrect email or password." |
| GoTrue `unexpected_failure` | "The authentication service could not complete that request. Please try again in a few minutes, and contact your administrator if it keeps happening." |
| GoTrue `email_not_confirmed` | "This account's email address has not been confirmed yet. Ask your administrator to confirm it." |
| GoTrue `over_request_rate_limit` | "Too many attempts. Please wait a few minutes and try again." |
| GoTrue `over_email_send_rate_limit` | "Too many emails have been requested recently — the sender allows only a few per hour. Please wait until the next hour and try again." |
| SQLSTATE `23505` (unique violation, generic) | "That record already exists." |
| SQLSTATE `23503` | "This action conflicts with related data." |
| SQLSTATE `23502` | "A required field is missing." |
| SQLSTATE `42501` | "You do not have permission to do that." |
| SQLSTATE `42P17` | "A database security policy is misconfigured. Please contact your administrator." |
| PostgREST `PGRST301` | "Your session has expired. Please sign in again." |
| PostgREST `PGRST116` | "That record could not be found." |
| Network failure (`Failed to fetch`/`NetworkError`/`network request failed`) | "Network error. Check your connection and try again." |
| Opaque message (`{}`,`[]`,etc.) | falls through to caller's fallback |
| Constraint `gate_passes_one_pending_per_material_idx` | "A pending gate pass already exists for this material in this department. Void it or have it verified at the gate before raising another." (dead index today, kept for un-migrated envs) |
| Constraint `gate_pass_items_one_open_per_material_idx` | *(retired — migration 073 dropped the index; the same material may be listed on as many lines as needed)* |
| Constraint `gate_pass_items_one_open_per_department_material_idx` | "Another open gate pass in this department already lists the same material. It must be returned or verified at the gate before this one can be raised." |
| Constraint `profiles_full_name_charset` | "A name can contain only letters, spaces, full stops, apostrophes and hyphens — no digits or other symbols." |
| Constraint `profiles_full_name_length` | "A name must be between 2 and 80 characters long." |
| Constraint `profiles_full_name_trimmed` | "A name cannot start or end with a space." |
| Login's own fallback | "Could not sign in." |

**P3 test note**: `23514` (generic check-constraint) is deliberately unmapped — expect the raw
Postgres message verbatim for any check constraint NOT in `CONSTRAINT_MESSAGES` above; do not
assert a friendly sentence for those.

**`?next=` deep-link on Login**: see §1.4.

---

## 4. Admin write-flows — steps, exact button/modal text, and what each mutates

| # | Flow | Steps (exact button text) | Mutates |
|---|---|---|---|
| W1 | Create department | Departments tab → "Add Department" → fill "Department Name"/"Code" → "Add Department" (submit) | `INSERT public.departments` (via `pub()`), VMS-shared table — **admin UI must show the cross-app warning per CLAUDE.md** |
| W2 | Edit department | Departments tab → row edit icon (`title="Edit department"`) → edit fields → "Save Changes" | `gp().rpc('admin_update_department', {p_dept_id,p_name,p_code})` |
| W3 | Request department deletion (has HODs) | row delete icon → fill reason → "Send Deletion Request" | `gp().rpc('admin_delete_department', {p_dept_id,p_reason})` → creates a pending request, department NOT deleted yet; HOD must approve |
| W3b | Delete department (no HODs) | same modal, button reads "Delete Department" instead | same RPC, immediate `DELETE public.departments` row + cascades `hod_departments` |
| W3c | Withdraw deletion request | "Withdraw request" link on pending-deletion banner | `gp().rpc('admin_withdraw_department_delete', {p_request_id})` |
| W4 | Assign HOD | "Assign HOD" → select HOD + Department → "Assign HOD" (submit) | delete-then-insert on `gp().from('hod_departments')` — one department per person enforced |
| W5 | Create user (guard/hod) | Users tab → "Add User" → Email/Password/Full Name/Role(+Dept if hod) → "Create User" | `gp().rpc('admin_create_user', {...})` — writes `app_metadata.role` + `profiles` row (VMS-shared `auth.users`/`profiles`) |
| W5b | Create user (approval office) | same modal, Role = office (Security Head/COO/Finance HOD/CEO) | same RPC + implicitly seats the office (displaces prior holder if occupied — modal warns) |
| W6 | Edit user | Users tab → row "Edit" → change Full Name/Role/Dept → "Save Changes" | sequence: `gp().rpc('clear_approval_role')` (if leaving office) → `gp().rpc('admin_update_user', {...})` → `gp().rpc('set_approval_role')` (if entering office) |
| W7 | Deactivate user | row "Deactivate" → confirm modal → "Deactivate" | `gp().rpc('admin_soft_delete_user', {p_user_id})` — writes `gatepass.user_status`, deletes all `auth.sessions` rows, vacates any held office (irreversible for the office; role/dept preserved) |
| W8 | Reactivate user (has role) | row "Reactivate" | `gp().rpc('admin_reactivate_user', {p_user_id})` directly, no modal |
| W8b | Reactivate user (bare staff, no role) | row "Reactivate" → role-choice modal → pick Guard/HOD(+Dept) → "Reactivate" | `gp().rpc('admin_update_user')` then `gp().rpc('admin_reactivate_user')` — sequential, and note: on error the UI STILL calls `onReactivated()` since the role write may have partially succeeded |
| W9 | Reset user's password | Edit User modal → "Reset Password" → type/generate password → "Set New Password" | `gp().rpc('admin_reset_user_password', {p_user_id,p_password})` — deletes all sessions, forces `mustChangePassword` on next sign-in; password shown once, never re-fetchable |
| W10 | Designate approval office holder | Users or Functional Roles tab → Approval Ladder card → holder select → pick person | `gp().rpc('set_approval_role', {p_role_key,p_user_id})` (or `clear_approval_role` for blank) |
| W12 | Change app setting | Settings tab → App Settings card → edit field(s) → "Save settings" | `gp().rpc('set_app_settings', payload)` — session-timeout minutes takes effect immediately per file comment |
| W13 | Change mail settings | Settings tab → Mail Settings card → edit field(s) → "Save mail settings" | `gp().rpc('set_mail_settings', payload)` — SMTP password write-only, never round-trips |
| W14 | Add to blacklist | Blacklist tab → "Add Entry" → fill Type/Vendor Name/Reason → "Add to Blacklist" | `gp().rpc('add_blacklist_entry', {p_list_type,p_list_value,p_reason})` — **note: no removal RPC exists** (dropped in migration 039) — a blacklist entry is add-only from this UI |
| W15 | Request vendor whitelist | Blacklist tab → row "Request Whitelist" → justification textarea (≥10 chars) → "Send for CEO Approval" | `gp().rpc('request_vendor_whitelist', {p_blacklist_id,p_justification})` |
| W16 | Decide whitelist request (CEO only) | Whitelist tab → expand card → "Approve"→"Yes" or "Reject"→reason→"Submit Rejection" | `gp().rpc('approve_whitelist_request', {p_id})` or `gp().rpc('reject_whitelist_request', {p_id,p_note})` — RLS refuses non-CEO regardless of UI |
| W17 | Review emergency release | Users tab → Emergency Releases card → (skip if self-released) → optional note → "Mark reviewed" | `review_emergency_release` RPC (via `src/lib/emergencyRelease.ts:reviewEmergencyRelease`) — four-eyes: cannot review your own release |
| W18 | Emergency release a stuck pass | Pass record → EmergencyReleaseBar "Release without approval" → modal → reason (≥10 chars) → "Release this pass" | `gp().rpc('emergency_release_pass', {p_pass_id,p_reason})` — irreversible, clears remaining approvals, prints on record, emails whole ladder |

**Destructive/irreversible flows to flag in test authoring**: W3b (immediate department delete,
no undo), W7 (deactivation kills sessions immediately), W9 (password shown exactly once), W14
(blacklist entry cannot be removed via UI), W18 (emergency release cannot be undone, bypasses the
approval ladder). Every one of these needs a dedicated test DB/branch, never the shared dev
project, per the "Data preconditions" section below.

---

## 5. Test cases

Numbering: `P3-NN`. Each states id, title, preconditions, steps, assertions. This is a
representative exhaustive set per the brief's categories — a code-generating agent should expand
per-role and per-field variants using the selector tables above as the source of truth for exact
text.

### Route/access (§1)

- **P3-01** — Unauthenticated request to every P3 route redirects to `/login?next=<path>`.
  Preconditions: no session. Steps: for each route in §1.2, `page.goto(route)`. Assertions: URL is
  `/login?next=${encodeURIComponent(route)}`; Login form renders.
- **P3-02** — `/reset-password` renders regardless of session state. Preconditions: (a) no
  session, (b) valid session, (c) valid recovery-token session. Steps: `page.goto('/reset-password')`
  in each state. Assertions: `ResetPassword` component renders in all three; no redirect happens.
- **P3-03** — Each non-home route for a role redirects to that role's exact `homeFor()` value.
  Preconditions: sign in as each of guard/hod/admin/super_admin/staff/office (7 sessions incl.
  office-holding-admin, see P3-04). Steps: visit every route forbidden to that role (§1.2 table).
  Assertions: final URL === `homeFor()` value from §1.2; browser history entry for the forbidden
  URL is NOT navigable back to (used `replace`).
- **P3-03a** — **NEW (migration 069)**, `/raise` and `/my-passes` split within "office". As
  `secHead` and as `finHead`: both redirect R→`/approvals` from `/raise` and `/my-passes`. As
  `coo` and as `ceo`: both are **A** on `/raise` and `/my-passes`. Not yet implemented as a spec
  (`raisePass()` in `tests/e2e/helpers/lifecycle.ts` has no Department-select step for the
  raising-office form) — see the P1 plan's "Planned, not yet written" note for the recommended
  helper change.
- **P3-04** — An admin who ALSO holds an approval office keeps every admin route AND gains
  `/approvals`/`/delegation`/`/whitelist`. Preconditions: seed an admin account, then
  `set_approval_role` it to e.g. Finance HOD. Steps: sign in, visit `/admin`, `/admin-dashboard`,
  `/all-passes`, `/activity`, `/approvals`, `/delegation`, `/whitelist`. Assertions: all seven
  render (no redirect); sidebar shows BOTH the admin tab set AND "Pending for My Approval" +
  "Delegation".
- **P3-05** — A non-admin office holder (e.g. Security Head with underlying `guard` role) loses
  every guard route. Preconditions: seed a guard account, `set_approval_role` Security Head.
  Steps: visit `/guard-dashboard`, `/console`, `/overdue`, `/returns`. Assertions: every one
  redirects to `/approvals` (the office's home), confirming `officeReplacesRole` — this is the
  documented 2026-08-22 client-driven reversal; do not assume the guard screens remain reachable.
- **P3-06** — `mustChangePassword` gate wins over every other gate. Preconditions: admin resets a
  test user's password (W9). Steps: sign in as that user, then attempt `page.goto('/admin')` (as
  an admin) or any other route. Assertions: `ForcePasswordChange` renders regardless of URL typed;
  after `set_my_password` succeeds and the flag re-reads false, the SAME session lands on
  `homeFor(role)`.
- **P3-07** — `deactivated` gate renders `NoAccess` with the deactivated variant, and typing any
  URL doesn't escape it. Preconditions: deactivate a test user (W7) while they hold an open
  session (or re-authenticate after deactivation). Steps: visit `/admin-dashboard`, `/pass/<id>`,
  etc. Assertions: `NoAccess` (deactivated heading + body) renders for every path; "Sign Out"
  button works.
- **P3-08** — `/pass/:id/print` renders with zero chrome. Preconditions: signed-in HOD, existing
  pass id. Steps: `page.goto('/pass/<id>/print')`. Assertions: no `nav`/sidebar/`NotificationBell`
  element in DOM; "Print" and "Back" buttons present; `SessionTimeout` modal absent from DOM
  (AppShell not mounted).
- **P3-09** — Deep-link `?next=` matrix (§1.4). Preconditions: none, per row. Steps: for each row
  in the §1.4 table, `page.goto('/login?next=' + encodeURIComponent(nextValue))`, then sign in as
  an HOD. Assertions: resumed URL matches the table's "Resumed?" column exactly; the two
  open-redirect payloads (`//evil.example/x`, `\evil.example`) never leave `location.origin`.

### Login (§2.1, §3)

- **P3-10** — Happy path sign-in. Steps: fill Email/Password, click "Sign In". Assertions: lands
  on `homeFor(role)`.
- **P3-11** — Invalid credentials shows exact GoTrue message. Steps: submit wrong password.
  Assertions: `getByText('Incorrect email or password.')` visible; form remains editable; no
  navigation occurred.
- **P3-12** — Show/hide password toggle. Steps: type in Password field, click the eye icon.
  Assertions: `input[type]` toggles `password`↔`text`; `aria-label` toggles
  `'Show password'`↔`'Hide password'`.
- **P3-13** — Busy state disables the form. Steps: submit, before response resolves. Assertions:
  button text is "Signing in…", `disabled` true.
- **P3-14** — Forgot-password affordance is a `mailto:` link only, no self-service flow.
  Assertions: `getByRole('link', {name: 'admin@demo.vms'})` has `href="mailto:admin@demo.vms"`; no
  "Forgot password?" BUTTON exists anywhere on the page (only the sentence).
- **P3-15** — Each error-message row in §3 renders verbatim for its trigger (network failure,
  rate limit, unconfirmed email, etc.) — one test per row, mocking the Supabase response.

### Admin write-flows (§4) — one happy + one validation/duplicate case each

- **P3-16** — W1 create department happy path + W1-dup: creating with an existing code shows
  'Department "{code}" already exists.' and does not close the modal.
- **P3-17** — W3/W3b: deleting a department WITH an HOD creates a pending request (banner "Deletion
  waiting with the HOD" appears, department still listed); deleting one WITHOUT an HOD removes it
  immediately (row disappears from `department-rows`).
- **P3-18** — W4 assign HOD happy path + duplicate: assigning the same HOD to the same department
  twice shows "That HOD is already assigned to this department."; assigning a second department to
  an already-assigned HOD (one-department-per-person, migration 032) must be rejected — assert the
  UI blocks or the RPC errors, whichever the implementation does (verify empirically, this plan
  does not assume which).
- **P3-19** — W5/W5b create user: guard/HOD happy path; office happy path shows the
  "will only be able to see and act on..." info box and, if occupied, the displacement warning
  with the CURRENT holder's name.
- **P3-20** — W6 edit user: moving FROM one office TO another triggers `clear_approval_role` then
  `set_approval_role` (assert via network trace or resulting ladder state, not just UI text);
  moving out of an office with no replacement shows the vacate warning and the ladder shows "Not
  designated yet" afterward.
- **P3-21** — W7 deactivate: confirm modal shows office-vacate warning ONLY when the user holds an
  office (`data-testid="deactivate-vacates-office"` present/absent correctly); after confirming,
  row moves to "Inactive" filter tab and disappears from "All"/"HOD"/"Guard"/"Admin" tabs.
- **P3-22** — W8/W8b reactivate: a suspended guard/HOD reactivates with one click (no modal); a
  suspended bare-`staff` account opens the role-choice modal and cannot be reactivated without
  picking Guard or HOD (submit disabled until role chosen).
- **P3-23** — W9 reset password: after "Set New Password", the plaintext is shown exactly once
  with a working "Copy" button; closing via "Done" and reopening "Reset Password" shows the
  collapsed state again (password is NOT retrievable a second time).
- **P3-24** — W10 ladder: designating a holder via the select immediately reflects in the
  "Level N · Title" row. There is ONE select per office — 068 removed the standing deputy.
- **P3-25** — W12 app settings: session-timeout field accepts only the documented numeric range
  (verify min/max from `SESSION_TIMEOUT_MIN=5`/`MAX=1440` empirically against `SettingField`'s
  validation); "Require two-factor authentication for approvers" checkbox toggles and persists but
  — per CLAUDE.md's explicit landmine — enforces NOTHING; a test should assert the checkbox state
  round-trips on reload but must NOT assert any behavioral gate exists behind it.
- **P3-26** — W13 mail settings: SMTP password field never pre-fills from the server (always
  blank on load, even after a previous save) — hint text differs depending on whether
  `smtp_password_set` is true.
- **P3-27** — W14 blacklist add + W14-dup validation: blank vendor name shows "Vendor name is
  required."; blank reason shows "Reason is required."; after adding, no delete/remove control
  exists anywhere on the row (assert absence).
- **P3-28** — W15/W16 whitelist: request with <10-char justification shows "Please give at least
  10 characters of justification."; as a non-CEO, decision controls are absent from an expanded
  card even though the card itself is viewable; as CEO, Approve requires the two-step "Sure?" → "Yes"
  confirm (assert clicking "Approve" alone does NOT mutate anything).
- **P3-29** — W17/W18 emergency release: the releasing admin cannot review their own release (no
  input/button rendered, only "You released this, so somebody else has to review it."); reason
  <10 chars keeps "Release this pass" effectively blocked (character-count hint visible,
  assert whether the button is `disabled` or the RPC rejects — verify empirically).

### Dashboard invariant, charts, filters, pagination (§2.9–§2.11)

- **P3-30** — For every Overview card (RGP, NRGP) on `/admin-dashboard`: read the displayed
  number, click through to `/admin-dashboard/<key>?days=N`, assert the drill page's row count
  (`DrillList`/`DrillPageShell` count prop) exactly equals the number read before navigating, and
  the number of rendered table rows equals that count too.
- **P3-31** — Changing the date-range select updates BOTH the header chip and the trend-window
  chip to the same value, and changes the RGP/NRGP card figures (assert the number actually
  changes when switching Today → Last 90 Days on a seeded dataset spanning that range).
- **P3-32** — Trend chart day click opens an in-place drill (`role="region" aria-label="Selected
  passes"`) without a URL change, and its row count matches the day's aria-label figure
  (`"{label}: {n} pass(es) raised"`).
- **P3-33** — Status ring: a zero-value slice renders as a non-interactive `<li>`, never a button;
  a non-zero slice is `aria-pressed` and toggles the drill region open/closed on repeat clicks.
- **P3-34** — SuperAdminDashboard: figures under "Gate Passes Raised" and "Needs Attention"
  (`super-card-raised`/`super-card-attention`) equal the SAME underlying values as AdminDashboard's
  RGP/NRGP/Overdue Returns for an admin session on identical data (cross-check both boards against
  one seeded dataset).
- **P3-35** — ReportsKpiCards are confirmed non-interactive: assert none of the 6 cards render as
  `<a>`/`<button>`/have an `onClick` — clicking anywhere on a card does not navigate.
- **P3-36** — ReportsFilterBar: changing any filter applies immediately (no separate Apply
  button exists — assert absence of any button literally named "Apply"); "Reset" stays disabled
  while only the date range differs from default, and enables once Pass Type/Status/Created
  By/Department is touched.
- **P3-37** — CSV export content matches the screen's label maps but never an em-dash: export from
  Reports and from Activity Log, open the file, assert every blank cell is `''` not `'—'`, and
  every populated cell's label matches `csvStatus`/`csvReturnStatus`/`csvCategory` output (same
  string as the on-screen badge).
- **P3-38** — GuardPager on Reports: "Rows per page" defaults to 10; changing it to 25/50 changes
  the row count and resets to page 1; "Next page"/"Previous page" disable at the boundaries;
  ellipsis renders as a non-clickable `<span>` (not a button) once page count exceeds 7.
- **P3-39** — Print/PDF from Reports: clicking "Print / PDF" or "Print" temporarily expands the
  page size to the full filtered row count (`Math.max(scoped.length,1)`) before calling
  `window.print()`, then restores the prior page size — assert via the pager's displayed row
  count before/during/after (mock `window.print`).

### Print page (§2.13)

- **P3-40** — Print page renders black-on-white with no color-dependent info: assert computed
  `background-color` of `.pass-sheet` is white and `color`/`border-color` are black regardless of
  the app's dark/light theme setting (set `localStorage['gatepass-theme']='dark'` before
  navigating, confirm the print sheet is unaffected — literal hex, not tokens).
- **P3-41** — `window.print()` is click-triggered only: stub `window.print`, load the page, assert
  zero calls; click "Print"; assert exactly one call.
- **P3-42** — Qty column: header text is exactly "Qty" (no unit suffix); every cell includes the
  line's unit via `quantityCell`.

### Emergency release / approval bar (§2.12)

- **P3-43** — `EmergencyReleaseBar` renders `null` (absent from DOM) for every role/session EXCEPT
  super_admin-unconditionally, or a COO/CEO fallback holder on a pass that is
  `pending && owes>=1 pending level && pass_is_stuck`. Test all four negative cases (guard, HOD,
  admin without fallback, COO/CEO on a NON-stuck pass) assert absence; test the positive case
  assert presence with the "Release without approval" button.
- **P3-44** — `ApprovalDecisionBar` renders nothing unless the reader IS the currently-routed
  pending approver on a still-pending pass; renders a sentence-only (no buttons) variant when
  routed but not yet reachable (earlier office still deciding); renders full Approve/Reject
  buttons only in the exact-turn case.
- **P3-45** — Reject requires a typed reason via `RejectApprovalModal` (out of directly-cited
  scope but reachable from `ApprovalDecisionBar`'s Reject button) — verify empirically that no
  native `confirm()` appears (assert `page.on('dialog')` never fires across this whole flow).

### Empty/loading states (cross-cutting)

- **P3-46** — For every list screen in scope (Departments, Users, Blacklist, Whitelist, Activity
  Log, Reports, Admin dashboard drill, Overdue/Returns pages), assert: (a) on a fresh/slow network
  the skeleton row count matches the documented constant (`SKELETON_ROWS` per file, or the
  hardcoded literal e.g. 3/4/5/6), (b) once loaded with zero rows the exact empty-state string
  from the tables above renders, (c) once loaded with N rows, all N render and no skeleton
  remains.

### Notification bell, theme toggle, session timeout, offline banner (chrome)

- **P3-47** — Notification bell badge shows nothing at 0 unread, the literal count at 1–99, and
  "99+" at 100+; clicking a notification of type `approval` navigates to `/pass/{id}` WITHOUT
  dismissing it (queue persists); clicking a `dept_delete` notification navigates to `/dashboard`
  and DOES dismiss; clicking a `flagged`/`expired` notification navigates to
  `/mismatch/{id}`/`/expired/{id}` respectively.
- **P3-48** — Theme toggle: click "Toggle theme", assert `<html>` gains/loses `.dark` class,
  button's visible label flips to name the OPPOSITE mode, and `localStorage['gatepass-theme']`
  persists the new value across a reload. Default (no stored value) is `'dark'` — NOT
  `prefers-color-scheme` — assert this explicitly by clearing localStorage and emulating a
  light-preferring OS, expecting dark anyway.
- **P3-49** — Sidebar is visually dark in both themes: assert `.shell-sidebar`'s computed
  `background-color` is identical whether `.dark` is present on `<html>` or not.
- **P3-50** — SessionTimeout: simulate `IDLE_TIMEOUT_MS` of inactivity (use the admin-configured
  value from W12, or the 5-minute default — mock timers, do not literally wait 5 minutes), assert
  the modal appears with heading "Session Timeout" and the exact idle-minutes sentence; "Keep
  session" resets the timer and closes the modal WITHOUT calling `signOut`; letting the 60-second
  countdown expire calls `signOut` and returns to `/login`; ordinary mouse/keyboard activity resets
  the pre-prompt timer but does NOT dismiss the prompt once it is already visible.
- **P3-51** — OfflineBanner: force `navigator.onLine=false` and fire a `window` `'offline'` event;
  assert `role="status"` banner appears with the exact heading/body text; fire `'online'`; assert
  it disappears. Confirm it is entirely absent (not just hidden) when online from page load.
- **P3-52** — Sidebar collapse: click the collapse handle, assert `aria-expanded` flips,
  `localStorage['gatepass-sidebar-collapsed']` persists `'1'`/`'0'`, and a reload preserves the
  collapsed state.

### Accessibility

- **P3-53** — Keyboard tab order on Login: Tab from page load reaches Email → Password → show/hide
  toggle → Sign In button, in that order, with visible focus rings; Enter on the password field
  submits the form.
- **P3-54** — Modal focus: opening any `ModalShell`-based modal (Add User, Delete Department,
  Emergency Release, etc.) — assert Escape closes it (`useEscapeKey`) and backdrop click closes it
  (`onClick` on `.modal-overlay`); **explicitly assert NO focus trap exists** — Tab can leave the
  modal into the page behind it, per the researched fact that no focus-trap/tabindex-cycling code
  was found in `ModalShell.tsx`. This is a documented gap, not a false negative — file it as a
  finding, do not treat trap-absence as a test bug.
- **P3-55** — Every form control referenced by `getByLabel(...)` in §2 resolves to exactly one
  element bound via `<label htmlFor>` or `aria-label` — run this as a blanket per-screen check
  rather than one test per field.
- **P3-56** — Heading hierarchy: each screen has exactly one `h1`/`page-title`, and nested section
  headings (`h2`/`h3`) do not skip a level (spot-check AdminPanel, Reports, Profile, NoAccess).
- **P3-57** — SidebarProfile sign-out button has only `title="Sign out"`, no `aria-label` — assert
  Playwright's computed accessible name still resolves to "Sign out" (title-derived); flag this in
  the report as the one a11y gap the research surfaced (§9 also lists it as a recommended
  improvement, though `title`-derived accessible names are valid per ARIA, so this is informational
  rather than a hard fail).
- **P3-58** — No native browser dialog ever appears anywhere in this scope: attach
  `page.on('dialog', d => { throw new Error('native dialog: ' + d.message()); })` for the FULL
  test session across every write-flow in §4 and every destructive action (deactivate, delete
  department, reject approval, emergency release) — CLAUDE.md forbids `window.alert/confirm/prompt`
  everywhere except `window.print()`.

---

## 6. Design-system assertion list

| CLAUDE.md rule | Playwright assertion |
|---|---|
| No `font-bold` on `font-display` | For every element carrying `font-display` in class list (grep-driven target list: `QuestLockup`'s "QUEST" span, every `page-title`/heading using the serif), assert computed `font-weight === '400'`, never `700`. Confirmed by research: zero violations found in the 18 layout/auth files read — this is a regression guard, not an expected finding. |
| Headings carry a `dark:` variant OR are a documented literal-color exemption | For every heading NOT on a fixed-context surface (Login, AuthField, ForcePasswordChange, ResetPassword, printed slip — all exempt per CLAUDE.md), assert the class list contains a `dark:` prefixed color utility alongside the base one. For the exempt surfaces, instead assert the color is a literal hex (inline `style`) that does NOT change when `.dark` toggles — confirms it's deliberately fixed, not an oversight. |
| Sidebar dark in both themes | `.shell-sidebar` computed `background-color` must equal `#16161A`'s rendered RGB regardless of `<html>.dark` presence — see P3-49. Source: `index.css:1183-1189` — literal hex, explicit "never dark: variant" comment `[researched]`. |
| Text on gold is charcoal, never white | `.sidebar-link-active` computed `color` must be near-black (`#101014`), never white/near-white — assert contrast ratio against the gold gradient background exceeds ~9:1, not ~2.4:1. Source confirmed `[researched]`: `color:#101014; background: linear-gradient(135deg,#D0AD68,#C6A15B)`. |
| Rupee values exact, never abbreviated | Search every rendered page containing a currency figure (Reports table Total Value, PassRecordSummary Total Value, PassPrint value cells) for the regex `/₹\d/` and assert NONE of them match `/₹[\d.]+[KMk]\b/` (the forbidden `₹3.1K` shape); assert the format matches `'₹' + toLocaleString('en-IN')` grouping (e.g. `₹1,00,000` not `₹100000` or `₹1,000,00`). |
| A quantity always names its unit | Every Qty/Quantity cell across Items tables, Reports, and the print sheet: assert cell text matches `/\d+(\.\d+)?\s+\S+/` (number + unit token) OR the bare number ONLY for a genuinely unitless line (confirm via `unitLabel` fallback `'—'` case) — and assert the COLUMN HEADER itself never contains a unit string (bare "Quantity"/"Qty"). |
| No chart draws in brand gold | `OverviewTrend`/`OverviewStatus` SVGs: assert no `fill`/`stroke` computed value resolves to the brand-600 hex (`#C6A15B`) or its gradient stops — series must use blue/violet/teal per `chartPalette.ts` (not in P3 scope to read, but the assertion is checkable purely by sampling rendered SVG element colors). |
| CSV exports say what the screen says, empty is empty not em-dash | See P3-37. Also: assert the CSV column's status/category/return-status text is byte-identical to the on-screen `Badge`'s visible label for the same row (both derive from the same `*_STYLES` map per `src/lib/statusStyles.ts`, `src/lib/rgpLifecycle.ts` — confirmed `[researched]`). |
| Never `window.alert/confirm/prompt` | See P3-58 — session-wide dialog listener across all P3 flows. |

---

## 7. Data preconditions and known landmines

### Data preconditions

- **Isolated test data required** for every destructive flow in §4 (W3b delete department, W7
  deactivate, W9 password reset, W14 blacklist add with no removal path, W18 emergency release) —
  never run these against the shared dev Supabase project (`oxzzeonftrmohdrancex`). Use a
  Supabase branch or a dedicated seed/teardown pass per CLAUDE.md's "Applying migrations" section
  (a `scripts/verify-0NN.mjs`-style probe-and-clean pattern, not raw `postgres` role usage which
  bypasses RLS and proves nothing).
- **Role fixtures needed**: guard, hod (with ≥1 department), admin, super_admin (COO or CEO
  holder, since super_admin is a fallback per migration 067 — there is no standing super_admin
  account, "the one that existed was stripped and suspended on 2026-08-24" per CLAUDE.md), staff
  (no role), and each of the four office holders (Security Head, Finance HOD, COO, CEO) as
  standalone `staff`-role accounts per migration 046, PLUS one admin-holding-an-office fixture for
  P3-04.
- **Pass fixtures needed**: at least one RGP pending pass, one RGP awaiting return, one RGP
  partially returned, one RGP fully returned, one NRGP, one flagged, one hod_reviewed, one
  cancelled, one expired-but-still-pending (for `isExpiredPending`), one "stuck" pass (pending,
  owing a signature, past `coo_escalation_hours`) for emergency-release testing, one pass with an
  emergency release already applied (for the reviewed/unreviewed EmergencyReleasesCard states).
- **Department fixtures**: at least one department with zero HODs (immediate-delete path), one
  with exactly one HOD (single-approval-request path), one with no departments at all seeded (for
  the "Awaiting an HOD" KPI and empty states).
- **Blacklist/whitelist fixtures**: at least one blacklist entry with no whitelist request (shows
  "Request Whitelist"), one with a pending request (shows "Awaiting CEO approval"), one approved,
  one rejected — for WhitelistRequestsTab's three groups.
- **Activity/Reports date range fixtures**: passes spread across the last 90+ days to exercise
  every `OVERVIEW_WINDOWS`/`RANGE_PRESETS` bucket meaningfully (a "Today" vs "Last 90 Days" test
  is meaningless against data all created in the same minute).

### Known landmines (from CLAUDE.md + this session's research)

- **Realtime silent refresh**: `postgres_changes` subscriptions on `gatepass.gate_passes` (and, in
  `DepartmentsTab.tsx`, on `public.departments`/`gatepass.hod_departments`) always call
  `load(true)` to refresh WITHOUT flashing a loading state. A Playwright test asserting "KPI
  updates after a background mutation" must NOT expect a skeleton to reappear — assert the number
  changes in place instead.
- **`window.print()`**: the one legitimate native-dialog-adjacent call, must remain click-triggered
  — P3-41 pins this. Do not confuse with the forbidden `alert/confirm/prompt`.
- **Avatar upload**: 2MB cap, `image/*` only, fixed storage path `{userId}/avatar` (upsert, no
  extension) — a re-upload OVERWRITES, it does not create a new object; cache-busted via `?t=`
  query param, so a Playwright screenshot-diff test must wait for the new URL, not just "upload
  completed".
- **Modal overlays never use `window.confirm`** — every destructive action (deactivate, delete
  department, reject flag, emergency release) is its own in-flow confirmation panel. A test
  looking for a native confirm dialog on any of these will find none — that is correct behavior,
  not a bug (see P3-58).
- **No focus trap in `ModalShell`** — confirmed absence, not a testing gap. Do not fail a test
  suite over Tab escaping a modal; document it as a product gap instead (P3-54).
- **`DepartmentsTab.tsx` is 594 lines**, violating the project's own 300-line-per-file convention.
  Irrelevant to test PASS/FAIL but worth noting if this plan is later used to justify a refactor —
  a refactor would very likely rename/relocate the selectors documented in §2.5, so re-verify that
  section after any such change.
- **SidebarProfile sign-out has no `aria-label`**, only `title` — see P3-57, informational not a
  failure.
- **`AppShell.tsx` comment flags a known gap**: `NotificationBell` and `Sidebar` render as fixed
  siblings OUTSIDE the theme-aware content div, so they "keep dark house theme always" and don't
  follow `.gb-main`'s light lock — relevant if a test asserts theme-consistency across the WHOLE
  viewport rather than just `.gb-main`; the sidebar/bell being dark-always is correct per CLAUDE.md
  ("Shell...DARK IN BOTH THEMES"), not a bug.
- **`officeReplacesRole`'s admin exemption (§1.3) has no cited dedicated test** in the current
  suite per this research — treat P3-04 as covering a real gap, not a redundant check.
- **`Awaiting an HOD` KPI card on Departments tab is NOT clickable** (plain div, no `onClick`) —
  unlike every other KPI in the app, this one breaks the "KPI is a link" pattern deliberately, per
  the fact-dump. Do not write a test expecting it to drill anywhere.
- **`ReportsKpiCards` are deliberately non-interactive** (§2.11) — same caution, opposite of
  `OverviewCards`. A test suite that assumes ALL KPI cards drill (per the general CLAUDE.md rule)
  must special-case this screen.
- **CSV injection guard** in `exportUtils.ts`: any cell value starting with `= + - @ \t \r`
  (excluding plain negative numbers) is prefixed with a tab to defuse spreadsheet formula
  injection — a targeted test case belongs here if a blacklist/vendor-name field can contain such
  characters (e.g. a vendor named `=SUM(A1:A9)`).

---

## 8. Files read/researched, for traceability

Direct reads this session: `CLAUDE.md` (root), `src/App.tsx`, `src/lib/roleRoutes.ts`,
`src/lib/errors.ts`, `src/pages/Login.tsx`, `src/components/AuthField.tsx`,
`src/lib/approverAccess.ts`, `src/lib/postLoginRedirect.ts`, repo-wide `data-testid`/`aria-label`
grep.

Researched via parallel sub-agents (full-file reads, reported back and incorporated above):
all files under `src/pages/Admin/**`, `src/components/admin/**`, `src/components/superadmin/**`,
`src/pages/Shared/**`, `src/components/passview/**`, `src/pages/ForcePasswordChange.tsx`,
`src/pages/ResetPassword.tsx`, `src/pages/NoAccess.tsx`, `src/components/SessionTimeout.tsx`,
`src/components/layout/**`, `src/components/OfflineBanner.tsx`, `src/components/ModalShell.tsx`,
`src/components/KpiCard.tsx`, `src/components/Badge.tsx`, `src/components/QuestMark.tsx`,
`src/lib/theme.tsx`, `src/lib/notifications.tsx`, `src/lib/avatarUpload.ts`,
`src/lib/emergencyRelease.ts`, `src/lib/rgpLifecycle.ts`, `src/lib/statusStyles.ts`,
`src/lib/units.ts`, `src/lib/adminOverview.ts`, `src/lib/exportUtils.ts`, `src/lib/csvCells.ts`.

Files referenced but NOT read by any pass (imported by in-scope files, contents unverified —
confirm before writing tests against them): `OverduePassBoard`, `ScheduledReturns`,
`RejectApprovalModal`, `QrPass`, `QrScanner`, `DrillList.tsx`, `DrillPageShell.tsx`,
`TablePager.tsx` (read at a shallow level only), `PassStack.tsx`/`PassStackCard.tsx`, `ItemOrdinal.tsx`,
`PassField.tsx`, `ReportsPrintHeader.tsx`.

---

## 9. Recommended data-testid additions

None invented into the selector tables above — every locator recommendation uses `getByRole`/
`getByLabel`/`getByText`/existing `data-testid`. The following are suggestions ONLY, for screens
where strict-mode ambiguity or the total absence of stable selectors makes a code-generating agent's
job meaningfully harder; a human/maintainer decides whether to add them:

- `src/pages/Admin/AdminPanel.tsx:82-89` — tab buttons have no `data-testid`; six tabs share the
  page with modals that reuse identical button text (e.g. "Add Department" appears both as a
  trigger and a modal submit) — a `data-testid="admin-tab-departments"` etc. would remove the need
  to scope by role text.
- `src/pages/Admin/DepartmentsTab.tsx` edit/delete icon buttons (`title="Edit department"`/
  `"Delete department"`) — per-row disambiguation currently requires DOM-position scoping;
  `data-testid={`dept-edit-${id}`}` would help.
- `src/components/ModalShell.tsx:1-46` — every modal in the app shares the literal string
  "Close" for its close button; a `data-testid="modal-close"` on the shared component would let
  every caller target it unambiguously without container-scoping gymnastics.
- `src/pages/Admin/ReportsPage.tsx` and its four subcomponents — zero `data-testid` anywhere
  despite being one of the most filter/interaction-heavy screens in scope; at minimum
  `data-testid="reports-table"` and `data-testid="reports-filter-bar"` would mirror the pattern
  already used on `ActivityLogPage.tsx:135`.
- `src/pages/Admin/AdminDashboard.tsx` / `SuperAdminDashboard.tsx` — the Overview cards group has
  `role="group" aria-label="Overview figures"` but no per-card testid; `data-testid={`overview-card-${key}`}`
  would make the KPI-invariant tests (P3-30) far less brittle to label-text changes.

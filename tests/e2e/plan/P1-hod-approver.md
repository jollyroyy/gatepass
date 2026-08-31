# P1 — HOD & Approver E2E Test Plan

Scope: HOD role (`src/pages/HOD/**`, `src/components/hod/**`) and Approval offices
(`src/pages/Approver/**`, `src/components/approver/**`, `ApprovalDecisionBar`).
Dev server `http://localhost:5174`. This document is the sole input for a code-generating
agent — it does not read source itself. All facts below are cited `file:line` against the
real repository state as of 2026-08-24. Facts not directly confirmed are marked **UNVERIFIED**.

Base library note: role/route gating lives in `src/lib/roleRoutes.ts`. An **approval office
REPLACES the holder's role routes** (`officeReplacesRole`, `roleRoutes.ts:118-121`):
`APPROVER_ROUTES = ['/approvals', '/delegation', '/whitelist', '/pass', '/profile']`
(`roleRoutes.ts:30`). Admin/super_admin are exempt and keep both sets
(`roleRoutes.ts:111-121`). `/whitelist` is listed for every office at the route-guard level,
but only the CEO can act inside it (`is_ceo()` RPC, see §7).

---

## 1. `/dashboard` — HOD Dashboard (`src/pages/HOD/Dashboard.tsx`)

**Route + access**: `/dashboard`, `hod` role only, `ROLE_ROUTES.hod` (`roleRoutes.ts:62`);
`ROLE_HOME.hod = '/dashboard'` (`roleRoutes.ts:89`) — the HOD's landing page. An office
holder who is also nominally `hod` loses this route entirely (`officeReplacesRole`).

### Selector inventory

| Element | Exact text | Locator | testid/aria | Conditional |
|---|---|---|---|---|
| Greeting heading | `"{greetingFor}, {hodGreetingName}"` e.g. "Good morning, HOD" | `page.getByRole('heading', { level: 1 })` (text varies by time-of-day) | none | always; `stamp` frozen at mount (`Dashboard.tsx:68`) |
| Sub text | "Here's what's happening with your passes today." | `page.getByText("Here's what's happening with your passes today.")` | none | always |
| Date chip | e.g. "24 Aug 2026" | `page.locator('.gb-stamp')` | none | always |
| Error banner | dynamic | `page.locator('.gb-alert')` | none | only when `error` |
| Dept-delete request card | "Department Deletion Request" | `page.getByTestId('dept-delete-requests')` | **has** `data-testid="dept-delete-requests"` (`DepartmentDeleteRequests.tsx:44`) | only when `decidableRequests(requests).length > 0`; renders `null` otherwise |
| KPI group | — | `page.getByRole('group', { name: 'Dashboard figures' })` | `aria-label="Dashboard figures"` (`HodKpiCards.tsx:37`) | always |
| KPI card "NRGP Issued" | figure + "NRGP Issued" | `page.getByRole('link', { name: /NRGP Issued/ })` | none, href `/dashboard/nrgpIssued` | figure `'—'` while loading |
| KPI card "RGP Issued" | figure + "RGP Issued" | `page.getByRole('link', { name: /RGP Issued/ })` | none, href `/dashboard/rgpIssued` | same |
| KPI card "Pending Return" | figure + "Pending Return" | `page.getByRole('link', { name: /Pending Return/ })` | none, href `/dashboard/pendingReturn` | same |
| KPI card "Overdue" | figure + "Overdue" | `page.getByRole('link', { name: 'Overdue' })` | none, href `/overdue` (item-level page, NOT `/dashboard/overdue`) | same |
| Desk line "Pending gate approval" (NRGP) | "Pending gate approval" | **AMBIGUOUS** — identical text under both NRGP and RGP cards; scope: `page.locator('.gb-kpi').filter({ hasText: 'NRGP Issued' }).getByRole('link', { name: /Pending gate approval/ })` | none, href `/dashboard/nrgpPendingGate` | always (both cards always render 2 notes, `hodBoard.ts:1088,1104`) |
| Desk line "Pending gate approval" (RGP) | same text | scope to RGP card, href `/dashboard/rgpPendingGate` | none | always |
| Desk line "Pending approval" (NRGP) | "Pending approval" | **AMBIGUOUS** — appears twice AND is a substring of "Pending gate approval"; use `{ name: 'Pending approval', exact: true }` + card scoping | none, href `/dashboard/nrgpPendingApproval` | always |
| Desk line "Pending approval" (RGP) | same | scope to RGP card, href `/dashboard/rgpPendingApproval` | none | always |
| Quick Actions heading | "Quick Actions" | `page.getByRole('heading', { name: 'Quick Actions' })` | none | always |
| "Raise Gate Pass" tile | "Raise Gate Pass" + note "RGP or NRGP — material out" | `page.getByRole('link', { name: /Raise Gate Pass/ })` | none, href `/raise` | always — the only tile (single-icon design) |
| Approval Pending heading | "Approval Pending" | `page.getByRole('heading', { name: 'Approval Pending' })` | none | always |
| Approval sub text | "Passes waiting for approval from other approvers." | `page.getByText(...)` | none | always |
| Approval slot "HOD Approval" | label + value + "Waiting" | `page.locator('.gb-approval').filter({ hasText: 'HOD Approval' })` — plain div, not interactive | none | always renders (4 slots: HOD/Security/Finance/Other); HOD's own reads 0 |
| Approval slot "Security Approval" | same pattern | same | none | always |
| Approval slot "Finance Approval" | same pattern | same | none | always |
| Approval slot "Other Approvers" | same pattern | same | none | always |

No day-picker chevron exists despite an old mock referencing one (`Dashboard.tsx:92-94` comment) — do not test for it.

### Empty / loading
No page-level `.empty-state`/`.skeleton`. KPI figures individually show `'—'` while `loading`
(`HodKpiCards.tsx:43,60`). `DepartmentDeleteRequests` renders nothing (not an empty-state div)
when there is nothing to decide.

### Dashboard invariant (verified)
- NRGP Issued: `value: nrgpToday.length` / `drill.rows: nrgpToday` — same array (`hodBoard.ts:1084,1094`).
- RGP Issued: `value: rgpToday.length` / `drill.rows: rgpToday` (`hodBoard.ts:1102,1110`).
- Pending Return: `value: overdue.length` / `drill.rows: overdue`, both from `overdueReturns(rows)` (`hodBoard.ts:1076,1118,1128`).
- Overdue card: `value: overdue.length` (`hodBoard.ts:1145`) but **no `drill`** — navigates to `/overdue` (a different page/mechanism), not covered by `boardDrills.ts`. Do not assert the literal invariant against `DashboardDrill`'s rows for this card; assert separately against the `/overdue` page's own row count.
- Desk notes: `pendingNotes()` builds `value: own.length` / `drill.rows: own` per note (`pendingSplit.ts:118-119,121`) — these are NOT a subset of the parent card's "today" window; they are running totals over the full `nrgpAll`/`rgpAll` arrays (`hodBoard.ts:28-31`).

### Known landmines
- Realtime: `postgres_changes` on `gatepass.gate_passes`, silent `load(true)` refresh, no skeleton flash (`useHodBoardData.ts:1445-1453`). Assert on the number changing, not on a loading state.
- Two sequential reads: pass rows, then (only if `passes.length>0`) a `pass_approvals` read (`useHodBoardData.ts:1383-1399`); failure of the second silently zeroes the Approval Pending strip with no error banner.
- `stamp` (today boundary + greeting) is frozen at first render (`Dashboard.tsx:68`) — a test spanning a day boundary must reload.
- Auth failure path: no user → `error = 'Could not identify your account. Sign out and back in.'` (`useHodBoardData.ts:1436-1440`), rendered in `.gb-alert`.

---

## 2. `/dashboard/:key` — Dashboard Drill (`src/pages/HOD/DashboardDrill.tsx`)

**Route + access**: `/dashboard/:key`, HOD only (sub-path of `/dashboard`, already admitted by
`ROLE_ROUTES.hod`). Valid `:key`: `nrgpIssued`, `rgpIssued`, `pendingReturn`, `nrgpPendingGate`,
`nrgpPendingApproval`, `rgpPendingGate`, `rgpPendingApproval`. NOT `overdue` — that card has no
`drill` and instead links to `/overdue` (`DashboardDrill.tsx:20`).

### Selector inventory

| Element | Text | Locator | Conditional |
|---|---|---|---|
| Back link | "Back to dashboard" | `page.getByRole('link', { name: 'Back to dashboard' })`, href `/dashboard` | always |
| Page heading | `drill.heading` e.g. "NRGP raised today" / "RGP pending approval" | `page.getByRole('heading', { level: 1 })` | falls back to "Passes" if `drill` unresolved pre-redirect |
| Count badge | `"{count} pass"` / `"{count} passes"` | `page.locator('.gb-head-count')` | omitted while `loading` |
| Scope note | "Everything still waiting, whatever day it was raised — not limited to the window above." | `page.locator('.gb-sub')` | only on the four `*PendingGate`/`*PendingApproval` desk drills |
| Error banner | dynamic | `page.locator('.gb-alert')` | on error |
| Empty state | `drill.empty` text e.g. "No NRGP raised today." / "No RGP is waiting at the gate." / "Nothing you raised is overdue." | `page.locator('.table-wrap.empty-state')` | `!loading && rows.length===0` |
| Skeleton rows | — | `page.locator('.table-wrap .skeleton')` — 6 rows | while `loading` |
| Pass cards | via `PassStack`/`PassStackCard` | see §9 shared component notes | when rows present |

`showHeading={false}` and `showRaisedBy={false}` are passed to `DrillList` here
(`DashboardDrill.tsx:56-57`) — its own internal heading and the "Raised By" column are
suppressed on this page.

### Dashboard invariant (verified)
`DashboardDrill` rebuilds `buildHodKpis(rows, stamp)` from the same `useHodBoardData` hook and
resolves `drillFor(cards, key)` (`boardDrills.ts:76-84`). `count={drill?.rows.length}`
(`DashboardDrill.tsx:167`) and `rows={drill?.rows ?? []}` (`:175`) — the header count and the
list ARE the same array, literally.

### Landmine
`if (!loading && !drill) return <Navigate to="/dashboard" replace />` (`DashboardDrill.tsx:159`)
— visiting `/dashboard/bogusKey` renders (fallback heading "Passes") during the loading window,
then redirects only once loading finishes. Wait for URL to settle, don't assert immediately.

---

## 3. `/reports` — HOD Reports (`src/pages/HOD/HodReports.tsx` wrapping `Admin/ReportsPage.tsx`)

**Route + access**: `/reports`, HOD only (`roleRoutes.ts:62`). `HodReports.tsx` is a 26-line
wrapper passing `showPeople={false}` into the shared `ReportsPage`; row scoping to the HOD's own
department is enforced server-side by RLS, not by any client prop.

### Selector inventory

**Header (`ReportsHeader.tsx`)**
| Element | Text | Locator |
|---|---|---|
| Stamp | `formatDateTime(stamp)` | `page.locator('.gb-stamp')` (scoped `.gb-rep-side.no-print`) |
| Export menu trigger | "Export ▾" | `page.getByRole('button', { name: /Export/ })`, `aria-haspopup="menu"` |
| Export item | "Spreadsheet (.csv)" | `page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' })` — only when menu open |
| Export item | "Print / PDF" | `page.getByRole('menuitem', { name: 'Print / PDF' })` — only when menu open |
| Print button | "Print" | `page.getByRole('button', { name: 'Print', exact: true })` — **AMBIGUOUS** with "Print / PDF" menuitem by substring; use `exact: true` |
| Download button | "Download" | `page.getByRole('button', { name: 'Download' })` |

**Filters (`ReportsFilterBar.tsx`, `showPeople=false` for HOD)**
| Element | Locator | Notes |
|---|---|---|
| From date | `page.getByLabel('From date')` | `type="date"` |
| To date | `page.getByLabel('To date')` | `type="date"` |
| Quick range | `page.getByLabel('Quick range')` | select, presets from `reportsDateRange.ts` (not enumerated here — **UNVERIFIED exact option text**, read that file before writing exact-option assertions) |
| Pass Type | `page.getByRole('combobox', { name: 'Pass Type' })` | **AMBIGUOUS**: `aria-label="Pass Type"` (line 127) sits directly under a visible `<span>Pass Type</span>` label (line 124) — prefer role+name over `getByLabel` |
| Status | `page.getByLabel('Status')` | select |
| Created By | not rendered | omitted when `showPeople=false` — HOD never sees this |
| Department | not rendered | omitted when `showPeople=false` |
| Reset | `page.getByRole('button', { name: 'Reset' })` | `disabled` while `!isNarrowed(filters)` |

**KPI cards (`ReportsKpiCards.tsx`)**: 6 non-interactive figure cards,
`role="group" aria-label="Report figures"` — explicitly NOT clickable (`ReportsKpiCards.tsx:6-11`
comment). Exact 6 titles are **UNVERIFIED** — read `src/lib/gatePassReport.ts` (`buildReportKpis`)
before asserting literal card titles.

**Table (`ReportsTable.tsx`, `showPeople=false`)**
| Element | Text | Locator |
|---|---|---|
| Column headers | "Pass Number", "Creation Date", "Pass Type", "Purpose / Description", "Total Number of Items", "Total Value of Items", "Status" | `page.getByRole('columnheader', { name: 'Pass Number' })` etc. — "Raised By Department"/"Created By" columns OMITTED for HOD |
| Row | click anywhere | `page.getByRole('row').filter({ hasText: passNumber }).click()` — this is a bare `<tr onClick>`, NOT a link; do not use `getByRole('link')` |
| Row kebab | `aria-label="Actions for {pass.pass_number}"` | `page.getByRole('button', { name: \`Actions for ${passNumber}\` })` — unique per row, good selector |
| Kebab item | "View Details" | `page.getByRole('menuitem', { name: 'View Details' })` → `/pass/:id` |
| Kebab item | "Print Pass" | `page.getByRole('menuitem', { name: 'Print Pass' })` → `/pass/:id/print` |

**Pager (`GuardPager.tsx`, reused)**
| Element | Text/aria | Locator |
|---|---|---|
| Entries summary | "Showing {from} to {to} of {total} entries" | `page.getByText(/Showing \d+ to \d+ of \d+ entries/)` |
| Prev | `aria-label="Previous page"` | disabled at page 1 |
| Page N | number, `aria-current="page"` on active | `page.getByRole('button', { name: '2', exact: true })` |
| Next | `aria-label="Next page"` | disabled on last page |
| Rows per page | `page.getByLabel('Rows per page')` | select |

### Empty / loading
Loading: `.gb-empty .gb-skeleton` (note: `gb-skeleton`, not the generic `.skeleton` class used
elsewhere). Empty: `.gb-empty` text "No passes match these filters."

### Landmines
- No "Apply" button — every filter self-applies on `onChange`; page resets to 1 on any filter
  change (`ReportsPage.tsx:144-147`).
- Print sets `printAll=true`, a `useEffect` calls `window.print()` then resets the flag
  (`ReportsPage.tsx:135-139`) — stub `window.print` in tests, don't wait on it synchronously.
- Export/kebab menus close on document `mousedown` outside, not on Escape.
- `showPeople=false` means Created By/Department are entirely absent from filter bar, columns
  and CSV — don't query for them on this route.

---

## 4. `/mismatch/:id` — Mismatch Review (`src/pages/HOD/MismatchReview.tsx`)

**Route + access**: `/mismatch/:id`, HOD only, reached only from the notification bell (no
dashboard card links here). `hod_review_flagged_pass` refuses anyone but the raising HOD
server-side regardless of this route list.

### Selector inventory
| Element | Text | Locator | Conditional |
|---|---|---|---|
| Title (all states) | "Rejected at Security Gate" | `page.getByRole('heading', { level: 1, name: 'Rejected at Security Gate' })` | always |
| Subtitle | `"{pass_number} · {categoryFor(...).label}"` | `page.locator('.page-subtitle')` | loaded only |
| Skeleton | — | `page.locator('.skeleton.h-48.w-full')` | while loading |
| Not-found | "That gate pass could not be found, or it is not one you may review." | `page.locator('.empty-state')` | `!loading && !pass` |
| Error banner | dynamic | `page.locator('.alert-error')` | on error |
| "Stopped at the gate" heading | "Stopped at the gate" | `page.getByRole('heading', { name: 'Stopped at the gate' })` | pass loaded |
| Flag reason | `pass.flag_reason` or "No reason was recorded." | text in `.card.border-flagged-500\/30 p` | always |
| "Flagged by" / "Flagged at" | dt/dd pairs | scope within their `dl` | always |
| Settled message | "This pass is no longer awaiting your decision — nothing further is needed here. View the pass ." | `page.locator('.empty-state')` inside `PassDecisionPanel` — **AMBIGUOUS with not-found empty-state** if queried page-wide; scope inside `PassDecisionPanel`'s container | `pass.status !== 'flagged'` |
| "View the pass" link | "View the pass" | `page.getByRole('link', { name: 'View the pass' })`, href `/pass/:id` | settled only |
| "Raise It Again" | "Raise It Again" | `page.getByRole('button', { name: 'Raise It Again' })` | idle (not settled, not confirming) |
| "Reject Permanently" | "Reject Permanently" | `page.getByRole('button', { name: 'Reject Permanently' })` (this screen's `voidLabel`) | idle |
| Idle help text | "Raising it again opens a new gate pass pre-filled from this one. This pass is voided only once the corrected one is submitted." | `page.getByText(...)` | idle |
| Confirm warning | "This is final. The pass will be void and the material will not be released." | `page.getByText(...)` | confirming |
| Reason field | label "Reason (optional)" | `page.getByLabel('Reason (optional)')` — real `id="void-reason"`/`htmlFor` | confirming |
| Confirm button | "Confirm — Reject Permanently" (busy: "Working…") | `page.getByRole('button', { name: /Confirm — Reject Permanently/ })` | confirming |
| Cancel | "Cancel" | `page.getByRole('button', { name: 'Cancel' })` | confirming |

### Landmines
- Success calls `dismissPass(id)` then `navigate('/dashboard')` immediately
  (`MismatchReview.tsx:297-298`) — no success message on this page; wait for the URL change.
- Error is cleared BEFORE the async call starts (deliberate anti-flicker,
  `MismatchReview.tsx:267-269,289`) — a retry-after-failure test should expect the banner to
  vanish the instant the retry begins, not only on success.
- No realtime subscription on this page at all — a stale-open tab keeps showing the decision
  buttons even if another actor changed the pass status; the server (`hod_review_flagged_pass`)
  is the real gate and will refuse a stale click, surfacing an RPC error in `.alert-error`.

---

## 5. `/expired/:id` — Expired Review (`src/pages/HOD/ExpiredReview.tsx`)

**Route + access**: `/expired/:id`, HOD only, same bell-notification-only reachability pattern
as Mismatch Review. Structurally identical (shares `PassDecisionPanel`).

### Selector inventory
| Element | Text | Locator | Conditional |
|---|---|---|---|
| Title (all states) | "Expired Gate Pass" | `page.getByRole('heading', { level: 1, name: 'Expired Gate Pass' })` | always |
| Subtitle | `"{pass_number} · {categoryFor(...).label}"` | `page.locator('.page-subtitle')` | loaded |
| Skeleton | — | `page.locator('.skeleton.h-48.w-full')` | loading |
| Not-found | "That gate pass could not be found, or it is not one you may review." | `page.locator('.empty-state')` — identical string to Mismatch's not-found state | `!loading && !pass` |
| "Null and void" heading | "Null and void" | `page.getByRole('heading', { name: 'Null and void' })` | loaded |
| Explanation | "This pass was never presented at the gate before it expired, so the material was never released. Security can no longer clear it — a replacement pass is the only way the material moves." | `page.getByText(...)` | always |
| "Raised" / "Expired" dt/dd | labels + `formatDateTime` | scope inside the `dl` — "Raised" alone is **AMBIGUOUS** (generic word) | always |
| Settled message | same wording as Mismatch's | scoped `.empty-state` inside `PassDecisionPanel` | `!isExpiredPending(pass)` (`ExpiredReview.tsx:121,163`; predicate = `status==='pending' && is_expired`, `statusStyles.ts:68`) |
| "View the pass" | "View the pass" | `page.getByRole('link', { name: 'View the pass' })` | settled |
| "Raise It Again" | "Raise It Again" | `page.getByRole('button', { name: 'Raise It Again' })` | idle, decidable |
| "Void It Permanently" | "Void It Permanently" (`voidLabel`) | `page.getByRole('button', { name: 'Void It Permanently' })` | idle, decidable |
| Idle help text | "Raising it again opens a new gate pass pre-filled from this one. This pass is voided only once the replacement is submitted." | `page.getByText(...)` | idle |
| Confirm warning | "This is final. The pass will be closed as void and can never be verified at the gate." | `page.getByText(...)` | confirming |
| Reason field | "Reason (optional)" | `page.getByLabel('Reason (optional)')`, `id="void-reason"` | confirming |
| Confirm button | "Confirm — Void It Permanently" (busy: "Working…") | `page.getByRole('button', { name: /Confirm — Void It Permanently/ })` | confirming |
| Cancel | "Cancel" | `page.getByRole('button', { name: 'Cancel' })` | confirming |

### Landmines
- `decidable = isExpiredPending(pass)` uses the DB view's `is_expired` flag exclusively
  (`ExpiredReview.tsx:117-120`) — a Playwright test cannot fake "expired" by manipulating the
  browser clock; the pass row must actually be past `expires_at` per the DB's `site_tz()`.
- Success navigates to `/dashboard` immediately (`ExpiredReview.tsx:475-476`), same
  error-cleared-before-call pattern (`:449-450,468`), and no realtime subscription — identical
  shape to Mismatch Review's landmines.
- `hod_void_expired_pass` re-validates expiry server-side; client `decidable` is UX only.

---

## 6. `/raise` — Raise Gate Pass (`src/pages/HOD/RaisePass.tsx`)

**Route + access**: `/raise`, HOD only (`roleRoutes.ts:62`). Re-raise entry point: navigated to
with router **state** `{ copyFrom: pass.id }` from `MismatchReview.tsx:171` and
`ExpiredReview.tsx:177` (`onRaise={() => navigate('/raise', { state: { copyFrom: pass.id } })}`).
This is NOT a query param — a refresh or a bookmark of the URL loses the prefill by design
(`useReraisePass.ts:1-24`). Also accepts `?type=NRGP` on initial mount only (not reactive,
`RaisePass.tsx:34-36`).

### 6a. Pass Type (`PassTypeSelector.tsx`)
`role="radiogroup" aria-label="Pass Type"` (`PassTypeSelector.tsx:52`), two radios
`name="pass-type"`, plate text `"${code} (${label})"`:
- "RGP (Returnable Gate Pass)"
- "NRGP (Non-Returnable Gate Pass)"

Default `RGP` unless `?type=NRGP`. Switching to NRGP clears every item's
`expected_return_date` and drops `*_expected_return_date` errors (`RaisePass.tsx:104-124`).

### 6b. Pass Details / Vendor / Carrier / Purpose fields

| Field | Label (verbatim) | Type | Required | Exact error / rule | id |
|---|---|---|---|---|---|
| Reference Number | "Reference Number" | text, `readOnly` | n/a | live preview `${TYPE}-${YYYYMMDD}-####`, never the real number pre-submit | `rp-ref` |
| Vehicle Number | "Vehicle Number" | text | No | placeholder "Optional — e.g. KA01AB1234" — **no format validation applied** despite `indianVehicle.ts` existing (confirmed unused here by grep) | `rp-vehicle` |
| Vendor Name | "Vendor Name" (+ red `*`) | text | Yes | empty → `'Vendor name is required.'` (`raisePassForm.ts:89`) | `rp-vendor` |
| Vendor Address | "Vendor Address" | text | No | none, placeholder "Street, area, city, pincode" | `rp-address` |
| Person Who Will Carry | "Person Who Will Carry" (+ `*`) | text | Yes | empty → `'Enter the name of the person who will carry the material.'` (`raisePassForm.ts:90`) | `rp-carrier` |
| Country code | `aria-label="Country code"` (no visible `<label>`) | select | n/a | options `+91,+971,+966,+968,+974,+44,+1` (`mobileNumber.ts:18-26`), default `+91` | — |
| Mobile Number | "Mobile Number" (+ `*`) | `type="tel"` | Yes | digits stripped of non-digit chars; empty → `'Mobile number is required.'`; <7 or >15 digits → `'Enter a valid mobile number.'` (`raisePassForm.ts:92-99`) | `rp-mobile` |
| Purpose / Description | "Purpose / Description" (+ `*`) | textarea, `maxLength={500}` | Yes | empty → `'Purpose / description is required.'`; over 500 chars → `'Keep the purpose under 500 characters.'` (only reachable programmatically — the DOM `maxLength` blocks normal typing) (`raisePassForm.ts:101-105`); live counter `"{len}/500"` | `rp-purpose` |
| Department | not rendered as a field | — | — | resolved server-side from `hod_departments`; zero-departments case shows whole-form error `'You are not assigned to any department.'` in `.alert-error` below the grid (`RaisePass.tsx:143,307`) | — |

Mobile/dial are two controls, one stored string `"${dial} ${digits}"` (`joinMobile`,
`mobileNumber.ts:53-57`) — empty digits store `''` regardless of dial code chosen.

Mobile boundary values: 6 digits → invalid; **7 digits → valid (min boundary)**; **15 digits →
valid (max boundary)**; 16 digits → invalid. Non-digit characters (dashes, spaces) are stripped
before counting.

### 6c. Material item grid (`MaterialItemsCard.tsx` + `MaterialItemRow.tsx`)

Starts with **2 empty rows** (`STARTING_ITEMS = 2`, `RaisePass.tsx:26,48`).

Header labels (verbatim, `*` decoration is `aria-hidden`, NOT proof of enforced validation):
`#`, `Item Description*`, `Quantity*`, `Unit*`, `Approx. Value (Rs)`, `Make / Model / Size*`,
`Serial / Asset Tag`, `Invoice / Reference No.`, `Remarks`, then (**RGP only**) `Expected Return
Date*`, then `Action`.

**Add row**: `<button type="button" className="rp-add-row">` text **"Add Another Item"**
(`MaterialItemsCard.tsx:102-108`). Locator: `page.getByRole('button', { name: 'Add Another Item' })`.
Clicking clears all `item_*` errors and the grid-level `errors.items` message.

**Remove row**: `aria-label={\`Remove item ${idx + 1}\`}` (`MaterialItemRow.tsx:198-210`, 1-indexed).
Locator: `page.getByRole('button', { name: 'Remove item 1' })`. Only rendered when
`items.length > 1` (`MaterialItemsCard.tsx:94`) — the last row has an empty `<span aria-hidden>`
instead of a button, so there is no way to remove the final row via the UI. Removing a row
clears ALL `item_*` errors across the whole grid, not just that row.

| Field | `aria-label` | Type/attrs | Required | Exact error(s) |
|---|---|---|---|---|
| Item Description | "Item Description" | text | Yes | empty → `'Item description is required.'` |
| Quantity | "Quantity" | `type="number"`, `min`/`step` `'1'`/`'1'` (whole units) or `'0.01'`/`'0.01'` (fractional units) | Yes | empty/NaN/≤0 → `'Enter a quantity greater than 0.'`; whole-unit fractional (e.g. `2.5` `nos`) → `` `${unitLabel} cannot be split — enter ${low} or ${high}.` `` e.g. **"Numbers cannot be split — enter 2 or 3."** (quantity `0.5` on a whole unit → **"Numbers cannot be split — enter 1."**, only the high option since `low<1`) |
| Unit | "Unit" | select | visually `*` but **not enforced** — no validation rule fires regardless of selection | none |
| Approx. Value (Rs) | "Approx. Value (Rs)" | `type="number"` `min="0"` `step="0.01"` | No | only checked if non-blank: NaN or <0 → `'Enter a value of 0 or more, or leave it blank.'`; no upper bound |
| Make / Model / Size | "Make / Model / Size" | text | Yes | empty → `'Make / model / size is required.'` |
| Serial / Asset Tag | "Serial / Asset Tag" | text | No | none |
| Invoice / Reference No. | "Invoice / Reference No." | text | No | none |
| Remarks | "Remarks" | text | No | none |
| Expected Return Date | "Expected Return Date" | `type="date"`, `min={todayStr()}` | Yes, **RGP only** — column absent for NRGP | empty → `'Return date is required for a Returnable Gate Pass.'`; date < today → `'Return date cannot be in the past.'` (re-checked in JS even though the native picker floors at today) |

`UNIT_OPTIONS` exact order/labels (`units.ts:9-34`): `nos`→"Numbers" (default), `box`→"Box",
`set`→"Set", `roll`→"Roll", `bag`→"Bags", `drum`→"Drums", `lot`→"Lots", `kg`→"Kg",
`litre`→"Litre", `metre`→"Metre". Whole (non-fractional) codes: `nos, box, roll, set, bag, drum,
lot`. Fractional-allowed: `kg, litre, metre` (and any unrecognized code).

Grid-level error `'At least one material item is required.'` is effectively unreachable via UI
(there's always ≥1 row and no way to remove the last one) — only reachable programmatically.

### 6d. Other interactive elements

| Element | Text | Locator | Notes |
|---|---|---|---|
| Cancel | "Cancel" | `page.getByRole('button', { name: 'Cancel' })` | `type="button"`, navigates to `/dashboard`, **no unsaved-changes confirmation** |
| Submit | "Submit Request" (busy: "Submitting…") | `page.getByRole('button', { name: 'Submit Request' })` | `type="submit"`, `disabled={submitting}` |
| Form heading | "Raise Gate Pass" or "Raise Gate Pass Again" (when re-raising) | `page.getByRole('heading', { name: /Raise Gate Pass/ })` | — |
| Re-raise banner | starts "Correcting {pass_number}..." | — | only when `sourceId` truthy |
| Department error | whole-form `.alert-error` | — | when no department |
| Submit error | whole-form `.alert-error` | — | on RPC failure |
| Supersede warning | `.alert-warning` | — | only after a re-raise submit whose `voidSupersededPass` failed |

**Success modal (`PassSubmittedModal.tsx`, via `ModalShell`)** — opens in place, **no navigation
on submit success**:
| Element | Text/locator |
|---|---|
| Close (×) | `page.getByRole('button', { name: 'Close' })` (`aria-label="Close"`) |
| Dialog | `role="dialog" aria-modal="true" aria-labelledby="pass-submitted-title"` |
| Title | "Pass Submitted" |
| Pass number | real number, no longer `####` |
| View Pass | `page.getByRole('link', { name: 'View Pass' })` → `/pass/:id` |
| Print Pass | `page.getByRole('link', { name: 'Print Pass' })` → `/pass/:id/print` |
| Send to Vendor | `page.getByRole('link', { name: 'Send to Vendor' })` — **conditional**: only rendered if `vendorWhatsappLink(submittedPass)` returns non-null (requires a phone in the packed vendor JSON); opens `wa.me` in a new tab |
| Dashboard | `page.getByRole('link', { name: 'Dashboard' })` → `/dashboard` |

Escape / backdrop click both close the modal only (no navigation, no data loss dialog); the
underlying form is still mounted with its just-submitted values — clicking Submit again would
likely create a duplicate pass (nothing resets/disables post-success).

### 6e. Special characters
`sanitizeTerm` (`src/lib/passTextSearch.ts:89`) is a SEARCH-only concern (escapes PostgREST
`or=()` grammar) — it is NOT applied anywhere on `RaisePass.tsx`. Vendor Name, Vendor Address,
Person, Purpose, and every item text field accept commas/brackets/quotes with zero client-side
filtering (stored via `packVendor`→`JSON.stringify`, `raisePassForm.ts:175-180`). Worth a
cross-flow test: raise with a vendor name containing `,` and `()` → submit succeeds → later
searching for that vendor on the gate/approver screens must not 400 (that's where
`sanitizeTerm` actually matters). `nameValidation.ts` (letters/digits/spaces, 80-char cap) is
**confirmed unused** by RaisePass/`raisePassForm.ts` (zero import matches) — do not expect it
to reject anything here.

### 6f. Boundary / edge values summary
- Quantity: `0`/negative → error; whole unit + `2.5` → split-message; whole unit + `0.5` →
  "...enter 1."; fractional unit (`kg`) + `0.01` → valid; no upper ceiling.
- Approx. Value: blank passes; negative or NaN (when non-blank) → error; no upper bound.
- Purpose: 500-char hard cap via DOM `maxLength` (browser-level block); JS "over max" branch is
  dead code for normal typing, reachable only via `fill()`/`evaluate()` bypass or stale re-raise
  prefill data.
- Return date (RGP only): native `min=today` blocks past dates in the calendar widget; JS
  re-checks `< today` (not `<=`) — today itself is valid.
- Mobile: 7–15 digits valid inclusive; outside that range invalid, regardless of dial code.
- Vehicle Number: **no validation of any kind** — any string is accepted; do not write a test
  expecting rejection of a malformed plate here (that only happens on the Admin blacklist tab
  and in SQL, both out of P1 scope).

### 6g. Known landmines
- Department list load is async (`RaisePass.tsx:73-102`); submitting before it resolves risks
  hitting the `'You are not assigned to any department.'` error even for a valid HOD — wait for
  the department to settle (e.g. poll for the department becoming implicitly selected, or
  intercept the network call) before a fast-path submit test.
- `userId` (from `getUser()`) is also async (`RaisePass.tsx:69-71`) — submitting instantly after
  navigation can throw `'Could not determine your user account. Please sign in again.'`.
- Submit performs sequential calls: `raise_pass` RPC → best-effort `v_gate_passes` read (failure
  tolerated) → fire-and-forget `notifyApproval(id)` (NOT awaited) → conditional
  `voidSupersededPass` when re-raising (awaited, but its failure only sets a warning, never
  blocks the already-successful submit). **No URL change on success** — wait for the "Pass
  Submitted" modal, not for navigation.
- Re-raise prefill (`useReraisePass.ts`) is itself async and can race the department-selection
  effect; the merge is non-destructive (`RaisePass.tsx:64-67`) but the form is briefly blank —
  wait for the prefilled Vendor Name to populate before interacting.
- `voidSupersededPass` runs only AFTER the new pass already exists — a re-raise test asserting
  the OLD pass's status must wait for this second RPC, not just the first.
- Per-field errors clear on change but are NOT re-validated until the next submit — there is no
  live/inline validation to poll for between keystrokes; only submit re-runs
  `validateRaiseForm()`.

---

## 7. `/approvals` — Pending for My Approval (`src/pages/Approver/PendingApprovals.tsx`)

**Route + access**: `/approvals`, any office holder via `APPROVER_ROUTES`
(`roleRoutes.ts:30`); `APPROVER_HOME = '/approvals'` (`roleRoutes.ts:33`). `office` is resolved
once in `App.tsx` via `my_approval_role()` and threaded down as a prop. If `office` is `null`
(shouldn't normally reach this route, but defensively): "This account does not hold an approval
office." (`.gb-empty`, `PendingApprovals.tsx:185`), no query fires.

### Header
`GuardPageHeader` title **"Pending for My Approval"**, subtitle
`` `Signing as ${APPROVAL_ROLE_TITLES[office]}. Approve or reject below, or open a pass to read it in full.` ``.

### KPI cards (`ApprovalKpiCards.tsx`, container `data-testid="approval-kpis"` at line 101)
Each card is a real `<button type="button">`, `aria-expanded={active===c.key}`,
`aria-controls="approval-stack"`, `disabled={total===0}`:
- **"Awaiting Your Approval"** (key `pending`)
- **"Approved by You"** (key `approved`)
- **"Rejected by You"** (key `rejected`)
- **"Nobody Has Approved"** (key `stuck`) — rendered ONLY when `holdsFallbackOffice(office)`
  is true, i.e. office is `coo` or `ceo` (`PendingApprovals.tsx:157`); returns `null` when
  `total===undefined` (`ApprovalKpiCards.tsx:107`).

Locator: scope by container, e.g. `page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ })`
(button text includes figure + note, so match by substring). No per-card testid exists —
see §10 recommendations.

### Quick Actions (CEO only)
`office === 'ceo'` (`PendingApprovals.tsx:216`): card "Quick Actions" containing
`<Link to="/whitelist">` text **"Whitelist of Vendors"**, note "Take a vendor off the
blacklist". Locator: `page.getByRole('link', { name: 'Whitelist of Vendors' })`.

### Filter bar (`ApprovalFilterBar.tsx`)
| Element | Locator | Options |
|---|---|---|
| Search | `page.getByLabel('Search by Pass ID / Vendor / Purpose')` — placeholder "Search by Pass ID / Vendor / Purpose..." | free text |
| Pass Type | `page.getByLabel('Pass Type')` | "Type: All" (default), "RGP", "NRGP" |
| Department | `page.getByLabel('Department')` | "Department: All" (default), then dept names derived from currently loaded rows (`departmentOptions()`, `pendingApprovals.ts:152-159`) |

Filtering is entirely client-side over already-loaded rows (`applyApprovalFilters`,
`pendingApprovals.ts:164-174`), no debounce, updates on every keystroke, and resets `page` to 1
(`PendingApprovals.tsx:163-166`).

### Empty / loading
- Loading: `.gb-card.gb-panel > .gb-empty > .gb-skeleton` (no text).
- Fully empty (nothing in any of the four lists before filtering): "Nothing is waiting on your
  signature."
- Filtered-to-nothing: "No request matches these filters."
Both share the same `.gb-empty` class — **disambiguate by exact text, not class.**

### The stack (visible when a card is open and has rows)
`<div id="approval-stack">` wraps `PassStack` (`data-testid="pass-stack"`) of `PassStackCard`s
(`data-testid="pass-stack-card"` — **repeats once per card, not unique**; scope by pass-number
text). Ordinal span `data-testid="pass-ordinal"`. Only `card === 'pending'` renders
`ApprovalCardActions` — approved/rejected/stuck cards render no action buttons.

Expand chevron per card: `aria-label={\`${open?'Hide':'Show'} items on ${pass.pass_number}\`}`,
`aria-expanded={open}` — unique per pass, good selector:
`page.getByRole('button', { name: \`Show items on ${passNumber}\` })`.

### `ApprovalCardActions` (only on `pending` cards)
- "Approve" — `.gpo-act-approve`, text "Approve" / busy "Working…". **Not unique** — scope to
  the specific `pass-stack-card` container.
- "Reject" — `.gpo-act-reject`, always "Reject", opens `RejectApprovalModal` (§9).
- Inline error `<span className="gpo-act-error">` on failure.
- On approve success: `dismissPass(id)` then `onDecided()` → full board reload from DB, never
  patched locally.

### Pager (`GuardPager.tsx`, shown when `total>0`, page size default 10)
Same shape as §3's pager: "Showing {from} to {to} of {total} entries", "Previous page"/"Next
page" aria-labels, numbered buttons with `aria-current="page"`, "Rows per page" select.

### Landmines
- `usePendingApprovals` subscribes to `postgres_changes` on `gatepass.gate_passes`
  (`pending-approvals-gate-passes` channel) with a silent `load(true)` reload — no skeleton
  flash on background changes; assert on row/count text, not loading indicators.
- Two sequential reads on mount: `pass_approvals` then a conditional `v_gate_passes` read by
  ids — skipped entirely when `ids.length===0` (still resolves to the "Nothing is waiting..."
  empty text, not an error).
- `escalationHours` (feeds the `stuck` queue / escalation sentences) loads via a separate hook —
  possible extra latency before the "Nobody Has Approved" figure is accurate.
- `approvalActions.ts`'s `approvePass`/`rejectPass` fire-and-forget `notifyApproval(passId)`
  (not awaited) — don't assert notification side effects synchronously after a click resolves.

---

## 8. `/delegation` — Approval Delegation (`src/pages/Approver/ApprovalDelegation.tsx`)

**Route + access**: same office-holder gate as `/approvals`. `office===null` → title "Approval
Delegation", subtitle "Delegate your gate pass approval authority to another user when you are
unavailable.", body `.gb-empty` "This account does not hold an approval office."

### Header
- `<h1>` "Approval Delegation".
- Subtitle "Delegate your Gate Pass approval authority to another user when you are
  unavailable." — note the capitalization differs slightly from the no-office variant above
  ("Gate Pass" here vs "gate pass" there); branches are mutually exclusive so this never
  collides in one render.
- "Delegation History" toggle: `.gb-btn-ghost.gbd-head-btn`, `aria-expanded={showHistory}`,
  `aria-controls="delegation-history"`. `page.getByRole('button', { name: 'Delegation History' })`.
- "Create Delegation" button (icon + text, accessible name is just "Create Delegation"): only
  rendered when `canDelegate` is true. `page.getByRole('button', { name: 'Create Delegation' })`
  — on click, scrolls the form into view and focuses `#delegate-to`.

### Alerts
- `error` → `.gb-alert`.
- `failure` (submit/revoke catch) → `.gb-alert` — **same class as `error`**; disambiguate by
  exact message text (defaults `'Could not create that delegation.'` /
  `'Could not revoke that delegation.'`, or the thrown message).
- `done` success banner → `.gbd-done`, text "Delegation activated." or "Delegation revoked.
  Approvals are back with you alone."

### Loading
`.gb-card.gb-panel > .gb-empty > .gb-skeleton`, no text — same shape as `/approvals`.

### `DelegationStatusCard` (rendered only when a live/scheduled delegation exists)
- Heading "My Delegation Status".
- Status pill: "ACTIVE" or "SCHEDULED" in practice (`currentDelegation()` only surfaces those
  two states, `approvalDelegation.ts:113-121`).
- Note text keyed by status (`DELEGATION_STATUS_NOTES`), e.g. active: "Gate pass approval
  requests are being handled by your delegate during the validity period. You can still approve
  them yourself at any time."
- `<dl className="gbd-status-facts">`: "Delegated To" / name, "Office" /
  `APPROVAL_ROLE_TITLES[role_key]`, "Valid From" / date, "Valid To" / date, "Approval Limit" /
  "No Limit" or currency, conditionally "Reason" / text.
- Revoke: initial `.gbd-revoke` button "Revoke Delegation" → sets `confirming=true` → reveals
  "This cannot be undone.", "Cancel" (`.gb-btn-ghost`), "Confirm Revoke" (`.gbd-revoke`).
  **Two-press confirm, local state only.**

**No zero-state**: when there is no live/scheduled delegation, no card and no "you have no
delegation" text renders at all (deliberate removal, `ApprovalDelegation.tsx:182-186`) — assert
absence of `.gbd-status`, not a placeholder string.

### `DelegationForm` (rendered only when `canDelegate`; else `.gb-empty`: "You are acting for
the {office title} office as a stand-in, so there is nothing here for you to delegate onward.")

Heading "Create New Delegation". All fields use real `<label htmlFor>`+`id` (safe for
`getByLabel`):

| Field | Label | Type | Required | Exact error(s) |
|---|---|---|---|---|
| Delegate To | "Delegate To" (implied `*`) | select, `id="delegate-to"` | Yes | `'Choose somebody to delegate to.'` |
| Start Date & Time | | `type="datetime-local"`, `id="delegate-start"` | Yes | `'Choose when the delegation starts.'` |
| End Date & Time | | `type="datetime-local"`, `id="delegate-end"` | Yes | `'Choose when the delegation ends.'` / `'The delegation has to end after it starts.'` (end ≤ start) / `'That period is already over. Choose an end in the future.'` (end ≤ now at submit time) |
| Approval Limit (Optional) | | `type="number"`, `min="1"` `step="1"`, placeholder "No Limit", `id="delegate-limit"` | No | blank = no limit; non-numeric → `'Enter an amount in rupees, or leave it blank for no limit.'`; ≤0 → `'An approval limit has to be more than zero. Leave it blank for no limit.'` |
| Reason (Optional) | | `<textarea maxLength={500}>`, placeholder "Official leave", `id="delegate-reason"` | No | none |

Delegate-To hint text (`.gbd-hint`) varies by office (`delegateEligibilityNote`):
- `coo`: "The COO office can only be delegated to the CEO, who signs the same level. Nobody
  else may cover it."
- `ceo`: "The CEO office can only be delegated to the COO, who signs the same level. Nobody
  else may cover it."
- other offices: "Department heads only. Anyone active who does not already hold an approval
  office or a delegation."

Submit: `.gb-btn-primary` "Activate Delegation" (busy: "Activating…"). Reset: `.gb-btn-ghost`
"Reset", clears draft+errors.

**Landmine — the COO/CEO mutual-coverage and "one HOD holding no seat" rules are NOT
client-validated.** They only exist as (a) hint text and (b) server-side narrowing of the
`candidates` list via `list_delegation_candidates` RPC. The `<select>` options are already
pre-filtered, so an E2E test cannot exercise "pick an ineligible delegate" through the UI at
all — that would require asserting the option list itself is correctly scoped (or a
server/RPC-level test), not a form-validation test.

### `DelegationHistoryTable` (rendered only when `showHistory`)
- `<div id="delegation-history">`, heading "Delegation History" — **identical text to the
  header's toggle button**; disambiguate by role (`heading` vs `button`).
- Empty: `.gb-empty` "You have not delegated your office yet."
- Columns: "Delegated To", "Office", "Valid From", "Valid To", "Approval Limit", "Status",
  "Created On", "Actions" — plain headers, **not sortable**.
- Per-row revoke (only `canRevoke(r)`): `.gbd-revoke.gbd-revoke-sm`, "Revoke" → "Confirm Revoke"
  (two-press, confirm state held per-row via `confirmId`, pressing a different row's Revoke
  overwrites `confirmId` and silently reverts the prior row's button text — no separate Cancel
  here).
- Non-revocable rows show `<span className="gbd-subline">NA</span>` instead of a button.
- Revoked rows show extra subline "Revoked {date}".
- Footer "Showing {n} of {n} {entry|entries}" — **static, not real pagination** despite the
  wording; there are no page-number buttons here.

**Ambiguity**: "Cancel"/"Confirm Revoke" text is identical between `DelegationStatusCard`'s
inline confirm and `DelegationHistoryTable`'s per-row confirm — if both are visible at once,
scope by container (`.gbd-status` vs `#delegation-history`).

### Landmines
- No realtime subscription on this page — updates only via explicit `reload()` after form
  actions; a background change by another actor won't reflect until refresh.
- `datetime-local` inputs are local wall-clock, converted with `new Date(...).toISOString()` at
  submit — fill in `YYYY-MM-DDTHH:mm` format; test-runner timezone affects exact ISO assertions.
- Candidate-list RPC failure is silently swallowed (`canDelegate=false`, no error banner) — a
  delegate account sees "nothing here for you to delegate onward" rather than an error.

---

## 9. `ApprovalDecisionBar` (`src/components/passview/ApprovalDecisionBar.tsx`) — inline on `/pass/:id`

Not its own route — rendered inside `PassDetail` for the reading office holder.

### Three render states
1. **Nothing** (`return null`) when: `!office`, OR pass not routed to this office (`!mine`), OR
   `mine.status !== 'pending'` (already decided), OR `pass.status !== 'pending'` (pass left the
   ladder entirely).
2. **Waiting sentence only** (not yet this office's turn) — container
   `data-testid="record-approval-actions"`, one `<p>` with one of two exact templates:
   - Escalation-held: `` `This pass is routed to you as ${title} (${level}), and it is with the ${holderTitle} until ${date}. You can sign it after that if they have not decided it.` ``
   - Ordinary wait: `` `This pass is routed to you as ${title} (${level}), but it is still with the ${holderTitle}. It reaches you once they have signed.` ``
3. **Actionable bar** — same `data-testid="record-approval-actions"` (**same testid as state 2**
   — distinguish by presence/absence of the Approve/Reject buttons or by exact sentence text):
   - Optional error `.alert-error`.
   - Optional email-intent banner `data-testid="decide-from-email"` (`.alert-info`), shown only
     when arriving via `?decide=approve|reject`:
     - approve intent: "You opened this from an approval email. Nothing has been signed yet —
       read the pass and press Approve below."
     - reject intent: "You opened this from an approval email. Give a written reason to reject
       this pass; nothing has been recorded yet."
   - "You are signing as {title} — {level}" + "Approving sends it to the next office, or
     releases it to the gate if you are the last. Rejecting closes this pass permanently and
     needs a written reason."
   - "Reject" — `.btn-danger`, always literal "Reject", opens `RejectApprovalModal`.
   - "Approve" — `.btn-approve`, "Approve" / busy "Working…".

**`?decide=reject` auto-opens the reject modal on load** (`rejecting` initializes to
`intent==='reject'`). `?decide=approve` does NOT auto-approve — it only shows the banner (an
explicit design decision, per the code comment).

On mount with any `intent` set, the box scrolls into view (`scrollIntoView({block:'center'})`)
— relevant for screenshot tests, not for locator assertions.

Shares the exact same `RejectApprovalModal` and `approvalActions.ts` calls as
`ApprovalCardActions` on `/approvals` — two UI surfaces, one decision path. `onDecided()`
triggers an independent reload in each (record view reloads itself; the queue reloads via
`usePendingApprovals.reload`) — don't assume the other surface reflects the change without its
own reload/navigation.

---

## 10. `RejectApprovalModal` (shared by `ApprovalCardActions` and `ApprovalDecisionBar`)

Built on `ModalShell`: overlay `.modal-overlay` (click closes), content `.modal-content`
`role="dialog" aria-modal="true" aria-labelledby="reject-approval-title"`, `×` close button
`aria-label="Close"`, **Escape key closes** via `useEscapeKey` — this is the app-wide modal
pattern, confirmed generic.

- Title `<h2 id="reject-approval-title">` "Reject Request".
- Subtext "Pass ID: {passNumber}".
- Field: label **"Reason for Rejection *"**, `htmlFor="reject-reason"`,
  `<textarea id="reject-reason" maxLength={500}>`, placeholder "Please provide a reason for
  rejecting this gate pass request...". `page.getByLabel('Reason for Rejection *')`.
- Counter "{length}/500", no testid.
- Error `.alert-error` on submit failure (modal stays open, reason text preserved).
- "Cancel" — `.btn-secondary`, disabled while submitting.
- "Submit Rejection" — `.btn-danger`, "Submit Rejection" / busy "Submitting…",
  **`disabled` when `trimmed.length===0`** — an all-whitespace reason is blocked by disabling
  the button, not by a separate validation message. Test this with `toBeDisabled()`, not by
  looking for an error string.
- `onClose` is neutered while `submitting` — Escape/backdrop/close-button all do nothing
  mid-submit.

---

## 11. `/whitelist` — Whitelist of Vendors (`src/pages/Approver/WhitelistApprovals.tsx`)

**Route + access**: route-reachable by ANY office holder (route guard is UX defence-in-depth
only); the **link into it** from `/approvals` is drawn only for `office === 'ceo'`
(`PendingApprovals.tsx:216-227`). Real authority is enforced per-action inside
`WhitelistRequestsTab` via the `is_ceo()` RPC (`WhitelistRequestsTab.tsx:39` sets `isCeo`); a
non-CEO who navigates here directly by URL gets read-only access.

### Header
`GuardPageHeader` title **"Whitelist of Vendors"**, subtitle "Vendors an admin has asked to
take off the blacklist. Only the CEO decides."

### `WhitelistRequestsTab` (shared with the Admin shell)
- `<h2 className="section-title">` **"Whitelist of Vendors"** — **duplicates the page-level
  title exactly**; disambiguate by heading level: `getByRole('heading', {level:1, name:'Whitelist of Vendors'})`
  vs `{level:2}`.
- KPI row `WhitelistKpiCards`, container `data-testid="whitelist-kpis"`,
  `role="group" aria-label="Whitelist figures"` — **plain divs, not clickable/drillable**
  (unlike `ApprovalKpiCards`). Exact three titles, confirmed from `src/lib/whitelistCounts.ts`:
  - **"Awaiting CEO Decision"** (key `pending`) — note (nonzero) "Vendors waiting to be taken
    off the blacklist"; note (zero) "Nothing is waiting on the CEO".
  - **"Whitelisting Granted"** (key `approved`) — note (nonzero) "Requests the CEO approved —
    the block was lifted"; note (zero) "The CEO has granted no whitelisting yet".
  - **"Whitelisting Rejected"** (key `rejected`) — note (nonzero) "Requests the CEO turned down
    — the vendor stays blocked"; note (zero) "The CEO has rejected no request".
  Card values are exactly `groups[key].length` of the same three-way split of the loaded rows
  (`whitelistCounts.ts:26-30,91-104`) — the board invariant holds by construction (disjoint,
  total split of one array; no separate query).
- Non-CEO notice (`!loading && !isCeo`): "Only the designated CEO can approve or reject a
  whitelist request. You can still review them below."
- Loading: `.table-wrap.p-4` with 3 `.skeleton.h-16.w-full` divs, no text.
- Fully empty: `.table-wrap.empty-state` "No whitelist requests."
- Pending-group empty (requests exist, none pending): `.table-wrap.empty-state` "No requests
  are waiting on the CEO." — **same class as the fully-empty state**, disambiguate by text.
- Decided-group section headers: `<h3 className="section-title">`, text = the KPI title for
  that group ("Whitelisting Granted" / "Whitelisting Rejected").

### `WhitelistRequestCard` — one disclosure per request
- Face `<button type="button" aria-expanded={open} aria-controls={\`whitelist-request-${id}\`}>`
  — shows type badge ("Vendor"/"Vehicle"/"Driver"), `request.list_value`, a formatted date,
  status badge ("Pending"/"Approved"/"Rejected"), and a `▲`/`▼` glyph. Scope by `list_value`
  text since type/status/date repeat across cards.
- Expanded body `data-testid="whitelist-request-details"`: "Blocked because: {reason}",
  "Justification: {text}", "Requested by {name} on {date}", and if decided: "Decided by {name}
  on {date}" + optional "Note: {decision_note}".
- **Only ONE card is open at a time** — `openId` is held in the parent tab, opening a second
  card closes the first (`WhitelistRequestsTab.tsx:75`).
- `WhitelistDecisionControls` renders only when `isPending && isCeo`:

  | Element | Text | Locator | Conditional |
  |---|---|---|---|
  | Approve (initial) | "Approve" | `page.getByRole('button', { name: 'Approve' })` | not yet confirming |
  | Approve confirm prompt | "Sure?" | `page.getByText('Sure?')` | after clicking Approve |
  | Yes | "Yes" | `page.getByRole('button', { name: 'Yes' })` | confirm step |
  | No | "No" | `page.getByRole('button', { name: 'No' })` | confirm step, cancels back to initial |
  | Reject (toggle) | "Reject" | `page.getByRole('button', { name: 'Reject' })` | hidden once reject textarea is shown |
  | Reject reason textarea | placeholder "Reason for rejecting" | `page.getByPlaceholder('Reason for rejecting')` | after clicking Reject |
  | Reject error | "A reason is required." | `page.getByText('A reason is required.')` | on submit with blank/whitespace-only reason — **this one IS a visible validation message** (unlike `RejectApprovalModal`'s disabled-button pattern) |
  | Submit Rejection | "Submit Rejection" (busy "Rejecting…") | `page.getByRole('button', { name: 'Submit Rejection' })` | reject textarea open |
  | Cancel (reject) | "Cancel" | `page.getByRole('button', { name: 'Cancel' })` | reject textarea open, clears note+error |

  RPCs: `approve_whitelist_request({p_id})` and `reject_whitelist_request({p_id, p_note})`
  (`WhitelistDecisionControls.tsx:29,47-50`). On success, `onDecided()` triggers a full list
  reload and closes the open card (`setOpenId(null)`) — a card that was expanded and approved
  will visually collapse and move to a different group; don't assert on the same DOM node
  persisting across the decision.

### Landmines
- Two layers of gating for the same action: route reachability (any office) vs `is_ceo()` RPC
  vs the `isCeo` prop passed down — an E2E test exercising Approve/Reject must authenticate as
  the actual seated CEO; any other office holder only gets read access, silently (no error, no
  disabled-with-tooltip — the controls simply don't render).
- The Approve confirm ("Sure? Yes/No") is a DIFFERENT pattern from the Reject flow (inline
  textarea + disabled-vs-visible-error) — do not assume symmetric UX between the two actions.

---

## 12. Shared component notes (used across §1, §2, §7, others)

- **`PassStack`/`PassStackCard`** (`src/components/PassStack.tsx`,
  `src/components/PassStackCard.tsx`): `data-testid="pass-stack"` on the list wrapper;
  `data-testid="pass-stack-card"` repeats per card (not unique — filter by pass number text);
  `data-testid="pass-ordinal"` on the numeric badge; expand toggle
  `aria-label={\`${open?'Hide':'Show'} items on ${pass.pass_number}\`}` is unique per card and
  the most reliable per-card selector.
- **`ModalShell`** (`src/components/ModalShell.tsx`): every modal in scope (`PassSubmittedModal`,
  `RejectApprovalModal`) shares: overlay `.modal-overlay` click-to-close, `role="dialog"
  aria-modal="true"`, `×` button `aria-label="Close"`, and Escape-key close via `useEscapeKey`
  — confirmed generic pattern, safe to write one shared helper in the test suite.
- **`GuardPager`** (`src/components/guard/GuardPager.tsx`): reused verbatim by `/reports` and
  `/approvals` — "Showing X to Y of Z entries", `aria-label="Previous page"` /
  `aria-label="Next page"`, `aria-current="page"`, `aria-label="Rows per page"` select.

---

## 13. Route-guard / access-control test matrix

Enforced once in `App.tsx` via `isForbidden()` (`roleRoutes.ts:123-137`). Test each row by
navigating directly to the URL while authenticated as the stated role and asserting the
redirect target (`homeFor(role, isApprover)`, `roleRoutes.ts:143-148`):

| Actor | Tries to reach | Expected outcome |
|---|---|---|
| HOD | `/dashboard`, `/raise`, `/overdue`, `/reports`, `/returns`, `/mismatch/:id`, `/expired/:id`, `/pass/:id`, `/profile` | allowed (`ROLE_ROUTES.hod`) |
| HOD | `/admin`, `/admin-dashboard`, `/all-passes`, `/activity`, `/guard-dashboard`, `/console`, `/verify`, `/approvals`, `/delegation`, `/whitelist` | forbidden → redirected to `/dashboard` |
| Office holder, no other role (e.g. dedicated Security Head account) | `/approvals`, `/delegation`, `/whitelist`, `/pass/:id`, `/profile` | allowed (`APPROVER_ROUTES`) |
| Office holder | `/dashboard`, `/raise`, `/overdue`, `/reports`, `/guard-dashboard`, `/admin`, any role-specific route | forbidden → redirected to `/approvals` (`officeReplacesRole` strips the underlying role entirely) |
| HOD who is ALSO designated to an office (e.g. an HOD holding Finance Head) | `/dashboard`, `/raise`, `/reports` | forbidden → redirected to `/approvals` — **this is the key regression case the office-replaces-role rule exists for**: verify the HOD board and Raise Gate Pass are fully unreachable while the designation holds |
| Admin/super_admin designated to an office | admin routes AND `/approvals`/`/delegation`/`/whitelist` | **both allowed** — admin/super_admin are exempt from `officeReplacesRole` (`roleRoutes.ts:111-121`) |
| Non-CEO office holder (e.g. Security Head, Finance Head, COO) | `/whitelist` directly by URL | route loads (not forbidden), but Approve/Reject controls are absent and the "Only the designated CEO..." notice shows |
| CEO | `/whitelist` via the "Whitelist of Vendors" link on `/approvals` | link is present only for CEO; clicking navigates and full decision controls are available |

---

## 14. Numbered test cases

Preconditions column states what must exist before the test runs and, where practical, how to
create it through the UI in a prior step rather than by direct DB seeding.

### Dashboard (`/dashboard`)

**P1-01 — Greeting renders and date chip shows today.**
Preconditions: an active HOD account with `app_metadata.role='hod'`, a department assignment in
`hod_departments`. Steps: sign in as the HOD, land on `/dashboard`. Assert: `<h1>` text matches
`/Good (morning|afternoon|evening), .+/`; `.gb-stamp` shows today's date in `formatDateOnly`
form.

**P1-02 — KPI figures show `'—'` while loading, then real numbers.**
Preconditions: same HOD, with at least one RGP and one NRGP raised today (create via `/raise`
in a setup step). Steps: reload `/dashboard`, immediately assert card figures (best-effort,
timing-sensitive — skip if flaky) then wait for network idle and assert final figures are
non-negative integers.

**P1-03 — Dashboard invariant: NRGP Issued.**
Preconditions: HOD has raised N NRGP passes today. Steps: read the "NRGP Issued" figure, click
it, land on `/dashboard/nrgpIssued`. Assert: header count badge equals N; rendered pass-stack
card count equals N; equals the on-dashboard figure.

**P1-04 — Dashboard invariant: RGP Issued.** Same shape as P1-03 for `/dashboard/rgpIssued`.

**P1-05 — Dashboard invariant: Pending Return.** Preconditions: HOD has at least one RGP whose
material has left but not fully returned. Steps: click "Pending Return", land on
`/dashboard/pendingReturn`. Assert count badge == figure == rendered rows.

**P1-06 — Overdue card navigates to `/overdue`, not a drill page.**
Steps: click the "Overdue" KPI card. Assert: URL is `/overdue` (not `/dashboard/overdue`).

**P1-07 — Desk line ambiguity: "Pending gate approval" under NRGP vs RGP resolve to different
routes.** Preconditions: at least one NRGP and one RGP pending gate approval. Steps: within the
NRGP card, click its "Pending gate approval" link (scoped locator per §1); assert URL
`/dashboard/nrgpPendingGate`. Repeat for the RGP card, assert `/dashboard/rgpPendingGate`.

**P1-08 — Desk line ambiguity: "Pending approval" exact-match under NRGP vs RGP.** Same pattern
as P1-07 for `nrgpPendingApproval` / `rgpPendingApproval`, using `{ name: 'Pending approval',
exact: true }` scoped per card to avoid matching "Pending gate approval".

**P1-09 — Quick Actions: "Raise Gate Pass" tile navigates to `/raise`.**

**P1-10 — Approval Pending strip shows all four slots reading "Waiting" / 0 for a fresh HOD
with no approvals in flight.**

**P1-11 — Department Deletion Request card is absent when there is nothing to decide.**
Preconditions: HOD's department has no pending deletion request. Assert:
`page.getByTestId('dept-delete-requests')` has zero matches.

**P1-12 — Department Deletion Request card appears when a decidable request exists.**
Preconditions: an admin has requested to delete this HOD's department (create via Admin flow,
out of P1 scope to build but in scope to precondition — coordinate with the Admin test plan, or
seed directly). Assert: card visible with testid.

**P1-13 — Realtime silent refresh.** Preconditions: two authenticated contexts — the HOD's
dashboard open in one page, and a way to raise a pass as that HOD from a second context (e.g. a
second browser context signed in as the same HOD, or an API/RPC call). Steps: with `/dashboard`
open and idle, raise a new NRGP pass via the second context. Assert: within a few seconds the
"NRGP Issued" figure increments WITHOUT any `.skeleton` element ever appearing on the first
page.

**P1-14 — Auth failure banner.** Preconditions: a way to force `getUser()` to fail (e.g. an
expired/invalidated session token). Assert `.gb-alert` reads exactly "Could not identify your
account. Sign out and back in."

### Dashboard Drill (`/dashboard/:key`)

**P1-15 — Unknown key redirects to `/dashboard` after loading.** Steps: navigate directly to
`/dashboard/bogusKey`. Assert: page briefly shows heading "Passes" (or redirect happens too
fast to observe — acceptable either way), then URL settles to `/dashboard`.

**P1-16 — Empty state text per key.** Preconditions: an HOD with zero RGP raised today. Steps:
visit `/dashboard/rgpIssued`. Assert `.table-wrap.empty-state` shows the exact configured empty
text for that key (read `drill.empty` value in `boardDrills.ts`/`hodBoard.ts` at test-authoring
time to pin the literal string — this plan flags where to look, not the final string for every
key, since only three were directly quoted above).

**P1-17 — Skeleton then rows.** Steps: throttle network, visit a drill with existing rows.
Assert: 6 `.skeleton` rows appear first, then real `PassStackCard`s replace them.

**P1-18 — Scope note appears only on desk-line drills.** Steps: visit `/dashboard/rgpIssued`
(card drill) — assert `.gb-sub` absent. Visit `/dashboard/rgpPendingGate` (desk drill) — assert
`.gb-sub` present with the exact scope-note text.

**P1-19 — Back to dashboard link.** Click it from any drill, assert URL `/dashboard`.

### HOD Reports (`/reports`)

**P1-20 — Filters apply immediately, no Apply button exists.** Steps: change the Status select.
Assert: table and KPI figures update without any additional click; assert
`page.getByRole('button', { name: 'Apply' })` has zero matches anywhere on the page.

**P1-21 — Any filter change resets to page 1.** Preconditions: enough report rows to have 2+
pages. Steps: navigate to page 2, then change Pass Type filter. Assert: pager shows page 1
active.

**P1-22 — Reset button is disabled until a filter narrows.** Assert `disabled` initially (only
the default date range applied); change Status, assert Reset becomes enabled; click Reset,
assert Status returns to default and Reset becomes disabled again.

**P1-23 — Created By / Department filters and columns are absent for HOD.** Assert
`page.getByLabel('Created By')` and `page.getByLabel('Department')` (as report filters) both
resolve to zero elements; assert no "Raised By Department" / "Created By" column headers exist.

**P1-24 — CSV export.** Steps: click "Export ▾", click "Spreadsheet (.csv)". Assert a download
is triggered (Playwright `page.waitForEvent('download')`) and, if feasible, that the CSV's
header row matches the visible table's columns (per CLAUDE.md's "CSV exports say what the
screen says" invariant).

**P1-25 — Print stub.** Steps: stub `window.print` before clicking "Print". Assert
`window.print` was called exactly once and no unhandled hang occurs.

**P1-26 — Row click navigates to pass detail.** Click a table row (not a link — a bare `<tr
onClick>`), assert URL becomes `/pass/:id` matching that row's pass.

**P1-27 — Row kebab menu: View Details / Print Pass.** Open the row's `Actions for {pass_number}`
menu, click "View Details" → `/pass/:id`; reset, open menu again, click "Print Pass" →
`/pass/:id/print`.

**P1-28 — Empty state.** Preconditions: filter combination matching zero passes (e.g. a future
date range). Assert `.gb-empty` text "No passes match these filters."

**P1-29 — Menus close on outside click, not Escape.** Open the Export menu, press Escape,
assert menu still open; click elsewhere on the page, assert menu closed.

### Mismatch Review (`/mismatch/:id`)

**P1-30 — Not-found state.** Navigate to `/mismatch/<random-uuid>` as the HOD. Assert
`.empty-state` text "That gate pass could not be found, or it is not one you may review."

**P1-31 — Settled pass shows the view-only message.** Preconditions: a pass that was flagged
and already resolved (status no longer `flagged`). Assert settled `.empty-state` text and a
working "View the pass" link to `/pass/:id`.

**P1-32 — Reject Permanently — happy path.** Preconditions: an HOD's pass that security flagged
(status `flagged`) at the gate. Steps: navigate here (simulate arriving from the bell), click
"Reject Permanently", assert confirm UI appears with warning text and optional Reason field;
type a reason, click "Confirm — Reject Permanently". Assert: navigation to `/dashboard`
(no success message shown on this page).

**P1-33 — Reject Permanently — cancel step.** Same precondition. Click "Reject Permanently",
then "Cancel". Assert: idle buttons ("Raise It Again"/"Reject Permanently") are visible again,
no RPC call was made (no navigation occurred).

**P1-34 — Raise It Again pre-fills `/raise`.** Click "Raise It Again". Assert: URL is `/raise`;
Vendor Name and item rows are pre-filled from the source pass (wait for the async prefill, per
the landmine in §6g); the "Raise Gate Pass Again" heading and "Correcting {pass_number}..."
banner are present.

**P1-35 — Error-clear-before-call anti-flicker.** Preconditions: force the reject RPC to fail
once then succeed. Click Reject → Confirm (fails, `.alert-error` shows) → click Confirm again.
Assert: the instant the second attempt starts, `.alert-error` is gone before the new
result returns.

### Expired Review (`/expired/:id`)

**P1-36 through P1-41** — mirror P1-30 through P1-35 exactly, substituting: title "Expired Gate
Pass", card heading "Null and void", button "Void It Permanently", confirm text "Confirm — Void
It Permanently", and the precondition that the pass is genuinely past `expires_at` per the
database (cannot be faked via browser clock — see §5 landmine). P1-41 (raise-again) asserts
navigation to `/raise` with prefill exactly as P1-34.

### Raise Gate Pass (`/raise`)

**P1-42 — Happy path RGP.** Preconditions: HOD with exactly one department assigned. Steps: fill
Vendor Name, Person Who Will Carry, Mobile Number (valid 10-digit), Purpose; leave the 2
starting item rows, fill Item Description/Quantity/Make-Model for both, set Expected Return
Date to today+1 for both. Click "Submit Request". Assert: "Pass Submitted" modal opens with a
real pass number matching `RGP-OUT-\d{8}-\d{4}`; "View Pass" navigates to `/pass/:id` showing
the same number.

**P1-43 — Happy path NRGP.** Same as P1-42 but select "NRGP (Non-Returnable Gate Pass)" first.
Assert: the "Expected Return Date" column is entirely absent from the item grid; submit
succeeds; pass number matches `NRGP-OUT-\d{8}-\d{4}`.

**P1-44 — Required-field validation, one at a time.** For each required field (Vendor Name,
Person Who Will Carry, Mobile Number, Purpose, and per-item Item Description/Quantity/Make-Model,
and RGP-only Expected Return Date), leave only that field blank, submit, assert the exact error
string quoted in §6b/§6c appears, then fill it and confirm the error clears on next submit.

**P1-45 — Mobile number boundaries.** Enter 6 digits → submit → assert "Enter a valid mobile
number."; enter 7 digits → assert no mobile error; enter 15 digits → assert no mobile error;
enter 16 digits → assert the same invalid-message.

**P1-46 — Quantity whole-unit split error.** Set Unit to "Numbers" (nos), Quantity to `2.5`.
Submit. Assert exact text "Numbers cannot be split — enter 2 or 3." Set Quantity to `0.5`.
Assert "Numbers cannot be split — enter 1."

**P1-47 — Quantity fractional unit allowed.** Set Unit to "Kg", Quantity to `0.01`. Assert no
quantity error on submit (other fields valid).

**P1-48 — Quantity ≤ 0.** Set Quantity to `0` and separately `-1`. Assert "Enter a quantity
greater than 0." in both cases.

**P1-49 — Approx. Value optional and boundary.** Leave blank → no error. Enter `-1` → "Enter a
value of 0 or more, or leave it blank." Enter `0` → valid.

**P1-50 — Purpose 500-char boundary.** Attempt to type 501 characters via `fill()` (bypassing
the DOM `maxLength`); if the harness allows it, assert either the browser truncates to 500 or,
if a raw value >500 reaches state, submit shows "Keep the purpose under 500 characters." Note in
the test comment that normal typing cannot reach this path (DOM cap blocks it) — this is a
defensive/edge test only.

**P1-51 — Expected Return Date cannot be in the past (RGP).** Set an item's Expected Return
Date to yesterday via `fill()` (bypassing the native `min` floor). Submit. Assert "Return date
cannot be in the past."

**P1-52 — Add/remove item rows.** Click "Add Another Item" three times, assert 5 rows exist and
row `#` labels read 1–5. Click "Remove item 3", assert 4 rows remain and are renumbered 1–4.
Remove down to 1 row, assert no remove button is rendered on the last row (`Remove item 1`
locator resolves to zero elements).

**P1-53 — Add/remove clears prior errors.** Trigger a per-item validation error on row 2 (leave
Item Description blank, submit). Then click "Add Another Item". Assert the row-2 error is
cleared without resubmitting. Repeat with "Remove item" on a different row and confirm all
`item_*` errors clear.

**P1-54 — Special characters in Vendor Name.** Set Vendor Name to `Acme, Traders (Pvt.) Ltd.`
(comma + brackets). Submit a valid pass. Assert success (no client-side rejection). Follow-up:
on `/approvals` or the gate search (outside strict P1 scope but worth a cross-check note),
search for that vendor and assert no 400/error occurs — this exercises `sanitizeTerm` even
though `/raise` itself does no sanitization.

**P1-55 — No unsaved-changes confirmation on Cancel.** Fill several fields, click "Cancel".
Assert: immediate navigation to `/dashboard`, no confirm dialog.

**P1-56 — Success modal: Send to Vendor is conditional.** Precondition A: vendor phone present
in the packed data (normal flow, since Mobile Number is required) — assert "Send to Vendor"
link is present and its href starts with `https://wa.me/`. (Given Mobile Number is required on
this form, this link should be present on every successful submission via the normal UI; note
this as effectively an always-present case for `/raise`-originated passes, and flag the
"conditional" branch as primarily relevant to legacy/imported data rather than reachable
through this form.)

**P1-57 — Success modal Escape/backdrop close without navigating.** After a successful submit,
press Escape. Assert: modal closes, URL remains `/raise`, form fields still show the
just-submitted values (per the landmine — nothing resets).

**P1-58 — Keyboard navigation / focus order.** Tab from the Pass Type radiogroup through Vendor
Name, Vendor Address, Person Who Will Carry, country code, Mobile Number, Purpose, into the item
grid, to Submit. Assert a logical left-to-right, top-to-bottom order and that the radiogroup
responds to arrow keys per native `role="radiogroup"` semantics.

**P1-59 — Re-raise prefill race.** From `/mismatch/:id` or `/expired/:id`, click "Raise It
Again". Assert the form is briefly blank/default, then Vendor Name and item rows populate from
the source pass without requiring a manual reload (poll, don't assert instantly).

**P1-60 — Re-raise voids the source pass, eventually.** Complete a re-raise submit. Assert the
new pass's success modal appears first; only afterward (poll `/pass/<old-id>`) assert the old
pass's status has moved to void/rejected — do not assert both in the same tick.

**P1-61 — No departments assigned.** Preconditions: an HOD account with zero rows in
`hod_departments` (edge/admin-seeded state). Steps: fill the form validly, submit. Assert whole-
form `.alert-error` "You are not assigned to any department." and no pass is created.

### Pending for My Approval (`/approvals`)

**P1-62 — No-office empty state.** Preconditions: an account with `office=null` reaching this
route (edge case / defensive test, may require a direct navigation as an admin exempted from the
office redirect, or a specially seeded account). Assert "This account does not hold an approval
office." and zero network calls to the approvals query.

**P1-63 — KPI dashboard invariant: Awaiting Your Approval.** Preconditions: an approver account
(e.g. Security Head) with N passes currently routed to it. Steps: read the "Awaiting Your
Approval" figure, click it. Assert: `aria-expanded="true"`, the stack under `#approval-stack`
renders exactly N `pass-stack-card`s.

**P1-64 — KPI dashboard invariant: Approved by You / Rejected by You.** Preconditions: approve
one pass and reject another as this approver (chain from P1-66/P1-68). Click each card in turn,
assert stack row count matches the figure.

**P1-65 — "Nobody Has Approved" card only for COO/CEO.** Sign in as Security Head or Finance
Head: assert the card is entirely absent (zero matches). Sign in as COO or CEO: assert it is
present (may read 0, but the card itself renders — button `disabled` when total is 0, not
hidden... actually per source: `ApprovalKpiCards.tsx:107` returns `null` when `total===undefined`,
which only happens when `holdsFallbackOffice` is false; when true but `total===0`, the card
still renders with a disabled button. Assert accordingly: rendered, `disabled` when 0.)

**P1-66 — Approve happy path from the queue card.** Preconditions: a pass pending at this
approver's rung. Steps: expand "Awaiting Your Approval", find the card by pass number, click its
scoped "Approve" button. Assert: button shows "Working…" transiently, then the card disappears
from this queue and the "Approved by You" figure increments by 1 after reload.

**P1-67 — Approve failure shows inline error.** Preconditions: force the approve RPC to fail
(e.g. stale/already-decided pass). Click Approve. Assert `.gpo-act-error` shows a message and
the card remains in the pending list.

**P1-68 — Reject happy path.** Click a card's "Reject" button, assert `RejectApprovalModal`
opens with "Pass ID: {passNumber}" matching that card. Type a reason, click "Submit Rejection".
Assert modal closes, card leaves "Awaiting Your Approval", "Rejected by You" figure increments.

**P1-69 — Reject blocked on blank reason.** Open the reject modal, leave the textarea blank (or
whitespace-only). Assert "Submit Rejection" is `disabled` (not an error message).

**P1-70 — Reject modal Escape/backdrop/close-button all close it; disabled mid-submit.** Open
modal, verify Escape closes it (reason discarded). Reopen, type a reason, trigger submit and
(if the harness can catch the in-flight window) verify Escape does nothing while `submitting`.

**P1-71 — Filter bar: search narrows all four KPI counts simultaneously.** Preconditions:
multiple passes from different vendors. Type a vendor substring into the search box. Assert all
visible KPI figures (pending/approved/rejected/stuck) drop to only rows matching that vendor,
with no debounce delay beyond a keystroke.

**P1-72 — Filter bar: Pass Type and Department combine (AND).** Set Pass Type to "RGP" and
Department to a specific department. Assert only RGP passes from that department count/appear.

**P1-73 — Empty vs filtered-empty text.** With zero total passes: assert "Nothing is waiting on
your signature." With passes present but filters excluding all: assert "No request matches
these filters."

**P1-74 — Pager.** Preconditions: >10 passes in one queue bucket. Assert default page size 10,
"Showing 1 to 10 of N entries", Next/Previous behavior, and changing "Rows per page" updates the
count and resets to page 1.

**P1-75 — Quick Actions: Whitelist link is CEO-only.** Sign in as CEO: assert "Whitelist of
Vendors" link present, navigates to `/whitelist`. Sign in as any other office: assert the
Quick Actions block / link is entirely absent.

**P1-76 — Realtime silent refresh on the queue.** With `/approvals` open and idle, have another
context raise a pass that routes to this approver. Assert the "Awaiting Your Approval" figure
increments without a skeleton flash.

### Approval Delegation (`/delegation`)

**P1-77 — No-office empty state.** Mirror P1-62 for this route; assert the specific subtitle
text differs slightly in capitalization from the with-office variant (note this as a documented
non-bug).

**P1-78 — Create Delegation happy path (regular office, e.g. Finance Head).** Preconditions:
signed in as Finance Head; at least one eligible active HOD (holding no seat) exists. Steps:
click "Create Delegation" (assert scroll+focus lands on `#delegate-to`), select a candidate, set
Start = now+1h, End = now+2h, leave Approval Limit blank, submit. Assert `.gbd-done` "Delegation
activated." and a new "SCHEDULED" (or "ACTIVE" if the window already started) `DelegationStatusCard`
appears with matching facts (Delegated To, Office, Valid From/To, Approval Limit "No Limit").

**P1-79 — Candidate list is pre-filtered — cannot select an ineligible person.** Preconditions:
same as P1-78. Steps: open the Delegate To select, enumerate all options. Assert every option
corresponds to an active HOD holding no seat (cross-check against known seeded accounts) — this
test validates the RPC-side narrowing indirectly, since the UI cannot be made to accept a bad
selection.

**P1-80 — COO delegates only to CEO (and vice versa).** Preconditions: signed in as COO. Steps:
open Delegate To. Assert exactly one option (the CEO) is present, and the hint text reads "The
COO office can only be delegated to the CEO, who signs the same level. Nobody else may cover
it." Repeat for CEO → expect the COO as the sole option and the mirrored hint text.

**P1-81 — Validation: all four required-field errors.** Leave each of Delegate To, Start, End
blank in turn (submitting the other two + a valid third), assert each exact error message from
§8's table. Set End before Start, assert "The delegation has to end after it starts." Set End in
the past, assert "That period is already over. Choose an end in the future."

**P1-82 — Approval Limit validation.** Enter `0`, assert "An approval limit has to be more than
zero. Leave it blank for no limit." Enter a non-numeric string via `fill()`+`evaluate` bypass if
the native number input blocks it, assert "Enter an amount in rupees, or leave it blank for no
limit." Enter `1`, assert no error (boundary, valid).

**P1-83 — Reset button clears the draft.** Fill several fields, click "Reset". Assert every
field returns to its default/blank state and any shown errors clear.

**P1-84 — Revoke from the Status Card, two-press confirm.** Preconditions: an active delegation
from P1-78. Click "Revoke Delegation". Assert "This cannot be undone." plus "Cancel"/"Confirm
Revoke" appear. Click "Cancel" — assert reverts to the single "Revoke Delegation" button, no RPC
call. Click "Revoke Delegation" again, then "Confirm Revoke". Assert `.gbd-done` "Delegation
revoked. Approvals are back with you alone." and the `DelegationStatusCard` disappears entirely
(no zero-state placeholder).

**P1-85 — Delegation History table.** Click "Delegation History" toggle (`aria-expanded`
flips). Assert the table renders with the 8 named columns, one row per past delegation
(including the one just revoked in P1-84, showing "Revoked {date}" subline). Assert no sort
controls exist on any column header (click a header, assert no reorder occurs).

**P1-86 — History empty state.** Preconditions: an office holder who has never delegated. Toggle
History open. Assert "You have not delegated your office yet."

**P1-87 — History per-row revoke, independent confirm state.** Preconditions: 2+ revocable
delegations in history (e.g. two future-dated scheduled delegations). Click "Revoke" on row A —
assert it becomes "Confirm Revoke". Click "Revoke" on row B — assert row A silently reverts to
"Revoke" and row B now shows "Confirm Revoke" (per the landmine in §8). Click "Confirm Revoke"
on row B, assert only row B's status changes.

**P1-88 — "No delegation to give" message for a covering delegate.** Preconditions: an account
currently covering another office as a stand-in (holds no office of its own to delegate onward).
Assert the `.gb-empty` message: "You are acting for the {office title} office as a stand-in, so
there is nothing here for you to delegate onward." and no `DelegationForm` fields are rendered.

**P1-89 — `datetime-local` timezone fill format.** Fill Start/End using `YYYY-MM-DDTHH:mm`
strings and confirm the resulting `DelegationStatusCard` "Valid From"/"Valid To" facts render
the expected local time (document the test runner's timezone in the test file).

### Approval decision on `/pass/:id` (`ApprovalDecisionBar`)

**P1-90 — Not-my-turn: no bar at all.** Preconditions: a pending pass not yet routed to this
approver's rung. Visit `/pass/:id`. Assert `page.getByTestId('record-approval-actions')`
resolves to zero elements (state 1 — component returns null).

**P1-91 — Waiting sentence (state 2), ordinary case.** Preconditions: a pending pass routed to
an earlier office, this approver's rung not yet reached. Assert `data-testid=
"record-approval-actions"` is present, contains the exact "...but it is still with the
{holderTitle}. It reaches you once they have signed." sentence, and NO Approve/Reject buttons
exist inside it.

**P1-92 — Waiting sentence (state 2), escalation-held case.** Preconditions: a pass stuck at the
COO/CEO shared rung past `app_settings.coo_escalation_hours`, viewed by the non-holder of that
moment (or before the window passes). Assert the escalation-specific sentence variant with a
date.

**P1-93 — Actionable bar (state 3): Approve.** Preconditions: a pending pass at this approver's
own rung. Visit `/pass/:id`. Assert the "You are signing as {title} — {level}" sentence and both
Approve/Reject buttons present. Click Approve. Assert success (page reloads its own approval
state; bar either disappears — state 1, if this was the last rung releasing to gate or moving on
— or shows "Approved" reflected elsewhere on the pass record).

**P1-94 — Actionable bar: Reject via the record view.** Click Reject, assert
`RejectApprovalModal` opens (same component as §10), fill a reason, submit. Assert the pass's
status becomes rejected/closed and the bar's actionable state is gone on reload.

**P1-95 — `?decide=reject` auto-opens the modal.** Navigate to `/pass/:id?decide=reject`.
Assert `RejectApprovalModal` is already open on load without any click, and the page has
scrolled the decision box into view.

**P1-96 — `?decide=approve` shows the info banner but does NOT auto-approve.** Navigate to
`/pass/:id?decide=approve`. Assert `data-testid="decide-from-email"` banner text "You opened
this from an approval email. Nothing has been signed yet — read the pass and press Approve
below." is shown, and the pass's approval status is unchanged until an explicit Approve click.

**P1-97 — Same-testid disambiguation.** Directly assert that both state-2 and state-3 renders
use the identical `data-testid="record-approval-actions"`, and that a test must branch on the
presence of `getByRole('button', {name:'Approve'})` to tell them apart (documents the ambiguity
from §9 as an explicit regression test so a future UI change that breaks this doesn't go
unnoticed).

### Whitelist of Vendors (`/whitelist`)

**P1-98 — Route reachable, controls hidden for non-CEO office holders.** Sign in as Security
Head/Finance Head/COO. Visit `/whitelist` directly. Assert page loads (not forbidden-redirected),
KPI cards show correct §11 titles/counts, but "Only the designated CEO can approve or reject a
whitelist request. You can still review them below." is shown and no
`WhitelistDecisionControls` render inside any expanded card.

**P1-99 — CEO KPI dashboard invariant.** Sign in as CEO. Preconditions: known counts of pending/
approved/rejected whitelist requests. Assert each KPI card's value equals
`groups[key].length`; expand the "Awaiting CEO Decision" section, count visible request cards,
confirm it equals the KPI figure.

**P1-100 — Approve flow, two-press confirm.** Expand a pending request card. Click "Approve".
Assert "Sure?" + "Yes"/"No" appear. Click "No" — assert reverts to "Approve" with no RPC call.
Click "Approve" again → "Yes". Assert: card's status badge becomes "Approved", the card list
re-renders (card collapses per the landmine — `setOpenId(null)`), and "Whitelisting Granted"
figure increments by 1 while "Awaiting CEO Decision" decrements by 1.

**P1-101 — Reject flow, blank-reason error.** Expand a pending card, click "Reject". Assert the
"Reason for rejecting" textarea appears and "Approve" is hidden. Click "Submit Rejection" with
an empty textarea. Assert the VISIBLE error text "A reason is required." appears (this differs
from `RejectApprovalModal`'s disabled-button pattern — confirm this distinction explicitly in
the test).

**P1-102 — Reject flow happy path.** Type a reason, click "Submit Rejection". Assert
"Rejecting…" busy text transiently, then card status becomes "Rejected", "Whitelisting
Rejected" increments, "Awaiting CEO Decision" decrements.

**P1-103 — Reject Cancel button.** Open Reject, type partial text, click "Cancel". Assert the
textarea and its content are gone, "Approve"/"Reject" toggle returns to initial state, no RPC
call was made.

**P1-104 — Only one card open at a time.** Expand card A, then click card B's face. Assert card
A auto-collapses (its `aria-expanded` becomes false) as card B opens.

**P1-105 — Empty states.** With zero requests ever created: `.table-wrap.empty-state` "No
whitelist requests." With requests existing but none pending (all decided): "No requests are
waiting on the CEO." (scoped to the pending group only — decided groups still list their own
rows below).

**P1-106 — Duplicate-heading disambiguation.** Assert exactly one `getByRole('heading', {level:
1, name:'Whitelist of Vendors'})` and one `getByRole('heading', {level:2, name:'Whitelist of
Vendors'})` — regression test for the known duplicate-text landmine.

---

## 15. Data preconditions summary

| Fixture needed | How to create via UI | Screens depending on it |
|---|---|---|
| Active HOD, one department assigned | `create-user` script or Admin → Users (out of P1 scope to build, but the account is a P1 precondition) | all HOD screens |
| RGP raised today, RGP raised prior day | `/raise` as HOD (today); for a prior-day one, either wait a day in a long-running suite or seed directly — flag as **needs DB seed**, not UI-creatable within a single test run | Dashboard KPIs (today-only counts), Reports |
| NRGP raised today | `/raise` as HOD, select NRGP | Dashboard KPIs, Reports |
| A pass flagged at the gate (status `flagged`) | requires a Security/guard actor to run `flag_pass` at `/verify` — **cross-role precondition**, coordinate with the guard test plan (P2/out of scope) or seed via RPC | `/mismatch/:id` |
| A pass past `expires_at`, never verified | raise a pass, then advance the DB clock or seed `expires_at` in the past — **cannot be done via UI**, needs a DB-level fixture | `/expired/:id` |
| A pass pending at a specific approver's rung | raise an RGP/NRGP as HOD; the approval ladder RPC routes it automatically to Security Head first — chain HOD raise → approver queue | `/approvals`, `ApprovalDecisionBar` |
| A pass approved/rejected by the signed-in approver | approve/reject via `/approvals` in a prior test step | `/approvals` KPI invariants |
| An active delegation (scheduled/active/expired/revoked) | create via `/delegation` `DelegationForm`; expired/revoked states require either waiting out the window or performing a Revoke in-test | `/delegation` |
| A whitelist request (pending/approved/rejected) | created by an Admin flagging a blocked vendor and requesting whitelisting (Admin scope, out of P1) — precondition must be seeded or coordinated with the Admin test plan | `/whitelist` |
| A department deletion request | Admin-initiated (out of P1 scope) | Dashboard's `DepartmentDeleteRequests` card |
| An HOD account also designated to an approval office | Admin designates via the approval ladder screen (out of P1 scope) | §13 access-control matrix (officeReplacesRole regression) |
| Admin/super_admin designated to an office | same, Admin scope | §13 access-control matrix (exemption case) |

---

## 16. Recommended data-testid additions

None currently exist on the HOD screens except `data-testid="dept-delete-requests"`
(`src/components/hod/DepartmentDeleteRequests.tsx:44`). On the approver screens, existing
testids are `approval-kpis` (`ApprovalKpiCards.tsx:101`), `pass-stack`/`pass-stack-card`/
`pass-ordinal` (shared `PassStack`/`PassStackCard`), `record-approval-actions` and
`decide-from-email` (`ApprovalDecisionBar.tsx:93,131,141`), and `whitelist-kpis`/
`whitelist-request-details` (`WhitelistKpiCards.tsx:26`, `WhitelistRequestCard.tsx:90`).
Recommended additions, all optional polish since every element is currently reachable via
`getByRole`/`getByLabel`:

1. `src/components/hod/HodKpiCards.tsx:39` — `data-testid={\`hod-kpi-${card.key}\`}` on each
   `.gb-card.gb-kpi` div, to target NRGP/RGP/Pending-Return/Overdue without mixed number+label
   text matching.
2. `src/components/hod/HodKpiCards.tsx:59` — `data-testid={\`hod-kpi-note-${n.key}\`}` on each
   desk-line `<Link>`, since "Pending gate approval"/"Pending approval" text repeats 4 times
   total across the two cards.
3. `src/components/hod/HodApprovalPending.tsx:45` — `data-testid={\`approval-slot-${s.key}\`}`
   on each `.gb-approval` div — currently zero unique non-text selector per slot.
4. `src/pages/HOD/MismatchReview.tsx` (not-found `.empty-state`, ~line 110) and
   `src/pages/HOD/ExpiredReview.tsx` (~line 111) — `data-testid="pass-not-found"`; and inside
   `src/pages/HOD/PassDecisionPanel.tsx` (~line 43) — `data-testid="pass-settled"` — both
   currently share the generic `.empty-state` class with overlapping text.
5. `src/pages/Admin/ReportsFilterBar.tsx:127,141` — `data-testid="report-filter-type"` /
   `"report-filter-status"` — the Pass Type `aria-label` sits directly under a visible `<span>`
   with the same text, a fragile `getByLabel` target.
6. `src/pages/Admin/ReportsTable.tsx:115` — `data-testid={\`report-row-${p.id}\`}` on the bare
   `<tr onClick>` — currently only targetable via `.filter({ hasText })`.
7. `src/components/approver/ApprovalKpiCards.tsx:109` — `data-testid={\`approval-kpi-${c.key}\`}`
   per card button.
8. `src/components/approver/DelegationStatusCard.tsx:77,81,85,89,95` —
   `data-testid="delegation-status-{field}"` on each `<dd>` (Delegated To / Office / Valid
   From / Valid To / Approval Limit).
9. `src/pages/Admin/WhitelistRequestCard.tsx:67` — `data-testid={\`whitelist-request-toggle-${id}\`}`
   on the disclosure button, since the face repeats structurally and is only distinguishable by
   `list_value` text today.
10. `src/components/approver/DelegationHistoryTable.tsx:93` —
    `data-testid={\`delegation-revoke-${r.id}\`}` per-row revoke button, to disambiguate from
    `DelegationStatusCard`'s identically-labeled button without container scoping.
11. `src/pages/Admin/WhitelistRequestsTab.tsx` — `data-testid="whitelist-group-{status}"` on
    each status group wrapper/`<h3>`.
12. `src/pages/HOD/PassSubmittedModal.tsx:65` (via a testid prop threaded through `ModalShell`)
    — `data-testid="pass-submitted-modal"` on the dialog container, and
    `src/pages/HOD/PassSubmittedModal.tsx:79` — `data-testid="raise-pass-number"` on the pass
    number heading, useful for chaining the generated number into follow-up tests.
13. `src/pages/HOD/RaisePass.tsx:312,315` — `data-testid="raise-cancel"` /
    `data-testid="raise-submit"` — lower priority since role+name already works, but removes
    dependency on the Submit button's text swapping to "Submitting…".
14. `src/pages/HOD/MaterialItemsCard.tsx:102` — `data-testid="raise-add-item"` on "Add Another
    Item".

---

## 17. Open questions / unverified facts requiring a follow-up read before finalizing exact
    assertions

- Exact option list/text for the "Quick range" select on `/reports` (`src/lib/reportsDateRange.ts`
  — not read in this pass).
- Exact 6 titles on `ReportsKpiCards` (`src/lib/gatePassReport.ts`'s `buildReportKpis` — not
  read).
- Exact `drill.heading`/`drill.empty` strings for every one of the 7 dashboard-drill keys beyond
  the three directly quoted in §1/§2 (full list lives in `src/lib/hodBoard.ts` — was read in
  aggregate by the research agent but not every literal string was transcribed here; re-open
  `hodBoard.ts` before hard-coding all 7 empty-state strings into test assertions).
- `PassRow.tsx` (compact pass summary used on Mismatch/Expired) and `PassStackCard.tsx`'s full
  internal item-list markup were not read line-by-line for every sub-element (only their
  top-level testids/aria-labels were confirmed) — read both before writing assertions on the
  expanded item list inside a stack card.

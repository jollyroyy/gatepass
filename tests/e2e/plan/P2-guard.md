# P2 — Playwright plan: Security / Guard role, returns, overdue

Scope owner: P2. Covers `src/pages/Security/**`, `src/components/guard/**`,
`src/components/returns/**`, `src/components/overdue/**`,
`src/pages/Shared/OverdueItemsPage.tsx` + `ReturnsDueTodayPage.tsx`,
`QrScanner`/`QrPass`, `PassStack`/`PassStackCard`/`PassStackItems`, and the
supporting libs. Every claim below is cited `file:line`. No test code is
written here — a code-generating agent consumes this document.

Dev server: `http://localhost:5174`. No `playwright.config.*` exists yet in
this repo as of this writing — the code-generating agent must add one
(`tests/e2e/`, base URL `http://localhost:5174`).

---

## 0. Legend

- G1 = guard role (`profiles.role = 'guard'`, `app_metadata.role='guard'`)
- H1 = HOD role, A1 = admin, S1 = super_admin (only referenced for route-guard
  negative tests)
- KPI-INV = "a KPI number MUST equal `rows.length` of the array its drill page
  renders" — the dashboard invariant from CLAUDE.md, restated per-figure below.

---

## 1. Routes and who may reach them

Source: `src/lib/roleRoutes.ts:47` (`ROLE_ROUTES.guard`), `:66` (`ROLE_HOME`),
`src/App.tsx:286-289,315-316`.

```
ROLE_ROUTES.guard = ['/guard-dashboard', '/overdue', '/console', '/returns',
                      '/verify', '/pass', '/profile']
ROLE_HOME.guard = '/guard-dashboard'
```

| Route | Page | Notes |
|---|---|---|
| `/guard-dashboard` | `GuardDashboard.tsx` | guard's landing page (`ROLE_HOME.guard`) |
| `/guard-dashboard/:key` | `GuardDrill.tsx` | `key ∈ {RGP, NRGP, returns}`; unknown key → `<Navigate to="/guard-dashboard"/>` (GuardDrill.tsx:58) |
| `/console` | `GateConsole.tsx` | search-only screen; NOT a sidebar tab (comment App.tsx:285-289) but still routed |
| `/verify/:id` | `Verify.tsx` | the Approve/Reject decision screen |
| `/overdue` | `OverdueItemsPage.tsx` (role-scoped) | guard, HOD and admin all reach this one page |
| `/returns` | `ReturnsDueTodayPage.tsx` (role-scoped) | same three roles |
| `/pass/:id` | `PassRecordView` (shared, not in P2's file list but reached from every guard search/list) | the one gate-pass record format |

A guard does NOT have `/dashboard` (HOD), `/raise`, `/admin`, `/all-passes`,
`/admin-dashboard`, `/reports`, etc. — `isForbidden` (`roleRoutes.ts:132-145`)
redirects any of those to `homeFor(role)` = `/guard-dashboard`
(`RouteGuard`, `src/App.tsx:51-65`).

**Route-guard test (P2-90 below)**: sign in as guard, `page.goto('/admin')`
and `page.goto('/raise')` → both must end on `/guard-dashboard`.

---

## 2. Screen-by-screen selector inventory

### 2.1 `GuardDashboard.tsx` (`/guard-dashboard`)

File: `src/pages/Security/GuardDashboard.tsx`.

| Element | Text (verbatim) | Locator | Notes / condition |
|---|---|---|---|
| Greeting heading | `Hello, {firstName}` (GuardDashboard.tsx:88) | `page.getByRole('heading', { name: /^Hello, / })` | firstName from `fetchMyProfile()`; falls back to "Guard" if profile never resolves |
| Subtitle | `Approve OUT for materials leaving and verify returns for RGP.` (:90) | `page.getByText('Approve OUT for materials leaving and verify returns for RGP.')` | static |
| Date stamp | formatted via `formatDateTime(stamp)` (:98) | not usually asserted exactly; assert presence via `.gb-stamp` | stamped once at mount |
| Search input | placeholder `Search by Pass No., Name, Vendor, Mobile No., Order No., Make / Model…` (GuardDashboard.tsx:53) | `page.getByPlaceholder('Search by Pass No., Name, Vendor, Mobile No., Order No., Make / Model…')` OR `page.getByLabel('Search any pass by number or by the mobile number of the person carrying it')` (sr-only label, useGuardSearch.tsx:117-119) | ellipsis is the Unicode `…` char, not three dots |
| Scan button | `Scan QR` / toggles to `Close Scanner` (useGuardSearch.tsx:130) | `page.getByRole('button', { name: 'Scan QR' })` | no aria-label; plain button+icon |
| RGP figure | number or `—` while loading; `data-testid="guard-figure-RGP"` (GuardSummaryCards.tsx:47,66) | `page.getByTestId('guard-figure-RGP')` | it's an `<a>` (React Router `<Link>`) to `/guard-dashboard/RGP`, role `link` |
| NRGP figure | `data-testid="guard-figure-NRGP"` | `page.getByTestId('guard-figure-NRGP')` | → `/guard-dashboard/NRGP` |
| Pending RGP Return figure | `data-testid="guard-figure-Due back"` (label undefined → falls back to `'Due back'`, GuardSummaryCards.tsx:47,78) | `page.getByTestId('guard-figure-Due back')` | → `/guard-dashboard/returns`; NOT `guard-figure-returns` |
| "Pending OUT (Needs Approval)" heading | verbatim (GuardSummaryCards.tsx:64) | `page.getByRole('heading', { name: 'Pending OUT (Needs Approval)' })` | static |
| "Pending RGP Return (Needs Verification)" heading | verbatim (:76) | `page.getByRole('heading', { name: 'Pending RGP Return (Needs Verification)' })` | static — this is the exact CLAUDE.md-named card |
| item/items unit next to returns figure | `"item"` / `"items"` (:80) | scope inside the returns figure's card | singular iff value === 1 |
| Quick Actions heading | `Quick Actions` (QuickActions.tsx:67) | `page.getByRole('heading', { name: 'Quick Actions' })` | |
| "Scan QR / Pass No." tile | link, title verbatim (QuickActions.tsx:44) | `page.getByRole('link', { name: /Scan QR \/ Pass No\./ })` | → `/console`; no count |
| "Overdue Returns" tile | link, title verbatim (:45) | `page.getByRole('link', { name: /Overdue Returns/ })` | → `/overdue`; count = `N item(s)` (itemCount, :50-51), hidden while `loading` |

**STRICT-MODE AMBIGUITY**: none observed within this screen alone (RGP/NRGP/Due
back testids are distinct). But "View pass" / "Approve OUT" text WILL repeat
once `SearchMatches` renders multiple cards — see §3.

**Conditional rendering** (GuardDashboard.tsx:108): while `search.scanning` is
true, or while `search.results` (a multi-match `SearchMatches` render) is
non-null, the `GuardSummaryCards` + `QuickActions` block is replaced entirely —
`search.scanning ? null : search.results ?? (<>cards/actions</>)`. So:
- Camera open → neither cards nor quick actions are in the DOM.
- Multi-pass search result showing → neither cards nor quick actions are in
  the DOM (`SearchMatches` renders instead).
- Single-pass match → `navigate('/pass/:id')`, dashboard unmounts.

### 2.2 `GuardDrill.tsx` (`/guard-dashboard/:key`)

File: `src/pages/Security/GuardDrill.tsx`. Frame is `DrillPageShell`
(`src/components/DrillPageShell.tsx`).

| Element | Text | Locator | Notes |
|---|---|---|---|
| Back link | `Back to dashboard` (GuardDrill.tsx:70, rendered via DrillPageShell.tsx:51) | `page.getByRole('link', { name: 'Back to dashboard' })` | → `/guard-dashboard` |
| Title | `Pending OUT · RGP` / `Pending OUT · NRGP` / `Pending RGP Return` (GuardDrill.tsx:39,43,47) | `page.getByRole('heading', { name: 'Pending RGP Return' })` etc | note the middle dot `·`, not a hyphen, in the OUT titles |
| Count beside title | `{count} {noun}` (DrillPageShell.tsx:55-59) | inside the `h1` | RGP/NRGP: noun = "pass"/"passes" (default); returns: noun = "item"/"items" (`ITEM_NOUN`, GuardDrill.tsx:32) — **the KPI-INV assertion target, see §6** |
| Subtitle | RGP: `Returnable material waiting for your approval at the gate.` / NRGP: `Non-returnable material waiting for your approval at the gate.` / returns: `Material lines that went out on an RGP and are due back today. Anything past its date is under Overdue Returns.` (GuardDrill.tsx:40,44,48-49) | `page.getByText(...)` | verbatim |

For `key='RGP'`/`'NRGP'` → renders `PendingOutPanel` (§2.3). For
`key='returns'` → renders `ScheduledReturns` (§2.6), fed
`passes={returnLines.map(r=>r.pass)}`, `items={returnLines.map(r=>r.item)}`,
`canRecord`, `empty="Nothing is due back today."` (GuardDrill.tsx:87-93).

**Important derivation subtlety**: `GuardDrill` does NOT pre-filter `rows` by
type before handing them to `PendingOutPanel` — `rows={pendingOut}`
(GuardDrill.tsx:102) is the FULL `pendingOutOf(queue)` array for BOTH
`/guard-dashboard/RGP` and `/guard-dashboard/NRGP`; only `initialTab` differs
(`key as 'RGP'|'NRGP'`, :104), which seeds `PendingOutPanel`'s own
`filters.tab` (PendingOutPanel.tsx:51). **Test case**: on `/guard-dashboard/RGP`,
switching the Type select/tab to NRGP must reveal NRGP rows too (P2-33).

### 2.3 `PendingOutPanel.tsx` (rendered inside GuardDrill for `RGP`/`NRGP`)

File: `src/components/guard/PendingOutPanel.tsx`.

| Element | Text | Locator | Condition |
|---|---|---|---|
| Region | `role="region" aria-label="Pending OUT (Needs Approval)"` (:68) | `page.getByRole('region', { name: 'Pending OUT (Needs Approval)' })` | static |
| Tab strip | see `GuardToolbar` §2.4 | | |
| Filter bar | see `PendingOutFilterBar` §2.5 | | |
| Loading | `.gb-empty > .gb-skeleton`, no text (:87-90) | `page.locator('.gb-skeleton')` | while `loading` |
| Empty (no rows at all) | `Queue clear — nothing is waiting at the gate.` (:94, em dash `—`) | `page.getByText('Queue clear — nothing is waiting at the gate.')` | `rows.length === 0` |
| Empty (filtered to zero) | `No pass matches these filters.` (:96) | `page.getByText('No pass matches these filters.')` | `rows.length > 0 && current.total === 0` |
| Table | `PendingOutTable` §2.7 | | when `current.total > 0` |
| Pager | `GuardPager` (already read; "Showing X to Y of Z entries", ‹/›/page-number buttons, "Rows per page" select) | see §1 legend / already-known file | |

### 2.4 `GuardToolbar.tsx` (tab strip, shared)

File: `src/components/guard/GuardToolbar.tsx`.

- Tablist: `role="tablist"` `aria-label={tabs.label}` — on the Pending OUT
  drill, `tabs.label = 'Pass type'` (PendingOutPanel.tsx:71). Locator:
  `page.getByRole('tablist', { name: 'Pass type' })`.
- Each tab: `role="tab"` `aria-selected` text `` `${label} (${count})` ``
  (GuardToolbar.tsx:48) → e.g. `All (7)`, `RGP (3)`, `NRGP (4)`. Labels come
  from `TYPE_TAB_LABELS` = `{ all: 'All', RGP: 'RGP', NRGP: 'NRGP' }`
  (`src/lib/pendingOutFilters.ts:23-27`); counts from `tabCounts(rows)`
  (`pendingOutFilters.ts:64-68`), over the WHOLE `rows` array (unfiltered by
  the other three controls) — deliberate, so a `(0)` tab tells the reader not
  to click it.
- On `GuardDashboard`, `GuardToolbar` is called with `search` only (no
  `tabs`) — no tablist renders there (GuardDashboard.tsx:102).
- `page.getByRole('tab', { name: 'RGP (3)' })` — exact count baked into the
  name; prefer a regex `/^RGP \(\d+\)$/` when the count is not fixed by the
  test's fixture.

### 2.5 `PendingOutFilterBar.tsx`

File: `src/components/guard/PendingOutFilterBar.tsx`.

| Control | aria-label | Options (verbatim) | Locator |
|---|---|---|---|
| Type select | `Type` (:47) | `Type: All` / `Type: RGP` / `Type: NRGP` (`TYPE_TAB_LABELS`, :53) | `page.getByLabel('Type')` |
| Vendor select | `Vendor` (:60) | default `Vendor: All` (:64); dynamic options = raw vendor names (no prefix) from `scopeOptions(rows).parties` | `page.getByLabel('Vendor')` |
| Department select | `Department` (:74) | default `Department: All` (:78); dynamic = department names | `page.getByLabel('Department')` |
| Sort by select | `Sort by` (:88) | `Sort by: Oldest First` / `Sort by: Newest First` (`SORT_LABELS`, pendingOutFilters.ts:33-36) | `page.getByLabel('Sort by')` |
| Reset button | `Reset` (:101, icon+text) | disabled unless `isFiltered(filters)` is true (pendingOutFilters.ts:54-59) | `page.getByRole('button', { name: 'Reset' })` |

Reset restores `DEFAULT_FILTERS` **but keeps the current tab**
(`onReset={() => narrow({ ...DEFAULT_FILTERS, tab: filters.tab })}`,
PendingOutPanel.tsx:83) — a reset on `/guard-dashboard/NRGP` after switching
Vendor stays on the NRGP tab, only Vendor/Department/Sort revert. **Test case
P2-35** covers this exactly.

Changing any filter also resets the page to 1 (`narrow`, PendingOutPanel.tsx:62-65).

### 2.6 `ScheduledReturns.tsx` + `ScheduledReturnsTable.tsx`

File: `src/components/returns/ScheduledReturns.tsx`,
`src/components/returns/ScheduledReturnsTable.tsx`. Rendered at
`/guard-dashboard/returns` (via GuardDrill) AND `/returns` (via
`ReturnsDueTodayPage`, all three roles, scoped differently — §2.9).

| Element | Text | Locator | Condition |
|---|---|---|---|
| Section heading | `Scheduled returns` (ScheduledReturns.tsx:87) | `page.getByRole('heading', { name: 'Scheduled returns' })` | static |
| Progress note | `{returned} of {total} returned` + `{percent}%` (:91-97) | text assertion, not a stable locator | shown only when `progress.total > 0` |
| Empty state | `class="card empty-state"`, text = the caller's `empty` prop — `Nothing is due back today.` (GuardDrill.tsx:92 / ReturnsDueTodayPage.tsx:50) | `page.locator('.empty-state')` or `page.getByText(...)` | `rows.length === 0`; note this is `.empty-state`, the HOUSE convention, unlike every other guard-skin screen's `.gb-empty` |
| Table | `data-testid="scheduled-returns-table"` (ScheduledReturnsTable.tsx:37) | `page.getByTestId('scheduled-returns-table')` | |
| Column headers | `Item`, `Make / Model`, `Gate Pass`, `Carried By`, `Department`, `Expected Return`, `Quantity`, `Return Status`, `Action` (ScheduledReturnsTable.tsx:42-53) | `page.getByRole('columnheader', { name: '...' })` | verbatim, exact order |
| "Mark returned" toggle | text `Mark returned` when unticked, `Undo` when ticked (ScheduledReturnsTable.tsx:105) | `page.getByRole('button', { name: 'Mark returned' })` | rendered when `item.outstanding_qty > 0 && !readOnly` (`owes`, :58); else a `View` link |
| "View" link (no outstanding qty, or read-only) | `View` (:109) | `page.getByRole('link', { name: 'View' })` scoped to the row | → `/pass/:id`; **STRICT AMBIGUITY**: "View" repeats per row — scope with `.locator('tr', { hasText: passNumber })` |
| Return-status badge | via `Badge` + `ITEM_RETURN_STYLES[stage]` — labels `Closed`/`Pending`/`Partially Returned`/`Returned` (`src/lib/passRecordView.ts:38-46`) | — | tick stays at the DATABASE stage until Record is pressed, even after a row is ticked (comment ScheduledReturnsTable.tsx:90-92) |
| Staged-count strip | `{N} {line/lines} marked returned — not saved yet. A recorded return cannot be undone.` (ScheduledReturns.tsx:122-125) | `page.getByText(/marked returned — not saved yet/)` | shown only when `chosen.length > 0` |
| Clear button | `Clear` (:128) | `page.getByRole('button', { name: 'Clear' })` | resets `picked` to empty set, no RPC |
| Record button | `data-testid="record-scheduled-returns"` (:130); text `` `Record ${chosen.length} ${return/returns}` ``, becomes `Recording…` while `busy` (:131) | `page.getByTestId('record-scheduled-returns')` | THE COMMIT — one `recordItemReturns(chosen)` RPC batch (§4) |
| Pager | `TablePager` — `Showing {from}–{to} of {total}` (en-dash), numbered buttons, `Previous page`/`Next page` aria-labels | `page.getByRole('button', { name: 'Previous page' })` etc | page size fixed at 5 (`PAGE_SIZE`, ScheduledReturns.tsx:28) |

**This flow is the WHOLE-LINE tick-and-record flow** ("Mark returned" ticks
the FULL outstanding quantity of the line — there is no quantity input here).
It is DIFFERENT from the per-line PARTIAL-quantity `AddReturnBox`/
`PassReturnBox` flow described in §5 below (that one lives on the pass record,
`/pass/:id`, not on this table).

### 2.7 `PendingOutTable.tsx` + `PendingOutRow.tsx`

File: `src/components/guard/PendingOutTable.tsx`,
`src/components/guard/PendingOutRow.tsx`.

Column headers (PendingOutTable.tsx:20-30, exact order): `Show items`
(sr-only), `Pass No.`, `Type`, `Vendor`, `Items`, `Total Qty`, `Vehicle No.`,
`Department`, `Requested By`, `Requested Time`, `Action`.

Per row (PendingOutRow.tsx):
- Chevron/expand button: `aria-expanded`, `aria-label` = `` `Show items in ${pass.pass_number}` `` / `` `Hide items in ${pass.pass_number}` `` (:118). `page.getByRole('button', { name: /Show items in RGP-OUT-/ })`.
- Pass number link: text = `pass.pass_number`, `href="/pass/:id"` (:124-126).
- Items disclosure button: text = `itemsLabel(item_count)` = `` `${n} ${Item/Items}` `` (capital I) (pendingOutFilters.ts:107-109) — clicking it ALSO toggles the same `open` state as the chevron (PendingOutRow.tsx:133-135). **STRICT AMBIGUITY**: two controls toggle the same panel; the chevron has a dynamic aria-label, the items button does not — prefer `page.getByRole('button', { name: /^\d+ Items?$/ })` for the count button and the aria-label form for the chevron; when both exist on one row, scope by `page.locator('tr').filter({ hasText: passNumber })`.
- Action cell: EITHER `ApproveOutAction` (text `Approve OUT`, href `/verify/:id`, when `canVerifyAtGate(pass)`) OR a plain `View pass` link to `/pass/:id` (:143-149). **STRICT AMBIGUITY** across multiple rows — "View pass" / "Approve OUT" repeat once >1 row is actionable the same way; always scope to the row (`hasText: passNumber`) before asserting/clicking.
- Detail panel (only when `open`): heading `` `Items in this Pass (${item_count})` `` (:158); columns `#`, `Item Name`, `Description`, `Make / Model`, `Quantity`, `Unit`, `Value` (:172-186, exact order — differs from PassStackItems, which additionally has `Serial / ID`, `Purpose`, `Status`); empty-lines text `This pass lists no material lines.` (:166); loading = `.gb-empty > .gb-skeleton` (:163); Meta rows (:218-235) — `Pass Validity` (value = `{created}—{expires}` em dash), `Purpose` (fallback `Not stated`), `Total Value` (fallback `Not priced` when `total_value <= 0`), `Authorised By`, `Carried By`.

**Only one row's detail panel open at a time** (`openId` state,
PendingOutTable.tsx:14,38-40) — opening row B's chevron auto-closes row A's
panel. Test case P2-24.

### 2.8 `SearchMatches.tsx` (the multi-pass answer)

Already fully quoted at §3 — repeated here for the selector table:

| Element | Text | Locator | Condition |
|---|---|---|---|
| Container | `data-testid="guard-search-results"` (:85) | `page.getByTestId('guard-search-results')` | |
| Heading | `` `${query} — ${n} ${pass/passes}` `` (em dash, :88) | `page.getByRole('heading', { name: new RegExp(`^${query} — \\d+ passes?$`) })` | |
| Clear search button | `Clear search` (:91) | `page.getByRole('button', { name: 'Clear search' })` | calls `onClear` |
| Empty state | `No gate pass matches that pass number, mobile number, name, vendor, requester, order number or make and model.` (:96-97, verbatim, no line break in the DOM — wraps in CSS) | `page.getByText(/No gate pass matches that pass number/)` | `rows.length === 0` |
| Card stack | `PassStack expandable renderActions={matchAction}` | see §2.10 | |
| Per-card action | `Approve OUT` XOR `Record Return` XOR `View pass` — see `matchAction` logic §3 | scope to the specific `pass-stack-card` (by pass number) before asserting | never two actions on one card |

### 2.9 Overdue: `OverduePassBoard.tsx`, `OverduePassCard.tsx`, `OverdueCardMenu.tsx`, `RemarkBox.tsx`, `OverdueItemsPage.tsx`

`/overdue` route → `OverdueItemsPage.tsx` (role-scoped subtitle + `canProcessReturn`) → `OverduePassBoard.tsx`.

| Element | Text | Locator | Condition |
|---|---|---|---|
| Page header | `Overdue RGP Gate Passes` (OverduePassBoard.tsx:111) | `page.getByRole('heading', { name: 'Overdue RGP Gate Passes' })` | via `GuardPageHeader` |
| Subtitle (guard) | `RGP gate passes that are past their return deadline.` (OverdueItemsPage.tsx:26) | | role-specific — see `SUBTITLES` map, :25-31, for HOD/admin wording |
| Loading | `.gb-empty > .gb-skeleton` (:121-124) | | |
| Total toggle button | `aria-expanded`, `aria-controls="overdue-stack"`, contains `Overdue Passes` title + the figure + note text `Nothing is past its return deadline` (total=0) or `Past return deadline — tap to see them` (total>0) (:130-147) | `page.getByRole('button', { name: /Overdue Passes/ })` | `disabled={total === 0}`; **open by default** once `total > 0` (`useState(true)`, :91) |
| Empty (total===0) | `Nothing is overdue. Every RGP still out is within its return date.` (:152) | | |
| Card stack | `#overdue-stack` `<ul class="gpo-stack">`, one `OverduePassCard` per row (:157-162) | | rendered only while `open` |
| Pager | `GuardPager`, `PAGE_SIZE = 10` (:47) | | |

`OverduePassCard.tsx` — the whole card is a `<Link to="/pass/:id">` wrapping
the face (comment :4-6); pass number, `{daysLate} Day(s) Overdue` pill
(`formatOverdueBy`, overduePasses.ts:92-94, e.g. `3 Days Overdue`), facts
`Requested By`/`Created`/`Vendor / Person`/`Gate Exit` (`Not recorded` if
`verified_at` null)/`Expected Return Date`/`Overdue By`/`Total Value`
(`—` if unpriced)/`Pending Items` (`pendingItemsLabel`, e.g. `2 items pending`
— lowercase "items", NOT the same casing as `itemsLabel`'s `2 Items`). Severity
pill `Critical` (red) vs `Overdue` (orange) — `row.severity === 'critical'`
(`CRITICAL_DAYS = 3`, overdueItems.ts:28).

`OverdueCardMenu.tsx` — three-dot button `aria-label="Actions for {passNumber}"`
(:141), `aria-haspopup="menu"`, `aria-expanded`. Menu items (`role="menu"` /
`role="menuitem"`), in order:
1. `Process RGP Return` (sub-note `Return pending items`) — ONLY when
   `canProcessReturn` (guard only, OverduePassCard.tsx:24-25 → OverdueItemsPage.tsx:46
   `role === 'guard'`). Navigates to `/pass/:id`.
2. `Contact Vendor / Person` — an `<a href="tel:...">` when a phone resolves
   (sub-note `{contactPerson} · {phone}`), else a disabled
   `aria-disabled="true"` span with sub-note `Looking up a number…` (while
   fetching) or `No number on file for this vendor` (resolved, no phone) or
   the RPC's own error text. Fetched lazily ON MENU OPEN (`useEffect`,
   OverdueCardMenu.tsx:116-129) — not fetched when the card list itself loads.
3. `Add Guard Remark` (guard) / `Add Remark` (everyone else) — opens
   `RemarkBox` inline.
4. `Export Pass PDF` (sub-note `Download gate pass`) — `<a target="_blank">`
   to `/pass/:id/print`.

Outside-click (`pointerdown`) and Escape both close the menu
(OverdueCardMenu.tsx:102,106-113).

`RemarkBox.tsx` — `role="dialog"` `aria-label="Add a guard remark on {passNumber}"`
(:56). Textarea `id="remark-{passId}"`, label `What happened` (:63-65),
`maxLength=1000`, placeholder `Rang the site office — truck returns Monday
morning.`. Cancel button (:82). Save button `Save Remark` → `Saving…` while
in flight → after success shows `Remark saved.` (:79) and auto-closes via
`window.setTimeout(onClose, 900)` (:47) — **900ms timer, a real landmine for
a test that asserts the box has closed; wait for the box to unmount, don't
assert instantly**. Validation: empty/whitespace-only body → `A remark cannot
be empty.` (:37), button also `disabled` while `trimmed.length === 0`
(:89). A remark is append-only — no edit, no delete UI exists anywhere.

### 2.10 `PassStack.tsx` / `PassStackCard.tsx` / `PassStackItems.tsx`

| testid | file:line |
|---|---|
| `pass-stack` | PassStack.tsx:40 (the `<ul>`) |
| `pass-ordinal` | PassStackCard.tsx:136 (the 1-based index badge, only when `numbered`) |
| `pass-stack-card` | PassStackCard.tsx:217,226 (one per `<li>`) |
| `pass-stack-items` | PassStackItems.tsx:45 (the unfolded material-line table) |

Card chevron (only when `expandable`): `aria-expanded`, `aria-label` =
`` `${Show/Hide} items on ${pass.pass_number}` `` (PassStackCard.tsx:197).
Card face is a `<Link to="/pass/:id">` (:132) — NOT nested inside the chevron
button or vice versa (deliberate, comment :42-44). `PassStackItems` columns:
`#`, `Item`, `Description`, `Make / Model`, `Serial / ID`, `Purpose`,
`Quantity`, `Value`, `Status` (PassStackItems.tsx:50-65) — loaded lazily via
`usePassItems` when a card is opened; shows `Loading items…` /
`No material lines on this pass.` / the RPC's error text while resolving
(:38-42).

### 2.11 `GateConsole.tsx` + `GateLookup.tsx` (`/console`)

File: `src/pages/Security/GateConsole.tsx`, `src/pages/Security/GateLookup.tsx`.

| Element | Text | Locator | Condition |
|---|---|---|---|
| Page title | `Search Pass` (GateConsole.tsx:75) | `page.getByRole('heading', { name: 'Search Pass' })` | |
| Subtitle | `Find a pass by its number, or by the mobile number, name, vendor, requester, order number or make and model on it.` (:77-79) | | |
| Lookup form | `data-testid="gate-lookup"` (GateLookup.tsx:65) | `page.getByTestId('gate-lookup')` | |
| Search input | `id="gate-lookup"`, sr-only label `Find a pass by number, mobile, name, vendor, requester, order number or make and model` (:66-67,91), placeholder `Pass no., mobile, name, vendor, requester, order no., make / model…` (:93) | `page.getByLabel('Find a pass by number, mobile, name, vendor, requester, order number or make and model')` or `getByPlaceholder(...)` | **different placeholder/label than the dashboard's `useGuardSearch` bar** — do not conflate |
| Scan/close button | `aria-label` toggles `Scan QR code` / `Close QR scanner` (:105-106), also `title` attr same text, icon-only (no visible text) | `page.getByRole('button', { name: 'Scan QR code' })` | |
| Submit button | text `Find`, or `…` while `search.busy` (:119); `disabled={busy || !value.trim()}` | `page.getByRole('button', { name: 'Find' })` | |
| Blacklist alert | `⚠ BLACKLIST ALERT: {reason}` (:129) | `page.getByText(/⚠ BLACKLIST ALERT:/)` | |
| Outcome message | `OUTCOME_MESSAGES[outcome].text` (§4) + optional `View details` link to `/pass/:id` (:136-140) | | |
| "Proceed anyway" button | shown only when `pendingPassId && blacklistMatch` both set (:144-152) | `page.getByRole('button', { name: 'Proceed anyway' })` — **it's actually a `<button>` here (GateLookup) but a `<Link>` styled the same in `useGuardSearch`'s notice (:160-162) — role differs by screen!** | navigates to `/verify/:id` |
| Flash banner | success text set via `navigate('/console', { state: { flash: ... } })` from Verify.tsx (§2.12) | `page.locator('.alert-success')` | shown ONCE, cleared from history state on mount (GateConsole.tsx:36-40) — a page refresh must NOT replay it |
| Single-match record | full `PassRecordView` (`data-testid="pass-record"`) renders in place under the search bar | | when `rows.length === 1` OR a direct pass-code resolution |
| Multi-match | `SearchMatches` (§2.8) renders in place | | |

### 2.12 `Verify.tsx` + `VerifyItemsTable.tsx` + `VerifyPanels.tsx` (`/verify/:id`)

File: `src/pages/Security/Verify.tsx`.

| Element | Text | Locator | Condition |
|---|---|---|---|
| Page title | `{pass.pass_number}` beside a `TypeChip` (:196) | `page.getByRole('heading', { name: pass.pass_number })` | |
| Already-actioned banner | `This pass was already **{matched/rejected/cancelled/held/reviewed by the HOD}** by {verified_by_name or "someone"} at {formatDateTime}. View full details` (:199-210) — `GUARD_OUTCOME` map (:33-39): `matched→'approved'`, `flagged→'rejected'`, `cancelled→'cancelled'`, `held→'held'`, `hod_reviewed→'reviewed by the HOD'` | | `alreadyActioned = status !== 'pending' && status !== 'hod_reviewed'` |
| HOD-approved banner | `**Approved by the HOD.** The rejection has been reviewed and cleared by the raising department. Approve the pass to release the material.` (:212-219) | | `hodApproved && !alreadyActioned` where `hodApproved = status === 'hod_reviewed'` |
| Fact fields | `Authorized Person's Name`, `Contact No`, `Vendor`, `Vendor Address`, `Vehicle Number`, `Department`, `Raised By`, `Expected Return Date` (RGP only), `Purpose` (only if `pass.purpose` set — usually null except Bulk Create) (:223-237) | `page.getByText('Authorized Person\'s Name')` etc | note the apostrophe in "Authorized Person's Name" |
| Material table | `VerifyItemsTable` — heading `Material`, `{n} item(s)`, optional `· {total} {unit} total`, optional `· ₹X declared` (VerifyItemsTable.tsx:48-59); per-line: name, `(make_model)` if set, description, unit+qty (readonly), `₹value`, `Reason` = `item.purpose`, `Expected Return` (RGP only, if set) | | `items.length === 0` → `No item lines recorded on this pass.` (:63) |
| Expired banner | `This pass expired on {formatDateTime(expires_at)} and can no longer be approved. Ask the HOD to raise a new one. You can still reject it if something is wrong.` (:247-250) | | `!alreadyActioned && expired` |
| Approve button | `Approve` (:269), `disabled={submitting || expired}` | `page.getByRole('button', { name: 'Approve', exact: true })` | opens `ApprovePanel` |
| Flag to Requester button | `Flag to Requester` (:273) | `page.getByRole('button', { name: 'Flag to Requester' })` | hidden when `pass.status === 'matched'`; NOT disabled by `expired` (deliberate, comment :255-262) |
| — buttons row | hidden entirely when `alreadyActioned` | | |

`ApprovePanel` (VerifyPanels.tsx:41-133), inside `ModalShell` (`role="dialog"`,
Close button `aria-label="Close"`):
- Title `Approve Gate Pass` (:72), subtitle `Verify each item's quantity at the gate, then confirm.` (:73)
- Per-line table: columns `Item`, `Declared`, `Counted` (:80-82); `Counted` is a `<input type="number" min="0.01" step="0.01">` pre-filled with the declared qty (:91-98) — editable
- `Actual vehicle number` labeled input, pre-filled `pass.vehicle_number` (:107-108)
- `Remarks (optional)` labeled textarea (:111-112)
- Cancel button (:119), disabled while `submitting`
- `Confirm Approval` button (:122-129) → `Approving…` while submitting; `disabled={submitting || lines.some(l => l.verified_qty <= 0)}` — **every line's verified_qty must be > 0**, this is the ONLY client-side validation (`handleConfirm`, :60-68)
- On confirm → `gp().rpc('match_pass', {...})` → success navigates to `/console` with flash `` `${pass_number} approved — cleared to proceed.` ``

`FlagPanel` (VerifyPanels.tsx:142-192):
- Title `Flag to Requester` (:151), explanatory paragraph (:152-156)
- Textarea `id="gate-flag-reason"`, label `Reason for flagging *` (:159), `maxLength={500}`, placeholder `e.g. Only 1 drill of the 2 declared is present.` (:168)
- Char counter `{n}/500` (:172)
- Cancel button (:178)
- `Send to Requester` button → `Sending…` while submitting; `disabled={submitting || !valid}` where `valid = reason.trim().length > 0` (:147) — **MANDATORY reason, whitespace-only is invalid**
- On confirm → `gp().rpc('flag_pass', {...})` → success navigates to `/console` with flash `` `${pass_number} rejected — sent to the raising department for review.` ``

Post-decision redirect target for BOTH paths: **`/console`** (Verify.tsx:136,150)
— never back to `/verify/:id` or `/guard-dashboard`.

Realtime: `Verify.tsx` subscribes to `postgres_changes` UPDATE on this one
row (`verify-{id}` channel, :93-117) and silently reloads — a test that
changes the pass's status out-of-band (e.g. via a second tab/context) while
`/verify/:id` is open should see the Approve button/banners update without a
manual refresh (best tested by re-navigating in CI if realtime is flaky in
the test env; flag as a known landmine, §8).

---

## 3. Search — exhaustive routing, sanitisation, rendering

Deciding function: `useGateSearch.resolve()`, `src/lib/useGateSearch.ts:101-157`.

```
raw = code.trim(); if empty → no-op
1. isPhoneQuery(raw)      → searchPassesByPhone(raw)  → onListResults
2. !isPassCodeQuery(raw)  → searchPassesByText(raw)   → onListResults
3. else                   → gp().rpc('lookup_pass', {p_code: raw}) → onPassResolved / outcome
```

**Branch 1 — phone.** `isPhoneQuery` (`src/lib/phoneSearch.ts:31-34`):
`false` if the string contains any letter (`/[A-Za-z]/`); else `true` iff the
digit-only length is `>= MIN_PHONE_QUERY_DIGITS` (= **6**, :26). Checked
FIRST — wins over the code/text branches.

**Branch 3 — code shape.** `isPassCodeQuery` (`src/lib/passTextSearch.ts:73-78`):
trims; empty → false. `true` if:
- `/^https?:\/\//i` (a QR URL), OR
- `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (:57), OR
- `PASS_NUMBER_RE = /^[A-Za-z]{2,5}-[A-Za-z]{2,4}-\d{4,10}-\d{1,8}$/` (:55, e.g. `RGP-OUT-20260727-0001`), OR
- `LEGACY_PASS_NUMBER_RE = /^[A-Za-z]{2,5}-\d{4,10}-\d{1,8}$/` (:56, e.g. `RGP-20260819-0001`).

A partial pass number (`RGP-OUT-2026`) fails all four and falls through to
free text.

**Branch 2 — free text.** `sanitizeTerm` (`passTextSearch.ts:89-91`):
```js
raw.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim()
```
Strips comma, `(`, `)`, `*`, `%`, backslash, double-quote → each becomes a
space, whitespace collapsed, trimmed. **Test the exact set**: a comma, a
bracket, `*`, or `%` in a search term must NOT 400 the PostgREST request
(CLAUDE.md's own warning) — assert the request succeeds and returns a
sensible (possibly empty) result, never a network error.

`searchPassesByText` (`src/lib/searchPasses.ts:51-94`): sanitized term empty →
`[]` immediately (no query fired). Otherwise, in parallel:
- pass-level `.or(orFilter(PASS_TEXT_FIELDS, term))` on `v_gate_passes`, limit 50.
  `PASS_TEXT_FIELDS` = `pass_number, visitor_name, visitor_company,
  raised_by_name, material_summary, vehicle_number, purpose`
  (`passTextSearch.ts:29-37`).
- item-level `.or(orFilter(ITEM_TEXT_FIELDS, term))` on `v_gate_pass_items`,
  selecting only `gate_pass_id`, limit 400. `ITEM_TEXT_FIELDS` = `name,
  description, make_model, invoice_no, serial_no` (:41-47).

Item hits are resolved back to their parent passes, merged with the direct
pass hits (`mergeMatches`, :110-116 — dedupe by id, first-seen wins, sorted
newest `created_at` first), capped to 50. **This is where the CLAUDE.md rule
"the order number (`invoice_no`) and `serial_no` are NOT in
`material_summary`" is enforced** — a search on an invoice number only
matches via the item-level union, never the pass-level `material_summary`
field.

**Result rendering** (`GateConsole.handleListResults`, GateConsole.tsx:56-64;
mirrored in `useGuardSearch.onListResults`, useGuardSearch.tsx:74-85 — but the
dashboard NAVIGATES to `/pass/:id` on a single match instead of rendering it
in place):
- 0 rows → real answer, `SearchMatches` renders its "No gate pass matches..."
  empty state (NOT a loading state).
- 1 row → treated as a resolved single pass: on `/console`, opens
  `PassRecordView` in place; on the dashboard's own search bar,
  `navigate('/pass/:id')`.
- 2+ rows → `SearchMatches` stack.

**Pass-code branch outcomes** — `onPassResolved` fires for EVERY outcome
carrying a `pass_id`, not only `ok` (useGateSearch.ts:137-148). A genuinely
missing row → plain error `The gate could not read that code. Try again.`
(:131). Every other named outcome routes to `OUTCOME_MESSAGES`
(useGateSearch.ts:42-55):

| outcome | tone | text |
|---|---|---|
| `not_found` | error | `No pass matches that code. Check the slip and try again.` |
| `expired` | warning | `That pass has expired and can no longer be matched. Ask the HOD to raise a new one.` |
| `cancelled` | warning | `That pass was voided by the HOD who raised it.` |
| `already_matched` | warning | `That pass has already been matched and cleared.` |
| `already_flagged` | warning | `That pass has already been rejected at the security gate.` |
| `awaiting_approval` | warning | `That pass has not been approved by every level yet. It cannot be cleared until it has.` |

**Blacklist**: any `row.blacklist_match` sets the blacklist banner
REGARDLESS of outcome. If outcome is `ok` AND blacklisted, resolution is
WITHHELD — `pendingPassId` is set instead of firing `onPassResolved` — the
guard must press "Proceed anyway" before the record/verify screen opens
(useGateSearch.ts:137-144).

**Multi-match action per card** (`matchAction`, `SearchMatches.tsx:52-67`,
`canAct` defaults true — false only on a hypothetical read-only host, unused
by any current caller):
```
if canAct && canVerifyAtGate(pass) → "Approve OUT" → /verify/:id
else if canAct && owesReturn(pass) → "Record Return" → /pass/:id
else                                → "View pass"    → /pass/:id
```
`owesReturn(p)` (SearchMatches.tsx:46-48): `return_status ∈
{awaiting_return, partially_returned}`. `canVerifyAtGate` and `owesReturn`
are mutually exclusive in practice (a pass still at the gate has not left, so
it owes nothing back) — assert exactly ONE action per card, never zero, never
two.

**No debounce anywhere** — search fires on form submit (Enter / Find button /
QR decode callback), never on keystroke. A Playwright test can `fill()` then
`press('Enter')` or click Find without waiting for a debounce window.

---

## 4. The verify flow (`/verify/:id`)

Covered in full in §2.12. Summary of the two RPC paths:

- **Approve** → `ApprovePanel` → `gp().rpc('match_pass', { p_pass_id,
  p_lines: [{item_id, verified_qty}], p_vehicle, p_remarks })`
  (Verify.tsx:129-134). Client validation: every line's `verified_qty > 0`.
  No server-error-message test is prescribed here beyond
  `safeErrorMessage` rendering into `.alert-error` inside the modal (VerifyPanels.tsx:116).
  Success → `navigate('/console', { state: { flash } })`.
- **Flag** → `FlagPanel` → `gp().rpc('flag_pass', { p_pass_id, p_reason })`
  (Verify.tsx:148). Client validation: `reason.trim().length > 0`
  (mandatory). Success → same redirect target, different flash text.
- Approve is withheld once `pass.is_expired` (button `disabled`); Flag is
  NOT withheld when expired (deliberate — comment Verify.tsx:255-262).
- Both buttons vanish entirely once `alreadyActioned` (status not in
  `{pending, hod_reviewed}`).

---

## 5. The return-recording flow(s) — TWO DISTINCT UIs, do not conflate

### 5.1 Whole-line tick-and-record (`ScheduledReturns` / `ScheduledReturnsTable`, §2.6)

"Mark returned" ticks a checkbox-like toggle for a LINE's entire outstanding
quantity — there is no quantity input. Ticking is purely client state
(`picked: Set<itemId>`, ScheduledReturns.tsx:48,58-65) — nothing is sent to
the database yet. A strip appears (`{N} lines marked returned — not saved
yet. A recorded return cannot be undone.`) once anything is ticked. Two
buttons: `Clear` (discards ticks, no RPC) and `Record {N} return(s)`
(`data-testid="record-scheduled-returns"`) — THIS is the commit:
`recordItemReturns(chosen)` → one `apply_item_returns` RPC PER PASS (grouped),
with `p_remarks` auto-composed as `` `Returned N line(s): #line# name, ...` ``
(`src/lib/recordReturns.ts:25-40`). After success: `setPicked(new Set())`,
`onRecorded()` → caller re-reads (`GuardDrill`'s `reload`, or
`ReturnsDueTodayPage`'s `reload`) — **the pass closes itself server-side**;
the client never computes "all lines are back" (comment ScheduledReturns.tsx:15-17).

### 5.2 Per-line partial-quantity staged flow (`AddReturnBox` / `PassReturnBox`, on the pass RECORD)

This is the flow CLAUDE.md's "two-press staged flow" describes, and it lives
on `/pass/:id` (via `PassRecordView` → `PassRecordReturns` →
`PassRecordItems`/`PassReturnBox`) — reachable from every guard search result
and from a pass-number lookup on `/console`. `AddReturnBox.tsx`
(`src/components/guard/AddReturnBox.tsx`) is the guard-skin twin used nowhere
in the P2 route set directly but sharing 100% of its validation logic with
`PassReturnBox.tsx` (house theme, used on `/pass/:id`).

Two presses, only the second is real (comment PassRecordReturns.tsx:10-15):
1. **"Mark return" / "Edit return" link** per line (`PassRecordItems.tsx:208-215`
   — text `Mark return` first time, `Edit return` if already staged) opens the
   side box (`role="dialog"`, NOT a modal — nothing behind it is disabled).
2. In the box: `Return Now*` numeric input (id `pass-return-qty` /
   `gb-return-qty`), unit shown read-only beside it, `Remarks (optional)`
   text input (`maxLength=200`). **"Confirm Return" button STAGES the line
   in memory only** — no RPC yet (comment AddReturnBox.tsx:10-13,
   PassReturnBox.tsx:13-15).
3. Once ≥1 line is staged, a strip appears: `{N} line(s) staged — not saved
   yet. A recorded return cannot be undone.` with `Discard` (clears the whole
   draft) and **`Record {N} return(s)`** (`data-testid="record-pass-returns"`,
   PassRecordReturns.tsx:150) — THIS is the commit:
   `recordDraftedReturns(passId, draftPayload(...), draftRemarks(...))` → one
   `apply_item_returns` RPC (`src/lib/recordReturns.ts:64-75`), only for
   staged lines. No-op if nothing staged.
4. After commit: draft clears, record re-reads (never patched locally —
   comment PassRecordReturns.tsx:23-24).

**Boundary validation — `checkReturnQty`** (`src/lib/returnDraft.ts:57-77`),
checked in this exact order:
1. Not a finite number (empty, letters, `NaN`, `Infinity`) → `Enter the
   quantity that came back.`
2. `qty <= 0` (covers zero AND negative) → `A return must be more than
   zero.`
3. `qty > outstanding` → `` `Only ${formatQty(outstanding)} is still
   outstanding on this line.` ``
4. `isWholeUnit(unit) && !Number.isInteger(qty)` → a message from
   `wholeUnitError` (`src/lib/units.ts:100-107`) of the shape `` `${unitLabel}
   cannot be split — enter ${low} or ${high}.` `` (omits the "or {high}"
   clause when `high` exceeds the outstanding ceiling; falls back to
   `"… cannot be split — enter a whole number."` when neither a low nor a
   high suggestion is available). **Order matters**: an over-ceiling
   fractional entry (e.g. `12.5` against `10` outstanding, whole unit) reports
   the OVER-CEILING message, never the fraction message.

`isWholeUnit` (`units.ts:85-89`): true for `unit ∈ {nos, box, roll, set, bag,
drum, lot}`; any other/unknown unit code accepts fractions.

The `<input type="number">` deliberately carries no native `min`/`max`/
`step="1"` — validation is 100% JS-side so the app's own message (not the
browser's native tooltip) is what a test observes. `step="any"` is always
present, even on whole units.

**Idempotency**: neither `returnDraft.ts` nor `recordReturns.ts` disables a
second RPC call on their own — the calling component's `busy`/`submitting`
state is what disables the Record button mid-flight
(`ScheduledReturns.tsx:50,127,130`; `PassRecordReturns.tsx:58,140,153`). A
double-click test should assert the button is `disabled` once the first click
registers, not that a second RPC never fires structurally.

**Partial vs full**: `apply_item_returns` moves `return_status`:
`awaiting_return → partially_returned → returned`, server-side, in the same
statement that updates `returned_qty` (never client-computed). A recorded
return CANNOT be undone — `returned_qty` only ever increases — there is no
"reverse" control anywhere in this file set.

**Badges (exact strings)** — from `src/lib/passRecordView.ts:38-46`
(`ITEM_RETURN_STYLES`) and `src/lib/returnDraft.ts` (`LINE_STATE_LABELS`):
`Closed`, `Pending`, `Partially Returned`, `Returned`; a staged-but-uncommitted
line additionally shows the subline `Not recorded yet`
(PassRecordItems.tsx:200-203, PendingReturnItems.tsx:132 — the latter is DEAD
CODE, see §8). A fully-returned, non-staged line shows `` `Returned
${formatDateOnly(returned_at)}` `` (PendingReturnItems.tsx:137, mirrored in
`PassRecordItems`).

---

## 6. Test cases

Numbering: `P2-NN`. Each states id, requirement, preconditions, steps,
assertions. Preconditions reference §7's data-setup recipes.

### Route guard

- **P2-01 — Guard cannot reach `/admin`.** Precondition: signed in as guard
  (D-GUARD). Steps: `page.goto('/admin')`. Assert: URL becomes
  `/guard-dashboard` (via `isForbidden`/`RouteGuard`, roleRoutes.ts:132-145,
  App.tsx:51-65).
- **P2-02 — Guard cannot reach `/raise`.** Same precondition. Steps:
  `page.goto('/raise')`. Assert: URL → `/guard-dashboard`.
- **P2-03 — Guard cannot reach `/dashboard` (HOD's).** Assert redirect to
  `/guard-dashboard`.
- **P2-04 — Guard's sidebar order matches `ROLE_ROUTES.guard`.** Assert nav
  items appear in order: Guard Dashboard, Overdue Items, Search Pass (Console),
  Returns — confirm against `roleRoutes.ts:47` and whatever `Sidebar.tsx`
  renders (out of P2's file list — verify labels against the live DOM, not
  guessed text).
- **P2-05 — `/guard-dashboard/unknown-key` redirects home.** Steps:
  `page.goto('/guard-dashboard/bogus')`. Assert: URL → `/guard-dashboard`
  (GuardDrill.tsx:57-58).

### Dashboard invariant (KPI-INV)

- **P2-10 — RGP figure equals its drill's row count.** Precondition:
  D-PENDING-OUT (≥1 RGP, ≥1 NRGP pending pass). Steps: read the number at
  `getByTestId('guard-figure-RGP')`; click it; on `/guard-dashboard/RGP`,
  count `PendingOutTable` body rows FILTERED to the RGP tab (the initial
  state). Assert: the two numbers are equal, AND equal to
  `DrillPageShell`'s own `{count} passes` text.
- **P2-11 — NRGP figure equals its drill's row count.** Same shape for NRGP.
- **P2-12 — "Pending RGP Return (Needs Verification)" counts LINES, not
  passes.** Precondition: D-RETURN-LINES — one RGP pass with 2 material lines
  both due today (`due_state='due_today'`), and a second RGP pass with 1 line
  due today — total 3 lines across 2 passes. Steps: read
  `getByTestId('guard-figure-Due back')`. Assert: value is **3** (not 2).
  Click it; on `/guard-dashboard/returns`, count `ScheduledReturnsTable` body
  rows. Assert: also 3, and `DrillPageShell`'s count reads `3 items` (not
  `3 passes`) — asserts `ITEM_NOUN` (GuardDrill.tsx:32) is wired correctly.
  This is the literal CLAUDE.md regression test ("counted PASSES ... beside
  the ... Quick Action counted the LINES ... read as '4' beside '2'").
- **P2-13 — Overdue Quick Action tile count equals `/overdue`'s row
  count.** Precondition: D-OVERDUE (≥2 overdue lines across ≥1 pass). Steps:
  read the `Overdue Returns` tile's `itemCount()` text; click it; on
  `/overdue`, open the "Overdue Passes" toggle (open by default) and count
  card-stack `<li>`s — BUT note the board counts PASSES
  (`buildOverduePasses`, overduePasses.ts) while the tile counts LINES
  (`buildOverdueRows`, overdueItems.ts) — **these two are legitimately
  different units by design** (CLAUDE.md: "the guard's return queue is
  counted in items" applies to the DASHBOARD tile; `/overdue`'s own total is
  pass-level). Assert the tile's number equals `buildOverdueRows(...).length`
  (verify by comparing to a second, independent line count if the fixture
  allows; otherwise assert against a known-seeded value) and do NOT assert
  tile-count === overdue-page-total (they are different units on purpose —
  write this as a documented non-equality, not a bug).

### Search — routing

- **P2-20 — A well-formed pass number resolves to one record.** Precondition:
  D-PASS (one known `pass_number`, e.g. `RGP-OUT-<date>-0001`). Steps: on
  `/console`, type the exact pass number, submit. Assert: `PassRecordView`
  (`data-testid="pass-record"`) renders in place, no navigation.
- **P2-21 — A partial pass number falls through to free text.** Steps: type
  `RGP-OUT-2026` (missing the day/sequence). Assert: NOT sent through
  `lookup_pass` (no scan-log side effect assertable at UI level; assert
  instead that the result is a `SearchMatches`/list render or the "no gate
  pass matches" empty state, never a "no pass matches that code" `lookup_pass`
  error).
- **P2-22 — A 6+ digit numeric query routes to phone search, not
  lookup_pass.** Precondition: D-PHONE (a pass whose `visitor_company` phone
  ends in a known 6-digit tail, e.g. `543210`). Steps: type `543210`. Assert:
  result is `SearchMatches` (list), not a `lookup_pass` "no pass matches"
  error, and the matching pass appears in the stack.
- **P2-23 — A 5-digit numeric query does NOT route to phone search.** Steps:
  type a 5-digit string with no letters. Assert: falls through to free text
  (not phone) per `MIN_PHONE_QUERY_DIGITS = 6`.
- **P2-24 — A query containing a letter is never treated as a phone number,
  even if mostly numeric.** Steps: type `A123456`. Assert: NOT phone-routed
  (`isPhoneQuery` returns false on any letter) — goes to free text or code
  branch depending on shape.
- **P2-25 — Special characters are sanitized, never 400 the request.**
  Precondition: D-VENDOR-COMMA (a pass whose vendor name contains a comma,
  e.g. `Acme, Inc.`). Steps: search `Acme, Inc.`. Assert: request succeeds
  (no network error / no `.alert-error` about a malformed query), and the
  pass is found (sanitized term still contains `Acme` and `Inc`).
- **P2-26 — Brackets and `%`/`*` are sanitized.** Steps: search
  `(Drill)` and separately `50%` and `Latitude*`. Assert: all three requests
  succeed without error; results are whatever free-text matching yields
  (assert no crash/alert, not necessarily specific rows unless fixture-backed).
- **P2-27 — Order number (invoice_no) is searchable, and is NOT part of
  material_summary.** Precondition: D-INVOICE (an item line with a known
  `invoice_no`, e.g. `INV-2026-0042`, on a pass whose `material_summary` does
  NOT contain that string). Steps: search the invoice number. Assert: the
  pass is found (proves the item-level union works), and confirms it is
  reachable ONLY via the union (documents the CLAUDE.md distinction — no
  separate assertion possible purely at UI level beyond "it is found").
- **P2-28 — Make/model is searchable.** Precondition: D-MAKEMODEL (a line with
  `make_model = 'Dell Latitude 5420'`). Steps: search `Latitude 5420`.
  Assert: the pass is found.
- **P2-29 — Zero matches renders the real empty state, not a loading
  spinner.** Steps: search a nonsense string, e.g. `zzzznomatchzzzz`. Assert:
  `SearchMatches` heading reads `zzzznomatchzzzz — 0 passes`, and the empty
  text `No gate pass matches that pass number, mobile number, name, vendor,
  requester, order number or make and model.` is visible.
- **P2-30 — One match opens the record directly (Search Pass /console).**
  Precondition: a query that resolves to exactly one pass via free text
  (e.g. a unique vendor name). Assert: `pass-record` renders, no
  `guard-search-results` testid present.
- **P2-31 — One match navigates on the dashboard's own search bar (different
  from /console).** Precondition: same as P2-30, but performed via
  `GuardDashboard`'s toolbar search. Assert: `page.url()` becomes `/pass/:id`
  (a real navigation, not an in-place render) — confirms
  `useGuardSearch.onListResults` (useGuardSearch.tsx:74-85) differs from
  `GateConsole.handleListResults`.
- **P2-32 — Multiple matches render a stacked card list with one action
  each.** Precondition: D-MULTI-VENDOR (≥3 passes for the same vendor, in
  mixed states: one pending/actionable-at-gate, one owing a return, one
  closed). Steps: search the vendor name. Assert: 3 `pass-stack-card`s;
  first card shows `Approve OUT`, second shows `Record Return`, third shows
  `View pass` — scoped per-card by pass number to avoid the strict-mode
  ambiguity noted in §2.8.

### Pending OUT drill / filters / pager

- **P2-33 — Switching the Type tab inside an RGP drill reveals NRGP rows
  too.** Precondition: D-PENDING-OUT. Steps: go to `/guard-dashboard/RGP`;
  assert only RGP rows shown (tab `RGP (n)` selected); click the `NRGP (m)`
  tab (or the Type select). Assert: table now shows NRGP rows — confirms
  `GuardDrill` hands the FULL `pendingOut` array regardless of `:key`
  (GuardDrill.tsx:102, see §2.2 note).
- **P2-34 — Vendor/Department filters narrow the table without changing tab
  counts.** Precondition: D-PENDING-OUT with ≥2 distinct vendors. Steps: note
  the `RGP (n)` tab count; pick a Vendor filter. Assert: table rows narrow to
  that vendor; the tab count text is UNCHANGED (`tabCounts` is computed over
  the whole list, pendingOutFilters.ts:64-68).
- **P2-35 — Reset restores filters but preserves the tab.** Precondition:
  on `/guard-dashboard/NRGP`, change Vendor and Sort. Steps: click `Reset`.
  Assert: Vendor reverts to `Vendor: All`, Sort reverts to `Sort by: Oldest
  First`, but the active tab remains `NRGP` (PendingOutPanel.tsx:83).
- **P2-36 — Reset button is disabled until something is filtered.**
  Precondition: fresh `/guard-dashboard/RGP` with only `tab` deviating from
  default (that alone counts as filtered per `isFiltered`,
  pendingOutFilters.ts:54-59 — the tab IS one of the four checked fields).
  Assert: Reset is actually ENABLED on first load of `/guard-dashboard/RGP`
  because `tab !== 'all'`. On `/guard-dashboard` with `initialTab` not set
  (n/a — drill always sets a tab) — use `/console`→PendingOutPanel is never
  reached with `tab='all'` by a real user path; document as: Reset is enabled
  by default on every drill page, since `initialTab` always differs from
  `DEFAULT_FILTERS.tab`.
- **P2-37 — Only one row's detail panel is open at a time.** Precondition:
  D-PENDING-OUT with ≥2 rows. Steps: expand row A (assert its detail table
  visible); expand row B. Assert: row A's detail panel is no longer in the
  DOM/visible, row B's is (PendingOutTable.tsx `openId` state).
  ("Show items"/count-button both toggle the SAME state — test both entry
  points.)
- **P2-38 — Empty queue shows the exact empty sentence.** Precondition:
  D-EMPTY-OUT (no pending/hod_reviewed passes at all). Steps: visit
  `/guard-dashboard/RGP`. Assert text `Queue clear — nothing is waiting at
  the gate.` (em dash).
- **P2-39 — Filtered-to-zero shows the OTHER empty sentence.** Precondition:
  D-PENDING-OUT (rows exist) but pick a Vendor filter matching nothing (not
  literally possible since options are built from the rows — instead: pick
  Vendor=X then Department=Y where no row has both). Assert text `No pass
  matches these filters.`
- **P2-40 — Rows-per-page control changes page size and resets to page 1.**
  Precondition: D-PENDING-OUT with > 10 rows in one type. Steps: change
  "Rows per page" to 25. Assert: more rows render, page indicator resets to
  1 (GuardPager component behavior already read).
- **P2-41 — Approve OUT is offered only when `canVerifyAtGate` is true.**
  Precondition: D-AWAITS-APPROVAL — a pass still awaiting an approval-ladder
  signature (`awaits_approval=true`) that nonetheless appears in the guard's
  queue (office-holder-as-guard edge case, comment useGuardQueues.ts:68-79) —
  hard to fabricate without DB access to the approval tables; if infeasible,
  substitute D-EXPIRED-PENDING (a pending pass whose `expires_at` has
  passed) as the negative case. Assert: row shows `View pass`, not
  `Approve OUT`.

### Verify flow

- **P2-50 — Approve happy path.** Precondition: D-ACTIONABLE (a pending,
  non-expired, fully-approved pass). Steps: from its Pending OUT row, click
  `Approve OUT` → lands on `/verify/:id`; click `Approve`; in the modal,
  leave all Counted quantities as declared; click `Confirm Approval`. Assert:
  navigates to `/console`; `.alert-success` shows `` `${pass_number}
  approved — cleared to proceed.` ``.
- **P2-51 — Approve is blocked (button disabled) when any Counted quantity is
  ≤ 0.** Precondition: same pass. Steps: open Approve modal; set one line's
  Counted input to `0`. Assert: `Confirm Approval` is `disabled`.
- **P2-52 — Approve button on the outer screen is disabled once the pass is
  expired.** Precondition: D-EXPIRED-PENDING. Steps: visit `/verify/:id`.
  Assert: `Approve` button `disabled`; expired banner text visible verbatim
  (§2.12); `Flag to Requester` remains ENABLED.
- **P2-53 — Flag requires a non-empty, non-whitespace reason.** Precondition:
  D-ACTIONABLE. Steps: click `Flag to Requester`; leave the textarea empty,
  assert `Send to Requester` disabled; type only spaces, assert still
  disabled; type a real reason, assert enabled.
- **P2-54 — Flag happy path and redirect flash text.** Steps: type a reason,
  e.g. `Only 1 of 2 drills present.`; click `Send to Requester`. Assert:
  navigates to `/console`; flash reads `` `${pass_number} rejected — sent to
  the raising department for review.` ``.
- **P2-55 — Flag reason respects the 500-char cap.** Steps: type 550 chars.
  Assert: input value length caps at 500; counter reads `500/500`.
- **P2-56 — Already-actioned pass shows the read-only banner and no
  buttons.** Precondition: D-MATCHED (already `matched`). Steps: visit
  `/verify/:id` directly. Assert: banner text includes `already **approved**
  by`; neither Approve nor Flag button renders; `View full details` link
  present, points to `/pass/:id`.
- **P2-57 — HOD-approved (post-flag) pass shows both the informational banner
  and an active Approve button.** Precondition: D-HOD-REVIEWED (status
  `hod_reviewed`). Steps: visit `/verify/:id`. Assert: `Approved by the
  HOD.` banner text; `Approve` button enabled (not `alreadyActioned`); `Flag
  to Requester` also still offered (flag_pass admits hod_reviewed too, per
  comment Verify.tsx:261-262).

### Return recording — whole-line (ScheduledReturns)

- **P2-60 — Marking a line tallies the strip and enables Record; Clear
  discards without any RPC.** Precondition: D-RETURN-LINES. Steps: on
  `/guard-dashboard/returns`, click `Mark returned` on one row. Assert: badge
  text stays unchanged (still the DB stage, not "Returned" — comment
  ScheduledReturnsTable.tsx:90-92); the button now reads `Undo`; the strip
  `1 line marked returned — not saved yet. A recorded return cannot be
  undone.` appears with `Clear` and `Record 1 return`. Click `Clear`. Assert:
  strip disappears, button reverts to `Mark returned`, table row unchanged
  (no navigation, no RPC — verify via `page.route` intercept or via DB state
  unchanged if fixture allows).
- **P2-61 — Record commits and re-reads; badge and figures update.** Steps:
  from P2-60's state, click `Mark returned`, then `Record 1 return`. Assert:
  button shows `Recording…` momentarily, then the strip disappears; the
  row's badge updates to `Returned` (full line) or `Partially Returned`
  depending on `outstanding_qty` vs the line's full quantity — since this
  flow always returns the FULL outstanding amount, a single-line pass should
  read `Returned`. Assert the dashboard's "Pending RGP Return" figure (if
  re-visited) has decremented by exactly the number of LINES just recorded.
- **P2-62 — Record button is disabled while a commit is in flight (no
  double-submit).** Steps: mark 1+ lines; click Record once; immediately
  attempt a second click before the RPC resolves (throttle network in test
  or assert the `disabled` attribute is set synchronously on click). Assert:
  button `disabled={busy}` prevents a second click from firing.
- **P2-63 — Multi-line partial select.** Precondition: D-RETURN-LINES with
  3 lines across passes. Steps: mark 2 of 3. Assert: strip reads `2 lines
  marked returned — not saved yet...` (plural); Record button reads `Record
  2 returns`.
- **P2-64 — Read-only mode offers no Mark control.** Precondition: view
  `/returns` (or `/overdue`'s return-adjacent surfaces) as an HOD or admin
  (`canRecord=false` passed down). Assert: every row shows `View`, not `Mark
  returned` (ScheduledReturnsTable.tsx `readOnly` prop, :58,96-111) — this is
  a cross-role smoke test worth keeping in P2 since the component is shared.

### Return recording — per-line staged (pass record `/pass/:id`)

- **P2-70 — Confirm Return stages only, does not call the RPC.**
  Precondition: D-ACTIONABLE-RGP (an RGP pass with return lines outstanding,
  reachable at `/pass/:id`). Steps: click `Mark return` on a line; enter a
  valid quantity less than outstanding; click `Confirm Return`. Assert: the
  box closes; the line now shows `Staged {qty}` and subline `Not recorded
  yet`; NO navigation, NO success toast — the pass is unchanged server-side.
- **P2-71 — Over-return is rejected with the exact ceiling message.**
  Precondition: same. Steps: open the box for a line with outstanding = 10;
  type `15`; submit. Assert: error text `Only 10 is still outstanding on this
  line.` (exact `formatQty` rendering — assert the number matches the
  fixture's outstanding value).
- **P2-72 — Zero is rejected.** Steps: type `0`; submit. Assert: `A return
  must be more than zero.`
- **P2-73 — Negative is rejected.** Steps: type `-5`; submit. Assert: same
  message as P2-72 (both ≤0 share one message).
- **P2-74 — Non-numeric input is rejected.** Steps: type `abc`; submit.
  Assert: `Enter the quantity that came back.`
- **P2-75 — A fractional quantity on a whole-unit line is rejected with a
  whole-number suggestion.** Precondition: a line whose `unit ∈ {nos, box,
  roll, set, bag, drum, lot}`, outstanding e.g. = 12. Steps: type `11.5`;
  submit. Assert: error matches `wholeUnitError`'s shape — contains "cannot
  be split" and suggests `11` and/or `12` per the outstanding ceiling.
- **P2-76 — An over-ceiling fractional entry reports the ceiling message,
  not the fraction message.** Precondition: same whole-unit line, outstanding
  = 10. Steps: type `12.5`. Assert: error is the OVER-CEILING message (`Only
  10 is still outstanding on this line.`), NOT the whole-unit message — locks
  in the precedence documented in returnDraft.ts.
- **P2-77 — Re-opening a staged line pre-fills its existing quantity and
  remarks, and "correcting" it does not double-count.** Steps: stage 5 of 10
  outstanding on a line; re-open via `Edit return`; assert the qty input
  shows `5`; change to `7`; confirm. Assert: line now shows `Staged 7`, and a
  SUBSEQUENT re-open shows outstanding recalculated as `10` again (not `10 -
  5 - 7`) — proves `effectiveOutstanding` correctly excludes the currently-
  open line's own prior stage (PassRecordReturns.tsx:168-169).
- **P2-78 — Record commits all staged lines in one press, then re-reads.**
  Steps: stage 2 lines on the same pass; click `Record 2 returns`
  (`data-testid="record-pass-returns"`). Assert: strip disappears; both
  lines show their post-commit badge (`Returned` or `Partially Returned`
  depending on remaining outstanding); `data-testid="return-locked"` banner
  (`Fully returned and closed — nothing on this pass can be edited.`) appears
  IF that was the last outstanding material on the pass.
- **P2-79 — Once closed, no return controls remain.** Precondition:
  D-CLOSED-RETURN (an RGP whose `return_status = 'returned'`). Steps: visit
  its `/pass/:id`. Assert: `return-locked` banner visible; no `Mark return` /
  `Edit return` links, only `NA` or nothing in that column
  (PassRecordItems.tsx:224-226).
- **P2-80 — "items still need attention" strip offers Review pending items
  only to a guard who can record.** Precondition: D-ACTIONABLE-RGP with ≥1
  outstanding line, viewed as guard. Assert: amber strip `{n} item(s) still
  need attention before this pass can be closed` with `Review pending items`
  button that opens the first open line's box. Precondition (negative): same
  pass viewed as HOD/admin (`canRecord=false`). Assert: amber strip absent
  entirely (comment PassRecordReturns.tsx:108-117).

### Overdue

- **P2-85 — Overdue board is open by default and toggle collapses/expands
  it.** Precondition: D-OVERDUE. Steps: visit `/overdue`. Assert: stack
  visible immediately (no extra click); click the `Overdue Passes` toggle.
  Assert: stack collapses (`aria-expanded="false"`, `#overdue-stack` not
  visible); click again to re-expand.
- **P2-86 — Toggle is disabled when total is zero.** Precondition:
  D-EMPTY-OVERDUE. Assert: toggle button `disabled`; empty sentence `Nothing
  is overdue. Every RGP still out is within its return date.` visible.
- **P2-87 — Card menu offers "Process RGP Return" to a guard, not to
  HOD/admin.** Precondition: D-OVERDUE, tested twice (guard session, HOD
  session — HOD sees only their own raised overdue passes per
  `SUBTITLES.hod`). Assert: guard's menu has 4 items including `Process RGP
  Return`; HOD's/admin's menu has 3 (no `Process RGP Return`), and the remark
  label reads `Add Remark` not `Add Guard Remark`.
- **P2-88 — Contact Vendor / Person lazy-loads on menu open, not on card
  render.** Precondition: D-OVERDUE with a pass that HAS a vendor phone on
  file. Steps: open the menu. Assert: briefly `Looking up a number…`, then
  resolves to `tel:` link with `{contactPerson} · {phone}` sub-note. Assert
  no network call for contact fires before the menu is opened (best verified
  via `page.route` request counting).
- **P2-89 — Contact with no phone on file shows a disabled, non-dialable
  item.** Precondition: an overdue pass whose vendor has no phone. Assert:
  `Contact Vendor / Person` renders as a disabled `<span aria-disabled="true">`
  with sub-note `No number on file for this vendor`.
- **P2-90 — Add Remark validates non-empty and auto-closes after save.**
  Steps: open `Add Guard Remark`/`Add Remark`; try to save empty → assert `A
  remark cannot be empty.` and Save button disabled while empty; type a
  remark; click `Save Remark`. Assert: button reads `Saving…`, then `Remark
  saved.` appears, then (after ~900ms) the box auto-closes — wait for the box
  to detach from the DOM rather than asserting on a fixed timer (§8).
- **P2-91 — Export Pass PDF opens a new tab to the print route.** Steps:
  click `Export Pass PDF`. Assert: a new tab/page opens with URL
  `/pass/:id/print` (`target="_blank"`).
- **P2-92 — Overdue pager works and preserves scope.** Precondition:
  D-OVERDUE with > 10 passes. Steps: page 2. Assert: different cards render;
  "Showing X to Y of Z entries" text updates.
- **P2-93 — Severity pill: Critical at ≥3 days late, Overdue otherwise.**
  Precondition: two overdue passes, one 2 days late, one 4 days late. Assert:
  the 2-day one shows `Overdue` (orange), the 4-day one shows `Critical`
  (red) — `CRITICAL_DAYS = 3` (overdueItems.ts:28).

### `/returns` (Returns Due Today, all three roles)

- **P2-95 — Guard can record; HOD/admin can only view.** Precondition:
  D-DUE-TODAY. Steps as guard: assert `Mark returned` present and functional
  (reuse P2-60/61 assertions). Steps as HOD: assert every row shows `View`,
  never `Mark returned`; assert page subtitle differs slightly
  (`isGuard` ternary, ReturnsDueTodayPage.tsx:34-36).
- **P2-96 — Empty state text.** Precondition: D-EMPTY-DUE-TODAY. Assert:
  `Nothing is expected back today.`

### Camera / QR

- **P2-100 — Camera permission denial shows the failure panel with a Close
  control, and the typed-entry field stays usable.** Precondition: browser
  context configured to DENY camera permission (Playwright:
  `context.grantPermissions([])` / explicit deny, or stub
  `navigator.mediaDevices.getUserMedia` to reject). Steps: on `/console` or
  the dashboard search bar, click the scan button. Assert: `Camera
  unavailable` heading, a message from `CAMERA_FAILURE_MESSAGE[classified]`
  (not in this file set — read `src/lib/qrDecode.ts` before writing this
  test, since the exact per-failure-type strings live there), and a `Close
  scanner` button; the typed-entry input remains focusable and submittable
  underneath.
- **P2-101 — A decoded QR value auto-submits the search.** Precondition:
  stub the decoder (`QrScanner`'s `onScan` callback) to fire synchronously
  with a known pass number/QR URL, bypassing real camera hardware entirely
  (see §8 for why this MUST be stubbed, not driven through a real camera).
  Assert: `value` state fills the visible input, `search.resolve(scanned)`
  fires, and the same branching in §3 applies.
- **P2-102 — Camera testing is impossible over LAN HTTP.** Not a runnable
  test — a documentation item: Playwright's own headless Chromium can grant
  a FAKE camera device (`--use-fake-device-for-media-stream` launch arg) even
  without a secure context locally, since `localhost` is itself a secure
  context. Running this suite against a LAN IP (not `localhost`) will make
  `getUserMedia` throw synchronously in every browser — pin the E2E base URL
  to `localhost:5174`, never a LAN IP, for any scan-related test.

---

## 7. Data preconditions

All fixture creation should go through `npm run create-user` for accounts
(`scripts/create-user.ts` — `--role guard`, `--role hod`) and through the
app's own RaisePass/RPC surface for pass state (never hand-insert into
`gatepass.gate_passes` unless a migration script explicitly supports it,
per CLAUDE.md's own rule that state transitions are RPC-only).

| Fixture id | Recipe |
|---|---|
| D-GUARD | one `guard` account via `create-user --role guard` |
| D-HOD | one `hod` account, one department |
| D-PASS | one RGP or NRGP raised by D-HOD, not yet actioned |
| D-ACTIONABLE | a pending pass, fully approved through whatever ladder applies (or no ladder configured — `awaits_approval` absent/false), `expires_at` in the future |
| D-EXPIRED-PENDING | same as D-ACTIONABLE but `expires_at` in the past — reach this by raising with a short validity window and waiting, or (preferred) seed directly via a test-only RPC/migration if one exists; otherwise skip and note as untestable without backend seeding |
| D-HOD-REVIEWED | a pass flagged at the gate then cleared by the raising HOD via `hod_review_flagged_pass` — status becomes `hod_reviewed` |
| D-MATCHED | an RGP/NRGP taken through the full Approve flow once, to `matched` |
| D-PENDING-OUT | ≥1 RGP and ≥1 NRGP pending pass, several vendors/departments for filter tests |
| D-EMPTY-OUT | a guard account whose queue is genuinely empty — easiest as a fresh, isolated test DB/tenant, or filter to a department/day with nothing raised |
| D-RETURN-LINES | ≥1 RGP pass approved through the gate (`matched`, `return_status='awaiting_return'`) with ≥2 item lines, `expected_return_date` = today, so `due_state='due_today'` |
| D-OVERDUE | an RGP matched and taken past its `expected_return_date` without full return — reach via a pass raised with a return date in the past (if the raise form allows it) or by waiting past a near-term date in a long-lived fixture; note DB `is_overdue`/`due_state` are view-computed against `site_tz()`, not the browser clock |
| D-EMPTY-OVERDUE | scope with no overdue rows |
| D-DUE-TODAY | an `awaiting_return` RGP with `expected_return_date` = today |
| D-EMPTY-DUE-TODAY | scope with nothing due today |
| D-CLOSED-RETURN | an RGP whose every line has been recorded returned (`return_status='returned'`) |
| D-VENDOR-COMMA, D-INVOICE, D-MAKEMODEL, D-PHONE, D-MULTI-VENDOR | raise passes with the specific `visitor_company`/`item.invoice_no`/`item.make_model`/phone values the search test needs, via the normal RaisePass UI so `visitor_company`'s JSON shape (`{"n","a","v"}`) is produced correctly — never hand-craft that JSON in a fixture, per CLAUDE.md's `parseCompanyInfo` warning |

Where a state cannot be reached through the UI/RPC surface at all (e.g. a
back-dated `expected_return_date` if the raise form validates against
"today or later"), flag it in the test file as `test.fixme()` with a comment
citing this plan, rather than fabricating a state via a direct SQL write that
CLAUDE.md forbids for anything reachable only through RPC.

---

## 8. Known landmines

- **Realtime (`postgres_changes`)** — `useGuardQueues` (guard-queues-gate-passes
  channel) and `Verify.tsx` (per-pass channel) both refresh SILENTLY on any
  matching change. A Playwright test that mutates state in a second
  browser context/tab should NOT assume the first tab updates without a
  manual re-navigation unless realtime is confirmed working in the test
  environment (Supabase realtime can be flaky/disabled in CI) — prefer
  driving all state changes through the SAME page/tab under test.
- **No debounce on search** — confirmed absent in every reviewed file; tests
  do not need `waitForTimeout` after typing, only after submit.
- **Camera / `getUserMedia`** — needs a secure context. `localhost` qualifies;
  a LAN IP does not. Use Chromium's `--use-fake-device-for-media-stream` (and
  optionally `--use-file-for-fake-video-capture=<path>` for a real QR frame)
  via Playwright's `launchOptions.args`, or stub `QrScanner`'s `onScan`
  callback directly by intercepting the component (not generally possible
  without a test-only hook — prefer the fake-device launch flag so the real
  component runs unmodified). Camera-DENIED tests can run headless with
  `context.grantPermissions([])` omitted/revoked.
- **`window.print()`** is NOT used anywhere in this file set directly —
  `PassPrint` (out of P2 scope) owns it; the guard's own `Export Pass PDF`
  link merely navigates to `/pass/:id/print` in a new tab, it does not itself
  trigger a print dialog. Do not assert on `window.print` here.
- **Navigation-on-click** — nearly every "action" in this scope is a React
  Router `<Link>`, not a client-side state change: `ApproveOutAction`,
  `PassStackCard`'s face, `PendingOutRow`'s pass-number/action cells,
  `OverdueCardMenu`'s Process/Export items, `SearchMatches`'s per-card action.
  Assert `page.url()` after these, not just DOM state.
  A few are genuinely in-place: `AddReturnBox`/`PassReturnBox`'s Confirm
  (stages only), `ScheduledReturns`'s Mark/Clear (client state only), and the
  two Record buttons (RPC + re-read, no navigation).
- **900ms auto-close timer on RemarkBox** (`window.setTimeout(onClose, 900)`,
  RemarkBox.tsx:47) — wait for the element to detach, don't assert against
  a fixed sleep shorter than 900ms.
- **`GateLookup`'s "Proceed anyway" is a `<button>` that calls
  `navigate()`** (GateLookup.tsx:144-152), while `useGuardSearch`'s own
  "Proceed anyway" notice is an actual `<Link>` (useGuardSearch.tsx:160-162)
  — same visible text, different element role depending on which screen
  rendered it. Do not assume `getByRole('link', {name: 'Proceed anyway'})`
  works on `/console`.
- **`PendingReturnItems.tsx` is DEAD CODE** — confirmed via repo-wide grep,
  it has zero importers (only a comment in `VerifyItemsTable.tsx:40`
  references its name in prose). Do not write tests that expect it to render
  anywhere; it is unreachable from any route.
- **`isTextQuery` (`src/lib/passTextSearch.ts:95-98`) has zero callers.** The
  documented `MIN_TEXT_QUERY_CHARS = 2` floor is NOT enforced by
  `searchPassesByText` itself (only an empty-after-sanitize term short-
  circuits, `searchPasses.ts:53`). A 1-character sanitized term (e.g. a bare
  `"a"`) WILL fire a real `ilike '%a%'` query across every text column — a
  potential perf/relevance issue, and worth a test (P2-supplemental, not
  numbered above) asserting the app does not crash and returns a (possibly
  very long) result list for a 1-character query, rather than assuming it is
  blocked client-side.
- **Two different "Type: X" / count vocabularies collide across files.**
  `itemsLabel` (`pendingOutFilters.ts:107-109`) prints `"3 Items"` (capital
  I); `pendingItemsLabel` (`overduePasses.ts:96-98`) prints `"3 items
  pending"` (lowercase). Do not write a shared "items label" helper
  assertion across Pending OUT and Overdue tests — they are deliberately
  different strings.
- **`ScheduledReturns`'s empty state uses `.empty-state` (house theme
  convention)**, while every other guard-skin screen in this scope uses
  `.gb-empty`. A generic "assert `.gb-empty` for every empty state" helper
  will silently fail on `/returns` and `/guard-dashboard/returns`.
- **No `playwright.config.*` exists yet** in this repo — the code-generating
  agent must create one before any of the above tests can run. `tests/e2e/`
  and `tests/e2e/plan/` currently exist as empty directories only (no
  sibling P1/P3 plan files present at the time this was written — check
  again before assuming naming/setup conventions from a sibling plan).

---

## Recommended `data-testid` additions

Existing test hooks in this scope (do not re-invent — full inventory):
`gate-lookup` (GateLookup.tsx:65), `guard-figure-RGP` / `guard-figure-NRGP` /
`guard-figure-Due back` (GuardSummaryCards.tsx:47), `guard-search-results`
(SearchMatches.tsx:85), `record-scheduled-returns` (ScheduledReturns.tsx:130),
`scheduled-returns-table` (ScheduledReturnsTable.tsx:37), `pass-stack`
(PassStack.tsx:40), `pass-ordinal` (PassStackCard.tsx:136), `pass-stack-card`
(PassStackCard.tsx:217,226), `pass-stack-items` (PassStackItems.tsx:45),
`pass-record` (PassRecordView.tsx:136), `emergency-banner`
(PassRecordView.tsx:152), `record-actions` (PassRecordView.tsx:235),
`return-locked` (PassRecordReturns.tsx:101), `items-need-attention`
(PassRecordReturns.tsx:119), `record-pass-returns` (PassRecordReturns.tsx:150).

Everything else in this scope must be reached by role+name or by scoping into
a row/card container, which is workable for every test case above. The one
place a missing hook would materially help:

- **`src/components/guard/PendingOutRow.tsx` — the per-row `<tr>` has no
  stable id or `data-testid`.** Every "scope to this row" instruction in §2.7
  currently relies on `page.locator('tr').filter({ hasText: passNumber })`,
  which is workable but fragile if a column's text ever contains another
  row's pass number as a substring (unlikely but not impossible given
  free-text fields). Recommend `data-testid={`pending-out-row-${pass.id}`}`
  on the `<tr>` at PendingOutRow.tsx:111, if this plan's test suite proves
  the text-based scoping flaky in practice — not a blocking gap, just a
  future hardening note.
- **`src/components/guard/GuardToolbar.tsx` — the tablist itself has no
  `data-testid`**, only its dynamic `aria-label`. Fine for `getByRole`, but a
  `data-testid="pending-out-tabs"` at GuardToolbar.tsx:38 would make the
  strict-mode scoping in P2-33 marginally more robust if `aria-label` text
  ever changes.

No fabricated testid is assumed to exist anywhere in the test-case section
above — every locator in §2 either cites a real hook or falls back to
role/text/label per Playwright's own priority order.

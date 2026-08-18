# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Response style — STRICT, no deviation

**When work is finished, reply with the goal only.** One or two lines saying what the change
achieves. No summary of steps, no file-by-file account, no narration of reasoning, no test
transcript. Detail belongs in **Current state** below, not in the reply. (User's standing
instruction, 2026-08-17.) Still say it plainly if something failed, was skipped, or is
unverified — a faithful outcome is not "detail". Answers to direct questions are unaffected.

# GatePass — Material Gate Pass System

React 18 + TypeScript + Vite + Tailwind, on Supabase (auth, Postgres, realtime, RLS).
HODs raise material gate passes (RGP/NRGP); security verifies them at the gate and either
**Matches** or **Flags** them. Deployed as an SPA on Vercel; shares one Supabase project
(`oxzzeonftrmohdrancex`, region `ap-south-1`, PG 17.6) with a separate **VMS** visitor system.

## Commands

```bash
npm run dev            # http://localhost:5174  (VMS uses 5173 — both can run at once)
npm run check          # tsc -p tsconfig.app.json --noEmit && vitest run  ← THE gate
npm run build          # same typecheck + vite build
npm run build:sql      # regenerate supabase/APPLY_ALL.sql from migrations/
npm run create-user -- --email x@y.z --password P --name "N" --role hod --dept IT
node scripts/verify-rls.mjs           # live RLS checks against the real DB
```

**`npm run lint` is a no-op — never trust it.** It runs bare `tsc --noEmit`, which picks up
the root `tsconfig.json` (`{"files": [], "references": [...]}`); project references are not
followed without `--build`, so it type-checks **zero files** and always exits 0. Use
`npm run check`. `npx vitest run path/to/one.test.tsx` runs a single spec.

**After editing any file in `supabase/migrations/`, run `npm run build:sql`.** `APPLY_ALL.sql`
is the artifact a human pastes; a migration edited but not re-concatenated never reaches the
database. `tests/security/applyAllIntegrity.test.ts` is the backstop.

## Current state — 2026-08-18

Full gate: **1140 tests across 104 files** (`npm run check`), `npm run build` clean.
Migrations **`001`–`041` are all applied to the live DB**; `039`, `040`, `041` were each
verified behaviourally with real anon-key JWTs (`scripts/verify-0NN.mjs`).

| Thing | State |
|---|---|
| `gatepass.gate_passes` | **45 rows** — real user data. **Not a scratch DB; do not wipe it.** |
| `public.departments` | **12 rows** (VMS-owned, shared) — do not wipe |
| Demo accounts | all `auth.users` share password `demo123`, all email-confirmed; shared with VMS |
| Deployment | Vercel SPA; env = `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only |

**Latest change (2026-08-18, ninth pass): four trims the client asked for, all frontend, no
migration.**

- **The guard's board is titled "Today at a glance"** and carries NO subtitle — the paragraph
  explaining which figures reset at midnight is deleted. `GuardDashboard` renders the title
  alone; the per-card "all time" chip on Overdue is still what marks the exception.
- **Two RGP movement counters became one.** `DRILL_DEFS.rgpOut` and `rgpIn` are replaced by
  **`rgpRaised` ("RGP Raised")**, matching on **`p.type === 'RGP'`**, not `categoryKey` — so a
  future RGP-in stays inside the figure. `DRILL_ORDER` is `rgpRaised, nrgpOut, …`. The old keys
  are gone, so any stale reference is a type error. (`boardAnalytics`'s unrelated `MovementKey`
  `rgpOut` is a different map and is untouched.)
- **Overdue Items has ONE tile, "Total overdue".** Critical overdue, Due back today and Average
  delay are deleted — the table already grades each row Critical/Overdue, and nothing acted on
  the other two. `OverdueStats` (the interface) is now `{ total, critical }` and
  `overdueStats(rows)` takes no second argument; **`critical` survives because the escalation
  panel and the delay filter read it**. **`dueTodayCount` is deleted** — it had no other caller.
- **The searched pass's Return activity rail has no "View full activity" link.**
  `PassRecordActivity` no longer takes `passId` and imports no `Link`; the full timeline is
  still at `/pass/:id`, reachable from every list.
- Pinned by rewritten cases in `overdueBoard.test.tsx`, `overdueItems.test.ts` and
  `guardDashboard.test.tsx` (17 overdue-lib cases now, one fewer than before — two merged).

**Earlier (2026-08-18, eighth pass): Overdue Items is a page all three roles get, the
guard's Pending Returns tab is gone, Search Pass lost its Pending Queue, and the boards' Overdue
/ Due Today figures NAVIGATE instead of drilling.** Frontend only — no migration, no new RPC.

- **`/overdue` — Overdue Items, one component, three scopes.** `src/components/overdue/`
  (`OverdueBoard` + `OverdueStats` + `OverdueFilters` + `OverdueTable` + `OverdueTrendPanel`),
  data in `src/lib/overdueItems.ts`, loaded by `src/lib/useOpenReturns.ts`, rendered by
  `src/pages/Shared/OverdueItemsPage.tsx` which decides scope from the role:
  **guard = lines that went overdue TODAY** (`daysLate === 1`), **HOD = all time, own passes**
  (`.eq('raised_by', …)`, server-side), **admin = all time, site-wide**. Only the guard can
  record — `apply_item_returns` refuses anyone else.
  - **A ROW IS A MATERIAL LINE**, graded by `itemReturnStage` — the same function Search Pass
    uses. **`daysLate` is whole CALENDAR DAYS**: `expected_return_date` is a `date`, so the
    reference's "1d 7h" is a figure nothing supports. An undated legacy line is not overdue.
  - Columns are ITEM · GATE PASS · CARRIED BY · DEPARTMENT · EXPECTED RETURN · QUANTITY ·
    DELAY · STATUS · ACTION. The reference's EMPLOYEE is CARRIED BY (`visitor_name`), and its
    "Contact employee" / "Escalate" buttons have no mechanism here, so ACTION is **Mark
    returned** (gate) or **View pass**. Same no-em-dash-columns rule as the record view.
  - `CRITICAL_DAYS = 3` is the ONE threshold: the Critical badge, the Critical tile, the delay
    filter and the escalation card all read it. **A tap saves nothing** — the Record bar is the
    commit, because `apply_item_returns` has no undo.
  - The trend bars are **the current backlog's age**, not an archive of past lateness: nothing
    records "how many were overdue last Tuesday". Said in `overdueTrend`'s own comment.
  - Pinned by `tests/unit/overdueItems.test.ts` (18) and `overdueBoard.test.tsx` (11).
- **`/returns` is Returns Due Today** (`src/pages/Shared/ReturnsDueTodayPage.tsx`), not a tab on
  anybody's sidebar — it is where a board's due-today figure lands, on every role. It filters on
  **`due_state === 'due_today'`**, the database's grading in `site_tz()`; never the browser
  clock. `ScheduledReturns` moved to `src/components/returns/` and now takes `passes` + `items`
  + `canRecord` (read-only for HOD/admin). Pinned by `returnsDueToday.test.tsx` (4).
- **Three board figures navigate instead of drilling** — `BOARD_KPI_LINKS` in `boardKpis.ts`:
  `overdueReturns` and `rgpOverdue` → `/overdue`, `rgpDueToday` → `/returns`. `BoardKpiTile`
  renders a `<Link>` when given `to`. On the guard board the same two are `DRILL_LINKS` in
  `guardDrills.ts` (`awaiting` → `/returns`, `overdue` → `/overdue`).
- **Search Pass has no Pending Queue** (client). The list moved to the guard board's **Pending
  for Gate Approval** figure, which is now its OWN query — `status in (pending, hod_reviewed)`
  and `expires_at >= now`, **any date** (`DrillSource` gained `gateQueue`). That is load-bearing:
  an HOD-approved pass is waiting on the gate alone, and `hodReviewGateFlow.test.tsx` now pins
  it there. **`GuardDrillCard` carries Verify at Gate** (`canVerifyAtGate`) so the board can
  still send a guard to `/verify/:id` — otherwise the queue would be visible and unclearable.
- **Deleted, not flagged off:** `PendingReturns.tsx`, `QueueCard.tsx`, `ItemReturnList.tsx`, and
  `GuardDrillCard`'s whole return panel. No card on any board records a return now.
  `DrillDef.returnable` is gone with them.

**Earlier (2026-08-18, seventh pass): units moved into the quantity heading, the
Awaiting Return drill became a line-level table, and the search stopped narrating outcomes.**
Frontend only — no migration, no new RPC.

- **A unit is named beside the column, never in the cells.** `src/lib/units.ts` gained
  `sharedUnit` / `headingUnit` / `quantityHeading` / `quantityCell`: when every line of a table
  carries the same unit and it is not `nos`, the heading reads **"Quantity (Kg)"** and the cells
  are bare numbers. **`nos` is never named at all** — a count of 3 is "3", not "3 Numbers"
  (client: "don't mention any NOS"). Lines that DISAGREE keep their own unit in the cell, or the
  numbers stop meaning anything. Used by `PassRecordItems`, `ScheduledReturnsTable` and the
  printed slip. **The slip's separate Unit column is gone** (`Qty` → `Qty (Kg)`, empty-row
  colSpan 8 → 7). Pinned by `tests/unit/quantityUnitHeading.test.ts` (5) and a rewritten
  `passPrintUnit.test.tsx` (2).
- **The printed slip says "Security Head", not "Security HOD"** (`signatureBlocks.ts`, seven
  blocks unchanged otherwise).
- **A resolved search shows the record and says nothing else.** `GateLookup` no longer sets an
  outcome banner when `onPassResolved` can open the record — the record's own stage badge
  ("Expired", "Matched") is the statement. `OUTCOME_MESSAGES` still covers the no-`pass_id`
  case (`not_found`). `PassRecordView`'s `notice` prop is deleted with its last caller, and so
  is the **`Gate Passes / RGP-…` breadcrumb** — it repeated the title and the summary line.
- **Awaiting Return opens "Scheduled returns", a table of MATERIAL LINES** (client mock-up,
  2026-08-18): `src/pages/Security/ScheduledReturns.tsx` (loads `v_gate_pass_items` for the
  drill's passes, holds the ticks, calls `apply_item_returns` once per pass) +
  `ScheduledReturnsTable.tsx` (the table, `Showing 1–5 of N`, pager at **PAGE_SIZE 5**) +
  `src/lib/scheduledReturns.ts` (`buildScheduledReturns`, `pageOf`). Columns are ITEM · GATE
  PASS · CARRIED BY · DEPARTMENT · EXPECTED RETURN · QUANTITY · RETURN STATUS · ACTION — the
  mock's CONDITION slot carries **quantity**, because no `condition` column exists (same rule
  as the record view: no em-dash columns).
  - **A tap still saves nothing.** "Mark returned" ticks the row; a Record bar appears and is
    what reaches the database. Same rule as `ItemReturnList` — `apply_item_returns` has no undo.
  - Rows sort by expected date, oldest first; a dateless legacy line sorts last.
  - **Only `awaiting` changed.** Overdue and every other drill are still `GuardDrillCard`s, so
    pass-level `mark_returned` ("Return All") is still reachable there and on `/returns`.
  - Pinned by `tests/unit/scheduledReturns.test.ts` (7) and two rewritten cases in
    `guardDashboard.test.tsx` (the Return All case now acts on the Overdue drill).

**Earlier (2026-08-18, sixth pass): Gate Console is "Search Pass", second in the guard's
sidebar, and an exact search renders the whole Gate Pass Details record in place.**

- `ALL_LINKS` for `guard` is Dashboard · Search Pass · Pending Returns; `ROLE_ROUTES.guard`
  mirrors it. **The route is still `/console`** — renaming it would break the `flash` redirect
  out of `Verify`. `ROLE_HOME.guard` is unchanged (`/guard-dashboard`).
- The search bar is alone at the top centre (`max-w-2xl mx-auto`, pill-rounded), labelled
  `sr-only` "Find a pass by number or mobile", which is what tests query by. The queue's
  pass-TYPE filter is deleted; the department filter and the `n/total` counter stay, under a
  `Pending Queue` section title.
- **An exact query opens the record, it does not jump to `/verify`.** `GateLookup` fires
  `onPassResolved(passId, outcome)` for EVERY outcome carrying a `pass_id`. **A pass number
  still goes through `lookup_pass`** — the scan attempt is logged and the blacklist alert still
  stops the guard first. A mobile number that exactly ONE pass carries opens that record too;
  two or more render `PhoneSearchResults`, whose rows call `onOpen` while the ACTION button
  navigates.
- **The record is `src/components/passview/`** — `PassRecordView` (title, the one
  `passStageStyle` badge, Print Pass, the attention banner) composing `PassRecordSummary`,
  `PassRecordItems` and `PassRecordActivity`. Loaded by `src/lib/useGatePassRecord.ts` — three
  reads of `v_gate_passes` / `v_gate_pass_items` / `v_verifications`, `undefined` = loading and
  `null` = no access, deliberately different.
- The item table's columns are this app's: no `category`, no `condition`, so those slots carry
  **DESCRIPTION** and **VALUE**. `SERIAL / ID` renders `serial_no`, which is write-dead and
  shows `—`. Every figure comes from `src/lib/passRecordView.ts`: `itemReturnStage` grades a
  line on **quantities, not `returned_at`**, `returnProgress` counts LINES fully back,
  `pendingItemCount` counts pending **and** partial. Pinned by `passRecordView.test.ts` (11)
  and `gateConsoleSearch.test.tsx` (4).

**Also 2026-08-18: the NRGP category is labelled "NRGP" everywhere, never "NRGP Out"** (client:
no KPI on either board says "out" for it). Changed in `PASS_CATEGORIES['NRGP-out'].label`,
`boardAnalytics` (`nrgpOut` slice) and `guardDrills` (label + heading); `csvCategory` follows
from the same map. **The KEY `NRGP-out` is unchanged** — it mirrors
`gate_passes_nrgp_is_outward` and the `NRGP-OUT-…` pass_number prefix, neither of which moved.

**Previous change (2026-08-18, fifth pass): the guard board's Awaiting Return is now TODAY's
expected returns only, and Overdue takes every earlier missed date.** Frontend only — no
migration.

- `DRILL_DEFS.awaiting` matches `isAwaiting(p) && p.due_state === 'due_today'`;
  `DRILL_DEFS.overdue` matches `isAwaiting(p) && p.due_state === 'overdue'`. The two are one
  timeline cut at today and are **disjoint by construction** — an overdue pass used to be
  counted under both. `allTime` is now true for **Overdue only**, so the "all time" chip drops
  off the Awaiting Return card and the page subtitle says so.
- **Both read `due_state`, not `is_overdue`.** The view pins `is_overdue` to `awaiting_return`
  alone, so a `partially_returned` pass months past its date read as not overdue; `due_state`
  grades both open states. Neither value is recomputed in TypeScript — both come off
  `v_gate_passes` in `site_tz()`.
- The `openObligations` query is still **unfiltered by date** — Overdue reads the same array
  and needs every age in it. The predicates do the cutting, not the query.
- **Knowingly out of both drills:** material due later than today, and a legacy row with no
  expected date. `mark_returned` is not stranded — **Pending Returns (`/returns`)** lists every
  open return of any date as the same returnable `GuardDrillCard`. That tab is what makes the
  narrowing safe; the old "reachable ONLY from the Awaiting Return drill" comment in
  `guardDrills.ts` was stale and is corrected.
- Untouched on purpose: the board's `rgpDueToday` already read `due_state === 'due_today'`;
  `returnWatch.ts` already buckets Overdue / Due Today / Due in 7 / Due Later; MyPasses'
  "awaiting return" chip is a user-driven filter on `return_status`, not a day figure.
- Pinned by `tests/unit/awaitingReturnDueToday.test.ts` (11) plus three rewritten cases in
  `guardDashboard.test.tsx`.

**Earlier change (2026-08-18, fourth pass): scope controls moved into the page header, top
right, on Reports and My Passes; My Passes gained a calendar.** Frontend only — no migration.

- **Reports**: `ReportsFilterBar` is no longer a card — it renders inline in the `.page-header`
  row beside the title. The "Pass Type" caption and the `<label for="report-dept">` are gone
  (the toggle names its own states; the select carries `aria-label="Department"`), as is the
  active-scope caption — the printed sheet already states the scope via `rangeLabel`, which is
  unchanged. Pinned by two new cases in `reportsFilters.test.tsx`.
- **My Passes**: the RGP/NRGP `<select>` ("All Types") is replaced by the same `tab-group`
  segmented toggle, in the header beside the period presets and Export CSV.
- **My Passes has a date input** (`aria-label="Date"`, `max` = local today). A picked date and
  the period presets are ONE choice, not two intersecting windows: a date wins and narrows to
  that single local day; clicking any period clears it (`pickPeriod`). Bounds come from
  `localDayBounds` in `reportsDateRange.ts`, so a day means the same thing here and on the
  register. The CSV export needed no wiring — it already writes `filtered`.
  Six new cases in `tests/unit/myPasses.test.tsx`.

**Earlier change (2026-08-18, third pass): both boards now OPEN on "Today's Summary", and the
admin board's strapline is gone.** Frontend only — no migration, no RPC.

- **`SUMMARY_SECTION` is back, above both category rows, on the admin AND the HOD board** —
  `totalRaised` (Total Passes), `totalCleared` (Cleared), `pendingApprovals`, `overdueReturns`,
  `materialOutside` (Material Outside). Both categories together, which is the only reason the
  row sits above a breakdown that is category-split. Scopes: the first two are `period`, the
  last three `current` — an approval still waiting does not reset at midnight.
- **The row is deliberately the barest on the page** (client: "minimal yet aesthetic", "don't
  put too much cluttered text"): no `hint` beside the heading and **no `note` under any tile**.
  `BoardKpi.note` is therefore **optional**, and `BoardKpiTile` renders no line at all when it
  is absent rather than an empty span that would still cost the row a line of height.
  Pinned by `boardKpiTile.test.ts`.
- **The admin board has no subtitle.** "Real-time overview of all material gate pass activity."
  is deleted; `GateBoard`/`BoardHeader` take `subtitle?` and render the `<p>` only when given
  one. The HOD board still passes one — there it names the department, which is a fact about
  the figures, not a description of the page. `gateBoard.test.tsx` asserts no `.page-subtitle`
  exists on the admin board.
- **The outstanding ranking is still gone** and still deleted, not flagged off:
  `BoardOutstanding.tsx`, `charts/BarList.tsx` and `boardAnalytics.departmentSlices` do not
  exist, `GateBoard` has no `outstandingMode`, Return Watch is 8/12 and Top Items 4/12.
- **No tile says "Today" any more.** `kpiLabel` is gone from `src/lib/boardWindows.ts`; a tile
  renders its own `label`. The word is on the board header chip once — `BoardHeader` now reads
  **"Today · Monday, 18 Aug 2026"**. The scopes (`period`/`returned`/`current`) are unchanged.
  The one label still containing the word is **RGP Due Today**, whose subject is a return date,
  not a window — `boardKpiSections.test.ts` exempts exactly that key and bans the rest.
- **RGP Overview is seven tiles and leads with NRGP's three**: `rgpRaised`, `rgpAwaiting`,
  `rgpCleared`, then `rgpReturned`, `rgpOutside`, `rgpDueToday`, `rgpOverdue`. NRGP is
  `nrgpRaised`, `nrgpAwaiting`, `nrgpCleared` in the same order. `rgpRequests` is **gone** —
  its matcher is `rgpAwaiting`. Old keys `rgpOut`/`nrgpOut`/`nrgpPending` were renamed, so any
  stale reference is a type error.

**Earlier still (2026-08-18): the gate can search by the mobile number of the person who
took the material.** Frontend only — no migration, no new RPC.
`src/lib/phoneSearch.ts` + `src/pages/Security/PhoneSearchResults.tsx`; `GateLookup` routes
the query and `GateConsole` renders the results full width above the queue.

- The number is not its own column — it is packed into `visitor_company` as
  `{"n":…,"a":…,"v":phone}` and stored exactly as typed, so the comparison is on **digits
  only**. Server-side narrowing is `ilike '%<last 4 digits>%'`: separators are written between
  groups from the left, so the final four are contiguous in every format seen here. That
  filter may **over**-match (an address with the same digits) and never under-matches —
  `passMatchesPhone` decides, on the pass's own phone field.
- **A mobile number deliberately does NOT go through `lookup_pass`.** That RPC returns one
  row, decides a single outcome and logs a scan attempt; a person may hold three passes and
  no scan happened. A pass number (anything containing a letter) still goes through it.
- Every result carries its own action button: **Verify at Gate** when `canVerifyAtGate` —
  the same rule the queue and `match_pass` use (`pending`/`hod_reviewed`, own expiry not
  passed) — otherwise **View Details**. A button that always fails is worse than no button.
- Pinned by `tests/unit/phoneSearch.test.ts` (6) and `tests/unit/gateLookupPhone.test.tsx` (5).

### Known, not fixed

- **⚠ `touch_updated_at` (001/008/010) pins `new.expires_at := old.expires_at` on EVERY
  update**, so `hod_review_flagged_pass(approve)`'s refresh of `expires_at` (035) **cannot
  take effect**. 035's live probe passed only because it overrode a pass raised the same day.
  An override of a pass raised YESTERDAY keeps yesterday's expiry and the gate still refuses
  it. Fix: let the trigger keep `expires_at` unless an RPC is deliberately moving it.
- **`UsersTab.tsx` is 478 lines**, over the 300-line cap (pre-existing). The honest fix is
  extracting the Add-User and Edit-User modals.
- **Pass-level `mark_returned` now has NO caller in `src/`** (2026-08-18): every return is
  recorded line by line through `apply_item_returns` on `/returns` and `/overdue`. The RPC is
  still granted and still part of the state machine — decide deliberately whether to drop it.
- **Material due LATER than today, and dateless legacy lines, can no longer be returned early.**
  Pending Returns was the only all-dates screen and it is gone; such a line becomes recordable
  the day it comes due (`/returns`) or the day after (`/overdue`). Accepted with the client.
- **`gatepass.kpis()` and `bulk_create_passes` have no caller in `src/`.** Both want a
  migration that drops them (see "never leave unused schema").
- **`gate_pass_items.serial_no` is write-dead**; dropping it needs the view rebuilt.
- **`src/lib/indianVehicle.ts` has no caller** since the blacklist form dropped the vehicle
  option; it still mirrors a live CHECK constraint, so it was kept knowingly.
- **Nothing since 2026-08-17 has been seen signed-in in a real browser** — the suite, a
  production build and live RPC probes only. `MANUAL_TEST.md` is the walkthrough for what no
  automated test can reach: real browsers, realtime across two windows, printing, the camera.
- **The camera scan path has never decoded a real printed slip**, and cannot be tested over
  LAN HTTP — `getUserMedia` needs a secure context (localhost or HTTPS).

## The two-schema rule — read before writing any query

| Schema | Owner | Contents |
|---|---|---|
| `public` | **VMS — treat as read-only** | `profiles`, `departments`, `auth.users` |
| `gatepass` | this app | `gate_passes`, `verifications`, `hod_departments`, `user_status`, … |

- Query through the explicit helpers in `src/supabaseClient.ts`: **`gp()`** for `gatepass`,
  **`pub()`** for `public`. There is deliberately no default-schema shortcut.
- **Never write a migration that alters anything in `public`.** New objects go in `gatepass`
  and reference `public.*` by foreign key only. Writing a *value* into a VMS column through a
  SECURITY DEFINER RPC is allowed (`admin_create_user` sets `profiles.role`); adding or
  altering the column is not — VMS's own migrations do that.
- Creating a department writes to VMS's shared `public.departments`, so VMS sees it. The
  admin UI says so out loud — keep that warning.

## Roles — mapped onto VMS's enum, not our own

| App role | `profiles.role` |
|---|---|
| Security | `guard` |
| HOD | `hod` |
| Admin | `admin` / `super_admin` |
| no access | `staff` |

Role comes from the JWT's **`app_metadata.role`** (server-writable only), with a `profiles`
fallback. **Never authorize off `user_metadata`** — users can write it. Consequence: every VMS
guard automatically has gate-console access, and every VMS HOD can raise passes once assigned
a department. Accounts must be created with `app_metadata.role` set or RLS cannot authorize
them. `ASSIGNABLE_ROLES` (guard/hod) mirrors the server: the portal cannot write `staff`.

**Active/inactive is a STATUS, not a role** (migration `040`). `gatepass.user_status` holds
it; **an absent row means active**, so no backfill was needed. A suspended person is shut out
by the database, not by a screen: `app_role()` returns null AND `my_department_ids()` returns
nothing — both are load-bearing, because `gate_passes_select` admits `department_id in (select
my_department_ids())` without ever reading `app_role()`. `is_user_active()` deliberately calls
nothing (an `is_admin()` inside it would recurse through its own policy). Deactivation keeps
the role and the department assignment and deletes every `auth.sessions` row.

## Architecture

**State transitions are RPC-only.** No client holds `UPDATE` or `DELETE` on
`gatepass.gate_passes`. `match_pass`, `flag_pass`, `mark_returned`, `apply_item_returns`,
`hod_review_flagged_pass`, `hod_void_expired_pass` own the whole state machine. This exists
because RLS cannot express "you may change `status` but not `visitor_name`". Route new state
changes through a new RPC; **do not add an UPDATE policy**.

**A raised gate pass is permanent** (migration `024`): no cancellation, no HOD delete. The
two ways a pass is closed without moving are `hod_review_flagged_pass('reject')` (a pass
security stopped) and `hod_void_expired_pass` (a pass that expired unused) — both raising-HOD
only, both re-checked server-side, both writing a `verifications` row.

**Two axes, and only one of them moves after the gate.** `status` describes the OUTWARD trip
and **freezes at `matched`**; the return leg is `return_status`
(`awaiting_return` → `partially_returned` → `returned`). Derive the return stage from
`return_status` alone (`src/lib/rgpLifecycle.ts`); `passStageStyle` collapses both axes into
**one** badge naming the latest state, and `passTimeline` holds the moments it supersedes.

**An RGP closes only when every line is fully returned.** `apply_item_returns` rolls the lines
up into the parent; the client never computes "all items are back". A recorded return **cannot
be undone** — `returned_qty` only ever increases and `returned_at` is written through
`coalesce`. That is a settled rule, not a limitation: do not write a `reverse_item_return`.

**`is_overdue` / `is_expired` are defined exactly once, in `gatepass.v_gate_passes`.** Never
recompute either in TypeScript. There is deliberately no `expired` enum label and no `pg_cron`
— expiry is derived at query time. A pass reads Expired when `status === 'pending' &&
is_expired`; use `isExpiredPending()` in `src/lib/statusStyles.ts`.

**One department per person** (`032`): a unique index on `hod_departments(hod_id)`, mirrored
into VMS's `profiles.department_id`. A department may still host several HODs — which is why
the HOD board scopes by `raised_by` **server-side** as well.

**Route access**: `src/lib/roleRoutes.ts` is the single source of truth (`ROLE_ROUTES`,
`ROLE_HOME`, `isForbidden`), enforced once in `App.tsx`; the first entry of each role's list
is its landing page. This is UX defence in depth — **RLS is the security boundary**.

**Dashboard invariant, on every board:** a KPI's number is `rows.length` of the very array its
click opens, and every aggregate (`Slice`) carries the rows it counted. **Never re-derive a
chart's rows from a predicate at the call site, and never add a `count: 'exact'` query.**

## The pass model — two types, one direction (migration 010)

```
type      = does it come back?      RGP | NRGP
direction = which way is it going?  in  | out
```

**Exactly three combinations are legal**, enforced by check constraints, not by the dropdown:
`RGP-out`, `RGP-in`, `NRGP-out`. `src/lib/passTypes.ts` mirrors this in `PASS_CATEGORIES`.
NRGP is outward-only — permanently inbound material is a goods receipt, not a gate pass.
`pass_number` carries direction (`RGP-OUT-20260727-0001`), counters are per (type, direction,
day). IGP/OGP remain as unreachable enum labels (Postgres cannot drop one); the
`gate_passes_type_is_current` check is what retires them.
**`RaisePass` hardcodes `p_direction: 'out'`, so RGP-in passes cannot currently be created.**

## SQL invariants that are easy to break silently

- **Views need `with (security_invoker = true)`** — otherwise a view runs as its owner and
  bypasses RLS entirely.
- **`SECURITY DEFINER` functions must pin `set search_path = ''`** and fully qualify every
  reference.
- **The view's joins to `public.*` are `LEFT JOIN` on purpose** — VMS can narrow its policies
  without notice; an inner join would make pass rows vanish, a left join degrades to a null
  name. Visibly wrong beats invisibly wrong.
- **`pass_number` generation takes an advisory lock** — a plain `max()+1` lets concurrent
  inserts collide.
- **A new schema inherits no Supabase grants.** `002` grants `authenticated`; `007` grants
  `service_role` the narrowest set that unblocks the RLS probe and **no privilege at all on
  `gate_passes`**, so the RPC-only state machine holds even for the service key.
- **A new enum value cannot be USED in the transaction that adds it.** `APPLY_ALL.sql` is
  pasted as ONE transaction, so naming a new label in a `check (…)` or a `language sql` body
  aborts the whole paste. `plpgsql` bodies are stored as text and are safe. This is why 027's
  constraint is the inverted `status not in ('pending','held')`.
- **`create or replace view` cannot absorb new base-table columns** — the view must be dropped
  and rebuilt, and its `grant select` re-applied in the same transaction. Same for a function
  whose RETURN TYPE changes (`my_profile()` has been drop+recreated twice).
- **Never hand-write an `insert into auth.users` without `confirmation_token`,
  `recovery_token`, `email_change`, `email_change_token_new` set to `''`** (migration `034`).
  They are nullable with no default; GoTrue scans them into Go `string` and dies with
  `converting NULL to string is unsupported` — a **500 on sign-in**, with nothing wrong
  visible in Postgres.
- **`visitor_company` is not a company name.** It is `{"n":name,"a":address,"v":phone}`. Use
  `gatepass.company_name_of(text)` in SQL and `parseCompanyInfo` in TypeScript — the packed
  shape is recognised by its KEYS, never by truthiness.
- **Nobody holds `UPDATE`/`DELETE` on `gatepass.gate_passes`** — enforced statically by
  `tests/security/sqlInvariants.test.ts`. The cost is accepted: `verify-rls.mjs --mutate`
  cannot delete the pass it raises and prints manual cleanup SQL instead. Don't "fix" that.

### Applying migrations — Claude can do this

- **`psql` + session pooler** (the working path): `aws-1-ap-south-1.pooler.supabase.com:5432`,
  user `postgres.oxzzeonftrmohdrancex`, `SUPABASE_DB_URL` in `.env` (git-ignored). The direct
  `db.<ref>.supabase.co` host is IPv6-only and does not resolve here. Always
  `--single-transaction -v ON_ERROR_STOP=1 -f <file>` — `-f` sends the file byte-for-byte.
  **Percent-encode the password** (`@` → `%40`), or libpq reports a bogus DNS failure.
- **Supabase MCP server** — excellent for reading: catalog probes, grant audits, advisors.

**psql connects as `postgres`, which bypasses RLS entirely — it can never prove RLS or any
`is_admin()`-style guard works.** Only `set local role` probes or a real anon-key JWT can.
Verifying a security change means a `scripts/verify-0NN.mjs` run with real JWTs; clean up
probe rows afterwards and record the row count.

**Grant drift:** adding a schema to **Exposed schemas** in the dashboard runs
`grant all … to anon, authenticated, service_role` over it. `009` corrects that. It is
one-time (no `pg_default_acl` entry), but **re-run `009` if anyone toggles Exposed schemas**.
`sqlInvariants` greps migration files and cannot see dashboard-introduced drift.

### Diagnosing DB errors — the code tells you which layer failed

- `PGRST106 Invalid schema` → `gatepass` missing from **Exposed schemas**. Dashboard fix.
- `PGRST205` / `PGRST202` → not in PostgREST's **schema cache**. This does NOT prove the
  object is missing — a stale cache reads identically. **Query `pg_catalog` before concluding
  a migration never ran.**
- `42501 permission denied for schema gatepass` → exists and is exposed, but the role lacks a
  GRANT (schema `USAGE` is checked before table privileges, hence the schema in the message).
- `42P17 infinite recursion … relation profiles` → VMS's recursive policy. GatePass is immune
  because it reads through `gatepass.my_profile()` — that is what `006` exists for.

`src/lib/errors.ts` maps SQLSTATEs, named constraints and GoTrue codes to human sentences, and
replaces opaque bodies (`{}`, `[object Object]`) with the caller's fallback. **23514 is
deliberately unmapped** — the constraint name is more informative than a catch-all.

## Design system — Quest Gold + Charcoal

```
Shell     #16161A sidebar — DARK IN BOTH THEMES (chrome, not content); ink #101014
Primary   brand-600  #C6A15B brass gold   buttons, active nav, focus
Accent    accent-600 #2B3FA0 royal blue   links, secondary emphasis
Status    pending-* amber · matched-* emerald · flagged-* red · overdue-* orange
Neutral   navy-* / surface-*  warm stone   meta, borders, baselines
Display   Antic Didone (serif, ONE weight) — headings, wordmark
```

**Saturated colour means status, never decoration.**

- **Text on gold is charcoal, never white** (~9.1:1 vs ~2.4:1).
- **Never apply `font-bold` to `font-display`** — Antic Didone is weight 400 only; bolding
  synthesises a smeared faux-bold. Presence comes from size and tracking.
- **Headings are the display serif in brand gold, at five rungs**, all
  `font-display font-normal text-brand-800 dark:text-brand-300` with sizes written
  **longhand** (`text-h1/h2/h3` each carry a fontWeight): `.page-title` 28 · `.section-title`
  22 · `.modal-title` 22 (no rule — a modal is already a bounded box) · `.card-title` 18 ·
  `.board-section-title` 18. **The `dark:` half is not polish**: `brand-*` are literal hex and
  do NOT invert, so `text-brand-800` alone is ~1.9:1 on the shipped dark surface. **Ink gold is
  not fill gold** — `brand-600` is the primary FILL and is under 3:1 as ink; it is never a
  heading. `.page-subtitle` stays Inter and neutral on purpose. Status outranks the house gold
  ("Delete Department?" keeps `text-flagged-600`). Data styled as a heading — a department
  name, a pass number — stays neutral. The print block names all five and forces
  `#111 !important`, because `body { color }` does not reach an element that sets its own.
  Pinned by `tests/unit/headingIdentity.test.ts`, which computes real WCAG ratios from the
  tokens.
- **Fixed-context surfaces must use literal colours, not `navy-*`/`surface-*` tokens.** The
  neutral ramp INVERTS under `.dark`, which is the shipped default. Anything always-light —
  the login card, `AuthField`, `QuestLockup tone="light"`, the printed slip — renders
  near-white on near-white if tokenised. `tests/unit/themeAudit.test.ts` also bans an opaque
  `bg-white` paired with an inverting token (alpha overlays excluded; `PassPrint` exempt).
- Token *names* match VMS so ported layout code works unchanged. **`navy` is a name, not a
  colour** — it is the warm-stone ramp now. Do not rename it.
- **No chart draws in the brand gold** — gold is the frame (sidebar, primary button,
  wordmark), so a slice in it reads as chrome. Series are blue / violet / teal;
  **`src/components/charts/chartPalette.ts` is the ONLY module in `src/` allowed literal hex**,
  and `themeAudit` enforces that by name. Status hues are untouched: a chart bucket must be the
  same colour as the badge beside it.
- The logo is `src/components/QuestMark.tsx`, redrawn as vector (the client publishes only a
  JPEG matted onto white). `public/favicon.svg` repeats the geometry — change both together.
- `.shell-sidebar` hardcodes dark values — never add `dark:` variants to the shell. **There is
  no top bar**; `main` carries `pt-20 lg:pt-8` for the fixed mobile hamburger.
- The printed slip is black-on-white with **no colour-dependent information** — it must read on
  a cheap mono laser. Guard controls are deliberately oversized: someone uses them standing at
  a gate, one-handed, with a truck waiting.
- **Rupee values are exact** — `formatCurrency` is `'₹' + Math.round(n).toLocaleString('en-IN')`.
  No `₹3.1K`: ₹3,149 and ₹3,050 both printed that, and the value is what a pass is about.
- The login background is generated by `scripts/make-login-bg.mjs`, not hand-edited.

## Conventions

- **Max 300 lines per file**, no exceptions — extract sub-components instead.
- **No fuzzy string matching on enums** — a `Record<Enum, T>` lookup map, never an
  `includes()` chain. Adding an enum member should be a type error, not a silent blank panel.
- **Never `window.alert` / `confirm` / `prompt`** — they block the page and break automation.
  Use inline panels or `.modal-overlay` / `.modal-content`. (`window.print()` in `PassPrint`
  is fine, and must stay click-triggered.)
- Every list handles loading (`.skeleton`), empty (`.empty-state`) and populated explicitly.
- **CSV exports say what the screen says** — `src/lib/csvCells.ts` formats through the same
  label maps the badges use. "Nothing here" is an empty cell, never the em-dash the screen
  shows (a dash breaks sorting and SUM). The formula guard skips plain numbers.
- **Realtime**: `postgres_changes` on `gatepass.gate_passes`; always refresh silently
  (`load(true)`) so KPIs don't flash. Write subscriptions defensively (optional chaining +
  try/catch) so a partially-mocked client cannot throw. Channel mock pattern:
  `const ch: any = {}; ch.on = () => ch;` avoids a TDZ error.
  **Realtime cannot carry expiry** — nothing is written when a pass expires, so a mount-time
  query is the only mechanism.
- **Supabase's query builder resolves to a `PromiseLike`, which has no `.catch()`** — `await`
  it inside `try/catch`.
- **The service-role key must never get a `VITE_` prefix** — Vite inlines `VITE_*` into the
  bundle. It appears only in `scripts/create-user.ts`, never under `src/`.

## Deployment

`vercel.json` holds the SPA rewrite (deep links like `/pass/<uuid>` would 404 on refresh),
asset caching, `Permissions-Policy: camera=(self)`, and the CSP.

**The CSP is a live footgun: it applies ONLY in production.** The Vite dev server sends none,
so anything it blocks works perfectly on localhost and fails only once deployed, silently.
This shipped once (avatars blocked by `img-src` while `connect-src` allowed the upload, so the
symptom was "nothing happens"). **Any new remote origin — a CDN, a font host, an image bucket
— needs its directive added in the same commit.** `tests/security/cspAllowsSupabase.test.ts`
pins every directive the app depends on.

**Password reset is admin-assisted; there is no self-service link.** The built-in Supabase
sender is capped at ~2 emails/hour **project-wide**, shared with VMS, and the dashboard's rate
limits do not lift it (custom SMTP only). An admin resets from Admin → Users → Edit User
(`admin_reset_user_password`, which also deletes every session), the user is forced to choose
their own on next sign-in (`set_my_password`, which clears the flag in the same call — nothing
else clears it). `/reset-password` is kept deliberately: it is the landing page for a recovery
email an admin triggers from the Supabase dashboard.

## Working on this repo

### TDD, always, in a loop

**Write the failing test first, then the minimum code to pass it, then verify.** Name the goal
→ write the test that would prove it → watch it fail for the right reason → write the smallest
code that passes → `npm run check` → repeat. A test that has never failed has proven nothing.
Do not batch a large change and test at the end — then a failure tells you only that
*something* broke.

This applies to SQL: `tests/security/sqlInvariants.test.ts` and `applyAllIntegrity.test.ts`
are how a migration is tested without a database — extend them **in the same commit** as the
migration. Note what they cannot catch: anything that only exists at the intersection of this
app's RPC and a VMS trigger (`023`), and anything introduced through the dashboard (`009`).

### Never leave unused schema or code in place

If a table, column, type, function, policy or grant is not needed, **remove it in the same
migration that retired it**. An unused SECURITY DEFINER function is still `EXECUTE`-able over
PostgREST by every authenticated user — attack surface nobody reviews. Two hard exceptions,
both Postgres limitations: enum labels cannot be dropped, and dropping a column used by a view
requires rebuilding the view.

### Delegate low-level work to subagents on cheaper models

Fan mechanical work out to **parallel subagents on `sonnet`** (or `haiku` for the most rote
work), launched in a **single message** so they run concurrently: file/content searches,
fact-gathering, boilerplate, mechanical ports and renames, config files, test fixtures, doc
writing, repetitive per-file edits following an established pattern.

**Keep on the main model:** schema design, RLS/auth/grant decisions, debugging, code review,
trade-off calls, and synthesis. Give each agent full context up front — it starts cold —
including the two-schema rule and the 300-line cap. **Never merge a subagent's output unread**,
and never let one make a security call.

**Git work always goes to a `sonnet` subagent** (user instruction): commits, pushes, branches,
tags. Read-only inspection may be run directly. **Always push after completing work — do not
wait to be asked.** Commits are the USER's: no `Co-Authored-By`, no AI attribution anywhere in
a message, title, body or trailer.

### Keep this file current — it is the session handoff

When you finish a chunk of work, update **Current state**: what is applied, what is merely
written, and what the single next action is. Say whether a claim is *verified* or *assumed*,
and **which credential proved it** — browser/`anon`, `service_role` or `postgres` see
different things, and `postgres` bypasses every policy. **Delete stale lines rather than
appending to them**, and before believing any "X was deleted" claim in here, check the disk —
that has been wrong before.

## Layout

**Docs live in `docs/`** — `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DEPLOYMENT.md`,
indexed from a Mermaid-diagrammed `README.md`. They are framed for a **Mall Management
Office**: material moves through the mall's service gate, HODs are department heads
(Housekeeping, Engineering/MEP, Facilities, Marketing, Retail Ops, F&B, IT), and
`visitor_company` is the tenant, brand or contractor firm. Keep that vocabulary — no
"factory"/"plant"/"manufacturing".

`src/pages/` is grouped by who uses it: `HOD/` (Dashboard, RaisePass, MyPasses,
MismatchReview, ExpiredReview), `Security/` (GateConsole — the **Search Pass** screen —
GateLookup, Verify, GuardDashboard), `Shared/` also holding the two role-scoped return pages
(OverdueItemsPage, ReturnsDueTodayPage), `Admin/` (AdminPanel and its tabs, AdminDashboard, ReportsPage), `Shared/`
(PassDetail, PassPrint, Profile). `src/components/passview/` is the Gate Pass Details record Search Pass
resolves to; `src/components/overdue/` is Overdue Items and `src/components/returns/` is the
line-level returns table, each one component serving all three roles; `src/components/board/` is the dashboard both the admin and the HOD get — one component, the HOD's scoped to one person server-side. `src/lib/` holds the
lookup maps, derivations and formatters; `supabase/migrations/` runs `001` → `041`, with
`005` an **optional demo seed** to skip in a real deployment.

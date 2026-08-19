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

## Current state — 2026-08-19

Full gate: **1212 tests across 111 files** (`npm run check`), `npm run build` clean.
Migrations **`001`–`042` are all applied to the live DB**; `039`, `040`, `041` were each
verified behaviourally with real anon-key JWTs (`scripts/verify-0NN.mjs`), and `042` with a
rolled-back `psql` insert that returned `RGP-20260818-0001`.

| Thing | State |
|---|---|
| `gatepass.gate_passes` | **49 rows** — real user data. **Not a scratch DB; do not wipe it.** |
| `public.departments` | **12 rows** (VMS-owned, shared) — do not wipe |
| Demo accounts | all `auth.users` share password `demo123`, all email-confirmed; shared with VMS |
| Deployment | Vercel SPA; env = `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only |

**Latest change (2026-08-19, third pass): the guard's two lists are PAGES, the dashboard's
figures DRILL into them, the action is "Approve OUT", and Search Pass left the sidebar.**
Frontend only — no migration, no new RPC, no query the guard screens did not already make.

- **The dashboard is a greeting, two DRILLABLE figures and three quick actions.** The two
  preview tables are gone from it (client: "remove those pending out and all those return
  verifications from the guard's view... put the card numbers drillable"). Each figure is a
  `<Link>`: RGP → `/pending-out?type=RGP`, NRGP → `/pending-out?type=NRGP`, the return count →
  `/pending-returns`. `GuardPanel.tsx` was DELETED, so a stale reference is a build error.
- **`/pending-out` — Pending OUT (Needs Approval)**, drawn to the client's mock-up:
  tab strip `All (n) · RGP (n) · NRGP (n)`, the global search and **Scan QR** top right, a
  filter bar (Type · Vendor · Department · Sort by · Reset), and a table of
  Pass No. · Type · Vendor · Items · Total Qty · Vehicle No. · **Department** · Requested By ·
  Requested Time · Action, each row opening its own material lines in place beside Pass
  Validity / Purpose / Authorised By / Carried By. Footer is "Showing 1 to 10 of N entries",
  numbered pages and Rows per page (10/25/50).
  - **The mock's GATE column is DEPARTMENT** — there is no gate entity in this schema. Same rule
    the record view follows: a column this app cannot fill takes the fact it does have, never an
    em dash. **Its UOM column IS drawn** on the opened item lines (see below) — the one screen in
    the app that names a unit on every line.
  - Lines load **on demand**, one row at a time (`src/lib/usePassItems.ts`).
- **`/pending-returns` — Pending RGP Return (Needs Verification)**: the same chrome and the same
  global search. Its scope is unchanged — `needsReturnVerification`, i.e. due today or already
  late, never every open obligation — but **the page itself was rebuilt to the client's mock-up
  the same day, and a return is now RECORDED ON IT, line by line and quantity by quantity**. See
  the entry below.
- **The action is "Approve OUT"** (`src/components/guard/ApproveOutAction.tsx`, one file so the
  client's word has one spelling). It replaces "Verify at Gate" everywhere a guard sees it. The
  destination is unchanged (`/verify/:id`, which offers Match, Flag and Hold) and it is still
  drawn only while `canVerifyAtGate` holds — the rule `match_pass` enforces — otherwise the row
  degrades to a **View pass** link.
- **THE SEARCH IS GLOBAL, and it is not a filter over the page it sits on.**
  `src/lib/useGateSearch.ts` is the resolution, extracted from `GateLookup` so the house-themed
  Search Pass screen and the guard pages' mock-up-themed bar cannot disagree about what a query
  means: a pass number goes through `lookup_pass` (whole register, scan log, blacklist alert), a
  mobile number through an unfiltered `v_gate_passes` query. `src/components/guard/useGuardSearch.tsx`
  is the guard skin of it. **A resolved pass NAVIGATES to `/pass/:id`** rather than rendering in
  place — that record is house-themed, and drawing it inside this fixed-light skin would put a
  dark card on a white ground for every reader on the shipped dark default. Several passes on one
  mobile number render as a gb-skinned list on the page.
- **`Search Pass` is off the guard sidebar** (client). The guard's tabs are now Dashboard ·
  Pending OUT · Pending RGP Return · Overdue Items, ordered by `ROLE_ROUTES.guard`. **The
  `/console` ROUTE stays** — `Verify` redirects onto it with a flash after a decision, and the
  dashboard's Scan QR quick action opens it — so `navLinksResolve.test.ts` names it as
  deliberately link-less.
- **ONE QUERY PAIR BEHIND ALL THREE SCREENS**: `src/lib/useGuardQueues.ts` (`'both' | 'out' |
  'returns'`) makes the same two reads the dashboard used to make itself, and each page derives
  its rows with the same predicate from `guardBoard.ts`. The old invariant is intact — a figure
  is `rows.length` of the array the page it opens renders; no aggregate, no `count: 'exact'`.
- **The `.gb-*` skin grew a page half** (`src/index.css`): page head, tab strip, search + scan
  button, filter selects, row disclosure and detail boxes, and the pager. Still fixed-light with
  **no `dark:` half**, still the ONLY place the mock-up's hex lives, and
  `src/components/guard/*` still carries no hex — `themeAudit.test.ts` stays absolute.
- Pinned by `tests/unit/pendingOutFilters.test.ts` (23), `pendingOutPage.test.tsx` (11),
  `pendingReturnsPage.test.tsx` (7) and a rewritten `guardDashboard.test.tsx` (11, now holding
  that the dashboard renders no table and every figure is a link). `hodReviewGateFlow.test.tsx`
  moved its two queue cases onto the Pending OUT page — the only list a guard picks a waiting
  pass from — and `sidebarOrder` / `guardBoardNoExpired` / `navLinksResolve` follow the new tabs.
- **Pending OUT's item lines carry a UNIT column** (client, 2026-08-19: "put unit beside the
  quantity so guard can verify the exact quantity being taken out"), so the mock's UOM slot is
  back — but **on that page ONLY**, by the client's own narrowing a moment later. It is a
  deliberate exception to `quantityHeading`/`quantityCell`: the unit is named on every line,
  `nos` included ("Numbers"), because the guard is counting a physical load against one line at
  a time. The return panel and every other quantity table still name a shared unit once in the
  heading and never name `nos`. `.gb-unit` in `src/index.css` is the cell.
- **`bag` · `drum` · `lot` are new unit codes** (`UNIT_LABELS` → Bags / Drums / Lots, and
  `UNITS` in `MaterialItemRow` so an HOD can raise in them) — the mock-up's own vocabulary; a
  gate that counts cement in bags cannot record it as a bare number.
- **"Party" is "Vendor" on both guard list pages** (client) — the column heading, the filter
  select, the Sort by option and the search placeholder, on Pending OUT, Pending RGP Return and
  the guard search's result table. The state key and `partyOf` are unchanged: it is a label
  change, not a data one.

**Also 2026-08-19: Pending RGP Return takes a MICRO-LEVEL return — each line, its own
quantity, its own remark.** Frontend only — no migration, no new RPC. `apply_item_returns` has
always accepted a partial quantity per line; until now nothing in the UI offered one, so 800 of
1,000 litres coming back could not be recorded at all.

- **The page is the mock-up**: status tabs `All (n) · Due Today (n) · Overdue (n) · Returned
  Partially (n)`, a filter bar (Vendor · Department · Status · Sort by · Reset), the table
  Pass No. · Vendor · Items · Expected Back · Status · Returned Summary · Action, the pager, and
  a **legend** strip naming the four states. `src/lib/pendingReturnFilters.ts` holds the tabs and
  filters, the same all-client-side shape `pendingOutFilters.ts` has.
  - **The mock's fifth tab, "Returned", is deliberately absent**: this page loads open returns
    only, so a closed one has left the queue by definition, and a tab for it would need a second
    query with an invented window ("returned when?"). **`dueToday`/`overdue` are disjoint but
    `partial` CUTS ACROSS both**, so the counts do not sum to All — four questions, not four
    buckets, and `pendingReturnFilters.test.ts` pins exactly that.
- **A row opens its own material lines** (`PendingReturnRow` + `PendingReturnItems`), one row at
  a time. Each line still owing material carries **+ Add Return**, which opens **`AddReturnBox`**
  — the mock's small box, `position: fixed` **bottom right**, a side box and NOT a modal, so the
  row stays readable underneath while the figure is typed into it.
- **TWO PRESSES, AND ONLY THE SECOND ONE IS REAL.** Confirm Return STAGES the line in
  `src/lib/returnDraft.ts` (in memory, keyed by item id); the **Record N Returns** bar at the
  foot of the panel is the commit, one `apply_item_returns` call for the whole set, through
  `recordDraftedReturns`. That shape is forced by the database — a recorded return cannot be
  undone — and it is the same rule the old `ItemReturnList` followed. Discard, Cancel, or closing
  the row throws the draft away. A staged line is **tinted, keeps its button, and says "Not
  recorded yet"** even when the quantity closes it, so "looks done" is never read as "is done".
- **The ceiling is the line's OUTSTANDING quantity**, checked by `checkReturnQty` — the same rule
  the RPC raises on. The quantity input carries **no `min`/`max` attribute on purpose**: the
  browser would then block submission with its own native tooltip and this app's message would
  never be reached, so the rule would live in two places.
- **Every figure in the open panel is RECORDED + STAGED** (`effectiveReturned`), so the panel
  already looks the way it will after the press. **Nothing recomputes lateness**: `due_state`
  grades the row, `lateNote` only says how late an already-late row is, in whole calendar days —
  the same arithmetic `buildOverdueRows` uses.
- **The Returned Summary cell counts QUANTITY, not lines** ("1,625 of 1,962 returned (82.8%)"),
  off the view's own roll-ups: a line count would call an 800-of-1,000-litre pass 0 of 1
  returned, which is the whole point of this screen.
- **After the RPC the list is RE-READ, never patched** — `useGuardQueues` gained `reload`. Only
  the database knows whether that movement was the last line, and the parent closes itself.
- **`GuardToolbar`'s tabs are now a plain `{key,label,count}[]`** rather than the `TypeTab`
  union, because the two pages tab by different things; each page keeps its own exhaustive
  `Record` in its own filters module, which is where a missing tab should be a compile error.
- Pinned by `returnDraft.test.ts` (35), `pendingReturnFilters.test.ts` (12) and
  `itemLevelReturns.test.tsx` (9 — staging without an RPC, the exact `p_lines` payload, two lines
  in one call, the outstanding ceiling, Cancel and Discard). `pendingReturnsPage.test.tsx` was
  rewritten where the new page supersedes it.
- **NOT seen signed-in in a browser**: `npm run check` (1271 tests) and `npm run build` only.

- **NOT seen in a browser**: the suite and a typecheck only. The three-column `.gb-detail` panel,
  the tab underline and the pager are unverified against a real render.

**Earlier (2026-08-19, second pass): the guard's dashboard is drawn in the CLIENT'S
OWN PALETTE AND TYPE, not the house theme.** Frontend only — no migration, no query change, no
change to what the board counts. **SEEN IN A BROWSER** (dev server, signed in as a guard, light
and dark) — the first screen since 2026-08-17 that has been.

- **`.gb-*` in `src/index.css` is a scoped, FIXED-LIGHT skin, and it is the only place the
  mock-up's hex lives.** The client asked for "the exact same colour, font, typography" on the
  main content area of this one screen, so it is white ground, near-black **Inter** headings
  (not the gold Antic Didone ladder), orange for the OUT queue and blue for the return queue.
  There is deliberately **no `dark:` half** — same category as the login card and the printed
  slip: a token here would invert under `.dark`, the shipped default, and stop being the
  mock-up. `.gb-board` bleeds out through `main`'s padding and paints its own ground, so the
  house surface never shows through in either theme (verified in both).
- **`src/components/guard/*` carries NO hex.** Containment is the same rule `chartPalette.ts`
  follows, and it is what keeps `themeAudit.test.ts` absolute over every `.tsx` in the repo.
  **The house classes are untouched** — `.card`, `.table-base`, `.page-title` and the gold
  heading ladder are exactly as they were, and every other screen still uses them. `.gb-table`
  is a separate table skin (grey title-case headings); `.table-base thead th` is still uppercase
  gold ink everywhere else.
- **The chevrons are gone from both summary cards** (client). They scrolled to the panel the
  figure counted; that panel is directly underneath at every width, so the control was a button
  to scroll one screen. `GuardDashboard` lost its two refs and `scrollTo` with them. The
  greeting also lost its 👋, and the header row carries a 60px right pad so the date stamp
  clears the `fixed top-4 right-4` notification bell instead of hiding its time.
- **The KPI icons are the mock-up's**: a big delivery truck on a round orange tint plate, a
  curved return arrow on a blue one. `GuardIcon` was rewritten — its tone union is now
  `GuardTone` (`orange | blue | green | purple`), its own vocabulary, so the house `Tone` ramp
  and the mock-up's palette cannot leak into each other. `GuardGlyphIcon` is the bare inked
  glyph the panel headings use.
- **A pass number and its type chip are coloured by TYPE** — RGP blue, NRGP green — through
  `TYPE_PILL` in `guardBoard.ts`, a `Record<PassType, string>`, so a third type would be a
  compile error rather than an uncoloured pill.
- **Two things keep this app's words against the mock-up, both already-settled calls**: the OUT
  action is **Verify at Gate**, not "Approve OUT" (the screen it opens offers Match, Flag and
  Hold, and naming one of three teaches a guard the wrong model of their job), and Quick Actions
  is three tiles, not the mock's four — its "Recent Activity" has no feed behind it. The return
  row also **keeps its Due Today / Overdue badge** where the mock prints a bare date: lateness is
  the only reason those rows are on the board.
- **A long real pass number makes the return table scroll sideways inside its panel.** The
  mock-up's are 9 characters (`RGP-00056`); this app's are 17 (`RGP-20260818-0003`), so at
  half-width the Action column falls off the edge and `.gb-scroll` takes it. Known, not a
  styling miss — the columns are the mock's own set.
- Pinned by a rewritten `guardDashboard.test.tsx` (17): the chevron case became "carries no
  chevron, and no control of any kind", plus two new cases holding the skin itself — the board
  renders on `.gb-board` with an h1 that is `gb-hello` and never `page-title`, and the pill
  colours follow type.

**Earlier (2026-08-19): the guard's dashboard is REVAMPED — two lists, a greeting and
three quick actions, from a client mock-up.** Frontend only — no migration, no new RPC, no query
the board did not already make.

- **The seven-drill board is GONE, deleted rather than flagged off.** `src/lib/guardDrills.ts`
  (`DRILL_DEFS`, `DRILL_ORDER`, `DRILL_LINKS`, the `DrillKey` union) and
  `src/pages/Security/GuardDrillCard.tsx` no longer exist, so a stale reference is a build
  error. What went with them: today's raises, today's mismatches, today's closures, and the
  in-place card stack. Those figures are the ADMIN's board and Reports — a whole-site count is
  not what a person standing at a barrier reads.
- **The board is two questions.** `src/lib/guardBoard.ts` holds the derivations and
  `src/components/guard/` the parts (`GuardIcon`, `GuardPanel`, `GuardSummaryCards`,
  `PendingOutTable`, `PendingReturnTable`, `QuickActions`):
  - **Pending OUT (Needs Approval)** — the gate queue (`status in (pending, hod_reviewed)` and
    `expires_at >= now`, ANY date), split into an RGP and an NRGP figure by `typeSplit`. The
    split is of ONE array, so the two figures sum to the rows in the panel under them.
  - **Pending RGP Return (Needs Verification)** — `needsReturnVerification`: an open return
    (`awaiting_return` or `partially_returned`) whose `due_state` is `due_today` or `overdue`.
    **Material due LATER is deliberately absent**: nobody is watching the barrier for an October
    date, and neither `/returns` nor `/overdue` would accept its return today, so a row for it
    would be a button that cannot be pressed. The whole backlog is still one click away.
- **TWO QUERIES, and the old invariant is intact**: a card's number is `rows.length` of the very
  array the panel beside it renders. No aggregate, no `count: 'exact'`, no second predicate.
  Neither `due_state` nor `is_overdue` is recomputed — both come off `v_gate_passes` in
  `site_tz()`.
- **Every action goes somewhere that works.** Pending OUT's is **Verify at Gate** →
  `/verify/:id`, rendered only while `canVerifyAtGate` holds (the same rule `match_pass`
  enforces); a pass that expired while the board sat open degrades to a **View pass** link.
  The return row's is **Record Return** → `/overdue` when the row is overdue, `/returns` when it
  is due today — the two pages that can actually record a line through `apply_item_returns`.
  **The client's mock-up said "Approve OUT" and "Verify Return"; the buttons keep this app's
  words**, because the screen they open offers Match, Flag and Hold, and naming one of three
  outcomes teaches a guard the wrong model of their own job.
- **Lateness is in WORDS.** `EXPECTED BACK` carries the `DUE_STATE_STYLES` badge ("Due Today" /
  "Overdue") beside the date, so the fact survives a mono print and a reader who does not
  separate orange from amber.
- **Each panel shows five rows and expands in place** ("View all (N)" / "Show less",
  `PREVIEW_ROWS`), and each summary card's chevron SCROLLS to its panel rather than navigating —
  a page load between a number and the list it stands for is a page load too many at a gate.
- **Quick Actions is three tiles, not the mock's four**: Scan QR / Pass No. → `/console`,
  Returns Due Today → `/returns`, Overdue Returns → `/overdue`. The mock's fourth was "Recent
  Activity"; this app has no activity feed for a guard, and a tile that goes nowhere is worse
  than no tile. Every destination is in `ROLE_ROUTES.guard`.
- **The header greets by name** — `firstNameOf` over `fetchMyProfile()`, falling back to "Guard"
  if the profile never resolves, with a date/time stamp taken ONCE at mount (a ticking clock
  would re-render two tables every second for a fact that changes by the minute).
- Design system untouched: `.card`, `.board-section-title` gold serif, `.table-base` gold column
  headings, `.kpi-label` / `.kpi-value`, `.btn-secondary`, the tint-plate icon device from
  `BoardKpiIcon`. No literal hex anywhere in the new components.
- Pinned by `tests/unit/guardBoard.test.ts` (11) and a rewritten `guardDashboard.test.tsx` (15).
  `scrollToDrill.test.tsx` became `scrollIntoViewOnChange.test.tsx` (the hook's remaining
  consumer is `GateBoard`); `drillListLayout`, `guardDrillCardLayout` and
  `awaitingReturnDueToday` are deleted with what they pinned; `stackedCards` and
  `hodReviewGateFlow` were rewritten — the latter now proves an HOD-approved pass reaches the
  guard through the Pending OUT list with a working Verify at Gate action.
- Seen in a browser on the second pass above; the 2026-08-19 revamp itself shipped on the suite
  and a production build alone.

**Earlier (2026-08-18, twelfth pass): no surface says "Matched" or "In Use", expired
passes are off both dashboards and tracked in Reports instead, and the Return Watch looks
forward only.** Frontend only — no migration. *(The guard board's drills, `guardDrills.ts` and `GuardDrillCard` were deleted on 2026-08-19 — see the latest change. Everything else in this entry stands.)*

- **A pass never reads "Matched".** `passStageStyle` gains a fourth arm: `matched` with no
  return loop at all is an NRGP through the gate, and that is the END of it, so it reads
  **Closed** (`RGP_STAGE_STYLES.closed`). `rgpStageStyle` now **RENAMES** a late open pass to
  **Overdue** rather than only re-toning it orange — the fact was carried by colour alone, which
  is nothing at all on the mono laser the register prints on or in a CSV. So the ladder is
  Expired · Mismatched/Held/Voided · Overdue · Partly Returned · Out — Not Returned · Closed.
  `STATUS_STYLES.matched` still exists (the `Record<PassStatus, …>` is exhaustive by design) but
  nothing reaches it. **`csvStatus` is now just `passStageStyle(p).label`**, so an export can
  never disagree with the screen it came from, and `AllPassesReport`'s badge calls the same
  function. MyPasses' status tab is **"Cleared at Gate"**, not "Matched". Pinned by
  `tests/unit/reportStatusStage.test.ts` (7) plus rewritten cases in `passStage`,
  `rgpLifecycle`, `rgpStageBadge` and `passDetailHeader`.
- **The record timeline's RGP gate moment is "Cleared at Gate"** (`passRecordStages`), the
  client's own words for the event; "In Use" described the material, and nothing here observes
  use. An NRGP is still "Closed" at the same moment.
- **Expired is off BOTH dashboards.** `DRILL_DEFS.expired` and the `expired` `DrillKey` are
  deleted (a stale reference is a type error), with `GuardDashboard`'s red expiry callout; the
  orange half of `BoardAttention` is gone too, so that strip is mismatches alone. An expired
  pass is dead paperwork — `match_pass` refuses it forever — and no board figure is acted on by
  reading it. **It is still tracked**: the raising HOD gets the bell notice that opens
  `/expired/:id` (untouched), and **Reports has an `Expired` button** beside Overdue
  (`isExpiredPending`, counted by Clear, named "Expired only" on the printed scope line).
  Pinned by `guardBoardNoExpired.test.tsx` (2, renamed from `guardDashboardExpiredDrill`), a new
  case in `gateBoard.test.tsx`, and three in `reportsFilters.test.tsx`.
- **Return Watch is three buckets, forward only: Due Today · Due in Next 7 Days · Due After 7
  Days.** `ReturnWatchKey` loses `overdue`, and `returnWatchKeyOf` returns **null** for a late
  pass — the `is_overdue` line must stay FIRST, because a past date makes `daysBetween` negative
  and every predicate below would file the pass under "Due in Next 7 Days". The donut follows
  from the same function. `BoardReturnWatch` opens on `dueToday` and **its "Days Overdue" column
  is gone** (every row is inside its date now), so `daysOverdue` was deleted with its only
  caller, and `RETURN_WATCH_COLORS.overdue` with the bucket. The backlog is still `/overdue`,
  graded line by line.

**Earlier (2026-08-18, eleventh pass): a batch of client trims — NRGP lines read
Closed, the pass number lost its direction (migration `042`, APPLIED), stacked cards are
numbered and compact with a VERTICAL timeline, Today's Summary is gone from BOTH boards, the
admin gets two department bar charts and an Overdue button on Reports, and column headings are
gold.**

- **An NRGP is CLOSED, never "In Use".** `ItemReturnStage`'s `not_applicable` is renamed
  **`closed`** (label "Closed", matched-green), and `passRecordStages` names the gate moment
  `pass.type === 'RGP' ? 'Cleared at Gate' : 'Closed'` (the RGP half was "In Use" until the
  twelfth pass). **The item table's Action column carries ONLY the
  return marking**: `Mark return` on an RGP line that still owes material, plain **`NA`** on
  everything else — the old "View" link pointed at the page the reader was already on.
  Pinned by `tests/unit/nrgpItemAction.test.tsx` (6).
- **Migration `042` — `pass_number` is `RGP-20260818-0001`, no `-OUT-`.** Applied to the live DB
  and probed inside a rolled-back transaction (`RGP-20260818-0001`; 49 rows, unchanged). The
  counter is now per (type, day) — `'RGP-20260818-%'` cannot match a legacy `RGP-OUT-…`, so the
  two coexist and an RGP-in would take the next number rather than colliding. **The 45+ existing
  rows keep their numbers**: a pass number is an audit anchor on printed paper. `RaisePass`'s
  preview prefix mirrors the trigger. Pinned by six cases in `sqlInvariants.test.ts`.
- **Stacked cards, in every list: numbered, compact, timeline reads DOWN.** `PassOrdinal`
  ("1", "2"…, `data-testid="pass-ordinal"`, `aria-hidden`) is rendered by `PassRow` in all three
  variants from an `index` the LIST assigns — DrillList, GuardDashboard, MyPassesTable,
  FlaggedReviewCard, PhoneSearchResults. the guard board's own card was `dense` too (it was the roomy
  variant and crowded the guard's screen; that board became two tables on 2026-08-19), dense paddings dropped a step, and list gaps are 2.
  `PassTimelineStrip` gained `orientation="vertical"` — a dot-on-a-rail rung per moment — which
  is what `PassRowBody` (every opened card) uses. Pinned by `stackedCards.test.tsx` (4).
- **Today's Summary is DELETED from both boards.** The five keys (`totalRaised`, `totalCleared`,
  `pendingApprovals`, `overdueReturns`, `materialOutside`) are gone from `BoardKpiKey`,
  `BOARD_KPIS`, `BoardKpiIcon` and `BOARD_KPI_LINKS`, so a stale reference is a type error. The
  board opens on RGP Overview. `/overdue` is still one click away — admin sidebar tab 2, and
  `rgpOverdue`.
- **Two department column charts, admin only.** `src/components/charts/ColumnChart.tsx` (vertical
  bars over `Slice[]`, `data-testid="column-bar"`, scrolls sideways past ~6 columns) driven by
  **`departmentSlices(rows, limit)`** in `boardAnalytics` (`BoardDepartments`, in the admin
  board's `footer`) and **`overdueByDepartment(rows)`** in `overdueItems` (`OverdueDeptChart`, on
  `/overdue` when `showDepartments`). Both bucket by `department_id`, label a null department
  "Unassigned", and count what the list beside them counts. `BoardDepartments` is deliberately
  NOT a drill — it sits outside GateBoard's drill machinery, so it offers no click.
  **`BoardDepartments` counts TODAY only** (client, 2026-08-18): it filters `rows` on
  `created_at` inside the local day, the same cut `GateBoard` makes for its `raised` window.
  `OverdueDeptChart` is unscoped by date on purpose — a backlog is not a day figure.
  **Every column stands on one baseline**: the plot is a fixed `PLOT_H` box and the label sits
  under it in a fixed `h-8 overflow-hidden` box (`data-testid="column-plot"`). The label used to
  size itself inside the flex column, so a department whose name wrapped to two lines started its
  bar a line lower than its neighbours. Pinned by `departmentCharts.test.tsx` (10).
- **The admin sidebar is Dashboard · Overdue Items · Departments & Users · Reports.** Sidebar
  order now comes from `ROLE_ROUTES[role]` (`Sidebar` sorts by it), because `/overdue` is one
  shared entry that cannot sit in the right slot for three roles at once. Guard and HOD orders
  are unchanged. Pinned by `sidebarOrder.test.tsx` (2).
- **Reports has an Overdue button** — `ReportsFilterBar`'s `overdueOnly` toggle, applied in
  `ReportsPage` beside type/department (`IS_OPEN_RETURN[return_status] && is_overdue`, never
  recomputed), counted by Clear and named on the printed sheet's scope line.
  Pinned by two cases in `reportsFilters.test.tsx`.
- **Column headings are gold and one size up**: `.table-base thead th` is
  `text-caption font-semibold tracking-wider text-brand-800 dark:text-brand-300 uppercase`.
  Ink gold, not the `brand-600` fill; the `dark:` half is load-bearing.
  Pinned by a rewritten case in `designSystem.test.ts`.

**Earlier (2026-08-18, tenth pass): there is ONE gate-pass record format. `/pass/:id`
renders the same `PassRecordView` the gate search resolves to.** Frontend only, no migration.

**Earlier (2026-08-18, ninth pass): four trims the client asked for, all frontend, no
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
/ Due Today figures NAVIGATE instead of drilling.** Frontend only — no migration, no new RPC. *(The guard board's drills, `guardDrills.ts` and `GuardDrillCard` were deleted on 2026-08-19 — see the latest change. Everything else in this entry stands.)*

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
migration. *(The guard board's drills, `guardDrills.ts` and `GuardDrillCard` were deleted on 2026-08-19 — see the latest change. Everything else in this entry stands.)*

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
  `returnWatch.ts` buckets the return schedule (Overdue was dropped from it in the twelfth pass); MyPasses'
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
MismatchReview, ExpiredReview), `Security/` (GateConsole — the **Search Pass** screen, no longer
a sidebar tab — GateLookup, Verify, GuardDashboard — the figures-and-quick-actions board — and
the two pages its figures drill into, PendingOutPage and PendingReturnsPage), `Shared/` also holding the two role-scoped return pages
(OverdueItemsPage, ReturnsDueTodayPage), `Admin/` (AdminPanel and its tabs, AdminDashboard, ReportsPage), `Shared/`
(PassDetail, PassPrint, Profile). `src/components/passview/` is the Gate Pass Details record — the ONE record format,
rendered both by Search Pass and by `/pass/:id`; `src/components/overdue/` is Overdue Items and `src/components/returns/` is the
line-level returns table, each one component serving all three roles;
`src/components/guard/` is the guard's three screens — the two summary cards, the quick actions,
the two list tables and the chrome the list pages share (header, toolbar, filter bar, pager,
`useGuardSearch`, `ApproveOutAction`); `src/components/board/` is the dashboard both the admin and the HOD get — one component, the HOD's scoped to one person server-side. `src/lib/` holds the
lookup maps, derivations and formatters; `supabase/migrations/` runs `001` → `042`, with
`005` an **optional demo seed** to skip in a real deployment.

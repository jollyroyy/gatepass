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

Full gate: **1453 tests across 120 files** (`npm run check`), green — and **`npm run build` is
green again**, which it had not been since the raise-form CSS landed (see the twelfth pass).
Migrations **`001`–`047` and `049`–`051` are applied to the live DB.** `044` was found UNAPPLIED on
2026-08-19 — the overdue card's Contact Vendor and Add Remark had shipped against RPCs that did
not exist — and was applied then, immediately before `046`. `039`, `040`, `041` and `043` were
each verified behaviourally with real anon-key JWTs (`scripts/verify-0NN.mjs` — `043` is **9/9**,
and it left the ladder empty exactly as it found it), `042` with a rolled-back `psql` insert that
returned `RGP-20260818-0001`, and **`046` is 20/20 (`scripts/verify-046.mjs`)** — every check run
as a real signed-in user, including the client's own rule that a guard cannot see an unapproved
pass. That probe borrows all four offices and hands them back; the run recorded the ladder
unchanged and its six probe passes were deleted, leaving **60 rows exactly as before**.
**`045`, `047` and `048` belong to a parallel session.** `045` IS applied (`vendor_profiles.address`
exists and `raise_pass` reads `make_model`); **`047` and `048` are NOT** — no approval-email or
notification function exists in `gatepass`. `APPLY_ALL.sql` carries all 49 sections regardless.

| Thing | State |
|---|---|
| `gatepass.gate_passes` | **61 rows** — real user data. **Not a scratch DB; do not wipe it.** |
| `public.departments` | **12 rows** (VMS-owned, shared) — do not wipe |
| Demo accounts | the `@demo.vms` accounts share password `demo123` and are email-confirmed; shared with VMS. **"all email-confirmed" was WRONG** — 7 real accounts carried `email_confirmed_at is null` and none of them had ever signed in (see the 048 entry). 6 still do, and a password reset is now what confirms them. |
| Deployment | Vercel SPA; env = `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only |
| `gatepass.approval_roles` | **4 rows — ALL FOUR OFFICES ARE FILLED**, so since `046` was applied every NEWLY raised pass needs four approvals and **the gate cannot see it until it has them**. Security Head **Demi** (re-designated 2026-08-19, fourteenth pass — it had been Jane/`jollyroyy@gmail.com` for the email test) · COO Sudeshna Pal · CEO Sid · Finance HOD GUARDSOHAM. One person holds one office (`049`). Admin → Users → *Gate pass approval ladder* is where they are set. |
| `gatepass.pass_approvals` | **4 rows** — one pending ladder, on `NRGP-20260819-0002`, sitting at level 1 (Security Head). The 60 older passes carry no ladder and reach the gate exactly as they did before. |

**Latest change (2026-08-19, fifteenth pass): THE APPROVAL QUEUE IS THE GUARD'S STACKED
SCREEN, the decision moved onto the pass record, and every letter NAMES THE PERSON IT IS
ASKING — migration `051`, APPLIED, and the Edge Function REDEPLOYED and PROBED 7/7 LIVE.**

- **DEMI NOW HOLDS THE SECURITY HEAD OFFICE.** The tab was never missing — `demi@vms.com` (an
  `hod` account) simply held no office, and `security_head` was still pointed at Jane
  (`jollyroyy@gmail.com`) from the email test. Re-designated on the live DB with the client's
  agreement, so the ladder reads **Security Head Demi · COO Sudeshna Pal · CEO Sid · Finance HOD
  GUARDSOHAM**. Nothing in the sidebar changed: `Sidebar.tsx` has appended `APPROVER_LINK`
  whenever `my_approval_role()` resolves since 046.
- **`/approvals` IS ONE FIGURE AND THE STACK IT OPENS** (client: "all the pending approvals
  should show up there in a stacked format, the styling should be the guard's view style, put the
  KPI number and make it reliable"). The same shape `/overdue` took: a `gpo-total` card, then
  `PassStack` — THE stacked card every role already reads — with the guard's pager underneath.
  **The figure is `rows.length` of the very array the stack renders**, so the search and the two
  filters narrow BOTH; no aggregate, no second predicate.
  `PendingApprovalsTable.tsx` and `PendingApprovalRow.tsx` are **DELETED**, so a stale reference
  is a build error.
- **APPROVE / REJECT ARE AT THE FOOT OF THE RECORD** (client: "once I click on the pending
  approval item it should show the exact same thing as it is showing in the guard's view — here
  make the CTA button, like approve or reject, at the bottom in a very proper manner").
  `src/components/passview/ApprovalDecisionBar.tsx`, rendered by `PassRecordView` from the
  `office` prop `App.tsx` now threads through `PassDetail`. Reject still opens the
  500-character modal. **A card in the stack carries no control at all** — the rule every
  stacked card in this app follows.
  - **`src/lib/approvalDecision.ts` is the slip-order rule, stated ONCE** and imported by both
    the queue and the bar, so a button is never drawn where `approve_pass_level` would refuse the
    press. `pendingApprovals.ts` lost its private copy of it.
  - An office the pass has NOT reached yet still gets the bar — as a sentence naming the office
    holding it up, and no buttons. "Nothing for me yet" must not look like a broken screen.
  - The record's `cancelled` banner now separates the two rejections by `flag_reason is null`:
    "Rejected in the approval ladder" against the HOD upholding a gate flag.
- **EVERY LETTER NAMES ITS RECIPIENT** (client: "address the person to whom you are sending it
  for approval — since we are using the same email I want to know whether the approval flow is
  working"). The subject is now **`Approval needed by Security Head (Demi) — RGP-20260819-0006
  (RGP), Level 1 of 4`**, the body greets "Hello Demi," and the tail names **who has already
  signed** ("Already approved by Security Head (Demi)"). That is load-bearing on this deployment:
  `MAIL_OVERRIDE_TO` sends every office's letter to ONE inbox and the mailer DROPS the display
  name when it redirects, so the name must be inside the subject and the body or the four
  offices' mails cannot be told apart.
- **MIGRATION `051` — the letter goes to WHOEVER HOLDS THE OFFICE TODAY.** Found by moving the
  Security Head while a pass sat at level 1: 046 gives authority to `my_approval_role()`, read at
  the moment of the press, but 047's payload joined `pass_approvals.routed_to` — the holder
  snapshotted at raise. So the mail asked a person the database would have refused, and the
  ladder stopped with an empty inbox as its only symptom. `approval_notice_payload` now resolves
  each level through `approval_roles`, **falling back to `routed_to` for an office nobody holds
  today**. 047's comment arguing the opposite is superseded — by 046, not by taste. **WHAT A PASS
  OWES IS STILL FROZEN AT RAISE**; only the address follows the office.
- **LIVE: `scripts/verify-047.mjs` 7/7 over real anon-key JWTs**, after
  `supabase functions deploy notify-approval`. One letter, to the Security Head, accepted by
  Resend (provider id recorded), logged as
  `jollyroyy@gmail.com (redirected from demi@vms.com)`, and nothing addressed to the raising HOD.
  **The probe pass was deleted afterwards; `gate_passes` is 61 rows** — 60 plus the client's own
  `NRGP-20260819-0002`, which is pending at level 1 and is what Demi can approve to watch the
  COO's letter go out.
- Pinned by `approvalDecision.test.ts` (10), `passRecordApprovalCta.test.tsx` (7), a rewritten
  `pendingApprovalsPage.test.tsx` (7 — the figure agreeing with the stack, no control on a card,
  the card opening `/pass/:id`), 5 new `approvalNotice` cases and 3 new `sqlInvariants` cases.
  `npm run check` is **1453 tests across 120 files**, and `npm run build` is green.
- **NOT SEEN SIGNED-IN IN A BROWSER**: the suite, a production build and the live probe only.
  The 2nd, 3rd and 4th rungs are still unproven end to end — approving as Demi is what proves
  them, and that is now one press at the foot of the record.

**Earlier (2026-08-19, fourteenth pass): the raise form states the pass's REFERENCE
NUMBER and takes a return date PER ITEM, the HOD's figures say each number once, and THE
GUARD'S SKIN IS NOW EVERY ROLE'S SKIN.** Frontend only — no migration, no RPC change, no change
to any query.

- **THE RAISE FORM CARRIES A READ-ONLY Reference Number** (client: "on top show the reference
  number of the RGP or NRGP pass and it should be uneditable"). `passNumberPreview` in
  `raisePassForm.ts` mirrors 042's trigger exactly — `TYPE-YYYYMMDD-` — and re-prefixes itself
  when the pass type changes. **THE SERIAL READS `####`, DELIBERATELY**: `set_pass_number()`
  assigns NNNN inside the INSERT under an advisory lock, so nothing outside that transaction can
  know it; two HODs on the form at once would be shown the same number and one of them would be
  wrong. An HOD reads only their own department's passes, so a count here could not even guess.
  The submitted-pass modal states the real number. `readOnly`, never `disabled` — the HOD may
  still select and copy it.
- **THE DEPARTMENT FIELD IS GONE** (client: "no need to show the department because it will be
  automatically captured"). It is still LOADED from `hod_departments` and still sent on
  `p_department_id`; it is simply not asked for. The one thing that can go wrong with it — an
  HOD assigned to no department — now reports as a whole-form `alert-error`, because a field
  that is not drawn cannot carry an error under it.
- **A RETURN DATE IS TAKEN AGAINST EACH ITEM AGAIN, ON AN RGP** (client: "we would expect a date
  of return against each item in the RGP form"). This REVERSES the eighth pass's rule, which the
  same client set the same day ("the return date of all individual items in the pass should be
  the expected return date of the entire pass"), so read the history in `raisePassForm.ts`
  before moving it a third time — each move has broken the form once.
  - `NewGatePassItem.expected_return_date` is back; **`NewGatePass.expected_return_date` is
    DELETED**, so a form that still writes a pass-level date is a type error rather than a
    second date silently disagreeing with the lines.
  - **THE PASS'S OWN DEADLINE IS THE EARLIEST LINE'S** (`earliestReturnDate`), computed at
    submit. `gate_passes.expected_return_date` is the one column `v_gate_passes` grades
    `is_overdue` / `due_state` from, and a pass is late the moment its FIRST line is; taking the
    latest would leave material outside, past its own date, on a pass the board calls on time.
  - The column is RGP-only, header included — `itemGridColumns(showReturnDate)` is the one
    variant this template has, threaded from the pass type so the header and every row read the
    same boolean. Selecting NRGP **CLEARS** every line's date rather than hiding it: a date left
    in state under a hidden field is a date that would be submitted, and an NRGP with a return
    date is a pass the return queue would chase forever.
  - Validation is per line, so both blank rows say so under their own inputs. `useReraisePass`
    copies each LINE's date and blanks only the ones already past.
- **THE HOD'S FIGURES STATE THEMSELVES ONCE** (client: "I need to put zero overdue multiple
  times — show it only once", "remove the bottom All types", "remove Material past its return
  date / 0 passes"). The Total Passes and Pending Return cards carry NO note at all — `0` in
  32px over "Pending Return · Overdue" was already the whole sentence — and `HodKpiCards` draws
  the hairline only when there is a note, so a noteless card is not an empty bordered strip. The
  HOD's drill passes `showHeading={false}` to `DrillList`; **the admin's still shows it**, since
  that board's figures do not sit directly over the list. `hodDashboardBoard.test.tsx` fails if
  any of the three comes back.
- **`.gb-main` IS ON `<main>` FOR EVERY ROLE NOW** (client: "admin and HOD do not have the same
  typography as the guard … keep the type and the box, everything exactly the same as the
  guard's typography, colour"). The stacked card itself was ALREADY the guard's markup
  everywhere — what differed was the page around it, so My Passes, Reports, the Admin panel and
  the pass record read in gold serif on the dark surface while the guard's shell was light Inter.
  One class on the shell fixes all of them at once. `OverduePassBoard` also gained `gb-main`
  beside its `gb-board`: `.gb-board` paints the ground but a HOUSE component inside it still
  took its `dark:` half, which is exactly the mismatch the client reported.
  - **CONSEQUENCE, FLAGGED: the app is effectively light-only for content now.** The twenty
    hand-written `.dark X:not(:where(.gb-main, .gb-main *))` rules and the `darkMode` variant in
    `tailwind.config.ts` still exist and are still correct — they simply no longer have any
    content subtree to apply to. The dark SIDEBAR is untouched (it is chrome, and hardcoded).
  - **KNOWN GAP: the notification bell and its dropdown are OUTSIDE `main`** (both `fixed`), so
    they keep the house theme. The guard's shell has had that gap since the skin landed.
  - `appShell.test.tsx`'s four "leaves `<main>` on the house theme" cases were REWRITTEN into one
    that walks every role, with a comment saying what they used to hold.
- **NOT seen signed-in in a browser**: `npm run check` only. A whole-app skin change is exactly
  the kind of thing only a real render proves — the Admin panel's modals, Reports' filter bar and
  the printed slip are worth opening first.

**Earlier (2026-08-19, thirteenth pass): NO ADMIN FIGURE COMPARES ITSELF TO THE
PREVIOUS WINDOW, and the stacked card's RGP/NRGP chip is the guard's own coloured pill.**
Frontend only — no migration, no query change, no change to what any figure counts.

- **EVERY DELTA IS DELETED, not flagged off** (client: "remove all those comparisons").
  `deltaOf`, the `Delta` type, `WindowBounds.prevStart`, the arrow glyphs and the
  `gb-ov-up/down/flat` ink are gone, so a stale reference is a build error. Each card's second
  line is now its SCOPE in plain grey words — "Raised in the last 7 days" on the three windowed
  figures, and the running queues keep the lines they already had. The row still reads as five
  cards of one height. `adminOverview.test.ts` now fails on a `delta` property reappearing.
- **The type chip on `PassStackCard` is `gb-pill` + `TYPE_PILL`** — RGP blue, NRGP green, the
  very map the guard's Pending OUT / Pending RGP Return / search rows colour theirs with
  (client: "whenever we are saying the NRGP and RGP in the guard's view, we make it exactly
  [that] for the stacked card in the admin across all the tabs"). `.gpo-type`, the grey
  lettering it replaced, is deleted from `index.css`; `.gpo-card-id > .gb-pill` keeps the pill
  from stretching in that flex COLUMN. It changes every stack at once — the admin's drills, the
  HOD's drills and My Passes — because there is one stacked card.
- **The rest of the stacked card was ALREADY the guard's**: same `.gpo-*` plate, same Inter
  from `.gb-stack`, same coloured left edge and stage pill, whole card linking to `/pass/:id`,
  and **no action of any kind** — the return-processing and Approve OUT controls are the
  guard's, on the record. Verified by reading it against `OverduePassCard`, not changed.
- **NOT seen signed-in in a browser**: `npm run check` (1423 tests, 118 files) and
  `npm run build`, both green.

**Earlier (2026-08-19, twelfth pass): THE ADMIN DASHBOARD IS THE CLIENT'S "Overview"
MOCK-UP, box for box — five figures with their change against the previous window, a Gate Pass
Trend and a Passes by Status ring. `GateBoard` IS DELETED.** Frontend only — no migration, no
new RPC, and ONE query where the old board made two.

- **`src/pages/Admin/AdminDashboard.tsx` is its own layout now**, over `src/components/admin/*`
  (`OverviewCards` · `OverviewTrend` · `OverviewStatus`) and `src/lib/adminOverview.ts` (pure).
  **DELETED, not flagged off** — a stale reference is a build error: `src/components/board/*`
  (all twelve files), `src/components/charts/*` (`TrendChart`, `DonutChart`, `ColumnChart`,
  `chartPalette.ts`), `boardKpis.ts`, `boardWindows.ts`, `boardAnalytics.ts`, `returnWatch.ts`,
  and eight spec files with them. `isWaitingAtGate` survived into `src/lib/gateQueue.ts`,
  because the HOD board asks the same question.
- **KNOWN COSTS, FLAGGED**: the admin loses the department column chart, the Return Watch
  table (due today / in 7 / later), Top Items Today and the mismatch attention strip. `/overdue`
  still lists the backlog and the Overdue Returns card opens the same rows; a flagged pass is
  inside the ring's Rejected arc and in the register. **Nothing ranks materials or departments
  any more** — which is why this page no longer reads `v_gate_pass_items` at all.
- **THE BOARD INVARIANT SURVIVES.** Every clickable figure — a card, a legend row, a day on the
  trend — carries the very rows it counted on a `BoardDrill`, and the stack underneath renders
  exactly that array. No aggregate, no `count: 'exact'`.
- **TWO FIGURES ARE DELIBERATELY OUTSIDE THE WINDOW**, and they are the two the mock draws in
  red: Pending Approvals and Overdue Returns are RUNNING queues. An obligation does not close
  because the window rolled past the day it started in. They carry **no delta**, ever — nothing
  in this database records how long a queue was last week, and a figure invented for a red arrow
  is worse than no arrow. A windowed card whose PREVIOUS window was empty drops its delta too:
  a percentage change from zero is not a number.
- **The third card is NRGP.** The mock's own label is "Energy Pay Pass" — the client corrected
  that phrase on sight the first time it appeared, on the raise form's second pass type.
- **The ring's five buckets are an ordered chain, urgency first**: Rejected (`flagged` /
  `cancelled`) → Pending (`pending` / `held` / `hod_reviewed`) → Overdue → Returned → Approved
  as the remainder, so the arcs sum to the rows and the centre total IS the Total Gate Passes
  card. **KNOWN IMPRECISION, flagged**: an EXPIRED pass is still `status = 'pending'` and lands
  under Pending though nothing can clear it — the mock has no sixth bucket, and the drill list
  badges each such pass "Expired". `is_overdue` is read off `v_gate_passes`, never recomputed.
- **The header chip and the trend card's chip are ONE control on ONE piece of state** (7 / 30 /
  90 days, local calendar days ending today), so the two can never disagree.
- **The skin is the `.gb-*` island** the guard's and the HOD's boards use — `gb-board gb-main`
  on one div, so `DrillList`'s house-themed pass cards take their LIGHT halves. No literal hex
  in `src/components/admin/*`; the two charts paint from `--gb-*` vars, which is why
  `chartPalette.ts` could be deleted outright rather than re-exempted in `themeAudit`.
- **`.board-section-title` and `.board-accent` are GONE from `index.css`** — the heading ladder
  is four rungs now (page 28 · section 22 · modal 22 · card 18). They headed a KPI band on a
  board that no longer exists; a future band heading takes `.card-title`, the same size.
- **A BUILD BREAK THAT PREDATED THIS WORK IS FIXED.** `npm run build` had been failing since
  the raise-form sheet landed: its comment read ``(navy-*/surface-*/accent-*)``, and the `*/`
  inside it CLOSES the comment — the prose after it was parsed as a selector and PostCSS died
  with "Unexpected '/'" pointing at `line: undefined`. **`npm run check` never sees this**: it
  type-checks and runs vitest, and neither builds the CSS. Two new `designSystem` cases fail on
  exactly that shape now (both were watched failing against the real bug before the fix).
- Pinned by `tests/unit/adminOverview.test.ts` (24) and `adminDashboardOverview.test.tsx` (12 —
  the five figures, the window/running split, the figure-drill agreement on a card, an arc and
  a trend day, the one-query rule, and the absence of every old panel by name).
  `boardHeadings.test.tsx` is DELETED with what it pinned; `headingIdentity` lost its fifth rung.
- **NOT seen signed-in in a browser**: `npm run check` (1424 tests, 118 files) and
  `npm run build` only. The trend's SVG geometry and the ring's dash arithmetic are exactly the
  kind of thing only a real render proves.

**Earlier (2026-08-19, eleventh pass): the raise form IS the client's new "Raise Gate
Pass" mock-up, and the HOD dashboard offers ONE Raise tile instead of two — migration `045`,
APPLIED via psql (every statement returned; not yet probed with a real anon-key JWT).**

- **ONE QUICK ACTION** (client: "instead of two gate passes, just create one icon"). The tile
  goes to `/raise` and the TYPE is chosen on the form itself, which is where the mock puts it.
  `/raise` still honours `?type=RGP|NRGP` as initial state, so an old bookmark still lands right.
  `.gb-raise-grid` is a single 223px track now — `repeat(2, …)` with one child left the tile at
  half width beside an empty column.
- **`RaisePass` is ONE `.rp-sheet`, not four cards**: Pass Type · Pass Details · Vendor Details ·
  Carrier / Person Details · Purpose · Item-wise Details, then **Cancel / Submit Request**. The
  submit button is no longer called "Raise Gate Pass". `PassIdentityPanel.tsx` is **DELETED** —
  the mock draws no Serial / Date / Raised By banner.
- **Pass Type is a real `role="radiogroup"`**, two wide plates with a radio, a tinted glyph and a
  blurb. **The mock's second plate said "Energy Pay Gate Pass"; the client corrected it on sight
  — it is NRGP**, and it keeps the mock's green skin.
- **Department, Vehicle Number and Expected Return Date are PASS-LEVEL and sit on top** (client:
  "all this should be for the entire pass … no need to give it that for each individual item").
  The mock draws none of the three; they are here on that instruction.
- **THREE FIELDS THE FORM NO LONGER COLLECTS, each a real cost, each flagged:**
  - **UOM** (client: remove the column) — every new line is written `nos`, so **material counted
    in bags, drums, kg or litres can no longer be raised in its own unit**. `isWholeUnit` still
    governs the return box; the raise form now just refuses every fraction.
  - **Approx. value** — no column on the mock, so **"Total Value" reads "—" on every card and
    record from here on** and the record's item table foots nothing. Old passes keep theirs.
  - **Per-item purpose** — asked ONCE for the whole pass (500 chars, with the mock's counter).
    `raise_pass` falls back to the pass purpose per line, so a record prints the reason that was
    authorised instead of the literal 'Material movement'.
- **Migration `045`**: `gate_pass_items` gains `make_model` · `invoice_no` · `remarks` (all
  nullable, one blank-vs-null check); `vendor_profiles` gains `address`; `save_vendor_profile`
  grows a 7th parameter (**the 6-arg overload is dropped in the same migration** — two overloads
  reachable by named args is exactly the ambiguity PostgREST guesses at); `raise_pass` keeps its
  **019 9-arg signature** and reads the three new keys out of each `p_items` element. No
  `gate_passes` column, so `v_gate_passes` is untouched (TRAP 2 does not apply).
- **"Vendor Address (Auto-filled)" is why `vendor_profiles.address` exists.** The address had
  only ever lived inside `visitor_company`'s packed `{"n","a","v"}` JSON, which is a record of
  ONE pass and is not queryable by vendor. **The pass still keeps its own copy** — a slip printed
  last month must not change because somebody corrected a pincode this morning. A hand-typed
  vendor is saved on submit, fire-and-forget, which is the only way the auto-fill ever comes true.
- **The mobile field is a dial-code select welded to a number box** (`src/lib/mobileNumber.ts`),
  joined into the one string the packed blob stores. Longest dial code wins on the way back out,
  so `+91` cannot claim a `+971…` number. Validation is 7–15 digits, **not an India-only 10** —
  the form carries a dial code and a Gulf supplier is an ordinary vendor here.
- **THE ATTACHMENT COLUMN IS NOT BUILT** (client, mid-flight: "remove the attachment part"). No
  storage bucket, no per-line upload.
- Downstream, `make_model` now shows on the printed slip (a second line under the item name),
  on the pass record, and on the guard's Verify table; `invoice_no` and `remarks` show on the
  slip and the record but **deliberately not to the guard** — an invoice number is an accounts
  fact, not something checked against material at a barrier.
- Pinned by rewritten `materialItemsGrid` · `raisePassSubmit` · `raisePassReturnDate` ·
  `reraisePass` · `wholeUnitQuantity` (raise half only) · `authorizedPersonLabel` ·
  `hodDashboardBoard` (Quick Actions block) · `themeAudit`, plus a new `mobileNumber.test.ts`.
- **NOT seen signed-in in a browser**: `npm run check` (1473 tests, 125 files) only.

**Also 2026-08-19 (parallel session): the Users tab lists ACTIVE people only, every inactive
row offers Reactivate, and an admin-set password can actually be signed in with — migration
`048`, APPLIED and probed with real anon-key JWTs (`scripts/verify-048.mjs`, 8/8, throwaway
account cleaned up).**

- **EVERY TAB BUT "Inactive" IS ACTIVE-ONLY** (client: "when you are showing all users, it
  should only show the active users and move all the inactive users to the inactive tab").
  `matchesFilter` in `UsersTab.tsx` tests the status FIRST, so activeness decides listing in
  exactly one place. **This reverses the rule this file used to carry**: the Guard and HOD tabs
  deliberately listed suspended people too, on the grounds that "they are still a guard". The
  client overruled it by name. Cost, accepted: a suspended guard is reachable through one tab
  now rather than two.
- **AN INACTIVE ROW ALWAYS OFFERS REACTIVATE** (client: "I don't see any reactivate option when
  we are seeing the inactive users. Besides there I'm only seeing that edit"). It used to be
  hidden on a `staff` row because `admin_reactivate_user` (040) *refuses* a target with no role
  to restore. **That refusal is unchanged — the portal answers it instead of hiding the
  control**: such a row opens `ReactivateUserModal.tsx`, which picks Guard/HOD (+ department),
  calls `admin_update_user` and then `admin_reactivate_user`. **In that order, because the
  second is illegal until the first lands.** A suspended guard/HOD still reactivates in one
  click — 040 kept their role, so there is nothing to ask.
- **`isDirectoryActive` (in `userStatus.ts`) is the directory's version of the question**, and
  it exists because of 046: an office holder's VMS role really is `staff`, and
  `isAccountActive` would file a COO under Inactive on the strength of a role that was never
  meant to describe them. It is a SECOND function, not a third parameter — App.tsx's gate asks
  about the signed-in user and has no office map to hand. An office holder gets no
  Deactivate/Reactivate at all; their office moves on the ladder card.
- **MIGRATION 048 — an admin-set password now CONFIRMS THE EMAIL** (client: "when the admin
  resets the password for a user then he should be able to log in with that password and with
  the email that is being shown in the user"). 036's reset wrote the bcrypt hash, killed the
  sessions and raised the must-change flag — and never touched `email_confirmed_at`, which
  **GoTrue checks BEFORE it looks at the password**. Measured on the live DB as `postgres`
  before writing it: 7 accounts unconfirmed, **every one with `last_sign_in_at is null`**,
  while every account that had signed in was confirmed; one of the 7 already carried
  `must_change_password`, i.e. an admin had reset it and it still could not be used.
  **`profiles.email` and `auth.users.email` agree on every row** — the address the portal shows
  was never the problem. `verify-048.mjs` reproduces it end to end and GoTrue names it:
  *"Email not confirmed"*.
  - `coalesce(email_confirmed_at, v_now)`, never a bare assignment: a reset must not restate
    when someone proved they owned the address. Pinned by `sqlInvariants`.
  - The **backfill is narrowed to `must_change_password` accounts** — the flag is written by
    that RPC alone, so the set is "accounts an admin has ALREADY reset and expects to work"
    (1 row: `demi@vms.com`). It is deliberately NOT a blanket confirmation of every unconfirmed
    address in a directory shared with VMS; the other 6 get confirmed the day their password is
    reset.
- Pinned by `usersTabActiveOnly.test.tsx` (9) and 5 new `sqlInvariants` cases. Two cases in
  `usersTabStatus.test.tsx` were REWRITTEN, not deleted — each says in its own comment what it
  used to hold and which client instruction superseded it.
- **NOT seen signed-in in a browser**: the suite, a typecheck and the live 048 probe only.

**Latest change (2026-08-19, eleventh pass): THE APPROVAL LADDER IS A REAL WORKFLOW —
migrations `046` and `049`, BOTH APPLIED AND PROBED 20/20 WITH REAL ANON-KEY JWTs.** An admin
creates a Security Head / COO / CEO / Finance HOD user; that person signs in to a Pending
Approvals queue and approves or rejects with a written reason; and **a guard cannot SEE a pass
that has not finished climbing the ladder.**

- **`046_approval_workflow.sql` — READ ITS HEADER BEFORE TOUCHING ANY OF THIS.** New table
  `gatepass.pass_approvals`, one row per office a pass owes, **snapshotted by an AFTER INSERT
  TRIGGER on `gate_passes`** from whatever `approval_roles` holds that day. It is a trigger and
  not a change to `raise_pass` on purpose — every insert path gets it, and the parallel session
  rewriting `raise_pass` in `045` cannot drop it by forgetting a line.
  - **A VACANT OFFICE IS NEVER SNAPSHOTTED**, which is the whole rollout: `approval_roles` is
    empty today, so nothing blocks until an admin designates somebody, and the **60 live passes
    are grandfathered with no backfill**.
  - **A pass's requirements FREEZE the day it is raised.** Designating a new CEO tomorrow does
    not reopen a pass that already cleared. Authority, though, follows the OFFICE: who may press
    Approve is resolved from `approval_roles` at the moment of the press, so a CEO who leaves
    does not take a queue of undecided passes with them.
  - **THE CLIENT RULE IS RLS, NOT A SCREEN FILTER** ("the guard cannot see any partially
    approved or unapproved gate passes"). `gate_passes_select` and `gate_pass_items_select` are
    rewritten: admin sees everything at every stage, **guard sees everything EXCEPT a pass still
    owing a signature**, HOD sees their own department at every stage, and an office holder sees
    only what is routed to their office. `is_security()` is no longer what decides that policy —
    it means guard-or-admin and those two now differ. A **BEFORE UPDATE trigger says it again**,
    because `match_pass` is SECURITY DEFINER and bypasses every policy.
  - `lookup_pass` gained an **`awaiting_approval`** outcome and **returns no `pass_id` with it** —
    the record is the very thing the guard may not read, and 'not_found' would send them hunting
    for a typo.
  - **Rejection is terminal** and reuses 027's shape: `status` to `cancelled`, a `verifications`
    row with who and why, no undo. The remaining levels are left `pending` rather than
    back-filled with an invented state — nobody below signed anything.
- **AN APPROVAL OFFICE IS NOT A ROLE**, and that is the load-bearing decision. `profiles.role`
  is VMS's enum and this app never adds to it, so `admin_create_user` now accepts the four
  office keys, creates the account as VMS **`staff`** (in the profile AND in
  `raw_app_meta_data.role`) and writes the `approval_roles` row in the same transaction. The
  office is a SECOND, INDEPENDENT grant carried beside the role — `isForbidden(path, role,
  isApprover)` and `homeFor(role, isApprover)` in `roleRoutes.ts`, `APPROVER_ROUTES` /
  `APPROVER_HOME`, and `src/lib/approverAccess.ts` for the argument. **043 explicitly allows the
  Security Head to be a `guard` account**: such a person keeps every gate tab and gains
  `/approvals`; a `staff` account with an office has `/approvals` as its home and nothing else.
- **`/approvals` is the client's mock-up**: `src/pages/Approver/PendingApprovals.tsx` over
  `src/components/approver/*` and `src/lib/pendingApprovals.ts` (pure) + `usePendingApprovals.ts`
  (two reads, no aggregate). A row is actionable only when the pass is `pending`, my office's row
  is `pending`, and **my level is the LOWEST still-pending one** — the slip order, enforced
  server-side too, so the screen never draws a button the RPC will refuse. Passes routed to my
  office but waiting on somebody below me render read-only underneath, naming the office they are
  actually with. Reject opens the mock's modal (reason required, 500 characters, `N/500`).
- **The record's ladder is graded from the pass's own rows now** (`buildApprovalSteps` takes a
  fourth argument; `src/lib/passApprovalState.ts` holds the shape and the two status maps).
  A pass with rows reads approved / waiting / rejected with a real name and a real moment, and the
  **guard's "signed on the printed pass" fiction no longer applies to it** — a pass that owes a
  signature is one a guard cannot see, so drawing it as signed would contradict the policy that
  hid it. **A pass with NO rows reads exactly as it did before** — all 60 of them.
- **The HOD dashboard's four approval figures are REAL** (`src/lib/hodApprovals.ts`): security
  from `security_head`, finance from `finance_head`, other from `coo` and `ceo`. **`hod` is still
  structurally zero** — the issuing HOD's approval is the act of raising. A rejected pass's
  leftover `pending` rows count nowhere, which is why the count is gated on the PASS's own status.
- **The bell tells the raising HOD a pass was rejected**, derived on mount from
  `status = 'cancelled' and flag_reason is null` — that null is what separates an approval
  rejection from the HOD's OWN decisions (voiding an expired pass, upholding a flag), which
  never reached the gate and so never carried a flag reason.
- **Admin → Users creates an office holder**, with the Department control hidden and a note
  saying which office it MOVES (an office has one holder, by primary key). The Edit modal still
  offers Guard and HOD only — `admin_update_user` cannot move an office; the ladder card does.
  `UsersTab.tsx` was split into `AddUserModal` / `EditUserModal` / `DeactivateUserModal` /
  `UsersTable` and is **260 lines**, so the 478-line debt in "Known, not fixed" is settled.
- **`/overdue` IS ONE SCREEN FOR ALL THREE ROLES** (client, same day): the guard's card stack,
  scoped — HOD to their own raised passes (`.eq('raised_by', ...)`, server-side), admin site-wide.
  `src/components/overdue/` now holds `OverduePassBoard` / `OverduePassCard` / `OverdueCardMenu` /
  `RemarkBox`; **`OverdueBoard`, `OverdueTable`, `OverdueFilters`, `OverdueStats`,
  `OverdueTrendPanel` and `OverdueDeptChart` are DELETED**, and with them `overdueStats`,
  `overdueTrend`, `filterOverdue`, `departmentsOf`, `overdueByDepartment`, `formatDelay`,
  `OVERDUE_STYLES` and `returnDeskFor` in `overdueItems.ts`. **KNOWN COST, FLAGGED**: the admin
  loses the overdue department chart and the 7-day trend. "Process RGP Return" is drawn for a
  guard alone (only `apply_item_returns` can act) and the remark item reads "Add Remark" for
  everyone else; Contact Vendor and Export Pass PDF are drawn for every role, because
  `pass_contact` / `add_pass_remark` are already RLS-scoped.
- **`046` IS APPLIED AND PROBED — `scripts/verify-046.mjs`, 20/20, over real anon-key JWTs.**
  It proves the whole workflow as signed-in users: the snapshot on raise, **a guard seeing
  neither the pass nor its material lines**, `lookup_pass` answering `awaiting_approval` with no
  pass id, **`match_pass` refused by the trigger even though it is SECURITY DEFINER**, slip
  order in both directions, a rejection needing a reason and closing the pass with a
  verification, and a fully approved pass becoming visible to the gate again.
  **THE PROBE'S FIRST RUN "FAILED" FOR THE RIGHT REASON AND IS WORTH KNOWING ABOUT**: it had
  lent the COO office to the very guard account whose blindness it was testing, and an office
  holder can of course see what is routed to them. The four offices it borrows must always go to
  accounts that are neither the probe guard nor the raising HOD.
- **`049` CAME OUT OF THAT PROBE, not out of review.** `my_approval_role()` is a scalar
  `returns text` over `approval_roles`, and Postgres does not error when such a query yields two
  rows — it returns an arbitrary one. Nothing forbade designating one person to two offices, so
  a dual-hatted approver could have acted on exactly one of them, silently, with half a queue.
  `049` is a **unique index on `approval_roles(user_id)`** plus a `set_approval_role` that names
  the office already held. If dual-hatting is ever wanted, that migration's header lists the four
  things that must change with it.
- **NOT SEEN SIGNED-IN IN A BROWSER.** No probe covers the RENDER: the `/approvals` screen, the
  reject modal, the record's ladder rungs and the `.gb-*` skin on a `staff` account's shell have
  been proved by the suite and a production build only.
- **THE FOUR OFFICES ARE NOW DESIGNATED**, so every newly raised pass enters the ladder and is
  hidden from the guard until it clears. `approval_roles` is no longer empty — the "nothing
  blocks until an admin designates somebody" rollout above has already been triggered.
  `security_head` is deliberately pointed at the `jollyroyy@gmail.com` account (Jane, a
  `guard` — 043 allows that) **for the email test below**; move it back to a real Security Head
  before this is used for real.

**`047_approval_email_notifications.sql` — APPLIED (2026-08-19, via psql; every statement
returned).** `gatepass.approval_notice_payload(uuid)` (SECURITY DEFINER, `service_role` only —
it returns officers' EMAIL ADDRESSES, which no signed-in role may read) and `gatepass.email_log`
(admin-select, service-role-write, no insert policy). The sender is the Deno Edge Function
`supabase/functions/notify-approval`, called AFTER the RPC commits — the pass matters more than
the letter. **NOT DEPLOYED, and no mail has ever been sent**: the provider call is unverified
against the real API. WHO gets mailed changed in a later pass — this entry describes
the schema half only.

- **`src/lib/approvalNotice.ts` MUST NEVER GAIN AN IMPORT.** Deno needs a `.ts` extension on a
  local import and the app's tooling needs none, so importing nothing is the only way one file
  serves both runtimes. `tests/unit/approvalNotice.test.ts` fails if an import appears there.
  It is also exempt in `themeAudit` — the hex is in email HTML, and a mail client does not load
  `index.css` (same category as `PassPrint`).
- **Testing without a corporate domain**: an unverified Resend account may send only FROM
  `onboarding@resend.dev` and only TO the address that owns the account, so the whole test is
  aimed at one real inbox. Read `gatepass.email_log` — `ok = false` carries the provider's
  refusal verbatim; no row at all means the function was never reached.

**Latest change (2026-08-19, twelfth pass): the ladder mails ONE OFFICE AT A TIME AND NOBODY
ELSE, and every letter can be redirected to a single inbox.** Frontend/function only — no
migration; `047` is unchanged and still applied.

- **THE RAISING HOD IS NEVER WRITTEN TO** (client: "the hod who raises the pass should not get
  any email because he or she already raised it. That means approval is already taken").
  `buildApprovalNotices` now returns AT MOST ONE message and `NoticeKind` is the single label
  `awaiting_you`. The four HOD receipts — `raised_ack`, `level_cleared`, `fully_approved`,
  `rejected` — are **deleted, not flagged off**, and `NoticePerson` with them, so a stale
  reference is a type error. **KNOWN COST, FLAGGED**: the HOD learns of a rejection in the app
  alone (the bell's notice, `status = 'cancelled' and flag_reason is null`) and hears nothing by
  mail.
- **ONE RUNG PER EVENT, which is what the client asked for and what the code already did.**
  Raising mails level 1; that office approving mails level 2; and so on, because each mail is
  sent by `notifyApproval` AFTER the RPC for the step before it committed, and `currentApproval`
  is the LOWEST still-pending level — the only one `approve_pass_level` will accept. A rejected
  ladder mails nobody: the levels below a rejection stay `pending` and asking one of them to
  approve a closed pass is the exact letter the guard in that function prevents.
- **`MAIL_OVERRIDE_TO` — every letter to one inbox.** An env var read in `_shared/mailer.ts`
  (never a constant, and the test inbox is named nowhere in the repo): when set, the provider is
  handed that address whatever office the message was aimed at, and the display name is dropped
  so a redirected letter cannot be mistaken for a real one. It exists because an unverified
  Resend account may only write to the address that owns it. `email_log.recipient` records
  **`delivered@x (redirected from intended@y)`** — a log saying only "sent to the test inbox"
  could not tell the four offices' mails apart afterwards. Unsetting it, plus a `MAIL_FROM` at a
  verified domain, is the whole production switch-over.
- **DEPLOYED, AND REAL MAIL HAS NOW BEEN SENT.** `supabase functions deploy notify-approval`
  ran (it uploaded three assets — the function, `_shared/mailer.ts` and `src/lib/approvalNotice.ts`,
  so the no-import rule is what makes the deploy work). Secrets set on the function:
  `RESEND_API_KEY`, `MAIL_FROM="Quest GatePass <onboarding@resend.dev>"`,
  `MAIL_OVERRIDE_TO=jollyroyy@gmail.com`, `APP_BASE_URL=http://localhost:5174`.
  **`APP_BASE_URL` IS LOCALHOST** (the client's choice) — the "Open your Pending Approvals" link
  in every letter therefore only works on that machine. Reset it to the Vercel URL before a real
  approver is asked to click one.
- **`scripts/verify-047.mjs` — the live probe, 6/7 on its first run, and the one FAIL was a real
  bug.** As a signed-in HOD over the anon key: the raise snapshotted all four offices, the
  function answered, **exactly one letter came out**, it was `awaiting_you` to the Security Head,
  **Resend accepted it** (provider id recorded) and nothing was addressed to the raising HOD.
  The failure was `email_log` staying EMPTY.
- **MIGRATION `050` CAME OUT OF THAT PROBE, and is APPLIED.** 047 created `email_log`, enabled
  RLS and wrote the admin SELECT policy, then relied on "the service role bypasses RLS" for the
  write. **RLS-bypass is not a table privilege**: a fresh schema inherits no Supabase grants, so
  `service_role` held nothing at all on that table and every insert failed with 42501 — swallowed
  by design, because a logging failure must never abort a delivery that already happened. `050`
  is `grant insert on gatepass.email_log to service_role`, INSERT only. Re-invoked afterwards and
  the row is there: `awaiting_you · jollyroyy@gmail.com · ok = t · provider id`.
- **THE PROBE'S PASS WAS DELETED and `gate_passes` is back to 60 rows** (61 → delete → 60,
  as `postgres`). The `email_log` row was kept, its `gate_pass_id` nulled by the FK's
  `on delete set null` — the evidence outlives the probe.
- **The 2nd, 3rd and 4th rungs are UNPROVEN end to end.** Driving them needs the four office
  holders' passwords, and they are real people. The mechanism is the same call on the same
  function — approve the pass at `/approvals` and the next office's letter goes out — but nobody
  has watched it happen. That, and the RENDER of the mail in a real client, are what is left.
- Pinned by a rewritten `tests/unit/approvalNotice.test.ts` (21): the first office only, nothing
  to the HOD, the next office when a rung is signed, silence when the ladder is done, silence on
  a rejection, silence when no office is designated, and silence rather than a letter to an
  office with no address.

**Earlier (2026-08-19, tenth pass): ONE stacked pass card for every role, the
timeline ends with the return, value is totalled everywhere, and the guard's record stopped
rendering white-on-white.** Frontend only — no migration, no new RPC. One DATA fix.

- **EVERY STACKED LIST DRAWS THE GUARD'S CARD** (client: "all the cards across all the admin,
  whether admin or HOD level, should mimic the exact same stacked card style of the guard's
  view … upon clicking on those cards it should show up the exact details as guard, but HOD
  and admin cannot perform any action — they can just see the return status").
  `src/components/PassStackCard.tsx` is `OverduePassCard` generalised — the white plate, the
  coloured left edge, the pass number, a six-fact grid (Requested By · Vendor / Person ·
  Material · Items · **Total Value** · Return Before, or Cleared on an NRGP) and the stage
  pill — and `PassStack.tsx` is the list plus the token island it needs.
  - **THE WHOLE CARD IS A LINK TO `/pass/:id` AND EXPANDS NOTHING.** The drill card used to
    open in place; now every role reads a pass in the one record.
  - **It offers no action to anybody, and that is not a role check** — there is no control on
    it at all. Approve OUT and recording a return live on the record and are drawn for a guard
    alone, by the rules `match_pass` and `apply_item_returns` enforce.
  - **DELETED, not flagged off**: `DrillPassCard.tsx`, `MyPassCard.tsx`, `PassRowBody.tsx`,
    `PassItemLines.tsx` and `PassRow`'s whole `drill` variant (with `dense`, `slim`,
    `subtitle`, `defaultOpen`, `showRaisedBy`). `PassRow` is now the phone-search row and the
    `compact` review card only. **KNOWN COST, FLAGGED**: the opened card's per-line material
    table went with `PassItemLines`, so each line's value is read on the record now (where the
    item table foots it) rather than inside the card.
  - `src/lib/passStackCard.ts` maps a stage LABEL to one of the guard skin's five pill tones;
    `passStackCard.test.tsx` walks `STATUS_STYLES` / `RGP_STAGE_STYLES` / `EXPIRED_STYLE` and
    fails on a stage nobody toned, which a Record keyed on an enum cannot do here.
- **THE `--gb-*` PALETTE IS DECLARED ONCE, for `.gb-board`, `.gb-main` AND `.gb-stack`.** It
  used to live on `.gb-board` alone while `.gb-main` painted with it — so on a guard page with
  no board (the pass record, Search Pass, Verify) `color: var(--gb-body)` was invalid at
  computed-value time and the cells INHERITED the app's near-white dark-mode ink onto a white
  plate. That is the bug the client reported ("a couple of columns are showing in light, it's
  not visible"). `designSystem.test.ts` pins the shared rule.
- **The return leg closes the merged timeline** (client: "To Be Returned should be after
  Cleared out at the gate"). `buildApprovalSteps` keeps the printed slip's order; `PassTimeline`
  renders the `return` step BELOW the recorded gate events, because material is due back only
  after it has gone out.
- **Print Pass no longer sits under the notification bell.** The record's title row reserves
  the same 76px `.page-header` and `.gb-page-head` do.
- **Value is totalled everywhere** (client): the record's item table and the fact strip both
  carry it, and only PRICED lines are added — an unpriced line contributes nothing, and a table
  where no line carries a value gets no total at all rather than a ₹0 nobody entered.
- **DATA FIX, live DB**: `RGP-20260818-0003`'s "sony" line (headphone) was **0.99 set**, issued
  before `isWholeUnit` existed. Set to **1 set, 1 returned** — the line was already fully back,
  so nothing pends on it. The pass's OTHER line (aluminium foil, 21 roll, none returned) is a
  real open obligation and was not touched, so the pass is still `partially_returned`.
- **NOT seen signed-in in a browser**: `npm run check` (1367 tests) and `npm run build` only.
  The stack card on an HOD/admin page is a fixed-light island on the house surface — exactly
  the kind of thing only a real render proves.

**Earlier (2026-08-19, ninth pass): the HOD dashboard IS the client's mock-up — a
greeting, four drillable figures, Quick Actions and the Approval Pending strip. No Alerts,
and no `GateBoard`.** Frontend only — no migration, no new RPC, and ONE query where the old
board made three.

- **The HOD no longer gets `GateBoard`.** That component is the ADMIN's board and is untouched;
  the HOD's page (`src/pages/HOD/Dashboard.tsx`) is now its own layout over
  `src/components/hod/*` and `src/lib/hodBoard.ts`. Gone with the old board: the two KPI rows,
  the movement trend, the status ring, the Return Watch, the Top Items ring, and — **known cost,
  flagged to the client** — the "Mismatches needing review" queue. `FlaggedReviewCard.tsx` is
  DELETED, so a stale reference is a build error, and `useHodBoardData` lost its flagged read,
  its items read and `useMyDepartmentNames` with them. Nothing became unreachable: the bell's
  mismatch notice still opens `/mismatch/:id`, and it is now the only route there.
- **THE ALERTS CARD IS NOT DRAWN** (client: "remove the alert part"). Its three lines restated
  the three cards beside it, each with a "View" link to the list a card's own drill now opens.
- **The four figures are `buildHodKpis`, and every one of them is drillable** (client: "KPI
  counts should be drillable… once after the drill it should stack up the list of the respective
  passes"). The WHOLE CARD is the button — a 32px figure with a two-character hit area is a
  control nobody can press — and it opens `DrillList`, the same stacked pass cards the board
  always used, in place directly underneath. Pressing the open card closes it.
  **The board's invariant survives the rewrite**: each card carries the very rows it counted on
  a `BoardDrill`, so a figure and its own list cannot disagree. No aggregate, no `count: 'exact'`.
- **TWO SCOPES SIT ON ONE ROW, exactly as the mock draws them.** Total Passes / NRGP Issued /
  RGP Issued are TODAY (`created_at` in LOCAL time); Pending Return, and the RGP card's
  "N pending at the gate" note, are RUNNING. The note is deliberately NOT a subset of the card
  above it — the mock's own numbers say the same (6 issued today over "7 pending at the gate").
  `is_overdue` comes off `v_gate_passes` and is never recomputed; `isWaitingAtGate` is now
  EXPORTED from `boardKpis.ts` rather than restated, so the gate queue means one thing.
- **"Pending approval" IS PERMANENTLY ZERO, and the client chose that with the gap in front of
  them.** `src/lib/hodApprovals.ts` owns the four office counts and the roll-up the KPI notes
  print. This database has no multi-level approval workflow: a raised pass goes STRAIGHT TO THE
  GATE (`status` is `pending` from the insert until `match_pass`/`flag_pass`), and
  `gatepass.approval_roles` (043) is an ORG CHART with no state — nothing waits at a level, no
  level carries a timestamp, `match_pass` never consults it, and the four signatures are wet ink
  on the A5 slip. Asked, answered "keep it exactly as drawn". The zeros live in ONE module so
  the day a real workflow lands there is one place to make them real, and
  `hodDashboardBoard.test.tsx` is the test that should fail when it does.
  **There is no "View all" link on the strip** — it would open a list of passes waiting at a
  level, and no pass ever waits at one.
- **Quick Actions is the mock's two tiles, and `/raise` now reads a type.** `RaisePass` seeds
  its initial `form.type` from `?type=NRGP|RGP` (once, as initial state — a `useEffect` resyncing
  from the URL would fight the selector), so "Raise NRGP" lands on an NRGP form. Anything else
  in the query falls back to RGP rather than seeding an illegal pass.
- **The skin is the `.gb-*` island, not the house theme.** `.gb-board` paints the white ground
  and the mock's blue/green/purple/orange; **`gb-main` rides alongside it on the same div** so
  the two HOUSE components this page still renders — `DrillList` and its pass cards — take their
  LIGHT halves instead of the shipped dark default, which is what stops a dark card landing on a
  white ground. Neither class reaches outside this subtree; every other HOD screen is untouched.
  The new CSS introduces NO new colour — every value is one of `.gb-board`'s own custom
  properties — and `src/components/hod/*` carries no hex, so `themeAudit.test.ts` stays absolute.
- **Two departures from the mock, both the usual rule.** The date chip carries no chevron: it
  implies a day picker, every figure here is today-or-running, and a control that opens nothing
  is worse than no control. The mock's own footer ("© 2025 Pass Management System") is another
  product's chrome and is not drawn.
- Pinned by a rewritten `hodDashboardBoard.test.tsx` (11): the person scope, the four figures
  against a fixture, the drill/close toggle, the five-day-old overdue pass being in the running
  figure and no today one, the two Raise hrefs, the four zeroed offices, and the absence of
  Alerts and of every old panel.
- **NOT seen signed-in in a browser**: `npm run check` (1371 tests) and `npm run build` only.

**Earlier (2026-08-19, eighth pass): the gate pass record is the client's newest
mock-up — ONE Quantity column naming its own unit, a real Serial / ID on every line, the
system's own return date and time, and the amber "items still need attention" strip. The
raise form now takes ONE return date for the whole pass and a serial per line.**

- **Quantity is ONE column** (client: "the column heading should be Quantity and under that the
  values would be 3 L or 3 kg as per the item"). The Unit, Qty Returned and Pending Qty columns
  are gone; the cell reads `3 Litre`, and under it the SECOND number the client asked for —
  `Returned 2 Litre`, plus `Pending 1 Litre` while any is still owed. **A deliberate exception to
  `quantityHeading`/`quantityCell`**: lines on one pass can be in different units and a heading
  cannot govern a column of mixed ones. `nos` is still never spelled out.
- **`serial_no` is written at last.** `raise_pass` has always read `serial_no` out of `p_items`
  (019) and a trigger upper-cases it — the client simply never sent one, which is why the column
  used to print em dashes. The raise form now has a Serial / ID field per line and the record
  prints it **on both pass types** (client). No migration.
- **The return date is the SYSTEM's.** The status cell carries `returned_at`'s date and time,
  stamped by `apply_item_returns` only when a line goes FULLY back (029) — so a partly returned
  line shows no date rather than borrowing the pass's — and a recorded return still cannot be
  undone anywhere in this app.
- **The Total row is gone; a progress line replaces it** ("3 of 5 items returned · 60%",
  `returnProgress`), and **`pendingItemCount` is back** behind the mock's amber strip: "2 items
  still need attention before this pass can be closed", whose *Review pending items* button opens
  the first line still owing — drawn for a guard alone, because nobody else may record a return.
- **An NRGP keeps its Status column ("Closed") and loses the Action one** — the 2026-08-18 call
  stands.
- **ONE return date governs the whole pass** (client: "the return date of all individual items in
  the pass should be the expected return date of the entire pass"). The per-item date input is
  gone from the raise form and **`earliestReturnDate` is deleted**: the pass-level field is the
  INPUT now, and `raise_pass` is sent that same date on `p_expected_return_date` AND on every
  element of `p_items`. `gate_passes.expected_return_date` never moved — it is still what
  `v_gate_passes` grades `is_overdue` / `due_state` from. The Material Items grid is one template
  again (no `showReturnDate` variant): **Item Name · Description · Serial / ID · Purpose · Qty ·
  Unit · Value (₹)**. The printed slip states the deadline once instead of listing it per line,
  and `useReraisePass` copies the PASS's date (blanked when it has already passed) plus each
  line's serial.
- Pinned by `passRecordItemsTable.test.tsx` (11) plus rewrites in `nrgpItemAction`,
  `gateConsoleSearch`, `passRecordEverywhere` and `passRecordReturns` (which gained two cases for
  the attention strip).
- **NOT seen signed-in in a browser**: `npm run check` only.

**Earlier (2026-08-19, seventh pass): a counted unit takes no fraction, a pass has ONE
timeline, and the guard's Approve OUT is at the FOOT of the record.** Frontend only — no
migration, no new RPC, no query change.

- **`isWholeUnit` in `src/lib/units.ts` is the one place a unit is judged countable**:
  `nos` · `box` · `roll` · `set` · `bag` · `drum` · `lot` are discrete objects and refuse a
  decimal; `kg` · `litre` · `metre` are measured and keep theirs. **An unknown code stays
  fractional** — a code this app does not recognise is no evidence that it is countable, and
  refusing a fraction on it would block a return with no other way to record it.
  - **Both ends enforce it, through the same function.** `checkReturnQty(text, outstanding,
    unit)` refuses 2.5 boxes at the gate, and `validateRaiseForm` refuses raising 2.5 boxes in
    the first place — a fractional issue would otherwise be a line the gate can never fully
    return. **The ceiling is checked BEFORE the fraction**, so 12.5 of 10 outstanding is told
    what it actually is instead of sending the guard away to type 13 and be refused again.
  - `wholeUnitError` names the two whole numbers either side ("Box cannot be split — enter 2 or
    3."), and drops the upper one when it would exceed the outstanding quantity.
  - **The return boxes still carry `step="any"`** and only switch `inputMode` to `numeric`:
    `step="1"` would make the BROWSER refuse the submit with its own tooltip and this app's
    message would never be reached. The raise form's Qty input DOES follow the unit
    (`min`/`step` 1 vs 0.01) — that form has always paired native attributes with its own
    errors, and the two agree because both read `isWholeUnit`.
  - Pinned by `tests/unit/wholeUnitQuantity.test.tsx` (13), including both return boxes rendered
    directly.
- **ONE TIMELINE ON A PASS** (client: "merge Activity timeline and approval timeline together
  for all passes"). `PassApprovalTimeline.tsx` and `PassRecordActivity.tsx` are gone, replaced by
  **`src/components/passview/PassTimeline.tsx`** (`data-testid="pass-timeline"`): the ladder's
  rungs in slip order, then `v_verifications`'s own events continuing the SAME rail underneath.
  **The activity reads OLDEST FIRST here** — it used to read newest first as a card of its own,
  and a shared rail that changes direction half way down cannot be read at all. `ActivityEntry`
  moved with it; `useGatePassRecord` imports it from the new file.
- **Approve OUT is at the BOTTOM of the record** (client: "for better visibility"), in its own
  `data-testid="record-actions"` bar, at full width, drawn only while `canVerifyAtGate` holds.
  It was REMOVED from the header — exactly one of it exists, because a second copy is how a
  reader presses the stale one. Print Pass and Clear stay in the header.
- **The fact strip no longer counts approvals.** "Multi-level Approval — 5 of 5 levels approved"
  is deleted and the vendor's ADDRESS takes the slot (client). `approvalProgress` lost its last
  caller and was **deleted with its tests**, per the repo's own rule; the rail states every level
  by name, which is the fact the counter was restating.
- Pinned by a new `passRecordTimelineMerge.test.tsx` (7) plus rewrites in
  `passRecordReturns.test.tsx`, `passRecordEverywhere.test.tsx`, `gateConsoleSearch.test.tsx` and
  `approvalLadder.test.ts`.
- **NOT seen signed-in in a browser**: `npm run check` and the suite only.

**Earlier (2026-08-19, sixth pass): the guard's SHELL is the mock-up's skin, so
every tab a guard opens — including the record that Approve OUT and Verify Return lead to —
is one white ground, one Inter ladder and one near-black ink. The type went up a rung, the
approval ladder reads APPROVED for a guard, and the record's explanatory strip is gone.**
Frontend only — no migration, no new RPC, no query change.

- **`.gb-main` is the skin, and `AppShell` puts it on `<main>` for a guard alone.** Client:
  "the approval after clicking on Approve or Verify returns the page you are showing … the
  same exact typographic colour as the dashboard's page … make all the pages in the guard's
  view the same across all the tabs and everywhere." Putting it on the SHELL rather than on
  each page is the whole point — Search Pass, Verify, Overdue Items, Returns Due Today and
  `/pass/:id` inherit it without knowing it exists. The three mock-up screens keep their own
  `.gb-board`, which sits inside it and repaints the same ground.
- **A LIGHT ISLAND TAKES THREE MECHANISMS, and all three are load-bearing.** (1) `.gb-main`
  re-declares the neutral ramp (`--c-navy-*`, `--c-surface-*`, the status tints, `--glass-bg`)
  to its LIGHT values, so `text-navy-700` / `bg-surface-50` stop inverting under `.dark` —
  the shipped default. (2) A `dark:` utility is a literal class no var can reach, so
  `tailwind.config.ts`'s `darkMode` is now
  `['variant', '&:where(.dark, .dark *):not(:where(.gb-main, .gb-main *))']` — the same
  zero-specificity shape Tailwind v4 ships, so a `dark:` utility still beats its light pair
  everywhere else by SOURCE ORDER (verified in `dist`: the dark utilities emit at ~90k, the
  base ones from ~8k). (3) index.css's twenty hand-written `.dark X` rules — the input, the
  secondary button, the card, the modal, the skeleton — are plain CSS that neither of the
  first two touches, so each carries the same `:not(:where(.gb-main, .gb-main *))` tail.
  Without (3), Print Pass on the guard's record renders white-on-white.
  `designSystem.test.ts` fails on a new `.dark` rule that forgets the tail.
- **The heading ladder is restated in Inter ink inside the skin** (`.gb-main .page-title` and
  the other four rungs), the house table takes the mock's grey title-case column heads, and
  `.card` loses its glass blur. The RUNGS are unchanged — this is family and colour, not size.
- **Every `font-size` in the `.gb-*` skin went up one rung** (client: "increase the font, all
  kinds of font, respective to the ratio by one, across all the tabs"): 10.5→11.5, 11→12,
  11.5→12.5, 12→13, 12.5→13.5, 13→14, 14→15, 15→16, 24→26, 26→28, 30→32. 51 declarations,
  bumped together so the ratios stay the mock's.
- **For a GUARD, all four approval levels read APPROVED — even a vacant office.** Client:
  "only the approved ones will be appearing in the guard's view — mark them so that they have
  been approved by those approvers." `buildApprovalSteps` and `approvalProgress` now take the
  reader's role: a guard sees `done` / "Signed on the printed pass" on all four and "5 of 5
  levels approved", because the signed A5 slip travels with the material and a pass would not
  be at the barrier without it. **An HOD or an admin still sees `unset` / "Not designated
  yet"** — they read from a desk with no paper in hand, and for them the fix is a designation.
  `gatepass.approval_roles` is still empty, and this change does not fill it.
- **The record's explanatory strip is deleted** (client: "don't put any extra words other than
  the ones I gave you"). The sentence about the four signatures being collected on paper is
  gone from `PassRecordView`; the ladder's own states say it. `.alert-info` now has no caller
  and was kept — it is one of four alert variants in the design system, not dead schema.
- **Approve OUT and Verify Return already opened `/pass/:id`** (fifth pass) and are unchanged.
  What changed is what that page LOOKS like to a guard.
- Pinned by two new cases in `appShell.test.tsx`, five in `designSystem.test.ts` (the three
  mechanisms plus the `.dark`-tail sweep), five in `approvalLadder.test.ts`, one in
  `passRecordEverywhere.test.tsx` (no explanatory strip) and a rewritten ladder block in
  `passRecordReturns.test.tsx`. `darkModeDropdown` and `passPrintDarkMode` grep index.css for
  those `.dark` rules and were widened to allow the tail.
- **NOT seen signed-in in a browser**: `npm run check` (1341 tests) and `npm run build` only.
  The three-mechanism light lock is exactly the kind of thing only a real render proves.

**Earlier (2026-08-19, fifth pass): the gate pass record IS the mock-up — a fact
strip, the material table with issued/returned/pending quantities, and the printed slip's own
APPROVAL LADDER down the right; a return is entered ON it; a returned pass is closed for good;
and the guard's Approve OUT / Verify Return open it.** One migration (**`043`, APPLIED**), no
change to the state machine.

- **Migration `043` — `gatepass.approval_roles`.** One row per office, keyed `security_head` ·
  `coo` · `ceo` · `finance_head` — the four the printed slip has always carried between the
  issuing HOD and the gate (`signatureBlocks.ts`: Issuing HOD → Security Head → COO → CEO →
  Finance HOD). Client, 2026-08-19: "just match the print slip."
  - **IT IS A LADDER, NOT A WORKFLOW.** Nothing gates anything: `match_pass` is untouched, no
    pass waits on a level, no queue exists for these offices. The signature is still the wet
    one on the A5 slip; the table only records WHO holds each office so the record can print a
    name instead of a blank box. **That is why none of the four carries a timestamp** — this
    database stamps two moments on a pass (the raise, the gate clearance) and inventing a
    third would be a fabricated audit trail on a document that leaves the building.
  - **It deliberately does NOT reuse `gatepass.ceo_approver` (039).** That row is a
    PERMISSION — its holder can whitelist a blacklisted vendor. This one is an ORG CHART.
    Folding them together would mean naming the CEO on a gate pass silently hands them the
    blacklist override that 039 exists to protect. `sqlInvariants` pins that 043 never
    mentions `ceo_approver`.
  - `role_key` is **text with a CHECK, not an enum** — a new enum value cannot be USED in the
    transaction that adds it, and `APPLY_ALL.sql` is pasted as one.
  - **Every app user may SELECT it**, on purpose: the four names are printed on the face of
    every pass that leaves the building, so a guard holding the paper already has them.
    Nobody holds INSERT/UPDATE/DELETE — `set_approval_role` / `clear_approval_role` (both
    **admin**, not super_admin, because the designation grants no access at all) are the only
    writers. Names and departments come back through `get_approval_ladder()`, SECURITY DEFINER
    because `gatepass.profile_names` carries no department and its own comment forbids adding
    one; its joins into `public.*` are LEFT, so a narrowed VMS policy degrades to a missing
    name rather than a missing office.
  - **No role restriction on the designee** — a Security Head is plausibly a `guard` account
    and a Finance HOD a `staff` one, and the designation opens nothing to sign in to.
- **`src/lib/approvalLadder.ts` builds the rail**: Raised By (HOD + department, at
  `created_at`, "Approved on raising") → Level 1–4 (office and holder as **`COO (Vikram
  Singh)`**, the client's own bracket form) → Cleared by Security / Mismatch raised at the
  gate / Security Verification pending → To Be Returned (RGP only, `blocked` and red when
  `is_overdue`) or Returned. **A vacant office is `unset`, says "Not designated yet", and does
  NOT count** — `approvalProgress` is "3 of 5 levels approved" on a pass whose COO and CEO
  seats are empty, because defaulting to 5 of 5 makes the counter meaningless.
  `src/components/passview/PassApprovalTimeline.tsx` is the rail; every state carries WORDS as
  well as a hue, for the mono print.
- **The record is rebuilt to the mock-up.** `PassRecordSummary` is a five-column fact strip
  (Gate Pass No. with a copy button · Pass Type · Purpose · Return Before · Requested By +
  department · Authorized Person's Name · Vendor / Person · Vendor Address · Request Date &
  Time · Cleared Date & Time · Multi-level Approval · Gate Exit · Vehicle No. · Contact No. ·
  Last Movement · QR). **Where the mock and this schema disagree, the schema wins**: there is
  no EMP ID (the slot carries the department), and **no gate entity** — Gate Exit is drawn
  only when a verification actually recorded a `gate_name`. **The mock's Status box is NOT
  drawn**: this app's live badge is in the title row a few pixels above, and repeating a live
  badge is how two of them end up disagreeing.
- **`PassRecordItems` is the mock's table**: `# · Item Name · Description · Unit · Qty Issued ·
  Qty Returned · Pending Qty · Value · Status · Action`, with a **Total row** summing the very
  figures printed above it. **The UNIT has its own column here** — a deliberate exception to
  `quantityHeading`/`quantityCell`, the same argument that put it back on Pending OUT: three
  quantity columns cannot share one unit named in a heading. **An NRGP draws no return columns
  at all** — it is not coming back, and a column of zeroes would describe an obligation that
  never existed. The ordinal IS the serial number (`serial_no` is write-dead).
- **A RETURN IS ENTERED ON THIS RECORD** (`PassRecordReturns` + `PassReturnBox`), over the same
  `returnDraft.ts` and the same one `apply_item_returns` call the guard's return queue uses.
  Two presses, and only the second is real: "+ Add Return" → "Confirm Return" STAGES (tinted,
  "Not recorded yet"), and the **Record N returns** bar is the commit. The box is the house
  theme, not `.gb-*` — this record renders on every role's dark surface and the guard skin has
  no `dark:` half. After the RPC the whole record is **re-read**, never patched.
- **ONCE RETURNED, NOTHING IS EDITABLE** (client). `canRecordReturns(pass, role)` restates the
  two conditions the RPC raises on — guard only, `return_status in (awaiting_return,
  partially_returned)` — so an HOD, an admin and a closed pass all get `NA`. A closed pass also
  prints the strip *"Fully returned and closed — nothing on this pass can be edited"*, because
  a table with no controls and no sentence reads as a screen that failed to load.
- **The guard's Approve OUT and Verify Return now open `/pass/:id`** (client: "clicking on
  Approve or Verify Return … it would come up like this"). The record carries its own
  **Approve OUT** button through to `/verify/:id` — still the only screen offering Match, Flag
  and Hold, and still drawn only while `canVerifyAtGate` holds. **Nothing became unreachable**:
  the return row's chevron still opens the line-by-line panel in place, so a guard clearing a
  row of trucks keeps their place in the queue. Known cost, accepted: the return can now be
  recorded from two surfaces.
- **Pending RGP Return lost its tab strip and its search bar** (client). The four status counts
  said in a strip what the Status column and the filter bar already say per row; the global
  search belongs where a guard goes looking for a pass they cannot see, and Pending OUT and the
  dashboard's Scan QR both still carry it. `filters.tab` stays at `'all'`, so
  `pendingReturnFilters.ts` is unchanged and the machinery is there if it comes back.
- **The guard's `/overdue` loses the Overdue trend AND the "Longest delay in this list" line**
  (client); the HOD's and the admin's keep both (`showTrend`, false only for a guard). **The
  escalation card stays on every role's page** — it names items to chase, which is exactly the
  guard's job.
- **Deleted with their last callers**: `pendingItemCount` and `passRecordStages` in
  `passRecordView.ts` (the stage strip became the approval ladder; the "N items still need
  attention" banner went with the mock's layout). Their cases are gone, not repointed.
- **Admin → Users carries "Gate pass approval ladder"** (`ApprovalLadderCard.tsx`): four
  selects over the whole directory, each saying "Not designated yet" until set.
- Pinned by `approvalLadder.test.ts` (17), `passRecordReturns.test.tsx` (7 — staging without an
  RPC, the exact payload, the outstanding ceiling, the HOD refusal, the closed strip, the
  ladder's vacant offices, and a ladder read that FAILS leaving the record perfectly readable),
  six new cases in `sqlInvariants.test.ts`, three in `overdueBoard.test.tsx`, and rewrites of
  `nrgpItemAction`, `pendingReturnsPage`, `gateConsoleSearch`, `passRecordEverywhere`,
  `passDetailHeader`, `pendingOutPage`, `hodReviewGateFlow` and `itemLevelReturns`.
- **NOT seen signed-in in a browser**: `npm run check` (1314 tests), `npm run build`, and the
  `verify-043.mjs` probe only.

**Earlier (2026-08-19, fourth pass): Overdue Items counts what the return queue
calls overdue, the guard's day cut is GONE, no surface says "Partial", a returned line names
its DATE, the scanner clears the page, the Quick Action tiles carry counts, and a stacked card
lists its lines priced in ₹.** Frontend only — no migration, no new RPC.

- **THE BUG: "Total overdue 0" beside a return queue showing an overdue pass.** Live data:
  `RGP-20260818-0003` is due back **18 Aug**; of its two lines, `sony` (18 Aug) came back and
  `aluminium foil` carries its OWN later date of **19 Aug**. `expectedOf` in `overdueItems.ts`
  preferred the line's date, so nothing was late and the page counted zero while the queue's
  pill said Overdue. **`expectedOf` now takes the EARLIER of the line's date and the pass's
  deadline** — a line cannot outlive the pass carrying it, so a pass the database grades
  `overdue` always yields at least one overdue line. Confirmed with the client, who chose this
  over the alternative (re-deriving the pass's Expected Back from its outstanding lines, which
  would have made the pass read *Due Today* and left the count at 0). **The cost is real and
  accepted**: a pass whose earliest line is late drags its later lines into the backlog too.
- **The guard's `/overdue` day cut is DELETED, not flagged off.** `scopeOverdue`, the
  `OverdueScope` union and `OverdueBoard`'s `scope` prop no longer exist, so a stale reference
  is a compile error. It showed a guard only `daysLate === 1`, which meant the same "0 overdue"
  reading returned the following morning for the very row above. All three roles now see the
  whole backlog; who sees which PASSES is still the page's business (RLS + `raised_by`).
- **No surface says "Partial"** (client). `PASS_RETURN_LABELS.partial`, `LINE_STATE_LABELS.partial`
  and `ReturnLegend` all read **"Partially Returned"**, and `lineStateLabel` composes from the
  map, so the line cell is "Partially Returned (250 Kg Pending)". The tab was already "Returned
  Partially" and is unchanged.
- **`lateNote` counts the day instead of naming it**: `(1 Day Overdue)`, never `(Yesterday)`
  (client). The column answers "how late"; a word answering "when" made the reader convert.
- **A returned line names the DATE it came back** (client) — `Returned 17 Aug 2026`, under the
  status badge on BOTH the record view (`PassRecordItems`) and the guard's return panel
  (`PendingReturnItems`). `returned_at` is stamped only when a line is FULLY back (029), so a
  partly-returned line deliberately carries no date rather than borrowing the pass's.
- **The three-dot kebab is gone from the return row** (client), and `.gb-kebab` with it. It
  linked to `/pass/:id`, which the pass number in the same row already does.
- **Opening the scanner CLEARS the guard list pages** (client). `useGuardSearch` exposes
  `scanning`; while it is true both pages drop the tab strip, the filter bar and the table,
  leaving the header, the search bar and the viewfinder. Whatever the scan resolves to appears
  underneath it, so the list was only pushing the answer off screen.
- **The Quick Action tiles carry a count** (client): Returns Due Today and Overdue Returns each
  print `N items` under their note; Scan QR prints none. **The figures count LINES, because both
  destinations are line-level tables** — the board's invariant, so `useGuardQueues` gained
  `openItems`, ONE extra `v_gate_pass_items` read narrowed by the pass ids already fetched, and
  **only on scope `'both'`** (the dashboard). The two list pages still load a row's lines on
  demand. The dashboard builds each figure with the page's own function — `buildScheduledReturns`
  over `due_state === 'due_today'` passes, `buildOverdueRows` over every open return.
- **A stacked card now lists its material lines, numbered and priced in ₹**
  (`src/components/PassItemLines.tsx`, rendered by `PassRowBody`) — **both DELETED on
  2026-08-19 with the card disclosure; see the latest change**. `usePassItems` fetches on
  disclosure, so a collapsed list makes no queries. **The ordinal IS the serial number** —
  `serial_no` is write-dead, and a column of em dashes says less than the line's position. An
  unpriced line is an empty cell, never `₹0`. PassRowBody's old header comment saying per-item
  value was out of reach here is corrected — it fetches now.
- Pinned by rewritten `overdueItems.test.ts` / `overdueBoard.test.tsx` (the `scopeOverdue`
  block became three cases on the earlier-of-two-dates rule), `returnDraft.test.ts`,
  `pendingReturnsPage.test.tsx` (+ a no-kebab case), `itemLevelReturns.test.tsx` (+ the returned
  date), `guardDashboard.test.tsx` (+ two tile-count cases, and its mock now serves
  `v_gate_pass_items`), `pendingOutPage.test.tsx` (+ two scanner cases, with `QrScanner` stubbed)
  and a new `stackedCardItemLines.test.tsx` (4).
- **NOT seen signed-in in a browser**: `npm run check` (1281 tests) and `npm run build` only.

**Earlier (2026-08-19, third pass): the guard's two lists are PAGES, the dashboard's
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
  is what `PassRowBody` (every opened card) uses. **`PassRowBody` and `stackedCards.test.tsx`
  are DELETED (2026-08-19, tenth pass) — the stack is `PassStackCard` now, and it does not
  expand at all. The numbering rule survives, re-pinned by `passStackCard.test.tsx`.**
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

- **`/overdue` — Overdue Items, one component, three scopes.** *(The guard's day cut was
  deleted on 2026-08-19 — every role now sees the whole backlog. Everything else here stands.)*
  `src/components/overdue/`
  (`OverdueBoard` + `OverdueStats` + `OverdueFilters` + `OverdueTable` + `OverdueTrendPanel`),
  data in `src/lib/overdueItems.ts`, loaded by `src/lib/useOpenReturns.ts`, rendered by
  `src/pages/Shared/OverdueItemsPage.tsx` which decides scope from the role:
  **guard = all time, site-wide**, **HOD = all time, own passes**
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

- **The HOD's "Mismatches needing review" queue is GONE** (2026-08-19, with the old board). The
  bell's mismatch notice is now the only route to `/mismatch/:id`. Accepted with the client, who
  asked for the dashboard to be their mock-up exactly.
- **`src/lib/notifications.tsx` is 386 lines**, over the 300-line cap. It was already 347 before
  the rejection notice was added to it; the honest fix is extracting the mount-time derivation
  into its own hook.
- **The admin lost the overdue DEPARTMENT CHART and the 7-day TREND** when `/overdue` became one
  screen for all three roles (2026-08-19). Accepted with the client, who asked for the guard's
  screen everywhere; the admin dashboard's own department chart is untouched.

- **⚠ `touch_updated_at` (001/008/010) pins `new.expires_at := old.expires_at` on EVERY
  update**, so `hod_review_flagged_pass(approve)`'s refresh of `expires_at` (035) **cannot
  take effect**. 035's live probe passed only because it overrode a pass raised the same day.
  An override of a pass raised YESTERDAY keeps yesterday's expiry and the gate still refuses
  it. Fix: let the trigger keep `expires_at` unless an RPC is deliberately moving it.
- **`UsersTab.tsx` is 478 lines**, over the 300-line cap (pre-existing). The honest fix is
  extracting the Add-User and Edit-User modals.
- **A return can be recorded from TWO surfaces** (2026-08-19): the guard's Pending RGP Return
  row panel, and the pass record itself. Both go through the same `returnDraft.ts` and the same
  single `apply_item_returns` call, so they cannot disagree about a quantity — but they are two
  places to change when the rules move. Accepted with the client, who asked for both.
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
(PassDetail, PassPrint, Profile). `src/components/passview/` is the Gate Pass Details record — the ONE record format, drawn to the client's mock-up and carrying the approval ladder and the line-by-line return entry,
rendered both by Search Pass and by `/pass/:id`; `src/components/overdue/` is Overdue Items and `src/components/returns/` is the
line-level returns table, each one component serving all three roles;
`src/components/guard/` is the guard's three screens — the two summary cards, the quick actions,
the two list tables and the chrome the list pages share (header, toolbar, filter bar, pager,
`useGuardSearch`, `ApproveOutAction`); `src/components/PassStackCard.tsx` + `PassStack.tsx` are THE stacked pass card, drawn the guard's way for every role and linking to `/pass/:id` (the HOD/admin drills and My Passes render it; `DrillPassCard`, `MyPassCard`, `PassRowBody` and `PassItemLines` are deleted); `src/components/hod/` is the HOD's dashboard — the four drillable figures, the two Raise tiles and the Approval Pending strip, drawn to the client's mock-up in the `.gb-*` skin; `src/components/admin/` is the ADMIN's dashboard — the Overview mock-up's five figures, the Gate Pass Trend and the Passes by Status ring, over `src/lib/adminOverview.ts` (`src/components/board/`, `src/components/charts/` and `GateBoard` are DELETED). `src/lib/` holds the
lookup maps, derivations and formatters; `supabase/migrations/` runs `001` → `043`, with
`005` an **optional demo seed** to skip in a real deployment.

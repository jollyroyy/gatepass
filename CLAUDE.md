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

Full gate: **1053 tests across 98 files** (`npm run check`), `npm run build` clean.
Migrations **`001`–`041` are all applied to the live DB**; `039`, `040`, `041` were each
verified behaviourally with real anon-key JWTs (`scripts/verify-0NN.mjs`).

| Thing | State |
|---|---|
| `gatepass.gate_passes` | **45 rows** — real user data. **Not a scratch DB; do not wipe it.** |
| `public.departments` | **12 rows** (VMS-owned, shared) — do not wipe |
| Demo accounts | all `auth.users` share password `demo123`, all email-confirmed; shared with VMS |
| Deployment | Vercel SPA; env = `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only |

**Latest change (2026-08-18, second pass): the admin dashboard was cut down and the two
category rows made to mirror each other.** Frontend only — no migration, no RPC.

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
- **The Quick Summary row and the outstanding ranking are gone from BOTH boards** — deleted,
  not flagged off. `src/components/board/BoardOutstanding.tsx`, `src/components/charts/BarList.tsx`,
  `boardAnalytics.departmentSlices` and the five summary KPIs (`totalRaised`, `totalCleared`,
  `pendingApprovals`, `overdueReturns`, `materialOutside`) with `SUMMARY_SECTION` no longer
  exist, so neither panel can come back by flipping a prop. `GateBoard` lost `outstandingMode`
  and `showSummary`; Return Watch is now 8/12 and Top Items 4/12. Nothing is lost that has no
  other home: every summary tile restated one of the two category rows, and Return Watch breaks
  the same open obligations down by how late they are.

**Previous change (2026-08-18): the gate can search by the mobile number of the person who
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
MismatchReview, ExpiredReview), `Security/` (GateConsole, GateLookup, Verify, GuardDashboard,
PendingReturns), `Admin/` (AdminPanel and its tabs, AdminDashboard, ReportsPage), `Shared/`
(PassDetail, PassPrint, Profile). `src/components/board/` is the dashboard both the admin and
the HOD get — one component, the HOD's scoped to one person server-side. `src/lib/` holds the
lookup maps, derivations and formatters; `supabase/migrations/` runs `001` → `041`, with
`005` an **optional demo seed** to skip in a real deployment.

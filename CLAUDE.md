# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Response style — STRICT, no deviation

**When work is finished, reply with the goal only.** One or two lines saying what the change
achieves. No summary of steps, no file-by-file account, no narration of reasoning, no test
transcript. Detail belongs in `docs/PROJECT_LOG.md`, not in the reply. (User's standing
instruction, 2026-08-17.) Still say it plainly if something failed, was skipped, or is unverified — a
faithful outcome is not "detail". Answers to direct questions are unaffected.

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

npm run e2e            # Playwright, headless, against the REAL project
npm run e2e:seed       # provision the @e2e.local cast (idempotent; global setup runs it)
npm run e2e:restore    # give the four approval offices back to their pre-campaign holders
npm run e2e:report     # open the last HTML report
```

**`npm run lint` is a no-op — never trust it.** It runs bare `tsc --noEmit`, which picks up
the root `tsconfig.json` (project references not followed without `--build`), so it
type-checks zero files and always exits 0. Use `npm run check`.
`npx vitest run path/to/one.test.tsx` runs a single spec.

**After editing any file in `supabase/migrations/`, run `npm run build:sql`.** `APPLY_ALL.sql`
is the artifact a human pastes; a migration edited but not re-concatenated never reaches the
database. `tests/security/applyAllIntegrity.test.ts` is the backstop.

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
fallback. **Never authorize off `user_metadata`** — users can write it. Accounts must be
created with `app_metadata.role` set or RLS cannot authorize them. `ASSIGNABLE_ROLES`
(guard/hod) mirrors the server: the portal cannot write `staff`.

**Active/inactive is a STATUS, not a role** (migration `040`). `gatepass.user_status` holds
it; an absent row means active. `app_role()` returns null AND `my_department_ids()` returns
nothing for a suspended person — both load-bearing, because `gate_passes_select` admits
`department_id in (select my_department_ids())` without ever reading `app_role()`.
`is_user_active()` calls nothing (an `is_admin()` inside it would recurse through its own
policy). Deactivation keeps the role and department assignment and deletes every
`auth.sessions` row.

**Super admin is a FALLBACK, held by the COO and the CEO** (migration `067`). There is no standing
super admin account — the one that existed was stripped and suspended on 2026-08-24.
`is_super_admin()` = the VMS role **or** the sitting COO/CEO holder (not a delegate),
and it is deliberately **not** `is_admin()`: it grants `emergency_release_pass` and nothing else, so
those two keep approver routes only. An office holder may release only a **stuck** pass —
`pass_is_stuck()`, meaning pending, still owing a signature, and on its current rung longer than
`app_settings.coo_escalation_hours` (063's window, reused so "waited too long" is defined once). The
one softening of `061`: `gate_passes_select` / `gate_pass_items_select` carry
`holds_fallback_office() and pass_is_stuck(id)` so the power has a reachable subject.
`pass_routed_to_me` is NOT where that arm goes — its name states 061's rule.

**The COO and the CEO delegate only to each other** (`067`), because 063 put them on ONE level that
takes ONE signature. Every other office delegates only to an active HOD holding no seat (`066`).
`approval_office_pair()` is the rule; the one-seat refusal is skipped for that pair alone, and only
because covering a shared rung cannot put two signatures on one pass.

**An approval office replaces a role's routes, not adds to them** (`officeReplacesRole` in
`roleRoutes.ts`): an office holder gets `APPROVER_ROUTES` only — "Pending for My Approval" and
"Delegation" — never their VMS role's screens. Admin/super_admin are exempt (an admin who lost
`/admin` to a designation would be locked out of the only screen that can undo it). One person
holds at most one office (`049`).

## Architecture

**State transitions are RPC-only.** No client holds `UPDATE` or `DELETE` on
`gatepass.gate_passes`. `match_pass`, `flag_pass`, `mark_returned`, `apply_item_returns`,
`hod_void_expired_pass` own the whole state machine. RLS cannot
express "you may change `status` but not `visitor_name`". Route new state changes through a
new RPC; **do not add an UPDATE policy**.

**A raised gate pass is permanent** (migration `024`): no cancellation, no HOD delete. The
two ways a pass closes without moving are `flag_pass` (security stopped it at the barrier)
and `hod_void_expired_pass` (expired unused, raising-HOD only) — both re-checked
server-side, both writing a `verifications` row.

**A GATE REJECTION IS FINAL** (migration `070`; client, 2026-08-31: "once a guard rejects a
pass he has to mention the justification … then the entire pass will be cancelled and a new
pass needs to be raised"). `flag_pass` demands a written reason (035) and closes the pass
where it stands: `status` stays **`flagged`**, which is now TERMINAL. `hod_review_flagged_pass`
is dropped — there is no override, no "send it back to the gate" and nothing for the
requester to answer; `/mismatch/:id` offers only Raise It Again, and `voidSupersededPass`
voids an EXPIRED source only. `flagged` is kept rather than folded into `cancelled` so the
record can still say security stopped it and quote whose words. **`hod_reviewed` is a
HISTORICAL status**: nothing can enter it, three live passes hold it, and `match_pass` /
`flag_pass` still admit it so the gate can close them.

**Two axes, only one moves after the gate.** `status` describes the OUTWARD trip and
**freezes at `matched`**; the return leg is `return_status` (`awaiting_return` →
`partially_returned` → `returned`). Derive return stage from `return_status` alone
(`src/lib/rgpLifecycle.ts`); `passStageStyle` collapses both axes into one badge.

**An RGP closes only when every line is fully returned.** `apply_item_returns` rolls lines up
into the parent; the client never computes "all items are back". A recorded return **cannot
be undone** — `returned_qty` only increases. Do not write a `reverse_item_return`.

**The printed slip drops the CEO's box unless the CEO is signing it** (client, 2026-08-31:
"remove CEO from print pass page if he is not approving … when the COO is absent and is
unable to approve, only that time show CEO approval"). Level 3 is one rung the two share
(063), so on most passes the CEO never had anything to sign and a box headed CEO — "Not
required" or empty — read as an owed signature. `printCeoBox.ts` keeps it only when the CEO
approved/rejected it, when the COO's escalation window has run out (`withEscalation`, the
same moment `level_escalates_at` computes), or when the pass carries no COO rung at all.
**The record on screen still draws every rung** — a desk reader may see a skipped one, the
paper may not.

**`is_overdue` / `is_expired` are defined exactly once, in `gatepass.v_gate_passes`.** Never
recompute either in TypeScript. No `expired` enum label, no `pg_cron` — expiry is derived at
query time. A pass reads Expired when `status === 'pending' && is_expired`; use
`isExpiredPending()` in `src/lib/statusStyles.ts`.

**The COO and the CEO raise for ANY department** (migration `069`; client, 2026-08-31).
`raise_pass` admits an HOD for a department they head, **or** `holds_fallback_office()` — the
same sitting COO/CEO pair 067 trusts with the emergency release, reused so the pair is
defined once; a deputy or delegate is excluded. Their form is the HOD's with ONE addition, a
department selector (`PassDetailsCards`'s `departments` prop, absent for an HOD); everything
below it is one code path. `RAISING_OFFICES` / `RAISING_OFFICE_ROUTES` in `roleRoutes.ts`
grant those two offices `/raise` and `/my-passes` on top of `APPROVER_ROUTES` — `isForbidden`
and `homeFor` take the OFFICE KEY now, and a bare `true` still means "an office, unspecified"
and gets the narrow answer. They sign their own level-3 rung like anyone else (client's
explicit choice); the ladder is not special-cased. `gate_passes_select` gained
`raised_by = auth.uid()` (and items `raised_by_me()`), without which the raiser cannot see
their own pass at all — they head no department and 061 hides it until the ladder reaches
them. `/my-passes` exists for the same reason.

**One department per person** (`032`): unique index on `hod_departments(hod_id)`, mirrored
into VMS's `profiles.department_id`. A department may still host several HODs, so the HOD
board scopes by `raised_by` server-side too.

**Route access**: `src/lib/roleRoutes.ts` is the single source of truth (`ROLE_ROUTES`,
`ROLE_HOME`, `isForbidden`), enforced once in `App.tsx`; first entry of each role's list is
its landing page. UX defence in depth — **RLS is the security boundary**.

**Dashboard invariant, every board:** a KPI's number is `rows.length` of the array its click
opens, and every aggregate (`Slice`) carries the rows it counted. Never re-derive a chart's
rows from a predicate at the call site; never add a `count: 'exact'` query.

**A KPI card is a LINK, and its list is a page** (client, 2026-08-23). Every figure on every
board navigates: `/dashboard/<key>` (HOD), `/guard-dashboard/<key>` (guard),
`/admin-dashboard/<key>?days=N` (admin AND super admin — one page, because both boards are
`buildOverviewCards`), or `/overdue` for the item-level board. Nothing opens under the row
except the admin trend's bars and the status ring's arcs, which have no stable key for a URL.
A drill page RE-DERIVES its board's row from the same hook/read and renders that card's own
`drill.rows` — never router state, which a refresh or a shared link would lose. They are
sub-paths of the board they belong to, so `ROLE_ROUTES` already admits the right role and no
sidebar tab exists for them; `DrillPageShell` is the shared frame.

**The guard's return queue is counted in ITEMS** (client, 2026-08-24). "Pending RGP Return
(Needs Verification)" is `returnLinesOf(openReturns, items).length` — the MATERIAL LINES of the
passes the database grades `due_today`, `partially_returned` ones included — and drilling it
opens `ScheduledReturns`, the line-level list those very rows build. It counted PASSES while the
"Returns Due Today" Quick Action counted the LINES of the same passes, so one queue read as "4"
beside "2". That tile is gone; `/returns` survives as a route for the HOD and the admin only.
The pass-level return panel (`PendingReturnsPanel` and its row/filter/legend files) went with it.

**Search is three branches, not two** (client, 2026-08-24). `isPassCodeQuery` is a SHAPE test —
a whole pass number, a pass id, a QR URL — and only those reach `lookup_pass`. Digits alone are
a phone. EVERYTHING ELSE IS FREE TEXT (`searchPassesByText`): pass number, visitor, vendor blob,
`raised_by_name`, material summary, vehicle and purpose on `v_gate_passes`, UNIONED with name,
description, `make_model`, `invoice_no` (the "order number") and `serial_no` on
`v_gate_pass_items` — the line columns are NOT in `material_summary`, which is
`string_agg(i.name)`. Sanitize every term (`sanitizeTerm`): a comma or a bracket in a vendor name
is PostgREST `or=()` grammar and 400s the request. A multi-pass answer is `SearchMatches` — the
one stacked `PassStack` format — and each card carries the action the guard's drilled KPI list
would offer it: Approve OUT (`canVerifyAtGate`), else Record Return, else View pass.

**Neither pending desk is a card** (client, 2026-08-23). `pendingNotes(rows)` prints
"Pending gate approval" / "Pending approval" as two sub-lines under EACH pass-type card, over
that type's rows only, on every board. The figure above them is windowed; the desk lines are
running.

## The pass model — two types, one direction (migration 010)

```
type      = does it come back?      RGP | NRGP
direction = which way is it going?  in  | out
```

Exactly three combinations are legal, enforced by check constraints: `RGP-out`, `RGP-in`,
`NRGP-out`. `src/lib/passTypes.ts` mirrors this in `PASS_CATEGORIES`. NRGP is outward-only.
**`pass_number` carries the DEPARTMENT, not the direction or the date** — `TYPE-DEPTCODE-NNNN`,
e.g. `RGP-IT-0001` (migration `064`; `042` dropped the direction, `064` dropped the date). The
counter is per (type, department) and runs FOR EVER rather than resetting at midnight, so
`RGP-IT-0002` is the second RGP that IT has ever raised; the four-digit pad is a MINIMUM width, so
pass 10,000 reads `RGP-IT-10000`. `gatepass.set_pass_number()` is the one definition. IGP/OGP
remain as unreachable enum labels (Postgres cannot drop one). `RaisePass` hardcodes
`p_direction: 'out'` — RGP-in passes cannot currently be created via the UI.

## SQL invariants that are easy to break silently

- **Views need `with (security_invoker = true)`** — otherwise a view runs as its owner and
  bypasses RLS entirely.
- **`SECURITY DEFINER` functions must pin `set search_path = ''`** and fully qualify every
  reference.
- **Joins to `public.*` are `LEFT JOIN` on purpose** — an inner join would make pass rows
  vanish if VMS narrows its policies; a left join degrades to a null name.
- **`pass_number` generation takes an advisory lock** — a plain `max()+1` lets concurrent
  inserts collide.
- **A new schema inherits no Supabase grants.** `002` grants `authenticated`; `007` grants
  `service_role` the narrowest set, with **no privilege at all on `gate_passes`**.
- **A new enum value cannot be USED in the transaction that adds it.** `APPLY_ALL.sql` is one
  transaction; naming a new label in a `check (…)` or `language sql` body aborts the paste.
  `plpgsql` bodies (stored as text) are safe.
- **`create or replace view` cannot absorb new base-table columns** — drop and rebuild it, and
  re-`grant select` in the same transaction. Same for a function whose return type changes.
- **Never hand-write `insert into auth.users` without `confirmation_token`,
  `recovery_token`, `email_change`, `email_change_token_new` set to `''`** — nullable, no
  default; GoTrue dies with `converting NULL to string is unsupported` (500 on sign-in,
  nothing wrong visible in Postgres).
- **`visitor_company` is not a company name** — it's `{"n":name,"a":address,"v":phone}`. Use
  `gatepass.company_name_of(text)` in SQL, `parseCompanyInfo` in TS; recognise by KEYS, never
  by truthiness.
- **Nobody holds `UPDATE`/`DELETE` on `gatepass.gate_passes`** — enforced statically by
  `tests/security/sqlInvariants.test.ts`.

### Applying migrations

- **`psql` + session pooler**: `aws-1-ap-south-1.pooler.supabase.com:5432`, user
  `postgres.oxzzeonftrmohdrancex`, `SUPABASE_DB_URL` in `.env` (git-ignored). Direct
  `db.<ref>.supabase.co` is IPv6-only and doesn't resolve here. Always
  `--single-transaction -v ON_ERROR_STOP=1 -f <file>`. **Percent-encode the password**
  (`@` → `%40`) or libpq reports a bogus DNS failure.
- **Supabase MCP server** — good for reading: catalog probes, grant audits, advisors.
- **`psql` connects as `postgres`, bypassing RLS entirely** — it can never prove RLS or an
  `is_admin()`-style guard works. Only `set local role` probes or a real anon-key JWT can.
  Verifying a security change means a `scripts/verify-0NN.mjs` run with real JWTs; clean up
  probe rows afterwards.
- **Grant drift**: toggling **Exposed schemas** in the dashboard re-runs
  `grant all … to anon, authenticated, service_role`. `009` corrects it; re-run `009` if
  anyone toggles Exposed schemas. `sqlInvariants` can't see dashboard-introduced drift.

### Diagnosing DB errors — the code tells you which layer failed

- `PGRST106 Invalid schema` → `gatepass` missing from **Exposed schemas**. Dashboard fix.
- `PGRST205` / `PGRST202` → not in PostgREST's schema cache. Does NOT prove the object is
  missing — query `pg_catalog` before concluding a migration never ran.
- `42501 permission denied for schema gatepass` → exists and exposed, role lacks a GRANT.
- `42P17 infinite recursion … relation profiles` → VMS's recursive policy; GatePass reads
  through `gatepass.my_profile()` instead (`006`).

`src/lib/errors.ts` maps SQLSTATEs, named constraints and GoTrue codes to human sentences.
**23514 is deliberately unmapped** — the constraint name is more informative than a catch-all.

## Design system — Quest Gold + Charcoal

```
Shell     #16161A sidebar — DARK IN BOTH THEMES (chrome, not content); ink #101014
Primary   brand-600  #C6A15B brass gold   buttons, active nav, focus
Accent    accent-600 #2B3FA0 royal blue   links, secondary emphasis
Status    pending-* amber · matched-* emerald · flagged-* red · overdue-* orange
Neutral   navy-* / surface-*  warm stone   meta, borders, baselines
Display   Antic Didone (serif, ONE weight) — headings, wordmark
```

- **Saturated colour means status, never decoration.**
- **Text on gold is charcoal, never white** (~9.1:1 vs ~2.4:1).
- **Never apply `font-bold` to `font-display`** — Antic Didone is weight 400 only.
- Headings: display serif in brand gold, `font-display font-normal text-brand-800
  dark:text-brand-300`, sizes written longhand. `brand-*` are literal hex and do NOT invert —
  `text-brand-800` alone is ~1.9:1 on the shipped dark surface, so the `dark:` variant is
  required, not polish. `brand-600` is the primary FILL (under 3:1 as ink) — never a heading.
  Status colour outranks house gold. Data styled as a heading stays neutral.
- **Fixed-context surfaces (login card, `AuthField`, `QuestLockup tone="light"`, printed slip)
  must use literal colours, not `navy-*`/`surface-*` tokens** — the neutral ramp inverts under
  `.dark` (the shipped default); tokenising them renders near-white on near-white.
- `navy` is a name, not a colour — it's the warm-stone ramp. Do not rename it.
- **No chart draws in brand gold** — gold is chrome. Series are blue/violet/teal;
  `src/components/charts/chartPalette.ts` is the ONLY module allowed literal hex
  (`themeAudit` enforces by name). Status hues stay consistent between chart and badge.
- `.shell-sidebar` hardcodes dark values — never add `dark:` variants to the shell. No top
  bar; `main` carries `pt-20 lg:pt-8` for the fixed mobile hamburger.
- Printed slip is black-on-white, no colour-dependent information. Guard controls are
  oversized (one-handed use at a gate).
- **Rupee values are exact**: `formatCurrency` = `'₹' + Math.round(n).toLocaleString('en-IN')`.
  No abbreviation (`₹3.1K`).
- Logo: `src/components/QuestMark.tsx` (vector); `public/favicon.svg` repeats the geometry —
  change both together. Login background from `scripts/make-login-bg.mjs`, not hand-edited.

## Conventions

- **Max 300 lines per file**, no exceptions — extract sub-components instead.
- **No fuzzy string matching on enums** — a `Record<Enum, T>` lookup map, never `includes()`.
- **A quantity always names its unit**, `nos` included — `quantityCell(qty, unit)` in
  `src/lib/units.ts` is the one formatter, and no column heading ever carries a unit (client,
  2026-08-23: "whatever unit has been selected, you need to show all of them, no matter what").
  `sharedUnit` survives only for a Total row, which can sum one unit alone.
- **Never `window.alert`/`confirm`/`prompt`** — blocks the page, breaks automation. Use inline
  panels or `.modal-overlay`/`.modal-content`. (`window.print()` in `PassPrint` is fine and
  must stay click-triggered.)
- Every list handles loading (`.skeleton`), empty (`.empty-state`) and populated explicitly.
- **CSV exports say what the screen says** — `src/lib/csvCells.ts` formats through the same
  label maps the badges use; empty is an empty cell, never an em-dash (breaks sorting/SUM).
- **Realtime**: `postgres_changes` on `gatepass.gate_passes`; always refresh silently
  (`load(true)`) so KPIs don't flash. Write subscriptions defensively (optional chaining +
  try/catch). Channel mock pattern: `const ch: any = {}; ch.on = () => ch;` avoids TDZ.
  Realtime cannot carry expiry — a mount-time query is the only mechanism.
- **Supabase's query builder resolves to a `PromiseLike`, no `.catch()`** — `await` inside
  `try/catch`.
- **The service-role key must never get a `VITE_` prefix** (Vite inlines `VITE_*`). It appears
  only in `scripts/create-user.ts`, never under `src/`.

## Deployment

`vercel.json` holds the SPA rewrite (deep links like `/pass/<uuid>` would 404 on refresh),
asset caching, `Permissions-Policy: camera=(self)`, and the CSP.

**The CSP applies ONLY in production** — Vite dev sends none, so a blocked resource works on
localhost and fails only once deployed, silently. Any new remote origin (CDN, font host, image
bucket) needs its directive added in the same commit.
`tests/security/cspAllowsSupabase.test.ts` pins every directive the app depends on.

**Password reset is admin-assisted; no self-service link.** Supabase's built-in sender is
capped at ~2 emails/hour project-wide (shared with VMS); dashboard rate limits don't lift it
(custom SMTP only). Admin resets from Admin → Users → Edit User
(`admin_reset_user_password`, which deletes every session); user is forced to choose their own
on next sign-in (`set_my_password`). `/reset-password` is the landing page for a recovery email
an admin triggers from the Supabase dashboard.

## Working on this repo

**TDD, always, in a loop.** Write the failing test first, then minimum code to pass, then
`npm run check`. A test that never failed has proven nothing. Extend
`tests/security/sqlInvariants.test.ts` / `applyAllIntegrity.test.ts` in the same commit as a
migration — they can't catch what only exists at the intersection of this app's RPC and a VMS
trigger, or anything introduced through the dashboard.

**Never leave unused schema or code in place.** Remove a table/column/type/function/policy/
grant in the same migration that retires it — an unused SECURITY DEFINER function is still
`EXECUTE`-able over PostgREST by every authenticated user. Exceptions: enum labels can't be
dropped; dropping a column used by a view requires rebuilding the view.

**Delegate low-level work to subagents on cheaper models.** Fan out mechanical work
(file/content search, boilerplate, mechanical ports/renames, config, fixtures, doc writing,
repetitive per-file edits) to parallel `sonnet`/`haiku` subagents in a single message. Keep
schema design, RLS/auth/grant decisions, debugging, code review and synthesis on the main
model. Give each subagent full context up front (it starts cold), including the two-schema
rule and the 300-line cap. Never merge a subagent's output unread; never let one make a
security call.

**Git work goes to a `sonnet` subagent** (commits, pushes, branches, tags); read-only
inspection may run directly. Always push after completing work — don't wait to be asked.
Commits are the USER's: no `Co-Authored-By`, no AI attribution anywhere.

**The e2e suite drives the REAL Supabase project, and it is not a unit test.** `tests/e2e/` is
Playwright's; `tests/unit` and `tests/security` are vitest's, and `vitest.config.ts` excludes the
former by name because both runners claim `*.spec.ts`. Read `tests/e2e/CONVENTIONS.md` before
writing a spec — it is the harness contract, and it carries the rules that keep a browser test from
damaging shared data: only the `@e2e.local` cast, only departments `E2E`/`E2E2`, a raised pass is
permanent so create the minimum, and never mutate an account the rest of the suite signs in as.
**An approval office is a singleton seat**, so seeding EVICTS the sitting holders and snapshots them
to `tests/e2e/.state/`; `scripts/e2e/ensure-ladder.mjs` re-takes a seat anything else steals
mid-run, and `npm run e2e:restore` is the way back. **Run one Playwright process at a time** — two
against one dev server and one database produce timeouts that look like app bugs.

**Keep this file current.** When you finish a chunk of work needing session handoff, log it in
`docs/PROJECT_LOG.md`, not here — this file is rules, not a journal. Say whether a claim is
verified or assumed, and which credential proved it (browser/`anon`, `service_role` and
`postgres` see different things; `postgres` bypasses every policy).

## Known landmines

- **`touch_updated_at` (001/008/010) pins `new.expires_at := old.expires_at` on every update**
  — an RPC's deliberate refresh of `expires_at` cannot take effect unless the trigger is
  changed to leave it alone when an RPC is moving it on purpose.
- **A control labelled "Require 2FA" that silently does nothing is worse than no control** —
  don't wire up a checkbox before the mechanism behind it exists.
- `gatepass.get_ceo_approver` / `set_ceo_approver` have no caller in `src/` — unreachable from
  the portal but still live over PostgREST for a super admin (see "never leave unused schema").
- No IP address, device or browser is recorded for any action. `verifications.device_info`
  exists and `match_pass`/`flag_pass` accept `p_device_info`, but nothing in `src/` sends one.
- The approval ladder keeps only CURRENT designations, not history — who held an office on a
  past date can't be reconstructed (each pass record snapshots who actually signed it).
- The camera scan path needs a secure context (`getUserMedia`) — cannot be tested over LAN
  HTTP, only localhost or HTTPS.

## Layout

**Docs live in `docs/`** — `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DEPLOYMENT.md`,
`PROJECT_LOG.md` (session history), indexed from a Mermaid-diagrammed `README.md`. Framed for
a **Mall Management Office**: material moves through the mall's service gate, HODs are
department heads (Housekeeping, Engineering/MEP, Facilities, Marketing, Retail Ops, F&B, IT),
`visitor_company` is the tenant/brand/contractor firm. Keep that vocabulary — no
"factory"/"plant"/"manufacturing".

`src/pages/` is grouped by who uses it: `HOD/` (Dashboard, DashboardDrill, RaisePass,
MismatchReview, ExpiredReview), `Security/` (GateConsole, GateLookup, Verify, GuardDashboard,
GuardDrill), `Approver/` (ApprovalQueue, ApprovalDelegation), `Shared/` (PassDetail, PassPrint,
Profile, the role-scoped return pages), `Admin/` (AdminPanel and its tabs, AdminDashboard,
DashboardDrill, ReportsPage).
`src/components/passview/` is the Gate Pass Details record, rendered both by Search Pass and
`/pass/:id`. `src/components/overdue/` and `src/components/returns/` serve all three roles.
`src/components/guard/` is the guard's one screen (summary cards, quick actions, the Pending OUT
drill panel, the shared toolbar/filter/pager, and `SearchMatches` — the stacked answer to any
query several passes match). `src/components/PassStackCard.tsx` + `PassStack.tsx` is
the one stacked pass card used everywhere. `src/components/hod/` is the HOD dashboard;
`src/components/admin/` is the admin dashboard (over `src/lib/adminOverview.ts`). `src/lib/`
holds lookup maps, derivations and formatters. `supabase/migrations/` — `005` is an optional
demo seed to skip in a real deployment.

For session-by-session history, applied-migration status, probe results and past decisions,
see `docs/PROJECT_LOG.md`.

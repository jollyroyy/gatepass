# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# GatePass — Material Gate Pass System

React 18 + TypeScript + Vite + Tailwind, on Supabase (auth, Postgres, realtime, RLS).
HODs raise material gate passes (IGP/OGP/RGP/NRGP); security verifies them at the gate
and either **Matches** or **Flags** them.

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
the root `tsconfig.json`, and that file is `{"files": [], "references": [...]}`. Project
references are not followed without `--build`, so it type-checks **zero files** and always
exits 0. It passed cleanly while `PassDetail.tsx` had a real missing-enum-key error.
Use `npm run check`.

`npx vitest run path/to/one.test.tsx` runs a single spec. **189 tests across 9 files
currently pass** (`tests/unit/`, `tests/security/`) — the "zero test specs" note that
used to live here is obsolete.

**After editing any file in `supabase/migrations/`, run `npm run build:sql`.**
`APPLY_ALL.sql` is the artifact a human actually pastes; a migration edited but not
re-concatenated is a fix that never reaches the database.
`tests/security/applyAllIntegrity.test.ts` is the backstop that catches the drift.

## Current state — verified 2026-07-27

Frontend typechecks, builds, and passes all **198 tests**. **All migrations are now applied
to the live database.** Verified by direct catalog query this session, not inferred:

| Thing | State |
|---|---|
| Supabase project | `oxzzeonftrmohdrancex` — named **VMS**, region `ap-south-1`, PG 17.6 |
| Migrations `001`–`004`, `006` | ✅ applied (`006` was applied all along — the old "NOT applied" note here was wrong, see below) |
| Migration `007` | ✅ superseded by `009`; harmless to re-run |
| Migration `008` | ✅ **applied 2026-07-27** — enums, columns, functions, index, view all verified present |
| Migration `009` | ✅ **applied 2026-07-27** — grant correction, see below |
| Migration `010` | ✅ **applied 2026-07-27** — direction column, IGP/OGP retired, HOD delete |
| Migration `011` | ✅ **applied 2026-07-27** — dropped dead `gate_passes_type_idx` |
| Migration `012` | ✅ **applied 2026-07-27** — pass integrity constraints; open-pass rule, verified live |
| `gatepass.gate_passes` | 0 rows — no production data exists yet |
| `public.departments` | ✅ 5 rows: FIN, HR, IT, SA, DEV |

**`006` was never actually missing.** The previous session concluded it was unapplied from a
`PGRST205`/`PGRST202`, but `gatepass.profile_names`, `my_profile()` and `admin_list_profiles()`
were all present in the catalog. That error means "not in PostgREST's *schema cache*", which a
stale cache produces just as readily as a missing object. **Query `pg_catalog` before
concluding a migration did not run** — a PostgREST error code cannot distinguish the two.

### The grant drift that `009` fixes — expect it to come back

Probed live *before* `009`, `gate_passes` carried `DELETE, INSERT, SELECT, UPDATE` for **all
three** of `anon`, `authenticated`, and `service_role` — flatly contradicting the documented
invariant that no client holds `UPDATE`. Cause: adding a schema to **Exposed schemas** in the
Supabase dashboard also runs `grant all on all tables in schema gatepass to anon,
authenticated, service_role`. It is a one-time blanket grant (no `pg_default_acl` entry was
left behind, so new objects are unaffected — the rebuilt `v_gate_passes` came back clean).

The app was never actually exploitable: RLS held on its own, because `gate_passes` has only
`gate_passes_select` and `gate_passes_insert` policies, both scoped to `authenticated`. No
UPDATE policy exists, so UPDATE failed for want of a policy; `anon` has no policy at all.
What was lost was a layer of defence in depth — and the remaining layer was one careless
`for all` policy away from total.

**`tests/security/sqlInvariants.test.ts` cannot catch this.** It greps migration *files*,
which were always clean. Only live verification sees dashboard-introduced drift.
**Re-run `009` if anyone toggles Exposed schemas again.**

Live permission probes after `009` (via `set local role`, so real checks apply):

| Probe | Result |
|---|---|
| `anon` → `app_role()` / `select gate_passes` / `lookup_pass()` | BLOCKED `42501 permission denied for schema gatepass` |
| `authenticated` → `UPDATE` / `DELETE` on `gate_passes` | BLOCKED `42501 permission denied for table` |

### How migrations actually get applied here — CLAUDE CAN DO THIS NOW

The old claim "Claude cannot apply migrations; only the user can" is **obsolete**. Two paths:

- **`psql` + session pooler** — this is what applied `008`/`009`. Use
  `aws-1-ap-south-1.pooler.supabase.com:5432`, user `postgres.oxzzeonftrmohdrancex`.
  The direct `db.<ref>.supabase.co` host is **IPv6-only and does not resolve** here.
  Always `--single-transaction -v ON_ERROR_STOP=1 -f <file>`. Prefer this over pasting SQL
  into a tool argument: `-f` sends the file byte-for-byte, with no transcription risk.
  `SUPABASE_DB_URL` is now set in `.env` (git-ignored) and confirmed working.
  **Percent-encode special characters in the password** — an `@` must be `%40`, or libpq
  splits the URI at the wrong `@` and reports `could not translate host name "…"`, which
  reads like DNS failure rather than a credential-format problem. This cost a round trip.
  `.gitignore` now uses `.env*` with `!.env.example`, because an exact-name rule would not
  have caught `.env.bak` or any renamed copy.
- **Supabase MCP server** (`.mcp.json`, project scope) — excellent for *reading*: catalog
  probes, grant audits, `get_advisors`. Needs no password. `apply_migration` exists but
  requires inlining the whole file into the call.

Note this connects as **`postgres`, which bypasses RLS entirely** — it can never prove RLS
works. Only `set local role` probes or a real anon/authenticated JWT can.

### RLS verified live — 2026-07-27, first ever run

`node scripts/verify-rls.mjs --mutate` → **17 passed, 0 failed, 1 informational.** Run with
real `anon`-key JWTs for a throwaway HOD and guard, so it proves RLS as the browser sees it
(unlike a `postgres` psql session, which bypasses RLS entirely).

The RPC-only state machine is now *proven*, not just designed: guard cannot PATCH
`gate_passes` (`42501`), HOD cannot PATCH their own pass after raising it (`42501`), HOD
cannot match their own pass (`Only security can verify a gate pass.`), a second match is
refused, and a matched pass reads back with a verifier name (no `42P17`).

The one INFO is expected and is not ours: VMS's `public.profiles` still throws
`42P17 infinite recursion`. GatePass is immune because it reads through
`gatepass.my_profile()` — that is exactly what `006` exists for.

`008`'s triggers verified against a real row (`NRGP-20260727-0001`, since deleted):
raised 27 Jul 13:04 IST → `expires_at` 28 Jul 23:59:59 IST, i.e. end of the *next* day in
`site_tz()`. The UTC-skew bug that motivated `site_tz()` is confirmed absent.
`qr_token` was stamped by the trigger and is unrelated to `pass_number`.

Test data was cleaned up via psql; `gate_passes` is back to **0 rows**.

### Still unverified

**`MANUAL_TEST.md` (repo root) is the walkthrough for everything below** — ordered by role,
with expected results and failure signatures. It covers the parts no automated test can
reach: real browsers, realtime across two windows, printing, and the camera.

- **The camera scan path.** No phone camera has decoded a real printed slip. This cannot be
  tested on `http://<lan-ip>` — see Deployment below.
- **Expiry refusal in practice.** `match_pass`'s expiry branch has never fired against a
  genuinely stale pass (would need a pass older than ~48h, or a hand-edited `expires_at`).
- **HOD void.** `cancel_pass` has never been called.
- **The duplicate-material index.** Never tripped by a real second insert.

`verify-rls.mjs` does not yet cover the `009`-era additions. Extending it to check that a
guard cannot call `cancel_pass`, an HOD cannot cancel another HOD's pass, a cancelled pass
cannot be matched, and an expired pass is refused by `match_pass` but still flaggable, is
the highest-value next test work.

### Gate-side features added in `008` (applied 2026-07-27)

- **Camera QR scanning.** `src/components/QrScanner.tsx` + `src/lib/qrDecode.ts`. Prefers
  the native `BarcodeDetector`, lazy-loads `jsqr` otherwise (that fallback is the whole
  iOS/Safari story — no iPhone has `BarcodeDetector`). Requires **HTTPS**; on plain HTTP
  `getUserMedia` does not exist at all, which is the most likely real-deployment failure.
  The typed pass-number field is always mounted beside it and must stay that way.
- **`qr_token`.** The QR encodes an opaque uuid, never `pass_number` — the number is
  sequential (`RGP-20260726-0001`) and a QR built from it can be forged for a pass nobody
  ever held. Printed slips still show the number for the typed fallback.
- **Expiry.** `expires_at` = end of the next day in `gatepass.site_tz()` (`Asia/Kolkata`).
  `match_pass` refuses an expired pass; **`flag_pass` deliberately does not** — refusing to
  record a real mismatch because the paperwork went stale is backwards. `is_expired` is
  defined once, in the view, exactly like `is_overdue`.
- **HOD void.** `gatepass.cancel_pass` — only the HOD who raised it, only while pending.
  Reaches the guard live for free: `gate_passes` is already in `supabase_realtime` and
  `GateConsole` subscribes with `event: '*'`. `Verify.tsx` now subscribes to its own row
  too, so a guard standing on the decision screen sees a void arrive.
- **`scan_attempts`.** Every scan including failures. `verifications` records what
  succeeded; this records what was *tried*, which is how a forged-QR probe becomes visible.
- **One pending pass per material per department**, as a partial unique index on
  normalised text. Race-safe by construction; a `select … if exists` check is not.

The Supabase **CLI is not installed at all** (not on PATH; `~/.supabase` holds only
telemetry, so it was never logged in) and the project is not linked — `supabase db push`
is not available. `psql` **is** installed (`C:\Program Files\PostgreSQL\18\bin\psql.exe`,
v18.3) and is the working path; see "How migrations actually get applied here" above.

Still outstanding: the E2E walkthrough, and the live RLS run itself.
Migration `005` is an **optional demo seed** — skip it in a real deployment.

### The pass model — two types, one direction (migration 010)

The old four types conflated two independent facts, and **OGP and NRGP meant exactly the
same thing**. Worse, inward-returnable — a contractor bringing their own tools in, which
must leave again — could not be expressed at all.

```
type      = does it come back?      RGP | NRGP
direction = which way is it going?  in  | out
```

**Exactly three combinations are legal**, and that is enforced by check constraints, not by
the dropdown: `RGP-out`, `RGP-in`, `NRGP-out`. `src/lib/passTypes.ts` mirrors this in
`PASS_CATEGORIES`, which is what the gate console filters on — a guard picks a whole
category, not two independent axes.

**NRGP is outward-only** (`gate_passes_nrgp_is_outward`). Permanently *inbound* material is
a goods receipt, not a gate pass: the gate never had custody, so the gate log must not claim
it did. If inbound deliveries ever need recording, that is a GRN feature, not a fourth type.

`pass_number` now carries direction: **`RGP-OUT-20260727-0001`**. Counters are per
(type, direction, day), which the existing advisory lock handles for free since it keys on
the whole prefix.

IGP/OGP still exist as labels in `gatepass.pass_type` — **Postgres cannot drop an enum
value**. They are made unreachable by `gate_passes_type_is_current` instead. Do not try to
"clean this up" by recreating the type; the column, view and every index would need
rebuilding for a cosmetic gain.

### HOD delete — the one delete permission in the schema

An HOD may **delete** their own pass while it is still `pending`, via an RLS policy
(`gate_passes_delete`), not an RPC. That is not an inconsistency with the RPC-only rule:
RPCs exist because RLS cannot express "you may change `status` but not `visitor_name`", a
*column*-level concern. Deletion has no columns to constrain, so a policy states the whole
rule exactly.

This was an explicit user decision, made with the costs stated: the pass number is consumed
and leaves a **permanent gap**, a printed slip becomes unscannable showing only `not_found`,
and the record of the mistake is gone. **Void remains the better path** and stays in the UI
beside it. `sqlInvariants.test.ts` allows this one grant in `010` only and still fails any
UPDATE grant, or a DELETE grant in any other file.

### Demo accounts — all set to `demo123` on 2026-07-27

**All 14 accounts** in `auth.users` share the password **`demo123`**, and all are
email-confirmed. Verified by real sign-in through the anon key that `guard@demo.vms`,
`hod.it@demo.vms`, `admin@demo.vms`, `hod.fin@demo.vms` and `staff@demo.vms` each return the
correct `app_metadata.role` in the JWT — which is what RLS authorizes off, not `profiles`.

`demo` itself is impossible: Supabase rejects anything under 6 characters with
`422 weak_password`. Lowering that minimum would weaken it for VMS too, so `demo123` was
chosen instead.

`hod.it@demo.vms` owns three departments (IT + DEV + SA) — use it to exercise the
many-to-many. `staff@demo.vms` is the one to use for testing the no-access path.

**`auth.users` is shared with VMS**, so this changed VMS's logins as well — there is only one
credential set across both apps. The separate **NoonHR** project (`ibxguyqsizpjfkhhuqrz`) was
deliberately not touched.

### Deployment — not deployed yet

There is **no hosted URL**; the app has only ever run on `localhost`. `vercel.json` was added
2026-07-27 with the SPA rewrite (`BrowserRouter` deep links like `/pass/<uuid>` would
otherwise 404 on refresh), asset caching, and `Permissions-Policy: camera=(self)` — the
camera scanner needs that header not to be restrictive.

**Camera QR scanning cannot be tested over LAN HTTP.** `getUserMedia` only exists in a secure
context: `localhost` qualifies, `http://<lan-ip>:5175` from a phone does not. Testing the
scanner on a real phone requires HTTPS — i.e. a Vercel deploy or a tunnel.

Vercel needs exactly two env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
**Never add `SUPABASE_SERVICE_ROLE_KEY`** — it is not used by any file under `src/`, and a
`VITE_`-prefixed secret is inlined into the public bundle.

### Diagnosing DB errors — the error code tells you which layer failed

Don't guess; these three look identical from the UI and have completely different fixes:

- `PGRST106 Invalid schema` → `gatepass` is missing from **Exposed schemas**. Dashboard fix.
- `PGRST205` / `PGRST202` *(table/function not in schema cache)* → the object genuinely
  **does not exist**; the migration was never applied. Paste it.
- `42501 permission denied for schema gatepass` → the object exists and is exposed, but
  **your role lacks a GRANT**. Schema `USAGE` is checked before table privileges, which is
  why this names the schema and never the table.
- `42P17 infinite recursion detected in policy for relation profiles` → VMS's recursive
  policy. Migration `006` makes GatePass immune; see `supabase/fixes/`.

## The two-schema rule — read before writing any query

This project shares one Supabase project with a separate **VMS visitor system**.

| Schema | Owner | Contents |
|---|---|---|
| `public` | **VMS — treat as read-only** | `profiles`, `departments`, `auth.users` |
| `gatepass` | this app | `gate_passes`, `verifications`, `hod_departments` |

- Query through the explicit helpers in `src/supabaseClient.ts`: **`gp()`** for the
  `gatepass` schema, **`pub()`** for `public`. There is deliberately no default-schema
  shortcut — a reader must always see which schema a query hits.
- **Never write a migration that alters anything in `public`.** New objects go in
  `gatepass` and reference `public.profiles` / `public.departments` by foreign key only.
- Creating a department writes to VMS's shared `public.departments`, so VMS sees it too.
  The admin UI says so out loud — keep that warning.

## Roles — mapped onto VMS's enum, not our own

There is no app-specific role enum. `public.user_role` is shared and owned by VMS:

| App role | `profiles.role` |
|---|---|
| Security | `guard` |
| HOD | `hod` |
| Admin | `admin` / `super_admin` |
| no access | `staff` |

Role comes from the JWT's **`app_metadata.role`** (server-writable only), with a
`profiles` fallback. Never authorize off `user_metadata` — users can write it.

Consequence to keep in mind: every existing VMS guard automatically has gate-console
access, and every VMS HOD can raise passes once assigned a department.

## Architecture

**State transitions are RPC-only.** No client holds `UPDATE` on `gatepass.gate_passes`
(migration `002` grants only `select, insert`). `match_pass`, `flag_pass`, and
`mark_returned` in migration `003` own the whole state machine. This exists because
Postgres RLS cannot express "you may change `status` but not `visitor_name`" — so column
authority lives in `security definer` functions instead. Route new state changes through
a new RPC; do not add an UPDATE policy.

**HOD→department is many-to-many** (`gatepass.hod_departments`). VMS's single
`profiles.department_id` cannot express "one HOD across 2-3 departments", and the live DB
has the opposite shape too (two HODs per department). VMS's column is untouched and
ignored here.

**`is_overdue` is defined exactly once**, in the `gatepass.v_gate_passes` view. Never
recompute it in TypeScript. Overdue is computed at query time — no `pg_cron` dependency.

**Route access**: `src/lib/roleRoutes.ts` is the single source of truth (`ROLE_ROUTES`,
`ROLE_HOME`, `isForbidden`), enforced once in `App.tsx`. Import it, never duplicate the
list. This is UX defence in depth — **RLS is the security boundary**, not this.

### SQL invariants that are easy to break silently

- **Views need `with (security_invoker = true)`.** Without it a view runs as its owner and
  bypasses RLS entirely — any HOD would read every department's passes.
- **`SECURITY DEFINER` functions must pin `set search_path = ''`** and fully qualify every
  reference; a mutable search_path is a privilege-escalation vector.
- **The view's joins to `public.*` are `LEFT JOIN` on purpose.** VMS owns those tables and
  can narrow its policies without notice; an inner join would make pass rows silently
  vanish, where a left join degrades to a null name — visibly wrong beats invisibly wrong.
- **`pass_number` generation takes an advisory lock.** A plain `max()+1` lets concurrent
  inserts collide on the unique constraint (VMS had to patch exactly this).
- **A new schema inherits no Supabase grants.** `service_role` is omnipotent over `public`
  only because Supabase granted it there at project creation; nothing propagates that to
  `gatepass`. Migration `002` grants `authenticated` and nobody else, which is why the
  service key hit `42501` and `verify-rls.mjs` could never run. Migration `007` grants
  `service_role` the narrowest set that unblocks it — and **no privilege at all on
  `gate_passes`**, so the RPC-only state machine holds even for the service key.
- **A new enum value cannot be USED in the transaction that adds it.** `alter type … add
  value` is fine inside a transaction (PG12+), but referencing the new value from anything
  Postgres evaluates at DDL time — a `check (…)` constraint, or a `language sql` function
  body — aborts with `unsafe use of new value`. Since `APPLY_ALL.sql` is pasted as **one
  transaction**, that would kill the entire paste. `plpgsql` bodies are stored as text and
  are safe. This is why `008` has no `cancelled_needs_reason` constraint and why
  `cancel_pass` is plpgsql rather than sql. `sqlInvariants.test.ts` now guards it.
- **`create or replace view` cannot absorb new base-table columns.** A view's column list
  is fixed at creation, so `select p.*` does not grow when `gate_passes` does — replacing
  it fails with "cannot change name of view column". The view must be dropped and rebuilt
  (`008` does this). Safe because `kpis()` is `$$`-quoted, so Postgres records no
  dependency on it.
- **Nobody holds `UPDATE`/`DELETE` on `gatepass.gate_passes`** — enforced statically by
  `tests/security/sqlInvariants.test.ts`, which greps every migration. The cost is real and
  accepted: `verify-rls.mjs --mutate` cannot delete the pass it raises, so it prints manual
  cleanup SQL instead. Don't "fix" that by adding the grant.

## Gotchas hit in practice

- **Supabase's query builder resolves to a `PromiseLike`, which has no `.catch()`.**
  `await` it inside `try/catch`; chaining `.catch()` is a type error.
- **Realtime**: `postgres_changes` on `gatepass.gate_passes`. Always refresh silently
  (`load(silent = true)`) so KPIs don't flash. Write subscriptions defensively (optional
  chaining + try/catch) so a partially-mocked client in tests can't throw. Channel mock
  pattern: `const ch: any = {}; ch.on = () => ch;` avoids a TDZ error.
- **The service-role key must never get a `VITE_` prefix** — Vite inlines `VITE_*` into
  the bundle. It appears only in `scripts/create-user.ts`, never under `src/`.
- Accounts must be created with `app_metadata.role` set, or RLS cannot authorize them.

## Conventions

- **Max 300 lines per file**, no exceptions — extract sub-components instead. Several
  files sit near the cap (`RaisePass` 291, `GateConsole` 286, `DepartmentsTab` 285).
- **No fuzzy string matching on enums** — use a `Record<Enum, T>` lookup map, never an
  `includes()` chain. See `src/lib/statusStyles.ts`, `src/lib/passTypes.ts`.
- **Never `window.alert` / `confirm` / `prompt`** — they block the page and break
  automation. Use inline panels or `.modal-overlay` / `.modal-content`.
  (`window.print()` in `PassPrint.tsx` is fine, and must stay click-triggered, not on mount.)
- Every list handles loading (`.skeleton`), empty (`.empty-state`), and populated explicitly.

## Working on this repo

### TDD, always, in a loop

**Write the failing test first, then the minimum code to pass it, then verify.** Every
feature, no exceptions. Loop until green — do not batch up a large change and test at the
end, because then a failure tells you only that *something* in the batch broke.

The order is: name the goal → write the test that would prove it → watch it fail for the
right reason → write the smallest code that passes → `npm run check` → repeat. A test that
has never failed has proven nothing; if it passes the moment you write it, it is testing
the wrong thing.

This applies to SQL too. `tests/security/sqlInvariants.test.ts` and
`applyAllIntegrity.test.ts` are how a migration gets tested without a database — extend
them in the same commit as the migration, never afterwards.

### Never leave unused schema in place

**If a table, column, type, function, policy or grant is not needed, remove it** — do not
leave it "in case". Every unused object is attack surface that nobody is reviewing: an
orphan column still gets selected by `p.*` into the view, an unused function is still
`EXECUTE`-able over PostgREST, and a stale grant still applies the day someone adds a
policy. Audit after every feature that changes the data model, and drop what the feature
retired in the same migration that retired it.

Two hard exceptions, both Postgres limitations rather than choices:
- **Enum labels cannot be dropped.** `IGP`/`OGP` still exist in `gatepass.pass_type` and are
  made unreachable by the `gate_passes_type_is_current` check constraint instead (`010`).
- **Dropping a column used by a view** requires rebuilding the view (TRAP 2).

### Always delegate low-level work to subagents on cheaper models

Fan mechanical work out to **parallel subagents on `sonnet`** (or `haiku` for the most
rote work), launched in a **single message** so they run concurrently. Don't do this work
serially on the main model.

**Delegate:** file/content searches, fact-gathering, boilerplate and scaffolding,
mechanical ports and renames, config files, test fixtures, doc and comment writing,
repetitive per-file edits that follow a pattern already established.

**Keep on the main model:** schema design, RLS/auth/grant decisions, debugging, code
review, trade-off calls, and synthesis of whatever the subagents return.

**Git work always goes to a `sonnet` subagent.** Commits, pushes, branch and remote setup,
tags — spawn an agent with `model: "sonnet"` rather than running the mutation on the main
model. Give it the repo path, remote URL, branch, commit message, and anything that must
NOT be committed, since it starts cold. Read-only inspection (`git status`, `git log`,
`git remote -v`) may still be run directly when the answer decides what to do next.
User instruction, 2026-07-27.

Give each subagent full context up front — it starts cold — including exact file paths,
the pattern to copy, and the decisions already made, so it never re-derives them. In this
repo that means telling it about the two-schema rule and the 300-line cap explicitly.
**Never merge a subagent's output unread**, and never let one make a security call.

### Keep this file current — it is the session handoff

When you finish a chunk of work, update **Current state** above: what is applied, what is
merely written, and what the single next action is. Note whether a claim is *verified* or
*assumed*, and say which credential proved it (browser/`anon`, `service_role`, or
`postgres` — they see different things, and `postgres` bypasses every policy, so it can
never prove RLS works). Delete lines that have gone stale rather than appending to them;
the "zero test specs" line survived three sessions past being false.

## Design system — Slate + Cyan Ops

Seven colours, and **saturated colour means status, never decoration**.

```
Shell     #0F172A sidebar / top strip — DARK IN BOTH THEMES (chrome, not content)
Primary   brand-600  #0891B2 cyan     buttons, active nav, focus
Accent    accent-600 #4F46E5 indigo   links, secondary emphasis
Status    pending-*  amber   matched-* emerald   flagged-* red   overdue-* orange
Neutral   navy-* / surface-*  slate    meta, borders, baselines
```

- Token *names* match VMS (`brand`/`accent`/`navy`/`surface`) so layout code ported from
  there works unchanged; only the hues differ.
- `.shell-sidebar` hardcodes dark values — never add `dark:` variants to the shell.
  **There is no top bar.** `.shell-topbar` and the `<header>` in `AppShell.tsx` were removed
  2026-07-27: it was a permanently empty dark band, since breadcrumbs never landed there and
  identity lives in `SidebarProfile` by design. `main` carries `pt-20 lg:pt-8` to replace the
  clearance the 64px header gave the fixed mobile hamburger (`Sidebar.tsx:217`). Do not
  reintroduce the strip without content to put in it.
- The printed slip (`PassPrint.tsx`) is black-on-white with **no colour-dependent
  information**; it must read on a cheap mono laser printer.
- Guard controls are deliberately oversized (`.btn-match`, `.btn-flag`) — someone uses
  these standing at a gate, one-handed, with a truck waiting.

## Layout

**Docs live in `docs/`** — `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DEPLOYMENT.md`,
indexed from `README.md`. They are framed for a **Mall Management Office**: material moves
through the mall's service gate / loading bay, HODs are Mall Management Office department
heads (Housekeeping, Engineering/MEP, Facilities, Marketing & Events, Retail Ops, F&B, IT),
and `visitor_company` is the tenant, brand, or contractor firm. Keep that vocabulary — no
"factory"/"plant"/"manufacturing".

`src/pages/` is grouped by who uses it: `HOD/` (Dashboard, RaisePass, MyPasses),
`Security/` (GateConsole, Verify, PendingReturns, History), `Admin/` (AdminPanel and its
tabs, AllPasses), `Shared/` (PassDetail, PassPrint). `src/lib/` holds the lookup maps and
formatters; `supabase/migrations/` is `001` schema → `002` RLS → `003` RPCs → `004` views
→ `005` optional seed.

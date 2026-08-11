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

`npx vitest run path/to/one.test.tsx` runs a single spec. **551 tests across 43 files
currently pass** (`tests/unit/`, `tests/security/`) — see "Current state" below for the
authoritative gate run.

**After editing any file in `supabase/migrations/`, run `npm run build:sql`.**
`APPLY_ALL.sql` is the artifact a human actually pastes; a migration edited but not
re-concatenated is a fix that never reaches the database.
`tests/security/applyAllIntegrity.test.ts` is the backstop that catches the drift.

## Current state — verified 2026-08-08

Frontend typechecks and passes the full suite — verified by a real `npm run check` run on
2026-08-08 (**551 tests across 43 files**). **All migrations through `035` are applied to
the live database**; `026`–`035` were written and applied 2026-08-08, `029` verified live
with real anon-key JWTs (13/13 behavioural checks, see below).

| Thing | State |
|---|---|
| Supabase project | `oxzzeonftrmohdrancex` — named **VMS**, region `ap-south-1`, PG 17.6 |
| Migrations `001`–`004`, `006` | ✅ applied (`006` was applied all along — see note below) |
| Migration `007` | ✅ superseded by `009`; harmless to re-run |
| Migration `008` | ✅ **applied 2026-07-27** — enums, columns, functions, index, view |
| Migration `009` | ✅ **applied 2026-07-27** — grant correction |
| Migration `010` | ✅ **applied 2026-07-27** — direction column, IGP/OGP retired, HOD delete |
| Migration `011` | ✅ **applied 2026-07-27** — dropped dead `gate_passes_type_idx` |
| Migration `012` | ✅ **applied 2026-07-27** — pass integrity constraints |
| Migration `013`–`016` | ✅ **applied 2026-07-27** — gate items, verification detail, HOD review, KPIs/aging/vendor/blacklist/bulk |
| Migration `017` | ✅ **applied 2026-07-27** — RGP-in constraint fix (`rgp_needs_return_date` dropped, `gate_passes_return_date_required` with direction-aware check) |
| Migrations `018`–`022` | ✅ applied — image/category, per-item fields, bulk-create index fix, admin user + department management RPCs |
| Migration `023` | ✅ **applied 2026-07-30** — fixes `admin_create_user` false "already exists" (see below) |
| Migration `024` | ✅ **applied 2026-08-04** — **cancellation removed entirely** (see below): `cancel_pass` dropped, HOD delete revoked, flagged-review `reject` removed, `cancel_reason` column dropped |
| Migration `025` | ✅ **applied 2026-08-04** — **self-service profile** (see below): `my_profile()` gains `avatar_url` (drop+recreate), plus `update_my_name(text)` / `set_my_avatar(text)` |
| Migration `026` | ✅ **applied + verified live 2026-08-08** — HOD override was 100% broken; `flag_reason` now survives it (see below) |
| Migration `027` | ✅ **applied + verified live 2026-08-08** — blacklist actually enforced (trigger), HOD final rejection (see below) |
| Migration `028` | ✅ **applied + verified live 2026-08-08** — same-day expiry; `lookup_pass` blacklist JSON fix (see below) |
| Migration `029` | ✅ **applied + verified live 2026-08-08** — per-item return timestamps; `gate_pass_items.returned_at` (see below) |
| Migration `030` | ✅ **applied 2026-08-08** — dropped `returnable_aging()`, whose only screen was removed |
| Migration `031` | ✅ **applied + verified live 2026-08-08** — RLS + SELECT grants for `blacklist`/`vendor_profiles`, `lookup_pass` return renamed `blacklist_match`, dead code dropped (see below) |
| Migration `032` | ✅ **applied + verified live 2026-08-08** — **one department per person** (see below): unique index on `hod_departments(hod_id)`, admin RPCs refuse >1 and mirror into `profiles.department_id` |
| Migration `034` | ✅ **applied + verified live 2026-08-08** — **admin-created users can finally sign in** (see below): NULL GoTrue token columns backfilled (7 rows) and `admin_create_user` fixed |
| Migration `033` | ✅ **applied + verified live 2026-08-08** — **blacklist + vehicle format hardened** (see below): strict Indian vehicle-format CHECK, blacklist form strictness, `parseCompanyInfo` packed-keys fix |
| Migration `035` | ✅ **applied + verified live 2026-08-08** — **HOD override = fresh pass** (see below): override refreshes `expires_at` to end of day, `flag_pass` admits `hod_reviewed`, view carries `flagged_at` / `hod_reviewed_at` |
| Migration `036` | ✅ **applied + verified live 2026-08-10** — **admin-assisted password reset** (see below): `admin_reset_user_password`, `set_my_password`, `my_profile()` carries `must_change_password`. **Requires VMS `064` first** |
| `gatepass.gate_passes` | ~10 rows — real user data as of 2026-08-08. **Not a scratch database any more; do not wipe it.** |
| `public.departments` | ✅ **12 rows** (verified live 2026-08-10): FIN, DEV, HT, HR, IT, IS, MR, OPS, SA, OFT, TH, VLG. Real data — do not wipe. |

### Guard dashboard trimmed to what still needs a guard (2026-08-11, frontend only)

Two KPI drills removed from `src/lib/guardDrills.ts` at the client's request — the board is
a shift console, and both counters only ever went up when the gate had already finished
with the pass. **Neither removal loses a pass**, and the reasons differ:

- **"Successful Gate Passes"** (`matched`, sourced from `verifiedToday`). Reports
  (`/all-passes`) still holds every matched pass of any date, and a *returnable* pass that
  came back is still on this board under **Returned & Closed** (`closed`). Consequence
  worth knowing: an **NRGP never comes back, so once matched it now appears in no drill on
  this board at all.** That is intended — it is done — but the guard's board no longer
  shows a same-shift count of everything cleared. If that is ever missed, the fix is a
  Today/All-time toggle in Reports, not this card.
- **"HOD Approved"** (`hod_reviewed`). This one is redundant rather than expendable, and
  the distinction matters: the drill was originally added to close a real hole — for two
  months an override moved a pass `flagged → hod_reviewed` and every guard surface then
  refused to act on it (queue filtered `pending` only, Verify hid Match), so a truck the
  HOD had approved could not be cleared. **That hole is closed at its source**:
  `GateConsole`'s queue selects `.in('status', ['pending','hod_reviewed'])` (035) and
  Verify offers both Match and Flag. `tests/unit/hodReviewGateFlow.test.tsx` pins both of
  those AND now pins the drill's absence — so narrowing the queue back to `pending` alone
  fails that spec rather than silently recreating the original bug with no card left to
  reveal it.

`DrillKey`, `DRILL_DEFS` and `DRILL_ORDER` all shrank accordingly; the `verifiedToday`
query stays (`flagged` and `closed` still read it). Full gate: **789 tests across 73
files** (`npm run check`, 2026-08-11).

### One badge per pass — the latest state only (2026-08-11, frontend only)

Client, same day, on the two-pill card the section below introduced: *"Only show
what is the latest status. Maybe it is matched but it has gone out, so you don't have to
show the match in the main card section — do show it when people look at more details, in
that timeline. If the passes are closed, completely returned, just put it Closed. Don't
show matched returned."* And on the detail page: *"the things which have already been
returned and closed, when I'm clicking on the card to see more details, on the top it is
still showing them as matched."*

Two new modules, both presentation-only — no query, no column, no migration:

- **`src/lib/passStage.ts`** — `passStageStyle()` collapses the status badge and the RGP
  stage pill into ONE. Precedence: **expired-pending → attention → RGP stage → status**.
  The *attention* tier (`OUTRANKS_RETURN_LOOP`, a `Record<PassStatus, boolean>`) is
  `flagged` / `held` / `cancelled`, and it is deliberately ABOVE the return loop even
  though the combination is unreachable today — `flag_pass` admits only pending / held /
  hod_reviewed, so nothing can flag a pass already cleared out. **This pre-wires the
  return-leg flag** the client asked for (see "Next" below): when a guard can stop a pass
  coming back IN, it must read "Mismatched", not "Out — Not Returned", and getting the
  order right now means that feature changes the database and the gate screen, not every
  card. `rgpLifecycle.ts` is unchanged and still owns the return-loop labels.
- **`src/lib/passTimeline.ts`** — `passTimeline()` returns the moments, oldest first:
  **Raised → Mismatch → Override → Cleared Out → Returned**. This is where the outward
  match went. Two things it fixes on the way: **Override is keyed off `hod_reviewed_at`,
  not `status === 'hod_reviewed'`**, so the moment survives the gate matching the fresh
  pass (the old cards dropped it exactly when a reader most wants it); and **Cleared Out
  reads `verified_at`**, which is safe because neither `apply_item_returns` nor
  `mark_returned` touches that column — they write a `verifications` row and move
  `return_status` instead.

`PassDetail`'s header used `STATUS_STYLES[pass.status]` directly, which is why a closed
RGP read "Matched" at the top of its own record: **`status` freezes at `matched` after the
outward trip and only `return_status` moves afterwards.** It now uses `passStageStyle`,
so a card and the page it opens can never disagree.

**`src/components/PassTimelineStrip.tsx`** extracted: `TimelineItem` had been copied
byte-for-byte into `PassRow`, `PassRowBody` and `PassRowCompact`, and the timeline had
just gone from decoration to the only legible record of the two gate events. Three copies
of that is three chances for one surface to quietly stop rendering a moment. The
extraction also brought `PassRow` back under the 300-line cap (309 → 292).

**My Passes cards rebuilt** (client: *"make it like the card format of the dashboard but
with a little less information — premium looking glass morphic design"*).
`src/pages/HOD/MyPassCard.tsx` is DrillPassCard's sibling on a `.card-glass` surface, with
three deliberate differences: **collapsed by default** (a dashboard drill answers one KPI
click; My Passes is a scrollable register, and a stack of open cards was the "too much
information" complaint); a **header subtitle** of material + value, always visible, so a
column of pass numbers is still scannable; and `slim`, a new `PassRowBody` prop that drops
Visitor / Department / Raised By / Raised At / Verified By — an HOD reading their own
register already knows those, and the raise time is in the timeline directly below.
`PassRow` gained `subtitle` and `slim` (drill variant only). `MyPassesTable`'s separate
return badge is **gone** — the single pill covers it — along with its `returnBadge` helper.

**Next, agreed with the client and NOT yet built: the return-leg mismatch.** A guard
cannot flag a pass coming back in — `flag_pass` refuses a `matched` pass — so a shortfall
at the return currently shows only as Partly Returned / Overdue. That needs a migration
plus a control on the guard's Record Returns screen. `passStageStyle`'s precedence and
`tests/unit/passStage.test.ts` ("lets a flag outrank the return loop") are already written
for it.

Full gate: **788 tests across 73 files pass** (`npm run check`, 2026-08-11). New specs:
`passStage`, `passTimeline`, `passDetailHeader`, `myPassCard`; `rgpStageBadge` and
`hodDrillCard` rewritten to pin the single-pill rule.

### The RGP return loop is now visible — and two real bugs behind it (2026-08-11, frontend only)

Client: *"once the RGP is cleared for going out it shows as matched and not cleared — it is
half matched, half not yet closed."* Correct, and **no migration was needed**: an RGP has
two axes, and only one of them was ever rendered.

`match_pass` (003) sets `status = 'matched'` **and** `return_status = 'awaiting_return'` in
the same statement — `status` describes only the OUTWARD trip and never changes again;
`apply_item_returns` / `mark_returned` (013) advance `return_status` to
`partially_returned` → `returned`. So a pass still standing outside the mall and one that
closed weeks ago are BOTH `matched`, and every card rendered exactly one badge.

**`src/lib/rgpLifecycle.ts`** is the fix: `rgpStage()` / `rgpStageStyle()` derive the stage
from **`return_status` alone** — never from `status`, because `return_status` is the axis
the database actually advances, and it is already pinned to `not_applicable` for NRGPs
(`gate_passes_return_status_rgp_only`, 001) and for anything not yet cleared, so both
"no badge" cases fall out of one `Record<ReturnStatus, RgpStage | null>` rather than
needing a second condition that could drift. `PassRow` renders it as a **second pill beside
the status badge, in all three variants** (row / drill / compact). "Matched" deliberately
survives — the guard still needs to know the gate cleared it. Labels: **Out — Not Returned**
/ Partly Returned / **Closed**. Overdue re-TONES the pill and never renames it (same rule
the status badge follows — several KPIs are named "Overdue" and exact-text lookups of
those must stay unambiguous).

**Bug 1 — the HOD's Return Rate was frozen at an all-time figure.** It was the ONE KPI on
that page whose value came from the `kpis()` RPC (`kpis.returnRate`) instead of the
period-scoped array every other card uses. `kpis()` takes no date parameter and aggregates
**all time** (016), so the client raised an RGP today and the card sat at 93%. The page's
own comment called it a "decorative delta" — it is a card's actual value. Now
`returnRateOf(scopedRows)` in `src/lib/hodDrills.ts`, and the card is a **drill** whose
click lists the numerator (mirroring what `AdminDashboard` already did correctly at line
66). `tests/unit/hodReturnRate.test.tsx` mocks the RPC to return **93** on purpose — if the
card ever reads 93% again, the RPC has crept back in.

**Bug 2 — a part-returned RGP became unfinishable.** `GuardDashboard`'s open-obligations
query was `.eq('return_status', 'awaiting_return')`, so the moment a guard recorded ONE
line of a multi-line RGP the pass left that query, vanished from the Awaiting Return drill
— **the only place `Record Returns` is reachable** — and its remaining lines could never be
recorded through the UI. The database always allowed it (`apply_item_returns` accepts
`partially_returned`); only the client had shut the door. Now `.in('return_status',
['awaiting_return','partially_returned'])`, and `guardDrills`' `isAwaiting` includes the
partial state to match `hodDrills`, which always did.

New drills: **`closed`** on both boards. Guard's is sourced from `verifiedToday` (a shift
board shows what the gate finished today; the all-time archive belongs in Reports); the
HOD's is the Return Rate card's numerator.

**HOD cards renovated to the gate-console idiom (same session, client request).** The HOD
dashboard's drill rows were flat single lines; they are now `DrillPassCard` — the same
shadcn Card `GuardDrillCard` uses (`PassRow variant="drill"`) at **`dense`** spacing.
`PassRow` / `PassRowBody` gained `dense` and `showRaisedBy`. **"Raised By" is gone from
every HOD surface** — the HOD raised the pass, so their own name back at them is noise:
`DrillList` takes `showRaisedBy` (defaults **true** for the admin board, which oversees
every department; HOD passes `false`), and `PassRowCompact` drops the field outright since
its only consumers are `MyPassesTable` and `FlaggedReviewCard`, both HOD-only.
`DrillList`'s `onOpen` is gone — the card's own "Full details →" link replaces it, so
`AdminDashboard` no longer needs `useNavigate` either.

Full gate: **756 tests across 69 files pass** (`npm run check`, 2026-08-11). New specs:
`rgpLifecycle`, `rgpStageBadge`, `hodReturnRate`, `hodDrillCard`.

### `035` — HOD override = fresh pass, and the timeline the boss asked for (2026-08-08)

Business rule (user's call, 2026-08-08): **when the HOD overrides a flag, the pass is a
FRESH gate pass.** The department head has settled the paper; the truck is standing at the
barrier — the pass must be eligible to leave again THAT day, and the gate must be able to
either match it or re-flag it. Before `035`, an overridden pass kept its old `expires_at`
(so one flagged at 09:00 died at midnight even if the HOD cleared it at 11:00) and
`flag_pass` refused `hod_reviewed` outright — the queue/Verify changes made in the same
session would have been cosmetic without it.

Three parts:

1. **`hod_review_flagged_pass` (approve) refreshes `expires_at`** to the end of the
   CURRENT day in `site_tz()` — the exact expression `028` uses for a brand-new pass
   (`((date_trunc('day', (now() at time zone gatepass.site_tz())) + interval '1 day') at
   time zone gatepass.site_tz()) - interval '1 microsecond'`), so "overridden" and
   "freshly raised" can never disagree about when the pass dies. Same 028 trade-off: an
   override approved at 23:50 is valid for ten minutes. The reject branch is unchanged
   (status `'cancelled'` + a `verifications` row), and both branches now write a
   `verifications` row (`'hod_reviewed'` / `'cancelled'`) so the timeline reads from one
   table.
2. **`flag_pass` admits `hod_reviewed`** (`drop function` + recreate, since the
   signature `(uuid, text, text, jsonb, jsonb)` from 013 is unchanged in shape; the
   5-arg drop is required or `create or replace` cannot change the body. Error text now
   says "Only a pending, held or HOD-approved pass can be flagged." Deliberately NO
   expiry check: refusing to record a real mismatch because the paperwork went stale is
   backwards (008's rule, still true).
3. **`v_gate_passes` gains `flagged_at` / `hod_reviewed_at`** — scalar subselects over
   `gatepass.verifications` (`max(created_at) where action = 'flagged'` / `'hod_reviewed'`).
   These are the SPECIFIC moments; `verified_at` is the LATEST verification and stays what
   it was. Dropped + rebuilt because `create or replace view` cannot absorb new columns;
   `grant select` re-applied, `notify pgrst, 'reload schema'`.

Frontend (same session, TDD):

- **`GateConsole` queue query**: `.in('status', ['pending','hod_reviewed']).gte('expires_at', nowIso)`
  — the queue still shows only actionable passes — hide rows whose OWN expiry passed
  (works for both states; `is_expired'' covers pending only). An override approved
  yesterday that was never matched drops off too; `flag_pass` still admits it via lookup.
- **`Verify`**: Flag Mismatch now renders for `status !== 'matched'` — an override
  approval is a judgement about the paper, not a fact about the material, so the guard at
  the barrier must be able to re-flag a fresh pass whose mismatch was not actually fixed.
- **`PassRow`** (`src/components/PassRow.tsx`): the 2026-08-08 card rule lands — every
  pass card is a horizontal row (number / type / vendor / visitor / material / vehicle /
  dept / the Raised → Mismatch → Override timeline / status badge) with optional
  expansion for the full detail. Consumers converted: `QueueCard` (Link to `/verify/:id`,
  wait pill), `GuardDrillCard` (row starts expanded — the drill IS the detail),
  `FlaggedReviewCard` (flag reason stays visually focused), `HodDrillList` and
  `MyPassesTable` (rows, not tables). Status badge is STATUS-only (EXPIRED for an
  expired-pending pass, else `STATUS_STYLES[status]`) — an overdue pass gets the overdue
  RING, never an 'Overdue' label, because several drills sit beside KPIs named "Overdue"
  / "Expired" and exact-text lookups of those labels must stay unambiguous.

**Verification**: applied to the live DB 2026-08-08 and **verified behaviourally
2026-08-08 with real anon-key JWTs** (`node scripts/verify-035.mjs`, hod.it + guard,
10/10) — raise has the 028 same-day `expires_at`; flag → `flagged_at` timeline column
is set; HOD approve keeps the reason, sets `hod_reviewed_at`, and refreshes `expires_at`
to the end of the CURRENT raising day (verified equal to a brand-new pass's); the fresh
pass then MATCHES at the gate AND can be RE-FLAGGED with a new reason; a `hod_reviewed`
pass still carries an `expires_at` for the queue's `.gte` filter. Probe rows cleaned up
(`visitor_name = '035 Probe'` swept via psql; 0 remain). Catalog counts also confirmed
via psql (`information_schema` shows `flagged_at`/`hod_reviewed_at`; both
`pg_get_functiondef` checks t/t). Static backstops: `tests/security/sqlInvariants.test.ts`
"035: ..." fails if the final `hod_review_flagged_pass` stops refreshing `expires_at`,
if `flag_pass` stops admitting `hod_reviewed`, or if the view loses either column;
all written-first.

### `034` — every user the admin panel created was unable to log in (2026-08-08)

**An admin adds a guard or HOD; the account is created and looks perfectly healthy — right
row in `auth.users`, right role in `public.profiles` AND in `raw_app_meta_data`, email
already confirmed, visible in the Users tab — and the person still cannot sign in.** Not
"invalid credentials": a **500** from the auth server. Live auth logs named it:

```
converting NULL to string is unsupported
```

GoTrue scans `auth.users`' token columns into Go `string` fields, which cannot hold NULL.
Four of them are **nullable with no column default**: `confirmation_token`,
`recovery_token`, `email_change`, `email_change_token_new`. `admin_create_user` never
listed them in its INSERT (021 → 023 → 032 all inherited the omission), so every account it
created carried NULLs and died inside the auth server on the first sign-in attempt.

Why nobody caught it earlier: **Supabase's own signup path writes `''` into all four**, so
demo accounts, self-signups and `scripts/create-user.ts` (which goes through the Admin API)
were unaffected. And the defect is invisible from GatePass's side — the RPC returns success,
every row reads correctly, and no GatePass query touches those columns. Only the auth
server does.

`034` does two things, because fixing the function alone leaves the existing people locked
out forever:
1. **Backfills NULL→`''`** on those four columns (`UPDATE 7` live — every account the admin
   panel had ever created). It touches nothing else, so a healthy row is left alone.
2. **Recreates `admin_create_user`** with the four columns in the INSERT list, otherwise
   byte-identical to `032`'s body (023's trigger fix and 032's one-department guard + VMS
   mirror both preserved).

The other string columns — `phone_change`, `phone_change_token`,
`email_change_token_current`, `reauthentication_token` — each default to `''` and were
always written correctly. They are deliberately omitted.

**Verified live 2026-08-08**, end to end through the anon key, not psql: signed in as
`admin@demo.vms`, called `admin_create_user` for real, then signed in as the brand-new user
from a **fresh client** — succeeded, with `role: 'guard'` in the JWT. Probe user deleted;
`still_null = 0` across all 32 `auth.users` rows.

Static backstops in `tests/security/sqlInvariants.test.ts`: one test fails if the final
`admin_create_user` definition stops setting any of the four columns, another fails if no
migration backfills them. Both were written first and watched fail.

**Rule this leaves behind: never hand-write an `insert into auth.users` without those four
columns.** Nothing in Postgres will complain — the failure surfaces only in the auth
server, on a later request, as a 500 with no connection to the insert that caused it.

### `safeErrorMessage` hardened — no blobs, no constraint names (2026-08-08, frontend only)

Two follow-ups from `034`, both in `src/lib/errors.ts`:

- **A message that says nothing to a human is now replaced by the caller's fallback.**
  `OPAQUE_MESSAGES` catches `{}`, `[]`, `[object Object]`, `null`, `undefined` — what
  supabase-js hands over when it cannot turn a response body into a sentence. Before this,
  a login failure could render as bare punctuation, which reads as a broken UI rather than
  an error. **Matched exactly, after trimming, never as a substring** — a real sentence may
  legitimately contain braces (the packed vendor blob in a blacklist refusal does), and
  must still be shown.
- **`AUTH_CODE_MESSAGES`** maps GoTrue codes (`AuthApiError.code` — auth-server strings,
  **not** SQLSTATEs, hence a separate map). `unexpected_failure` is the one that matters:
  it is how a 500 from the auth server arrives, and its own text is "Database error
  querying schema". Checked *after* the SQLSTATE map so a Postgres code can never be
  shadowed. An unlisted auth code still shows GoTrue's own text.
- **`public.profiles`' three name checks are now named** in `CONSTRAINT_MESSAGES`:
  `profiles_full_name_charset` (letters, spaces, full stops, apostrophes, hyphens — so a
  name with a digit, like "Probe 034", is refused), `_length` (2–80), `_trimmed`. These are
  VMS-owned `NOT VALID` checks and fire on the admin Users tab and the profile page.

**23514 has deliberately NOT been added to `CODE_MESSAGES`.** A catch-all "that value is
not allowed" would be *less* informative than the constraint name for every check this map
does not name — `033`'s vehicle-format check among them. Name the constraint instead;
`tests/unit/errors.test.ts` pins that an unnamed 23514 still passes its text through.

### `033` — blacklist + vehicle format hardened (2026-08-08)

**`visitor_company` used to render as raw JSON on the slip and the detail page.**
`RaisePass` writes `JSON.stringify({n, a, v})`, and when the HOD leaves all three vendor
fields blank it writes `{"n":"","a":"","v":""}` — a *truthy non-empty string*. Old
`parseCompanyInfo` tested `parsed.n` for truthiness, so the empty blob fell through to the
legacy branch and displayed the raw JSON as the company name everywhere. It now recognises
the packed shape by its **keys** (`n/c/a/v` present), not by truthiness — and `RaisePass`
stops writing blobs at all: `packVendor()` returns `null` when all three fields are blank,
so the honest record of "no vendor" is a null column (`company_name_of()` already coped).
`PassDetail` also renders `—` for a missing name.

**Blacklist and vehicle numbers are now strict.** `033` adds a CHECK on `gate_passes`
enforcing the Indian format (`IN` or `WB` … `XX 1234`/`XX9 1234`/`X9 1234`, exactly one
space before the digits, digits 13BF to 9999) and hardens the blacklist form
(`tests/unit/blacklistForm.test.tsx`) — blanks rejected, leading zeros rejected, etc. The
migration also refactors `check_blacklist` to compare on the *packed* `n` key so a
blacklisted vendor name can never slip past as `{"n":"bsc",…}`.

Two live-DB quirks surfaced while applying `033`, fixed in the migration body:
- **Postgres `overlay(to… from 3…)` REPLACES rather than inserts** — use
  `left(…) || '0' || substring(…)` to splice a digit in.
- **The server's collation mangled `[^A-Z0-9]`** (stripped letters) — use the POSIX class
  `[[:alnum:]]` instead.

Verified live with real anon-key JWTs: blank-vendor raise → `visitor_company = null`; the
pass detail/slip show `—`; a blacklisted vendor by name and by number is refused; a valid
pass matches. Probe rows cleaned up; `gate_passes` back to ~18 rows. **No commit of this
was made before the next push (see git log — `033` ships in the same push as the docs).**

### `036` — the admin resets a password, the user is forced to replace it (2026-08-10)

The other half of removing self-service reset (section below). An admin resets a
password from **Admin → Users → Edit User**; the person signs in with what the admin gives
them and is then made to choose their own before reaching any screen.

**The browser cannot do this on its own.** `auth.admin.updateUserById` needs the
service-role key, which must never reach the bundle. So the write happens in a
SECURITY DEFINER function using the same bcrypt shape `admin_create_user` has used since
`021` — `extensions.crypt(pw, extensions.gen_salt('bf'))`. GoTrue accepts a hash written
this way; that was already proven live by `034`, and re-proven here.

- **`gatepass.admin_reset_user_password(uuid, text)`** — `is_admin()` gated. Sets the
  password, raises `must_change_password`, and **deletes every session the user has**
  (`auth.sessions`; `refresh_tokens.session_id` cascades — verified live, `confdeltype`
  is `'c'`). Without that delete, someone already signed in elsewhere keeps full access,
  which defeats the point of a reset when the reason for it is a suspected compromise.
- **It refuses to target an `admin` / `super_admin`.** Otherwise the weakest admin account
  becomes a takeover route into every stronger one, and "reset" is an undetectable way to
  seize a super_admin. A locked-out admin is a Supabase-dashboard job, deliberately. This
  mirrors `admin_create_user`, which likewise will not mint an admin.
- **`gatepass.set_my_password(text)`** — the user's own choice, scoped to `auth.uid()`.
  **It clears the flag in the same call that writes the password, and nothing else clears
  it.** A separate "clear the flag" RPC would let the forced-change screen be skipped from
  the browser console. It also refuses reusing the current password (`crypt(new, current)
  = current`), because keeping the password the admin just read out over the phone leaves
  the account exactly as exposed as it was.
- **`my_profile()` was drop+recreated** to carry `must_change_password` — its return type
  changed, which `create or replace` cannot do (the same dance `025` did for `avatar_url`);
  the execute grant is re-applied in the same transaction. GatePass never reads
  `public.profiles` directly (the `006` rule), so this function is the only way the flag
  reaches the client.

**The flag lives in `public.profiles`, added by VMS migration `064` — not by this one.**
`public` is VMS-owned and GatePass must never alter it. This migration only reads and
writes the column's *value*, exactly as `admin_create_user` already writes
`public.profiles.role`. **Apply VMS `064` first**; `036` is a no-op-then-error without it.
The two apps' functions deliberately MIRROR rather than call each other: each authorizes
with its own admin check, and each app's callable surface stays in its own schema.

**Verified live 2026-08-10** — `node scripts/verify-036.mjs`, **16/16**, real anon-key
JWTs throughout (postgres bypasses every guard here, so psql could not have proven any of
it). Covers: a fresh user is NOT flagged (the regression that would lock out the whole
org); a non-admin is refused; an admin cannot reset an admin; a short password is refused;
the old password stops working; the new one signs in; both apps' flag readers agree;
reusing the temp password is refused; the user's own choice clears the flag; a second
sign-in is not gated; the temp password dies once replaced. Probe user deleted;
`profiles` has **0** rows flagged.

### Password reset is admin-assisted — self-service is GONE (2026-08-10, frontend only)

**There is no "Forgot password?" link any more** (user's call, 2026-08-10). The login card
carries a line of help text instead: *"Forgot your password? Contact the administrator at
admin@demo.vms to have it reset."*, with the address as a `mailto:` link.
`src/components/ForgotPasswordCard.tsx` was **deleted** along with `Login`'s `mode` state,
so `resetPasswordForEmail` now has **no caller anywhere in `src/`**.

The address lives in **one** place — `ADMIN_CONTACT_EMAIL`, exported from
`src/pages/Login.tsx` — so the test asserts the same constant the page renders and the two
cannot drift. Change it there if the real administrator's mailbox differs from the demo one.

Why removing it is an improvement and not a regression: the built-in Supabase sender is
capped at **~2 emails/hour project-wide** (see the section below, still true), so the
self-serve button failed for most people who pressed it and left them with a rate-limit
error and no next step. A named human is a better answer than a button that usually fails.

**`ResetPassword.tsx` and the `/reset-password` route are deliberately KEPT.** They are no
longer reachable from inside the app, but they are still the landing page for a recovery
email the **admin** triggers from the Supabase dashboard — which is exactly the flow this
change institutes. Deleting them would break the new process, not tidy it. This is a
knowing exception to "never leave unused code": the page has a caller, it is just not in
this codebase. `tests/unit/resetPassword.test.tsx` (7) still covers it.

`tests/unit/forgotPassword.test.tsx` was rewritten (4 tests) and now pins the *absence* of
the control plus the presence of the mailto — so the link cannot creep back in. Full gate:
**555 tests across 43 files pass** (`npm run check`, 2026-08-10).

The original 2026-08-08 fix that this supersedes is kept below only for the recovery-page
mechanics, which are unchanged:

- **`ResetPassword.tsx`** at `/reset-password` — the recovery token the email embeds is
  an implicit-grant callback: the SDK detects it and fires the `PASSWORD_RECOVERY`
  event, and only that event unlocks the new-password + confirm form (`updateUser`).
  A fallback 1.5 s timer shows "link invalid" if no recovery event arrives (stale or
  forged link). On success it `signOut()`s and shows a confirmation — password is set,
  session is not kept.
- **`App.tsx`** routes `/reset-password` — the render branch sits **before** the
  `!session` gate, because the recovery session is valid but must not be treated as a
  logged-in visit (it would bounce to the console instead of the form).
- **Login.tsx HTML validity:** the card's own `<form>` used to nest inside the outer
  sign-in `<form>` (invalid HTML). The outer element is a `<div>`; the sign-in content is
  its own inner `<form>`. Keep it that way — it is still the only `<form>` on the card.

Still worth verifying with a real mailbox: that the link in an **admin-triggered** recovery
email lands on `/reset-password` and the form there accepts a new password.

### Reset email rate limit — the built-in sender is capped at ~2 emails/hour (2026-08-08)

**The built-in Supabase email provider allows only ~2 emails per hour, PROJECT-WIDE** —
signup + reset emails from *both* GatePass and VMS (shared project) count against the same
budget. The dashboard's Rate Limits settings do NOT lift it — "Custom SMTP only" per the
docs. Users hitting it see `over_email_send_rate_limit` (429), which `safeErrorMessage`
already translated. Two follow-ups landed:

- **The message now says it is an hourly cap**, not "a few minutes"
  (`src/lib/errors.ts`, tests pin `/hour/i`) — with the built-in sender the wait really
  can be until the next hour.
- ~~`ForgotPasswordCard`'s 60-second client-side resend cooldown~~ — **gone with the card
  itself on 2026-08-10** (see the section above). Nothing in the app sends a reset email
  any more, so no client-side throttle is needed. **The cap itself still applies** to
  whatever the admin triggers from the Supabase dashboard, and it is still project-wide
  and shared with VMS.

To raise the cap for real: configure a **custom SMTP** provider in Authentication →
Settings (e.g. Resend), then raise `rate_limit_email_sent` in Authentication → Rate
Limits or via the Management API (`/v1/projects/oxzzeonftrmohdrancex/config/auth`).
Full gate: **551 tests pass** (`npm run check`, 2026-08-08).

### UI overhaul, 2026-08-04 (frontend only — no migration)

**The RGP form could not be submitted at all, and had been broken since `019`.**
`RaisePass.validate()` required a *pass-level* `expected_return_date`, but `019` replaced
that field with per-item dates and the form stopped rendering a pass-level input. So every
RGP submit failed validation on a field the user could neither see nor fill, and
`errors.expected_return_date` was never rendered either — the button just did nothing. Worse,
`handleSubmit` never sent `p_expected_return_date`, and the view computes `is_overdue` /
`due_state` from the **pass-level** column, so a pass that did get through could never go
overdue. Fixed: each RGP line requires its own Return Date (error rendered inline under the
input), and the pass-level date is derived as the **earliest** item date — a pass is due when
its first line is due. Covered by `tests/unit/raisePassSubmit.test.tsx`.

**Serial number removed from the HOD forms** — `RaisePass`, `BulkRaise`, and the
`NewGatePassItem` form type, plus the `PassDetail` row and the `PassPrint` column.
`gatepass.gate_pass_items.serial_no` **still exists in the database and is now write-dead**;
dropping it needs a migration that rebuilds `v_gate_pass_items`. Deliberately deferred —
user's call, 2026-08-04. This is the one known violation of "never leave unused schema".

**Guard view split into Dashboard + Gate Console.**
- **`/guard-dashboard`** (`GuardDashboard.tsx`) is the guard's first sidebar tab, "Dashboard".
  Five KPI cards — Pending for Gate Approval, Matched at Gate, Mismatch at Gate, Awaiting
  Return, Overdue — and **each is a drill**: clicking it lists the matching passes as full
  premium cards *on the same page*, no navigation, because a guard is standing at a barrier.
  Drill definitions live once in `src/lib/guardDrills.ts` as a `Record<DrillKey, DrillDef>`.
  **Each KPI number is `rows.length` of the very list the click opens**, so the count and the
  list cannot disagree — do not "optimise" this back into a separate `count: 'exact'` query.
- ~~**`/returns` and `Security/PendingReturns.tsx` are gone.**~~ **THIS IS FALSE — corrected
  2026-08-10.** Both still exist and are fully wired: `PendingReturns.tsx` is on disk,
  `App.tsx:184` routes `/returns`, `ROLE_ROUTES.guard` permits it, and `Sidebar.tsx`
  offers it to guards as "Pending Returns". Either the deletion was never carried out or
  it was reverted; the doc was never corrected. Verified by
  `tests/unit/navLinksResolve.test.ts`, which now fails if any nav link stops resolving to
  a real, permitted route.
  What IS true from that change: its KPIs also became guard-dashboard drills, and
  **`mark_returned` is reachable from `GuardDrillCard.tsx`** as well. So there are now TWO
  routes to closing an RGP, not one — worth deciding deliberately rather than leaving to
  drift. **Before believing any "X was deleted" claim in this file, check the disk.**
- **`/history` and `Security/History.tsx` are gone** (user's call, 2026-08-04), along with
  `tests/unit/history.test.tsx`. Note the capability actually lost: the Matched / Mismatch
  drills are **today-only**, so a guard can no longer look back at past verifications at all.
  Adding a Today/All-time toggle to those two drills is the fix if that is ever missed.
- **`GateConsole` is the pending queue and nothing else.** Its KPI row moved to the dashboard;
  `GateLookup` moved from a full-width card above the KPIs to a compact fixed-width card
  anchored right of the page header, with an icon-only QR button. `QueueCard.tsx` was
  extracted to keep the file under the 300-line cap.

**Session timeout is now 5 minutes, not 10.** `SessionTimeout.tsx` already existed and was
already mounted in `AppShell` — it just never fired within the window anyone waited. It now
exports `IDLE_TIMEOUT_MS` / `COUNTDOWN_SEC` so `tests/unit/sessionTimeout.test.tsx` asserts
the threshold rather than trusting a comment. **Activity does not dismiss a visible prompt** —
only "Keep session" does, so the mouse nudge that wakes a screen cannot silently cancel a
logout nobody saw.

**Reports filters lifted to the page.** The All / Pending / Matched / Mismatched status tabs
were removed from `AllPassesReport` and those counts became KPI cards on the admin Dashboard.
Department and RGP/NRGP filters moved OUT of `AllPassesReport` into `ReportsFilterBar.tsx`,
rendered by `ReportsPage`, so **the scope now applies to all three report portals** and is
appended to the printed report header (`rangeLabel`) — a filtered report that does not say so
on the paper reads as the whole org and undercounts by an unknowable amount. `AllPassesReport`
keeps only free-text search and CSV export.

**`RGP In` added to the gate console's category filter — and `categoryKey` was wrong.**
It took only the type and hardcoded `` `${type}-out` ``, so an RGP-in pass was filed under
"RGP Out" and could not be filtered for at all. Bulk Create's direction select already
allows "In" for RGP, so such rows can genuinely exist. `categoryKey(type, direction)` and
`categoryFor(type, direction)` now take both; `PASS_CATEGORIES` gained `RGP-in` with a
`direction` field. **Still no `NRGP-in`** — that is a goods receipt, not a gate pass
(`gate_passes_nrgp_is_outward`). `tests/unit/lookupMaps.test.ts` had a test *named* "three
combinations" that asserted two; corrected. Note `RaisePass` still hardcodes
`p_direction: 'out'`, so RGP-in passes can only be created via Bulk Create today.

**Sidebar labels:** admin "Admin Dashboard" → "Dashboard"; guard order is Dashboard, Gate
Console. `ALL_LINKS` is now exported from `Sidebar.tsx` so tests can assert nav order.
**All four roles now land on their KPI board** (2026-08-08): `ROLE_HOME.guard` is
`/guard-dashboard` (was `/console`), matching admin's `/admin-dashboard` and HOD's
`/dashboard`. The console is still where a shift is spent, but it shows only the pending
queue — **Expired, Awaiting Return and Overdue appear nowhere else in the guard's UI, and
`mark_returned` is reachable only from a dashboard drill**, so landing on the queue meant
those were seen only if someone thought to click across. `tests/unit/roleRoutes.test.ts`
pins each role's landing page and the "first entry of `ROLE_ROUTES` is the landing page"
convention for guard and admin alike.

### Dashboards are period-scoped, and every KPI is a drill (2026-08-08)

**All three dashboards default to today.** Historical data is reached through Reports
(`/all-passes`, admin) or My Passes (`/my-passes`, HOD) — user's call: a dashboard is a
snapshot, not an archive.

- **HOD and Admin** carry a **period filter** top-right (`src/components/DashboardPeriodFilter.tsx`,
  bounds in `src/lib/dashboardPeriod.ts`): Today / Weekly / Biweekly / Monthly / Yearly,
  rolling windows ending at midnight tomorrow, default Today. `todayBounds()` in
  `src/lib/hodKpis.ts` now delegates to `periodBounds('today')` — do not let a second
  "start of today" implementation reappear.
- **HOD dashboard**: Recent Passes is gone; every KPI is a clickable drill
  (`src/lib/hodDrills.ts` + `HodDrillList.tsx`), including **RGP Issued**, **NRGP Issued**
  and **Expired**. The **`<FlaggedReviewCard>` is deliberately fed by UNSCOPED rows** — a
  mismatch raised yesterday still needs a decision today. Keep that comment.
- **Admin dashboard** no longer calls the `kpis()` RPC (it aggregates all-time and takes no
  date parameter); it derives its four KPIs from `v_gate_passes` rows instead. `kpis()` still
  has one caller, the HOD dashboard.
- **Guard dashboard is deliberately mixed-scope, and this is load-bearing.** Pending /
  Matched / Mismatch / Expired are today-only; **Awaiting Return and Overdue are all-time**
  and labelled "all time" on the card. They were previously (and wrongly) scoped to
  `raisedToday`, which meant an RGP raised last week and still out was **invisible** — and
  since `mark_returned` is reachable nowhere else in the UI, those passes could never be
  closed at all. Do not "fix" the inconsistency by scoping them.

**The invariant across all three:** a KPI's number is `rows.length` of the very list the
click opens, both from the same filtered array. Never a separate `count: 'exact'` query.

### HOD nav trimmed + admin lands on the KPI board (2026-08-08, frontend only)

**`ROLE_HOME.admin` / `.super_admin` is now `/admin-dashboard`, not `/admin`** — an admin
signing in sees the KPI board, not Departments & Users. `ROLE_ROUTES` was reordered to keep
the documented "first entry is the landing page" convention true; `tests/unit/roleRoutes.test.ts`
now pins it.

**Vendors and Bulk Create were removed from the HOD sidebar entirely** (user's call,
2026-08-08). Deleted: `HOD/VendorProfiles.tsx`, `HOD/BulkRaise.tsx`, `HOD/BulkItemRow.tsx`,
`HOD/BulkResultList.tsx`, `tests/unit/bulkRaise.test.tsx`, both routes and both `ALL_LINKS`
entries, and `/vendors` from `ROLE_ROUTES.hod`. `tests/unit/hodNav.test.tsx` pins the
surviving HOD nav (Dashboard, Raise Gate Pass, My Passes) so neither tab can creep back.

Two consequences worth knowing:
- **RGP-in passes can no longer be created at all.** `RaisePass` hardcodes
  `p_direction: 'out'` and Bulk Create was the only screen whose direction select allowed
  "In". The `RGP In` filter in the gate console will now never match anything. Giving
  `RaisePass` a direction selector is the fix if inbound returnables are ever needed.
- **The vendor *prefill* inside Raise Gate Pass deliberately stays** — the "Vendor Details"
  card, the "Load from vendor…" dropdown, the "Save as vendor profile" checkbox and the
  `list_vendor_profiles` / `save_vendor_profile` RPCs are all untouched. Only the standalone
  browse/manage page went. So vendors can still be saved and reused, just not browsed.
- `bulk_create_passes` in the database now has **no caller**. Left in place rather than
  dropped, pending a decision on whether Bulk Create returns.

**300-line cap:** `RaisePass` (451) and `BulkRaise` (315) were over and were split into
`MaterialItemRow` / `MaterialItemsCard` / `PassDetailsCards` / `PassSubmittedModal` and
`BulkItemRow` / `BulkResultList`. Still over the cap and **untouched this session**:
`DepartmentsTab` (466), `UsersTab` (431), `HOD/Dashboard` (307), `AIAnalyticsTab` (307).

### Admin UI split — Dashboard and Reports are now separate pages (2026-08-04)

The admin left-sidebar gained **Admin Dashboard** (`/admin-dashboard`, admin + super_admin) —
the KPI board (`kpis()` + per-department breakdown) that used to sit on top of the old
`AllPasses`. `/all-passes` is now **Reports** only: three report "portals" behind a
date-range toolbar (`ReportsPage` + `ReportsToolbar`, range presets from
`src/lib/reportsDateRange.ts`): **All Passes** (register + filters),
**Return Schedule** (RGP-only, Expected Return + Actual Return columns off the view) and
**Department Summary**. Reports print A4 landscape via a **named page**
(`@page report-sheet`) with a Quest letterhead (`ReportsPrintHeader`, `QuestLockup` light
tone) — the A5 slip's `@page` rule is untouched. Old `Admin/AllPasses.tsx` was deleted.

**Dashboard is a slim operational snapshot — status counts live only under Reports.**
2026-08-04 feedback: `Pending for Gate Approval` / `Matched` / `Mismatched` KPI cards, the
per-department `By Department` table, and the `Open Reports →` button were all removed from
`AdminDashboard.tsx`; it now loads only the `kpis()` RPC and shows `Total`, `Awaiting Return`,
`Return Rate`, `Overdue`. The status register and per-department counts are exclusively in
`/all-passes` (the `DeptBreakdownTable` component now has exactly one consumer, the
`DepartmentSummaryReport`). The Reports page header subtitle was dropped too.

### `025` — self-service profile page (2026-08-04)

Clicking the **bottom-left profile block** in the sidebar now opens `/profile` (all four roles),
mirroring VMS's profile page: upload / replace / **remove** the photo, and edit the display
name. The photo lives in the shared `avatars` storage bucket (`avatars/<uid>/avatar`, created
by VMS migration 053 — same project, so a photo set here shows in VMS too). Client writes go
through two new **SECURITY DEFINER** RPCs scoped to `auth.uid()` — `gatepass.update_my_name(text)`
(validates non-empty / ≤80 chars, raises otherwise) and `gatepass.set_my_avatar(text)`
(null or `''` clears) — never `public.profiles` directly (the 006 rule). `my_profile()` was
drop+recreated to return `avatar_url` (its return type changed, which `create or replace`
cannot do; the execute grant was re-applied in the same migration). Files:
`src/pages/Shared/Profile.tsx` + `ProfilePhotoCard.tsx` + `ProfileDetails.tsx`,
`src/lib/useMyProfile.ts`, `src/lib/avatarUpload.ts`, `src/lib/initials.ts`, and the
`/profile` link in `SidebarProfile.tsx` (re-fetches the avatar on navigation so returning
from the page shows the new photo). **Verified live** as `guard@demo.vms` via real anon-key
JWT: name updated, avatar set/cleared, and the empty-name case rejected with HTTP 400
(`gatepass` schema REST needs `Accept-Profile`/`Content-Profile: gatepass` headers).

**Sidebar active-link fix (2026-08-04):** the nav highlight used a bare `startsWith`, so
`/admin-dashboard` lit up *both* **Admin Dashboard** and **Departments & Users**. Now
`isNavActive()` (in `src/lib/roleRoutes.ts`) matches exact or parent-segment only. **AI
Analytics was removed from the HOD view** (sidebar link, `/analytics` route,
`HodAnalytics.tsx` deleted); the admin's AI Analytics tab under `/admin` is untouched.

### `027` / `028` — the blacklist was decorative, and the JSON trap that hid it

**`visitor_company` does not hold a company name.** `RaisePass` writes
`JSON.stringify({n: name, a: address, v: phone})`, so the column holds
`{"n":"BSC","a":"…","v":"…"}`. Every blacklist comparison in the codebase was
`lower(list_value) = lower(trim(visitor_company))`, which can never equal `'bsc'`. This bit
in **two** separate places, and both looked correct on inspection:
- `check_blacklist()` (016) was never called at raise time at all — the list was advisory
  data no code path consulted. `027` fixes this with a **BEFORE INSERT trigger**
  (`gate_passes_enforce_blacklist`), not a check inside `raise_pass`: there are TWO
  `raise_pass` overloads plus `bulk_create_passes`, and a trigger covers every insert path
  including ones added later. The refusal message includes the reason, because an HOD told
  only "blocked" cannot tell a deliberate ban from a typo and will just retry.
- `lookup_pass()` compared the same raw JSON on the **gate** side, so a guard's scan
  silently returned a null blacklist note every time — indistinguishable from "this vendor
  is fine". `028` fixes it.

`gatepass.company_name_of(text)` (027) unwraps the JSON and falls back to the raw text for
legacy rows that stored a bare name. **Use it for any future comparison against
`visitor_company`.** The trigger fires on INSERT only — blacklisting a vendor must not break
the gate for passes already standing at the barrier.

**Verified live 2026-08-08** (real anon-key JWTs): the JSON-wrapped, lowercased+padded, and
legacy bare-text spellings of a blacklisted company were all refused with the reason; a clean
vendor still got through; and rejection/matching behaved as designed. Probe rows deleted.

**HOD final rejection (027).** A flagged pass could only ever be *approved*, so one the HOD
did not want released sat at `flagged` forever. `hod_review_flagged_pass` now accepts
`p_action = 'reject'`, moving the pass to **`cancelled`** and keeping `flag_reason`. This does
not reopen what `024` closed: `024` stopped an HOD voiding their own pass on a whim; this
applies only to a pass security has already stopped, only by the raising HOD, and adds no
DELETE grant or UPDATE policy. Verified live: a rejected pass is refused by `match_pass`.

**`'cancelled'` cannot appear in a CHECK constraint.** `026` used an allow-list
(`status in ('flagged','hod_reviewed','matched')`); `027` needed `cancelled` too, and naming
it **aborts the whole `APPLY_ALL.sql` paste** — the label is added by `008`, and the paste is
ONE transaction, so Postgres hits "unsafe use of new value" at DDL time. It would have worked
on this live DB and failed on every fresh deploy. `tests/security/sqlInvariants.test.ts`
caught it. The constraint is now an inverted deny-list, `status not in ('pending','held')`,
which names only original `001` labels and states `012`'s intent more directly anyway.

### `029` — per-item returns, and the RPC that had no caller for three migrations

**`apply_item_returns` has taken `[{item_id, qty}]` since `013` and nothing ever called it.**
The only return action reachable in the UI was `mark_returned`, which closes every line at
once — so a trolley that went out with a drill, two ladders and a coil could only come back
all together, and the record showed a single timestamp on the parent for a return that
physically happened over three days. `029` adds `gate_pass_items.returned_at` and
`src/pages/Security/ItemReturnList.tsx` is the first caller.

- **`returned_at` is stamped only when a line becomes FULLY returned.** A partially-returned
  line (2 of 3 ladders) stays null: it still owes material, and a date on it reads as "this
  came back" on every screen that renders one. Outstanding quantity expresses a partial
  return; the timestamp expresses closure. It is nullable for the same reason — a
  `not null default now()` would stamp every line at raise time.
- **The stamp is set in the same UPDATE that moves `returned_qty`**, with
  `coalesce(returned_at, ...)` so it can never be moved once written.
- **The pass closes itself.** The roll-up (unchanged since `013`) sets `return_status =
  'returned'` in the same call once no line has `returned_qty < quantity`. The client never
  decides closure — `ItemReturnList` calls back so the dashboard *re-reads* it. Do not
  compute "all items are back" in TypeScript and act on it.
- `v_gate_pass_items` was drop+rebuilt (TRAP 2 — `select i.*` cannot absorb a new base
  column) and its grant re-applied in the same transaction.
- The guard card's button is now **Record Returns**, opening per-line buttons plus a
  **Return All** fallback for the single-move common case. Items load only when a card is
  opened, so a long Awaiting Return drill doesn't fire one query per pass at the barrier.

**Verified live 2026-08-08**, real anon-key JWTs for `hod.it` + `guard`, 13/13: a 3-line RGP
raised and matched; line 1 returned alone → stamped, lines 2–3 null, pass
`partially_returned` with no `actual_return_date`; 1 of 2 ladders returned → still no stamp
on that line; remainder returned → all three stamped with **distinct** times, line 1's
original stamp unchanged, pass `returned` with an `actual_return_date`. A closed pass refuses
a further return; an HOD is refused outright ("Only security can record a return."). Probe
row deleted via psql — note the anon path **cannot** clean up, because nobody holds DELETE on
`gate_passes`. `tests/security/perItemReturns.test.ts` + `tests/unit/itemReturnList.test.tsx`.

### `030` — Returnable Aging removed (2026-08-08, user's call)

The HOD dashboard's Returnable Aging card (Period / Items Out / Estimated Value) is gone:
`src/pages/HOD/ReturnableAging.tsx` deleted, the `returnable_aging` RPC call and its state
removed from `HOD/Dashboard.tsx`, `ReturnableAgingBucket` dropped from `src/types/index.ts`,
and `030` drops `gatepass.returnable_aging(uuid)` itself. An unused SECURITY DEFINER function
stays EXECUTE-able over PostgREST by every authenticated user — it is attack surface no
screen exercises and nobody reviews.

`formatCurrency` was **kept**: still used by the HOD Overdue KPI and `PassPrint`.
`bulk_create_passes` is still **not** dropped — that one is pending a decision on whether
Bulk Create returns; Returnable Aging is not coming back.

### `032` — one department per person, DB-enforced (2026-08-08)

Business rule: a person can belong to AT MOST ONE department, in both apps. VMS already
models it structurally — `public.profiles.department_id` is a single column. The only place a
user could acquire two departments was GatePass's join table. `032` closes that gap three
ways:

- **A unique index** `hod_departments_one_department_per_person` on `hod_departments (hod_id)`.
  The database itself rejects a second row for the same person with a 23505 — no RPC can be
  forgotten later, because every write path hits the same index.
- **The admin functions now agree with VMS.** `admin_create_user` / `admin_update_user`
  refuse a `p_department_ids` array longer than one ("A person can belong to at most one
  department — found N."), and mirror the sole department into `profiles.department_id`
  (VMS's authority) so both apps read the same fact for the same person. `[]` still clears,
  `null` still means "unchanged".
- **The demo seed no longer invents a multi-department HOD** — `005` seeds from
  `profiles.department_id` only (it always did; the IT+DEV+SA cross-join is gone).

Frontend follows: `DepartmentsTab`'s Assign action is now a MOVE (delete-then-insert, so
assigning an already-assigned HOD relocates them instead of failing), and `UsersTab`'s
create/edit modals use single-select department chips (edit pre-fills the HOD's current one;
leave empty to unassign).

**Verified live 2026-08-08:** applied cleanly (0 rows needed dedupe — all 7 HODs already
held exactly one row); `7 people / 7 rows / max 1 per person`; a second row for a real HOD
was refused with the exact `23505 duplicate key` and rolled back; both deployed function
bodies carry the guard and the `department_id` mirror (checked via `pg_get_functiondef`).
Static backstops: `tests/security/sqlInvariants.test.ts` now fails if the unique index is
ever dropped, or if either admin function stops rejecting >1 / stops mirroring.

### KPI clicks scroll their results into view (2026-08-08, frontend only)

`src/lib/useScrollIntoViewOnChange.ts` — one hook, used by `GuardDashboard` and
`HOD/Dashboard`, that scrolls the revealed drill list to the top of the viewport when the
selected KPI changes. Three things in it are load-bearing:
- **It never scrolls on first mount.** A page that jumps on load is worse than one that
  doesn't scroll.
- **`scrollIntoView` does not exist in jsdom** — it is called only after a
  `typeof el.scrollIntoView === 'function'` check. Without that guard every dashboard test
  crashes.
- **`prefers-reduced-motion: reduce` downgrades to `behavior: 'auto'`**, with `matchMedia`
  itself feature-detected because jsdom may not implement it.

**The admin dashboard is deliberately not wired up: its four KPIs are not clickable at all**
(no `onClick`, no drill list to reveal), so there is nothing to scroll to. Making them drills
is the prerequisite if that is ever wanted.

### `028` — expiry is now same-day

`expires_at` was end of the **next** day; it is now **end of the raising day** in
`site_tz()`. Verified live: raised 09:47 IST → expires 23:59:59 the same day.

**Trade-off to know about:** a pass raised at 23:50 is now valid for ten minutes. The old
`+2 days` existed precisely to avoid that cliff. If it bites, the fix is "end of the raising
day, but never less than N hours" — not a return to `+2 days`.

**There is deliberately no `'expired'` status enum label and no `pg_cron` job.** Expiry is
derived at query time from `expires_at`, exactly like `is_overdue`, and surfaced as
`is_expired` on `v_gate_passes`. A pass reads as Expired when
**`status === 'pending' && is_expired`** — a matched or flagged pass already reached its
outcome. `src/lib/statusStyles.ts` exports `isExpiredPending()`; use it rather than
re-deriving the pair, and **never recompute expiry from `expires_at` in TypeScript.**

### `026` — the HOD override could never have worked (2026-08-08)

`hod_review_flagged_pass` moves a pass `flagged → hod_reviewed` without touching
`flag_reason`, but `012` added `gate_passes_flag_reason_only_when_flagged`
(`flag_reason is null or status = 'flagged'`). Since `flagged_needs_reason` guarantees a
flagged pass *has* a reason, that UPDATE aborted every single time:
**"new row … violates check constraint gate_passes_flag_reason_only_when_flagged"**.
Broken for every pass since `012`, not intermittently.

The fix is NOT to null the reason in the RPC — that destroys the audit trail at exactly the
moment it matters, and erases the text the HOD screens display. `026` widens the constraint
to `status in ('flagged','hod_reviewed','matched')` instead. `matched` is included because
**`match_pass` explicitly admits `hod_reviewed`**, so the real path is
`flagged → hod_reviewed → matched` and a matched pass legitimately keeps the reason it was
once flagged for. `pending`/`held`/`cancelled` still cannot carry one, so `012`'s actual
intent — no accusation on a pass nobody acted on — is fully preserved.

**Verified live 2026-08-08** with real anon-key JWTs (hod.it + guard): raise → flag →
override → match all succeeded, `flag_reason` intact at every step, and a control pending
pass still came back with `flag_reason = null`. Probe rows deleted; `gate_passes` back to 0.

**Consequence for the UI: a `matched` pass CAN now carry a `flag_reason`.** The note on
commit `89726b3` ("matched passes never have a flag_reason, so the Mismatch Reason column is
pure noise on the Matched tab") is **no longer true** — an overridden-then-matched pass has
one. Revisit that column's visibility if overrides become common.

### `024` — cancellation removed: a raised gate pass is permanent

Business rule fixed 2026-08-04: **once a gate pass is raised it cannot be cancelled or
deleted.** Migration `024` removed every cancellation path — `gatepass.cancel_pass` (the HOD
void), the `gate_passes_delete` policy + the schema's only DELETE grant (the HOD hard-delete),
the `reject` branch of `hod_review_flagged_pass` (a flagged pass can now only be **approved**),
the now-dead `cancel_reason` column, and the `'cancelled'` branches of `validate_pass` /
`lookup_pass`. The enum labels stay — Postgres cannot drop enum values — but no code path sets
them. Verified live: `cancel_pass` gone, `gate_passes_delete` policy gone, `cancel_reason`
column gone. The `VoidPassPanel.tsx` / `DeletePassPanel.tsx` / `useDeletePass.ts` files were
deleted and the Cancel/Delete/Reject buttons removed from `MyPasses` and `PassDetail`.

Companion rule (already true, verified, not changed): **an RGP pass closes only when ALL its
items are fully returned.** `apply_item_returns` (013) rolls lines up into the parent and only
sets `return_status = 'returned'` when no line has `returned_qty < quantity`; a partially
returned multi-item pass stays `partially_returned` (still outstanding, still overdue-reckoned)
until every line is back.

### `023` — admin_create_user collided with VMS's own signup trigger

Every "Add User" in the admin panel failed with **"That record already exists."**, even for
a genuinely unused email. Root cause: `public.handle_new_user()` — VMS's own trigger on
`auth.users`, owned by the `public` schema — fires on the `insert into auth.users` inside
`admin_create_user` and **already inserts the matching `public.profiles` row itself**
(role defaulted to `'staff'`), *and* immediately overwrites `raw_app_meta_data` back to
`role: 'staff'`. `021`'s `admin_create_user` then ran its own `insert into public.profiles`,
which collided with the trigger's row — a `23505` unique violation, which
`src/lib/errors.ts` renders as the generic "already exists" message. Even if that insert
were skipped, the trigger's `app_metadata` overwrite would have silently demoted every new
guard/HOD back to `staff`.

`023` changes `admin_create_user` to `UPDATE` the profile and `app_metadata` the trigger
already created, instead of inserting a second time. **Verified live this session** by
signing in as `admin@demo.vms` and calling the RPC for real (not via `psql`, which runs as
`postgres` and would bypass `is_admin()`): a `guard` and an `hod` test account were created
with the correct `role` in both `public.profiles` and `auth.users.raw_app_meta_data`, then
deleted. `sqlInvariants.test.ts`/`applyAllIntegrity.test.ts` do not (and cannot) catch this
class of bug — it only exists at the intersection of this app's RPC and VMS's trigger,
neither of which is visible from the other's migration files alone.

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
- **The duplicate-material index.** Never tripped by a real second insert.

`verify-rls.mjs` does not yet cover the `009`-era additions. Extending it to check that a
guard cannot call `cancel_pass` and an expired pass is refused by `match_pass` but still
flaggable is the highest-value next test work. (Cancellation itself is gone as of `024` —
there is no longer a `cancel_pass` to refuse.)

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

### HOD delete — removed in migration `024`

The HOD could once **delete** their own still-`pending` pass via an RLS policy
(`gate_passes_delete`), and **void** it via `cancel_pass`. As of `024` neither exists: a
raised gate pass is permanent. The policy + DELETE grant and the RPC were dropped together
so the RPC-only state machine is complete even for the service key. `sqlInvariants.test.ts`
still fails any UPDATE grant, or a DELETE grant anywhere (its one `010` approval is legacy —
`024` revoked it).

### Demo accounts — all set to `demo123` on 2026-07-27

**All 14 accounts** in `auth.users` share the password **`demo123`**, and all are
email-confirmed. Verified by real sign-in through the anon key that `guard@demo.vms`,
`hod.it@demo.vms`, `admin@demo.vms`, `hod.fin@demo.vms` and `staff@demo.vms` each return the
correct `app_metadata.role` in the JWT — which is what RLS authorizes off, not `profiles`.

`demo` itself is impossible: Supabase rejects anything under 6 characters with
`422 weak_password`. Lowering that minimum would weaken it for VMS too, so `demo123` was
chosen instead.

`hod.it@demo.vms` heads Information Technology only — since migration `032` a person belongs
to at most one department (unique index on `hod_departments.hod_id`), so no single account
exercises a multi-department shape any more. `staff@demo.vms` is the one to use for testing
the no-access path.

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

**The CSP in `vercel.json` is a live footgun: it applies ONLY in production.** The Vite dev
server sends no CSP at all, so anything the policy blocks works perfectly on localhost and
fails only once deployed — with no error the user can see. This shipped once: profile photos
were invisible on Vercel because `img-src` was `'self' data: blob:` while avatars are served
cross-origin from `https://oxzzeonftrmohdrancex.supabase.co/storage/v1/object/public/...`.
`connect-src` already allowed that host, so the upload and `set_my_avatar` both *succeeded*
and the row was written — only the `<img>` was blocked, so the symptom was "nothing happens".
Fixed 2026-08-08 by adding the Supabase origin to `img-src`;
`tests/security/cspAllowsSupabase.test.ts` now pins every directive the app depends on.
**Any new remote origin — a CDN, a font host, an image bucket — needs its directive added
there in the same commit, or it will pass every local check and break in production.**

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

**HOD→department is one-to-many** (`gatepass.hod_departments`, one row per person since
`032`; a department may still host several HODs). VMS models the same rule structurally via
`profiles.department_id` (a single column), and the admin functions mirror the sole
department into it so both apps agree. Never write a second row for the same `hod_id` — the
unique index rejects it with a 23505.

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

## Design system — Quest Gold + Charcoal

Rebranded 2026-07-29 to the client's identity (Quest Mall, Kolkata). Seven colours, and
**saturated colour means status, never decoration**.

```
Shell     #16161A sidebar — DARK IN BOTH THEMES (chrome, not content); ink #101014
Primary   brand-600  #C6A15B brass gold   buttons, active nav, focus
Accent    accent-600 #2B3FA0 royal blue   links, secondary emphasis
Status    pending-*  amber   matched-* emerald   flagged-* red   overdue-* orange
Neutral   navy-* / surface-*  warm stone   meta, borders, baselines
Display   Antic Didone (serif, ONE weight) — headings, wordmark
```

Palette sourced from questmall.in's own `css/custom.css` (verified 2026-07-29): gold
`#d0ad68`/`#d09918`, charcoal `#404041`, maroon `#740e0c`, warm off-white `#fff9eb`.

- **Text on gold is charcoal (`shell.ink` / `brand.ink`), never white.** White on
  `#C6A15B` is ~2.4:1 and fails AA; charcoal is ~9.1:1. `.btn-primary` and
  `.sidebar-link-active` already do this — match them.
- **Never apply `font-bold` to `font-display`.** Antic Didone ships weight 400 only;
  bolding it synthesises a smeared faux-bold. Presence comes from size and tracking.
  `.kpi-value` deliberately does NOT use the display face — numerals need a real heavy
  weight and tabular figures.
- **Three warm hues now coexist** — brass gold, amber pending, orange overdue. They are
  separated by *saturation* (gold is muted ~48%, status hues are vivid ~92%) and by
  form: status appears only as a tinted pill with dark text, never as a solid fill.
  Break either of those and the distinction collapses.
- **Fixed-context surfaces must use literal colours, not `navy-*`/`surface-*` tokens.**
  The neutral ramp INVERTS under `.dark`, which is the shipped default (`index.html`
  hardcodes `class="dark"`). Anything that is always-light — the login card, `AuthField`,
  `QuestLockup tone="light"`, the printed slip — renders near-white on near-white if
  tokenised. This bit twice during the rebrand; the print case is invisible on screen.
- Token *names* still match VMS (`brand`/`accent`/`navy`/`surface`) so layout code ported
  from there works unchanged; only the hues differ. **`navy` is a name, not a colour** —
  it is the warm-stone ramp now. Do not rename it; every ported file would follow.
- **The logo is `src/components/QuestMark.tsx`**, redrawn as vector. The client publishes
  their logo only as a JPEG matted onto white (`questmall.in/images/quest-logo.jpg`) —
  that would show a white box with compression fringing on the charcoal shell. Exports
  `QuestMark` (faceted-gem glyph) and `QuestLockup` (gem + wordmark + subtitle,
  `tone="dark"|"light"`). `public/favicon.svg` repeats the same geometry — change both
  together or they drift.
- `.shell-sidebar` hardcodes dark values — never add `dark:` variants to the shell.
  **There is no top bar.** `.shell-topbar` and the `<header>` in `AppShell.tsx` were removed
  2026-07-27: it was a permanently empty dark band, since breadcrumbs never landed there and
  identity lives in `SidebarProfile` by design. `main` carries `pt-20 lg:pt-8` to replace the
  clearance the 64px header gave the fixed mobile hamburger (`Sidebar.tsx:217`). Do not
  reintroduce the strip without content to put in it.
- The printed slip (`PassPrint.tsx`) is black-on-white with **no colour-dependent
  information**; it must read on a cheap mono laser printer. It now carries the
  `QuestLockup` in its header — a logo is decoration, not information, and prints as
  grey. Nothing a guard must *read* may depend on colour.
- **The login background is generated, not hand-edited.** `public/login-bg.jpg` is built
  from the client's facade photo by `scripts/make-login-bg.mjs` (`npm run build:login-bg`,
  needs the `sharp` devDependency). Re-run it rather than editing the JPEG. The lit
  facade sits on the RIGHT of the frame, which is why the login card is anchored LEFT on
  wide screens — it lands on the quiet part of the photo instead of covering the subject.
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
tabs, AdminDashboard, ReportsPage + report views), `Shared/` (PassDetail, PassPrint).
`src/lib/` holds the lookup maps and formatters; `supabase/migrations/` is `001` schema →
`002` RLS → `003` RPCs → `004` views → `005` optional seed.

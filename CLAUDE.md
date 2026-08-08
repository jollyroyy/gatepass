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

`npx vitest run path/to/one.test.tsx` runs a single spec. **266 tests across 16 files
currently pass** (`tests/unit/`, `tests/security/`) — the "zero test specs" note that
used to live here is obsolete.

**After editing any file in `supabase/migrations/`, run `npm run build:sql`.**
`APPLY_ALL.sql` is the artifact a human actually pastes; a migration edited but not
re-concatenated is a fix that never reaches the database.
`tests/security/applyAllIntegrity.test.ts` is the backstop that catches the drift.

## Current state — verified 2026-08-04

Frontend typechecks and passes all **383 tests** (29 files) — verified by a real
`npm run check` run on 2026-08-08. **All migrations through `025` are applied to the live
database**, `024`/`025` applied and verified live 2026-08-04 (see below), `023` verified live, the rest as of 2026-07-27.
**No migration was written this session — every change below is frontend-only.**

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
| `gatepass.gate_passes` | 0 rows — all passes wiped 2026-08-04 |
| `public.departments` | ✅ 5 rows: FIN, HR, IT, SA, DEV |

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
- **`/returns` and `Security/PendingReturns.tsx` are gone.** Its KPIs became two of the drills
  and — critically — **`mark_returned` moved onto `GuardDrillCard.tsx`**, which is now the
  ONLY way a guard can close an RGP. Deleting that tab without moving the action would have
  stranded every returnable pass permanently.
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
**`ROLE_HOME.guard` is still `/console`, not the new dashboard** — the console is the working
screen. Change it if landing on the dashboard is preferred.

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

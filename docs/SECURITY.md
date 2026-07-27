# Security

GatePass runs the material gate pass system for a Mall Management Office: department
heads (Housekeeping, Engineering/MEP, Facilities, Marketing & Events, Retail Operations,
F&B, IT) raise passes for material crossing the service gate / loading bay — tenant
fit-out material, retail stock, event installations, kiosk equipment, HVAC/chiller/lift
spares, signage, F&B equipment, furniture, scrap, contractor tools — and security verifies
each one at the bay, often at night when fit-out work happens after mall hours. This
document is the threat model: what we protect, where the trust boundary actually sits,
the invariants that hold it, how each one is tested, and the ways it has already broken in
practice. See `ARCHITECTURE.md` for how the system is built and `DATABASE.md` for the full
schema.

## Table of contents

1. [What we are actually protecting](#what-we-are-actually-protecting)
2. [Trust boundaries](#trust-boundaries)
3. [The invariants](#the-invariants)
4. [How the invariants are tested](#how-the-invariants-are-tested)
5. [Ways this has actually broken](#ways-this-has-actually-broken)
6. [Operational notes](#operational-notes)

## What we are actually protecting

A gate pass is a promise about physical material: *this much of this thing, leaving the
loading bay with this person, in this vehicle, and — if returnable — coming back by this
date.* The assets are therefore:

1. **The integrity of the gate log.** If a pass can be edited after the fact, the log
   proves nothing. Someone could raise a pass for two boxes, walk out with twenty, then
   edit the record to say twenty was authorised — or edit it back down to two after the
   fact.
2. **Departmental confidentiality.** An HOD must not read another department's passes.
   Retail Operations should not see what Marketing is moving in for an unannounced brand
   launch, and no tenant-linked department should be able to enumerate another tenant's
   shipments.
3. **Attributability.** Every gate action names a person and a time, and cannot be
   repudiated.
4. **Visibility of attempts, not just successes.** A forged QR presented at the loading
   bay at 2am must leave a trace even though it was rejected.

## Trust boundaries

| Zone | Trusted? | Notes |
|---|---|---|
| The browser bundle | **No** | Anyone can read it and call any API it can. The anon key is public by design. |
| `roleRoutes.ts` / `RouteGuard` | **No** — UX only | Stops a wrong-role user seeing a broken screen. Deleting it would leak nothing. |
| The user's JWT `app_metadata` | **Yes** | Server-writable only. |
| The user's JWT `user_metadata` | **NEVER** | Users can write it themselves. Authorizing off it would let any account promote itself to `guard`. |
| Postgres RLS + grants + SECURITY DEFINER functions | **Yes — this is the boundary** | Everything else is defence in depth. |
| The `service_role` key | Trusted, and must never reach the browser | Bypasses RLS entirely. |

## The invariants

### 1. No client holds `UPDATE` on `gatepass.gate_passes`

Migration `002` grants `authenticated` only `select, insert`. There is no UPDATE policy on
the table in any migration. State changes go exclusively through the `SECURITY DEFINER`
RPCs `match_pass`, `flag_pass`, `mark_returned`, `cancel_pass`.

*Why this shape:* Postgres RLS cannot express "you may change `status` but not
`visitor_name`". A policy authorizes a row, not a column. Since the whole value of the gate
log is that the material description cannot be edited after the fact, column authority has
to live in functions instead.

*If it breaks:* an HOD rewrites `material_description` or `quantity` on a pass that has
already been matched at the loading bay, and the log now attests to something that never
happened.

*Rule:* route new state changes through a new RPC. Never add an UPDATE policy.

### 2. The only DELETE is an HOD deleting their own still-pending pass

Policy `gate_passes_delete` (migration `010`): `status = 'pending'` AND
`raised_by = auth.uid()` AND `app_role() = 'hod'`.

*Why a policy and not an RPC:* deletion has no columns to constrain, so a policy states the
whole rule exactly. This is not an inconsistency with invariant 1.

*Accepted costs, decided explicitly:* the pass number is consumed and leaves a permanent
gap; a printed slip becomes unscannable showing only `not_found`; the record of the mistake
is gone. Void (`cancel_pass`) remains the better path and stays in the UI beside it.

*If it breaks* (e.g. the `status = 'pending'` clause is dropped): an HOD erases a pass that
security already flagged — the exact record of a discrepancy disappears, erased by the
person it implicates.

### 3. `anon` holds nothing at all

Migration `009` revokes `usage` on the schema plus all table, sequence and function
privileges from `anon`. Schema `USAGE` is checked before table privileges, which is why a
probe returns `42501 permission denied for schema gatepass` and never names a table.

*If it breaks:* the whole pass log is world-readable to anyone with the public anon key,
which is in the browser bundle by design.

### 4. `service_role` holds no privilege at all on `gate_passes`

Migration `007` grants it `usage` on the schema, `select, insert, delete` on
`hod_departments`, and `select` on `verifications` — the narrowest set that unblocks
`scripts/verify-rls.mjs`. Nothing on `gate_passes`.

*Why:* the RPC-only state machine must hold even for the service key. A leaked service key
should not be able to silently rewrite gate history.

### 5. Views carry `with (security_invoker = true)`

Without it a view runs as its owner and bypasses RLS entirely — any HOD would read every
department's passes.

*The one deliberate exception* is `gatepass.profile_names`, which is owner-rights on
purpose so it can read `public.profiles` without triggering VMS's recursive policy. It
exposes exactly two columns, `id` and `full_name`, and nothing else — the blast radius of
an owner-rights view is kept as small as it can be.

### 6. `SECURITY DEFINER` functions pin `set search_path = ''` and fully qualify every reference

A mutable `search_path` in a definer function is a privilege-escalation vector: an attacker
creates a same-named object in a schema that resolves first and the function executes their
code with the owner's rights.

*The three deliberate exceptions* — `site_tz()`, `normalize_material()`, `kpis()` — are
neither SECURITY DEFINER nor pinned, because they are stable/immutable read-only helpers
that intentionally run as invoker. `kpis()` in particular runs as invoker precisely so RLS
scopes its numbers to what the caller may see.

### 7. Every RPC re-checks the caller's role itself

`match_pass`, `flag_pass`, `mark_returned` and `lookup_pass` each call
`gatepass.is_security()`; `cancel_pass` requires `app_role() = 'hod'` AND
`raised_by = auth.uid()`. Execute is granted broadly to `authenticated` — the grant is not
the check.

*Why:* a grant is coarse. The function is where the fine-grained rule lives, and it must
not assume the grant already filtered anyone out.

### 8. The QR encodes `qr_token`, never `pass_number`

`pass_number` is sequential (`RGP-OUT-20260727-0001`), so a QR built from one can be forged
for a pass nobody ever held — you could guess tomorrow's number. `qr_token` is a random
uuid with a unique index. Printed slips still show the human-readable number, because the
typed field is the fallback when a camera fails.

### 9. Authorization reads `app_metadata.role`, never `user_metadata`

`gatepass.app_role()` reads `auth.jwt() -> app_metadata ->> role` with a
`public.profiles` fallback; the frontend's `getUserRole()` reads the same claim, so the two
agree by construction. Accounts must be created with `app_metadata.role` set or RLS cannot
authorize them at all.

### 10. The service-role key never gets a `VITE_` prefix

Vite inlines every `VITE_*` variable into the public browser bundle at build time. A
`VITE_`-prefixed service key would ship an RLS-bypassing credential to every visitor. It
appears only in `scripts/create-user.ts`, never under `src/`. `.gitignore` uses `.env*`
with `!.env.example` — an exact-name rule would not have caught `.env.bak` or a renamed
copy, and a real database password did land in the wrong env file once.

### 11. `is_overdue` and `is_expired` are defined once each, in the view

Not a confidentiality property but an integrity one: a screen that disagrees with
`match_pass` about expiry is a guard arguing with a driver about whether a piece of paper is
still valid, and the screen loses. Never recompute either in TypeScript.

### 12. `flag_pass` deliberately does not check expiry, while `match_pass` does

An expired pass is stale paperwork; refusing to *match* it is correct, because the
authorization lapsed. Refusing to *flag* it would mean refusing to record a real mismatch
because the paperwork went stale — and the mismatch is exactly the thing you most need
written down. This asymmetry is intentional; do not "fix" it.

### 13. Every scan is logged, including the failures

`gatepass.lookup_pass` writes to `scan_attempts` on every call, whatever the outcome.
`verifications` records what succeeded; `scan_attempts` records what was *tried*. That
difference is the only way a forged-QR probe at the loading bay becomes visible at all.
`scan_attempts_outcome_idx` is a partial index `where outcome <> 'ok'`, so querying just the
failures is cheap.

### 14. One pending pass per material per department

`gate_passes_one_pending_per_material_idx` is a unique partial index on
`(department_id, gatepass.normalize_material(material_description)) where status =
'pending'`. Race-safe by construction — a `select … if exists` check is not, and would let
two simultaneous submissions both pass the check.

## How the invariants are tested

| Layer | What it covers | Limits |
|---|---|---|
| `tests/security/sqlInvariants.test.ts` | Greps every migration file. Fails on any UPDATE grant on `gate_passes`, any DELETE grant outside `010`, missing `security_invoker`, unpinned `search_path`, and unsafe use of a new enum value in the same transaction. | **Reads files, not the database.** It cannot see drift introduced outside the migrations. |
| `tests/security/applyAllIntegrity.test.ts` | `APPLY_ALL.sql` matches the concatenated migrations. | Catches "edited the migration but forgot `npm run build:sql`". |
| `tests/security/clientSecrets.test.ts` | No service-role key or secret under `src/`. | Static. |
| `tests/security/noDirectProfilesRead.test.ts` | Nothing reads `public.profiles` directly; everything goes through `gatepass.my_profile()` / `profile_names`. | Static. |
| `scripts/verify-rls.mjs` | **Live** RLS checks using real `anon`-key JWTs for a throwaway HOD and guard — so it proves RLS as the browser sees it. | Requires the database. Cannot delete the pass it raises (invariant 1 applies to it too), so it prints manual cleanup SQL instead. Do not "fix" that by adding the grant. |

**A `psql` session as `postgres` bypasses RLS entirely and can never prove RLS works.**
Only `set local role` probes or a real anon/authenticated JWT can. Say which credential
proved a claim whenever you record one.

`verify-rls.mjs` currently proves: a guard cannot PATCH `gate_passes` (`42501`); an HOD
cannot PATCH their own pass after raising it (`42501`); an HOD cannot match their own pass
(`Only security can verify a gate pass.`); a second match is refused; and a matched pass
reads back with a verifier name.

**The highest-value next test work** is extending `verify-rls.mjs` to the `009`-era
additions: that a guard cannot call `cancel_pass`, that an HOD cannot cancel another HOD's
pass, that a cancelled pass cannot be matched, and that an expired pass is refused by
`match_pass` but is still flaggable.

## Ways this has actually broken

**Grant drift: the dashboard undoes your grants.**
Probed live before migration `009`, `gate_passes` carried `DELETE, INSERT, SELECT, UPDATE`
for **all three** of `anon`, `authenticated` and `service_role` — flatly contradicting
invariant 1. The cause was not a bad migration: **adding a schema to "Exposed schemas" in
the Supabase dashboard also runs `grant all on all tables in schema gatepass to anon,
authenticated, service_role`.** It is a one-time blanket grant over existing objects; no
`pg_default_acl` entry is left behind, so newly created objects are unaffected.

The app was never actually exploitable, because RLS held on its own: `gate_passes` has only
`gate_passes_select` and `gate_passes_insert` policies, both scoped to `authenticated`, so
UPDATE failed for want of a policy, and `anon` had no policy at all. What was lost was a
layer of defence in depth — and the remaining layer was one careless `for all` policy away
from total.

`sqlInvariants.test.ts` **cannot** catch this. It greps migration files, which were always
clean. Only live verification sees dashboard-introduced drift.

**→ Re-run migration `009` whenever anyone toggles Exposed schemas.** It is idempotent and
written to be re-run.

**`42P17 infinite recursion` from a neighbouring app.**
VMS has a recursive RLS policy on `public.profiles`. Because `v_gate_passes` runs with
`security_invoker = true`, that recursion propagated into our view and broke every list
screen at once. Migration `006` isolates us behind `gatepass.profile_names` and
`gatepass.my_profile()`. VMS's own `public.profiles` still throws it; `verify-rls.mjs`
reports that as one informational result, and it is expected and not ours.

**A misread error code nearly caused a duplicate migration.**
A `PGRST205`/`PGRST202` was read as "migration `006` was never applied", when in fact every
object existed and PostgREST's **schema cache** was merely stale. **Query `pg_catalog`
before concluding a migration did not run** — a PostgREST error code cannot distinguish a
missing object from a stale cache.

**A lint command that checked nothing.**
`npm run lint` runs bare `tsc --noEmit`, which picks up the root `tsconfig.json` — and that
file is `{"files": [], "references": [...]}`. Project references are not followed without
`--build`, so it type-checked **zero files** and always exited 0. It passed cleanly while a
real missing-enum-key error sat in `PassDetail.tsx`. **Use `npm run check`.** A green check
that checks nothing is worse than no check at all.

## Operational notes

- **Demo accounts share a well-known password and are for demonstration only.** Change or
  remove them before the system carries real mall traffic, and never reuse them on an
  instance holding tenant data.
- **`auth.users` is shared with the VMS visitor system.** There is one credential set
  across both apps — changing a password here changes it there.
- **Every existing VMS guard automatically has loading-bay console access,** and every VMS
  HOD can raise passes once assigned a department. Audit the VMS user list before going
  live, because the role mapping is inherited, not defined here.
- Migration `005` is an optional demo seed — **skip it in a real deployment**.
- **`Permissions-Policy: camera=(self)`** in `vercel.json` must stay permissive enough for
  the loading-bay scanner; a restrictive value silently kills the camera.
- Deploy with exactly two environment variables: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. **Never add `SUPABASE_SERVICE_ROLE_KEY` to the frontend
  deployment.**

See also: `ARCHITECTURE.md` for the system design these invariants sit inside, and
`DATABASE.md` for the full schema, migrations, and RPC signatures.

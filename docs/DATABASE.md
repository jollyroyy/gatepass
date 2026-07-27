# Database Reference — `gatepass` schema

GatePass runs the material gate pass workflow for a shopping mall's loading bay: department
heads inside the Mall Management Office raise passes for material moving in or out through the
service gate, and security matches or flags them against the physical load. This document is
the full inventory of the `gatepass` Postgres schema — every table, enum, constraint, index,
function, view, policy and grant — and the reasoning behind each one, so that a future change
doesn't quietly undo a decision that was made for a reason.

For how these pieces fit into the application layer, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
For the security model — RLS as the actual boundary, the grant-drift incident, and how to
verify it live — see [`SECURITY.md`](./SECURITY.md).

## Table of contents

1. [The two-schema rule](#the-two-schema-rule)
2. [Entity overview](#entity-overview)
3. [Tables](#tables)
4. [Enums](#enums)
5. [Check constraints](#check-constraints)
6. [Indexes](#indexes)
7. [Functions](#functions)
8. [Views](#views)
9. [RLS policies](#rls-policies)
10. [Grants](#grants)
11. [Migration history](#migration-history)
12. [Working on migrations](#working-on-migrations)

## The two-schema rule

This project shares one Supabase project with a separate **VMS visitor-management system**.

| Schema | Owner | Contents |
|---|---|---|
| `public` | **VMS — treat as read-only** | `profiles`, `departments`, `auth.users` |
| `gatepass` | this app | `gate_passes`, `verifications`, `hod_departments`, `scan_attempts` |

`public.departments` are the mall's own departments (Housekeeping, Engineering/MEP,
Facilities, Security, Marketing & Events, Retail Operations, F&B, IT, and so on), and
`public.profiles` is VMS's user table with its own role enum. GatePass never alters either —
**no migration in this repo may write DDL against `public`.** New objects always go in
`gatepass`, and where they need to reference a mall department or a person, they do it with a
foreign key into `public.departments` / `public.profiles`, never by copying or duplicating
those tables' data.

Two consequences worth remembering:

- Creating a department from the GatePass admin UI writes into VMS's shared
  `public.departments` table, so VMS sees it too.
- VMS's `profiles.role` enum is what GatePass authorizes against (see
  [`SECURITY.md`](./SECURITY.md) for the JWT/`app_metadata` mechanics) — there is no
  GatePass-specific role type.

## Entity overview

```
 public.profiles                      public.departments
 (VMS, read-only)                     (VMS, read-only)
  id  full_name  role                  id  name  code
      │                                    │
      │  hod_id                department_id
      ▼                                    ▼
 ┌─────────────────────────────────────────────────┐
 │            gatepass.hod_departments               │
 │  hod_id (fk profiles) + department_id (fk depts)  │
 │  composite primary key (hod_id, department_id)    │
 └─────────────────────────────────────────────────┘

 public.profiles ──┐
   (raised_by)      │
   (verified_by)    ▼
              ┌───────────────────────────────────────┐
              │        gatepass.gate_passes              │
              │  id  pass_number  type  status  direction │
              │  department_id (fk departments)           │
              │  raised_by / verified_by (fk profiles)     │
              │  qr_token  expires_at  cancel_reason  ...  │
              └───────────────────────────────────────┘
                  │                              │
                  │ gate_pass_id                 │ gate_pass_id (nullable, on delete set null)
                  ▼                              ▼
   ┌───────────────────────────┐   ┌───────────────────────────────┐
   │  gatepass.verifications      │   │  gatepass.scan_attempts          │
   │  what succeeded — audit trail│   │  what was TRIED, incl. failures  │
   │  action  security_user_id    │   │  scanned_code  scanned_by outcome│
   └───────────────────────────┘   └───────────────────────────────┘

 Views (all security_invoker except profile_names):
   gatepass.v_gate_passes    — gate_passes + department + raised_by/verified_by names
   gatepass.v_verifications  — verifications + security officer name
   gatepass.profile_names    — owner-rights escape hatch around VMS's recursive profiles RLS
```

## Tables

### `gatepass.hod_departments`

Created in `001`. The many-to-many join between HODs and the mall departments they cover.

| Column | Type | Notes |
|---|---|---|
| `hod_id` | uuid | not null, references `public.profiles(id)` on delete cascade |
| `department_id` | uuid | not null, references `public.departments(id)` on delete cascade |
| `created_at` | timestamptz | not null default `now()` |

Primary key: composite `(hod_id, department_id)`, unnamed.

**Why a join table at all:** VMS's `profiles.department_id` is a single column and can only
express one department per person. The live data contradicts that shape twice over — one HOD
covering IT, DEV and SA simultaneously, and two HODs assigned to the same department. A join
table is the only shape that holds both directions of that many-to-many without touching VMS's
column, which stays untouched and ignored here.

### `gatepass.gate_passes`

Created in `001`; altered in `008` and `010`. The core table — one row per pass raised for
material crossing the loading bay.

| Column | Type | Notes | Added |
|---|---|---|---|
| `id` | uuid | primary key, default `gen_random_uuid()` | 001 |
| `pass_number` | text | not null, unique, set by trigger `set_pass_number` | 001 |
| `type` | `gatepass.pass_type` | not null | 001 |
| `status` | `gatepass.pass_status` | not null default `'pending'` | 001 |
| `department_id` | uuid | not null, references `public.departments(id)` | 001 |
| `raised_by` | uuid | not null, references `public.profiles(id)` | 001 |
| `visitor_name` | text | not null — the person physically carrying/escorting the material | 001 |
| `visitor_company` | text | nullable — typically the tenant, brand, or contractor firm | 001 |
| `material_description` | text | not null | 001 |
| `quantity` | numeric(12,2) | not null, inline check `quantity > 0` (auto-named) | 001 |
| `unit` | text | not null default `'nos'` | 001 |
| `vehicle_number` | text | nullable | 001 |
| `purpose` | text | not null | 001 |
| `expected_return_date` | date | nullable, RGP only | 001 |
| `return_status` | `gatepass.return_status` | not null default `'not_applicable'` | 001 |
| `actual_return_date` | timestamptz | nullable | 001 |
| `verified_by` | uuid | nullable, references `public.profiles(id)` | 001 |
| `verified_at` | timestamptz | nullable | 001 |
| `flag_reason` | text | nullable | 001 |
| `created_at` | timestamptz | not null default `now()`, server-forced by trigger | 001 |
| `updated_at` | timestamptz | not null default `now()`, trigger-maintained | 001 |
| `qr_token` | uuid | not null default `gen_random_uuid()`, unique via index | 008 |
| `expires_at` | timestamptz | added nullable, backfilled, then set not null | 008 |
| `cancel_reason` | text | nullable | 008 |
| `direction` | `gatepass.pass_direction` | not null default `'out'` | 010 |

`visitor_name`/`visitor_company` map onto mall reality: a fit-out contractor's site
supervisor signing for a scaffolding delivery, or an event vendor's crew lead bringing in
staging equipment for Marketing & Events.

### `gatepass.verifications`

Created in `001`. Append-only audit trail of gate actions that **succeeded** — every match,
flag, return, and cancellation, and who performed it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | pk default `gen_random_uuid()` |
| `gate_pass_id` | uuid | not null, references `gatepass.gate_passes(id)` on delete cascade |
| `action` | `gatepass.verify_action` | not null |
| `security_user_id` | uuid | not null, references `public.profiles(id)` |
| `verified_quantity` | numeric(12,2) | nullable |
| `verified_vehicle` | text | nullable |
| `remarks` | text | nullable |
| `created_at` | timestamptz | not null default `now()` |

### `gatepass.scan_attempts`

Created in `008`. Append-only log of **every** QR/pass-number scan at the loading bay,
including failures.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | pk default `gen_random_uuid()` |
| `scanned_code` | text | not null |
| `gate_pass_id` | uuid | nullable, references `gatepass.gate_passes(id)` on delete set null |
| `scanned_by` | uuid | not null, references `public.profiles(id)` |
| `outcome` | text | not null |
| `created_at` | timestamptz | not null default `now()` |

`verifications` records what **succeeded**; `scan_attempts` records what was **tried**. That
distinction is what makes a forged-QR probe at the loading bay visible at all — a guard
scanning a QR code that resolves to `not_found` still leaves a row, even though no
`gate_passes` row was ever touched.

## Enums

| Enum | Created | Labels | Notes |
|---|---|---|---|
| `gatepass.pass_type` | 001 | `'IGP'`, `'OGP'`, `'RGP'`, `'NRGP'` | `'IGP'`/`'OGP'` are RETIRED but undroppable — Postgres cannot drop an enum label. Made unreachable by check constraint `gate_passes_type_is_current`. |
| `gatepass.pass_status` | 001, extended 008 | `'pending'`, `'matched'`, `'flagged'`, `'cancelled'` | `'cancelled'` added in 008 via `alter type ... add value if not exists` |
| `gatepass.return_status` | 001 | `'not_applicable'`, `'awaiting_return'`, `'returned'` | unchanged |
| `gatepass.verify_action` | 001, extended 008 | `'matched'`, `'flagged'`, `'returned'`, `'cancelled'` | `'cancelled'` added 008 |
| `gatepass.pass_direction` | 010 | `'in'`, `'out'` | created fresh as a new type, not via `add value` |

### The two-axis pass model (migration `010`)

The original four `pass_type` labels conflated two independent facts, and — critically —
**OGP and NRGP meant exactly the same thing**. Worse, "inward-returnable" — a fit-out
contractor bringing in their own scaffolding or scissor lift, which must leave again — could
not be expressed at all under the old four-label scheme.

`010` split the concept into two orthogonal axes:

```
type      = does it come back?      RGP | NRGP
direction = which way is it going?  in  | out
```

Only three combinations are legal in this mall's operations, enforced by check constraints
(not by the UI dropdown):

| Combination | Real example at the loading bay |
|---|---|
| `RGP` + `out` | The mall's own chiller pump going out to a vendor for repair; a marketing LED wall going out to an event contractor |
| `RGP` + `in` | A fit-out contractor's scaffolding, scissor lift, or power tools coming in — must leave again |
| `NRGP` + `out` | Scrap, waste, disposal; a tenant vacating and removing their own fixtures for good |

`src/lib/passTypes.ts` mirrors this in `PASS_CATEGORIES`, which is what the gate console
filters on — a guard picks a whole category (e.g. "RGP outward"), not two independent axes.

## Check constraints

All on `gatepass.gate_passes`.

| Name | Migration | Enforces |
|---|---|---|
| auto-named on `quantity` | 001 | `quantity > 0` |
| `rgp_needs_return_date` | 001 | `(type = 'RGP') = (expected_return_date is not null)` — an RGP must carry a return date; no other type may |
| `flagged_needs_reason` | 001 | `status <> 'flagged' or (flag_reason is not null and length(trim(flag_reason)) > 0)` |
| `only_rgp_returns` | 001 | `return_status = 'not_applicable' or type = 'RGP'` |
| `returned_needs_date` | 001 | `return_status <> 'returned' or actual_return_date is not null` |
| `gate_passes_type_is_current` | 010 | `type in ('RGP', 'NRGP')` — retires IGP/OGP from being insertable |
| `gate_passes_nrgp_is_outward` | 010 | `type <> 'NRGP' or direction = 'out'` — NRGP is outward-only |
| `gate_passes_text_not_blank` | 012 | `length(trim(visitor_name)) > 0 and length(trim(material_description)) > 0 and length(trim(purpose)) > 0 and length(trim(unit)) > 0` — `not null` alone doesn't mean "has a value"; `''` and `'   '` both satisfy `not null` |
| `gate_passes_optional_text_not_blank` | 012 | `(visitor_company is null or length(trim(visitor_company)) > 0) and (vehicle_number is null or length(trim(vehicle_number)) > 0)` — stops `''` and `NULL` meaning "missing" in the same column, which is how a report double-counts one missing vehicle |
| `gate_passes_quantity_sane` | 012 | `quantity <= 1000000` — `001`'s `quantity > 0` had no upper bound, so a fat-fingered `99999999` passed silently |
| `gate_passes_verified_pair` | 012 | `(verified_by is null) = (verified_at is null)` — verification is one event; a half-set pair is a matched pass with no verifier name, indistinguishable from tampering |
| `gate_passes_timeline_sane` | 012 | `(verified_at is null or verified_at >= created_at) and (actual_return_date is null or actual_return_date >= created_at) and expires_at > created_at` — time cannot run backwards; reachable only via a bad direct write, which is exactly what the RPCs can't defend against |
| `gate_passes_flag_reason_only_when_flagged` | 012 | `flag_reason is null or status = 'flagged'` — `001`'s `flagged_needs_reason` requires a reason WHEN flagged; this is the converse, requiring flagged status whenever there IS a reason, so a pending pass can't carry an accusation nobody acted on |
| `gate_passes_matched_rgp_owes_return` | 012 | `status <> 'matched' or type <> 'RGP' or return_status <> 'not_applicable'` — a matched RGP always owes a return; `not_applicable` there would mean material left the loading bay with nothing tracking its way back |

**Why NRGP is outward-only:** permanently *inbound* material at a mall's loading bay is a
goods receipt — a new POS terminal being delivered to a tenant, stock arriving for a store
opening — not a gate pass. The loading bay never had custody of that material in the sense a
gate pass records (something that came in through the gate and must be accounted for going
back out, or something going out that the gate must remember left). Claiming otherwise in the
gate log would be recording custody the gate never actually held. If inbound deliveries ever
need tracking, that's a goods-receipt-note (GRN) feature — a different table with a different
lifecycle — not a fourth `pass_type` label bolted onto this one.

**Deliberately absent: `cancelled_needs_reason`.** A constraint referencing the freshly-added
`'cancelled'` enum label would be evaluated at DDL time, and Postgres aborts any statement in
the *same transaction* that added the enum label with "unsafe use of new value" if that
statement references it. Since `APPLY_ALL.sql` is pasted as one single transaction, that would
kill the entire paste, not just the one constraint. `008` enforced the reason requirement
procedurally instead, inside `gatepass.cancel_pass()`; `012` widens that from "only `cancel_pass`
checks it" to "no write can avoid it" — the `gatepass.validate_pass()` trigger (see
[Functions](#functions)) independently rejects a `'cancelled'` status with a blank or null
`cancel_reason`, and also rejects a `cancel_reason` set on any row that isn't `'cancelled'`, on
both INSERT and UPDATE, regardless of which code path produced the write. `validate_pass()` hits
the exact same "unsafe use of new value" trap and stays plpgsql for the same reason — see
[Working on migrations](#working-on-migrations) for the general rule.

**Deliberately NOT added, as of `012`** (decisions, not oversights):

- A CHECK constraining `scan_attempts.outcome` to the six known outcome strings. The column is
  `text`, so the literal `'cancelled'` there would be perfectly safe at DDL time — but
  `tests/security/sqlInvariants.test.ts` greps every CHECK body in the migrations for that word
  and can't distinguish a text literal from an enum value. Loosening a security test to buy a
  nice-to-have constraint is the wrong trade.
- Blocking an HOD from raising a new pass while they already have an overdue RGP. It would stop
  real work at the loading bay over paperwork, and the overdue list already surfaces the
  problem without blocking anyone.
- Uniqueness on `vehicle_number` while a pass is open. One van legitimately carries several
  passes on one trip through the loading bay.

## Indexes

| Name | Table / columns | Unique | Partial | Migration | Status |
|---|---|---|---|---|---|
| `hod_departments_dept_idx` | `hod_departments (department_id)` | no | no | 001 | live |
| `gate_passes_status_idx` | `gate_passes (status)` | no | no | 001 | live |
| `gate_passes_dept_idx` | `gate_passes (department_id)` | no | no | 001 | live |
| `gate_passes_raised_by_idx` | `gate_passes (raised_by)` | no | no | 001 | live |
| `gate_passes_created_idx` | `gate_passes (created_at desc)` | no | no | 001 | live |
| `gate_passes_type_idx` | `gate_passes (type)` | no | no | 001 | **DROPPED in 011** |
| `gate_passes_awaiting_idx` | `gate_passes (expected_return_date)` | no | `where return_status = 'awaiting_return'` | 001 | live |
| `verifications_pass_idx` | `verifications (gate_pass_id, created_at desc)` | no | no | 001 | live |
| `gate_passes_qr_token_idx` | `gate_passes (qr_token)` | **YES** | no | 008 | live |
| `gate_passes_one_pending_per_material_idx` | `gate_passes (department_id, gatepass.normalize_material(material_description))` | **YES** | `where status = 'pending'` | 008 | **DROPPED in 012**, superseded below |
| `gate_passes_one_open_per_material_idx` | `gate_passes (department_id, gatepass.normalize_material(material_description))` | **YES** | `where status = 'pending' or return_status = 'awaiting_return'` | 012 | live |
| `scan_attempts_created_idx` | `scan_attempts (created_at desc)` | no | no | 008 | live |
| `scan_attempts_outcome_idx` | `scan_attempts (outcome)` | no | `where outcome <> 'ok'` | 008 | live |

**Why `011` dropped `gate_passes_type_idx`:** `010` shrank `type` from four values to two
(`RGP`/`NRGP`). A btree over a column with two possible values is close to useless for
selectivity, and nothing server-side ever filters on `type` alone — every real query either
filters on `status` (which has its own index) or on the combination the UI actually uses
(`PASS_CATEGORIES`, which is `type` + `direction` together, not `type` alone). Keeping a dead
index costs write overhead on every insert and update for no read benefit, so it was dropped
rather than left "in case" — see the [Working on migrations](#working-on-migrations) rule
against unused schema.

**Why the other six `gate_passes` indexes are kept:** each backs a real, distinct query path —
`status` for the gate console's pending queue, `department_id` for HOD-scoped views,
`raised_by` for "my passes", `created_at desc` for the default sort, the partial
`awaiting_return` index for the overdue-returns screen, and the unique `qr_token` index for
camera-scan lookups.

### The open-pass rule (migration `012`)

`gate_passes_one_pending_per_material_idx` (008) enforced **one pending pass per material per
department** — a fit-out contractor couldn't raise two RGP-in passes for the same scissor lift
from the same department. But its predicate, `where status = 'pending'`, only covers the window
between an HOD raising a pass and a guard verifying it at the loading bay. The moment a guard
**matches** an RGP, the row moves to `matched` / `awaiting_return` and falls straight out of
that predicate — so nothing stopped Engineering from raising a *second* `RGP-out` pass for
"Chiller Pump #3" the moment the first one cleared the gate, even though there is exactly one
pump and it is already off site being repaired.

`012` drops that index and replaces it with `gate_passes_one_open_per_material_idx`, widening
the predicate to `where status = 'pending' or return_status = 'awaiting_return'` — "still
open," not merely "not yet verified." `flagged`, `cancelled`, `returned`, and matched-`NRGP`
rows all fall outside the predicate, because none of them leaves an obligation outstanding — a
pump that has come back **should** be sendable out again. Both enum values are pre-existing
labels from `001`, so the predicate is safe to evaluate inside the single transaction
`APPLY_ALL.sql` pastes (see the enum-in-same-transaction trap under
[Working on migrations](#working-on-migrations)).

Scoped per department on purpose: `material_description` is free text, and two departments
each moving something they both happen to call "trolley" is not a duplicate.

It remains race-safe by construction — the database rejects the second concurrent insert at
the constraint level, where a `select … if exists` check in application code is not — and
match-insensitive via `gatepass.normalize_material()`, so `'  chiller   pump #3 '` collides
with `'Chiller Pump #3'`.

## Functions

### Trigger functions

**`gatepass.set_pass_number()`** — trigger, `SECURITY DEFINER`, `search_path = ''`. Fires
before insert on `gate_passes`. Generates `pass_number` under an advisory lock — a plain
`max()+1` lets concurrent inserts collide on the unique constraint, which is exactly the bug
VMS had to patch — and forces server-owned `created_at`/`updated_at` so a client can't backdate
a pass. Rewritten in `008` (also stamps `qr_token` and `expires_at`) and again in `010`
(prefix now includes direction, e.g. `RGP-OUT-...`).

**`gatepass.touch_updated_at()`** — trigger, `search_path = ''`. Fires before update on
`gate_passes`. Forces `updated_at = now()` and pins immutable columns against client
tampering — progressively `pass_number`, `created_at`, then `qr_token`, `expires_at`, `type`,
`direction`, `raised_by` as those columns were added.

> **Privilege change to flag:** this function was **not** `SECURITY DEFINER` in `001` or `008`,
> but **is** as of the `010` replacement. Anyone touching this trigger again should treat that
> as a deliberate, load-bearing change, not an oversight to "fix" back — verify why it needed
> definer rights in `010` (likely to reliably re-assert the pinned columns regardless of the
> caller's own privileges) before altering it further.

**`gatepass.validate_pass()`** — trigger, `SECURITY DEFINER`, `search_path = ''`. Added `012`.
Fires `before insert or update on gate_passes for each row`, as the `validate_pass` trigger.
Postgres fires BEFORE triggers in alphabetical order — `set_pass_number` < `touch_updated_at` <
`validate_pass` — so this one deliberately runs last and sees the fully-stamped row
(`pass_number`, `qr_token`, `expires_at` already set).

On INSERT it **normalises**, ahead of the CHECK constraints (which is why this has to be a
BEFORE trigger and not a constraint: CHECK constraints run after every BEFORE trigger, so a
`'   '` value is trimmed to `''` by this trigger and only then correctly rejected, rather than
silently stored as whitespace):

- trims `visitor_name`, `material_description`, `purpose`
- lower-cases and trims `unit`
- collapses a blank `visitor_company` or `vehicle_number` to `NULL`, so "not given" has exactly
  one spelling
- **upper-cases `vehicle_number`** — plates get eyeballed at the loading bay, often at night, so
  they're stored one consistent way (`' mh12 ab 1234 '` → `'MH12 AB 1234'`)

On INSERT it **rejects**, using `(now() at time zone gatepass.site_tz())::date` rather than raw
UTC (UTC would misjudge anything raised after 18:30 local by a full day, since `Asia/Kolkata` is
UTC+5:30):

- `expected_return_date` earlier than today — "a pass cannot be born overdue"
- `expected_return_date` more than 365 days out — catches a mistyped year (`2260` for `2026`),
  which would otherwise sit on the awaiting-return list forever and never once show as overdue

On INSERT **and** UPDATE it rejects:

- `status = 'cancelled'` with a blank or null `cancel_reason` — "an unexplained void is
  indistinguishable from a cover-up"
- `status = 'cancelled'` while `verified_by` or `verified_at` is set — a pass can't be both
  withdrawn by the HOD and verified at the loading bay; one of those records would be false with
  no way to tell which
- `cancel_reason` set while `status` is anything other than `'cancelled'`
- `return_status = 'returned'` with `actual_return_date < verified_at` — material can't come
  back before it went out

**Must stay plpgsql.** It names the `'cancelled'` enum label (added `008`), and `APPLY_ALL.sql`
runs `008` and `012` in the same single transaction — a CHECK constraint or a `language sql`
body naming that label would abort the whole paste with "unsafe use of new value." This is the
same trap that kept `008` from adding a `cancelled_needs_reason` constraint (see
[Check constraints](#check-constraints)); it hasn't gone away, so the rule lives in this trigger
instead. `tests/security/sqlInvariants.test.ts` pins `validate_pass` as plpgsql.

### Role helpers

All `SECURITY DEFINER`, `search_path = ''`, granted `execute` to `authenticated`, added in
`002`.

| Function | Returns | Purpose |
|---|---|---|
| `gatepass.app_role()` | text | Reads `auth.jwt() -> app_metadata ->> role`, falling back to `public.profiles.role` |
| `gatepass.is_security()` | boolean | `app_role() in ('guard','admin','super_admin')` |
| `gatepass.is_admin()` | boolean | `app_role() in ('admin','super_admin')` |
| `gatepass.my_department_ids()` | setof uuid | Departments the calling HOD covers, from `hod_departments`. `SECURITY DEFINER` specifically to avoid RLS self-recursion — a plain invoker-rights query joined against a policy that itself calls this function would recurse |

### State-machine RPCs

All `SECURITY DEFINER`, `search_path = ''`, granted `execute` to `authenticated`; each
self-checks the caller's role rather than trusting the grant, and each row-locks with
`for update` so two guards can't race the same pass.

| Function | Signature | Added / changed | Purpose |
|---|---|---|---|
| `gatepass.match_pass` | `(p_pass_id uuid, p_verified_quantity numeric default null, p_verified_vehicle text default null, p_remarks text default null) → gatepass.gate_passes` | 003, replaced 008 | The **only** path to `'matched'`. Requires `is_security()`. Writes a `verifications` row. `008` added the expiry check. |
| `gatepass.flag_pass` | `(p_pass_id uuid, p_reason text) → gatepass.gate_passes` | 003 | The **only** path to `'flagged'`. Requires `is_security()` and a non-blank reason. **Deliberately does not check expiry** — refusing to record a real mismatch because the paperwork went stale would be backwards. |
| `gatepass.mark_returned` | `(p_pass_id uuid, p_remarks text default null) → gatepass.gate_passes` | 003 | `'awaiting_return'` → `'returned'`. Requires `is_security()`. |
| `gatepass.cancel_pass` | `(p_pass_id uuid, p_reason text) → gatepass.gate_passes` | 008 | Lets the HOD who raised a still-pending pass void it. Requires `app_role() = 'hod'`, a non-blank reason, and `raised_by = auth.uid()`. Written in **plpgsql**, not sql — a `language sql` body is parsed at DDL time and would choke on referencing the new `'cancelled'` enum label. |
| `gatepass.lookup_pass` | `(p_code text) → table(outcome text, pass_id uuid)` | 008 | The loading-bay scan entry point. Resolves either a `qr_token` (uuid) or a typed `pass_number`. Requires `is_security()`. Returns an *outcome* rather than raising — `ok`, `not_found`, `cancelled`, `already_matched`, `already_flagged`, `expired` — because every one of those is a normal thing to happen at a gate, and the guard needs to see which. Logs every attempt to `scan_attempts`. |

### Read helpers

| Function | Returns | Security | Purpose |
|---|---|---|---|
| `gatepass.kpis(p_department_id uuid default null)` | `table(total bigint, pending bigint, matched bigint, flagged bigint, awaiting_return bigint, overdue bigint, raised_today bigint)` | invoker (**not** `SECURITY DEFINER`, deliberately) | Runs as the caller so RLS scopes the numbers to what that caller may actually see. Granted to `authenticated`. |
| `gatepass.my_profile()` | `table(id uuid, email text, full_name text, role text, department_id uuid, created_at timestamptz)` | `SECURITY DEFINER`, `search_path = ''` | The caller's own `public.profiles` row (`where p.id = auth.uid()`), bypassing VMS's recursive RLS policy. Added 006. |
| `gatepass.admin_list_profiles(p_role text default null)` | same column list as `my_profile` | `SECURITY DEFINER` | Internally requires `gatepass.is_admin()` and raises otherwise. Added 006. |
| `gatepass.site_tz()` | text | invoker, `immutable` | Returns the literal `'Asia/Kolkata'` — single source of truth for the mall's local wall-clock timezone. Added 008. |
| `gatepass.normalize_material(p_text text)` | text | invoker, `immutable` (required — a unique index depends on it) | Lower-cases and collapses whitespace. Added 008. |

`site_tz()`, `normalize_material()` and `kpis()` are the only three functions in the schema
that are neither `SECURITY DEFINER` nor have `search_path` pinned — by design, since all three
are stable/immutable, read-only helpers that intentionally run as invoker (for `kpis()`, so
RLS still applies; for the other two, because they touch no tables at all).

## Views

### `gatepass.v_gate_passes`

Created `004`; `create or replace` in `006`; **dropped and recreated** in `008` and again in
`010`. `with (security_invoker = true)` on every version — this is load-bearing, not
cosmetic: without it the view runs as its owner and bypasses RLS entirely, which would let any
HOD read every other department's passes.

Base query: `gatepass.gate_passes p` left join `public.departments d`, left join
`gatepass.profile_names rb` (on `raised_by`), left join `gatepass.profile_names vb` (on
`verified_by`).

Output columns: every column of `p.*` — `id, pass_number, type, status, department_id,
raised_by, visitor_name, visitor_company, material_description, quantity, unit,
vehicle_number, purpose, expected_return_date, return_status, actual_return_date,
verified_by, verified_at, flag_reason, created_at, updated_at, qr_token, expires_at,
cancel_reason, direction` — plus computed columns:

| Computed column | Definition | Added |
|---|---|---|
| `is_overdue` | `return_status = 'awaiting_return' and expected_return_date is not null and expected_return_date < (now() at time zone 'UTC')::date` | 004 |
| `is_expired` | `status = 'pending' and expires_at < now()` | 008 |
| `department_name` | `d.name` | 004 |
| `department_code` | `d.code` | 004 |
| `raised_by_name` | `rb.full_name` | 004 |
| `verified_by_name` | `vb.full_name` | 004 |

`is_overdue` and `is_expired` are each defined **exactly once**, here — never recompute either
in TypeScript. Overdue and expiry are both computed at query time, with no `pg_cron`
dependency.

### `gatepass.v_verifications`

Created `004`, replaced `006`. `security_invoker = true`. Base: `gatepass.verifications v`
left join `gatepass.profile_names su` (on `security_user_id`). Columns: every column of `v.*`
plus `security_name = su.full_name`.

### `gatepass.profile_names`

Created `006`. **No `security_invoker`** — this is the one deliberate exception. It runs with
owner rights specifically so that querying `public.profiles` through it does not trigger
VMS's recursive RLS policy (see [Migration `006`](#migration-history) and the `42P17` note in
[Diagnosing DB errors](../CLAUDE.md)). Columns are limited to `id` and `full_name` only, and
nothing else, to keep the blast radius of running as an owner as small as it can possibly be —
this view must never become the path by which a caller reads someone else's email or role
through owner rights.

### Why the joins to `public.*` are LEFT JOINs

VMS owns `profiles` and `departments` and can narrow its own RLS policies without notifying
this codebase. An inner join would make GatePass rows silently vanish from a guard's or HOD's
view the moment VMS tightened something unrelated. A left join instead degrades gracefully to
a null name or null department — visibly wrong (a blank cell an operator will ask about) beats
invisibly wrong (a pass that's still open at the loading bay just disappearing from a list).

## RLS policies

| Policy | Table | Command | Role | Condition |
|---|---|---|---|---|
| `hod_departments_select` | `hod_departments` | SELECT | authenticated | USING: row's `hod_id` is the caller, OR caller is security/admin |
| `hod_departments_insert` | `hod_departments` | INSERT | authenticated | WITH CHECK: `gatepass.is_admin()` |
| `hod_departments_delete` | `hod_departments` | DELETE | authenticated | USING: `gatepass.is_admin()` |
| `gate_passes_select` | `gate_passes` | SELECT | authenticated | USING: caller is security/admin, OR row's `department_id` is in `gatepass.my_department_ids()` |
| `gate_passes_insert` | `gate_passes` | INSERT | authenticated | WITH CHECK: caller's role is `'hod'`; `raised_by` = caller; `department_id` is one they hold; and the row must be born clean — `status = 'pending'`, `verified_by`/`verified_at`/`flag_reason` null, `actual_return_date` null, `return_status = 'not_applicable'` |
| `gate_passes_delete` | `gate_passes` | DELETE | authenticated | USING: `status = 'pending'` AND `raised_by = auth.uid()` AND `app_role() = 'hod'`. Added 010. |
| `verifications_select` | `verifications` | SELECT | authenticated | USING: caller is security/admin, OR the referenced pass's department is one of the caller's |
| `scan_attempts_select` | `scan_attempts` | SELECT | authenticated | USING: `gatepass.is_security()` |

There is **no UPDATE policy on any table in `gatepass`, in any migration.** `verifications`
and `scan_attempts` also have no INSERT policy — rows only ever get written from inside the
`SECURITY DEFINER` RPCs (`match_pass`, `flag_pass`, `mark_returned`, `lookup_pass`), never
directly by a client.

### `gate_passes_delete` — the one delete permission in the schema

It is easy to read this as an inconsistency with the "state transitions are RPC-only" rule.
It isn't, and the distinction matters: RPCs exist because RLS *cannot* express "you may change
`status` but not `visitor_name`" — that's a column-level concern, and Postgres row policies
have no column granularity. Deletion has no columns to constrain at all — a row either goes or
it doesn't — so a policy states the whole rule exactly, with no need for a function in
between.

This was an explicit product decision, made with the costs named up front: deleting a pass
consumes its `pass_number` and leaves a **permanent gap** in the sequence; a printed slip for
a deleted pass becomes unscannable, showing only `not_found` at `lookup_pass`; and the record
that a mistake was ever made is simply gone. **Voiding via `cancel_pass` remains the better
path** for almost every real case — it keeps the row, the audit trail, and the `'cancelled'`
status — and stays in the UI right beside delete. `tests/security/sqlInvariants.test.ts`
allows this one DELETE grant, and only in migration `010`; it still fails the build on any
UPDATE grant anywhere, or a DELETE grant introduced in any other file.

## Grants

Intended final state, after `009` and `010` are both applied.

| Role | Schema usage | Table privileges | Function privileges |
|---|---|---|---|
| `anon` | **none** | **none** | **none** — `009` explicitly revokes schema usage and all table/sequence/function privileges |
| `authenticated` | `usage` on `gatepass` | `select, insert, delete` on `gate_passes` (delete added by 010); `select` on `verifications`, `v_gate_passes`, `v_verifications`, `profile_names`, `scan_attempts`; `select, insert, delete` on `hod_departments` | `execute` on `app_role`, `is_security`, `is_admin`, `my_department_ids`, `match_pass`, `flag_pass`, `mark_returned`, `kpis`, `my_profile`, `admin_list_profiles`, `site_tz`, `normalize_material`, `lookup_pass`, `cancel_pass` |
| `service_role` | `usage` on `gatepass` | `select, insert, delete` on `hod_departments`; `select` on `verifications`. **No privilege at all on `gate_passes`** | (none listed) |

`authenticated` never holding UPDATE on `gate_passes` is what makes the RPC-only state
machine real rather than aspirational — enforced statically by
`tests/security/sqlInvariants.test.ts`, which greps every migration file for any grant that
would violate it. `service_role` having no privilege on `gate_passes` means even the service
key can't shortcut the state machine.

> **Grant drift warning.** Adding a schema to **Exposed schemas** in the Supabase dashboard
> silently runs `grant all on all tables in schema gatepass to anon, authenticated,
> service_role`. This has happened before in this project and is exactly what `009` exists to
> remediate. **Re-run migration `009` whenever anyone toggles that dashboard setting.** See
> [`SECURITY.md`](./SECURITY.md) for the full incident writeup and how it was detected — RLS
> held on its own that time because no UPDATE policy existed to exploit, but the grant itself
> was still a real loss of defence in depth.

## Migration history

| # | File | What it does |
|---|---|---|
| 001 | `001_gatepass_schema.sql` | Creates schema `gatepass`, four enums, tables `hod_departments`/`gate_passes`/`verifications` with indexes and check constraints, and the `set_pass_number` and `touch_updated_at` trigger functions plus their triggers. |
| 002 | `002_gatepass_rls.sql` | Grants to `authenticated` only (none to `anon`); adds `app_role()`, `is_security()`, `is_admin()`, `my_department_ids()`; enables RLS and defines the select/insert policies; adds `gate_passes` to the `supabase_realtime` publication. |
| 003 | `003_gatepass_rpcs.sql` | Adds `match_pass`, `flag_pass`, `mark_returned` — the only legal way to move a pass between statuses. |
| 004 | `004_gatepass_view.sql` | Adds `v_gate_passes` (with `is_overdue`), `kpis()`, and `v_verifications`. |
| 005 | `005_seed_hod_departments.sql` | **Optional demo seed — skip in a real deployment.** Backfills `hod_departments` from VMS's `public.profiles.department_id`, then gives one HOD extra departments to demonstrate the many-to-many. Idempotent. |
| 006 | `006_profiles_rls_isolation.sql` | Fixes a `42P17 infinite recursion` crash caused by `v_gate_passes` (under `security_invoker`) hitting VMS's recursive `public.profiles` policy. Adds owner-rights view `profile_names`, plus `my_profile()` and `admin_list_profiles()`, and repoints both views away from `public.profiles`. |
| 007 | `007_service_role_grants.sql` | Grants `service_role` the narrowest set that unblocks `scripts/verify-rls.mjs`. Deliberately grants it nothing on `gate_passes`. |
| 008 | `008_qr_token_expiry_cancel.sql` | Adds `site_tz()`; adds `qr_token`, `expires_at`, `cancel_reason`; adds the `'cancelled'` enum label to two enums; rewrites `set_pass_number`; backfills then sets `expires_at not null`; adds `normalize_material()` and the one-pending-per-material unique partial index; creates `scan_attempts` with RLS and `lookup_pass()`; extends `match_pass` with the expiry check; adds `cancel_pass()`; rebuilds `v_gate_passes` with `is_expired`. |
| 009 | `009_restore_narrow_grants.sql` | Remediates grant drift introduced by the Supabase dashboard's "Exposed schemas" toggle. Revokes then rebuilds the intended narrow grant set. Idempotent and meant to be re-run. |
| 010 | `010_direction_and_hod_delete.sql` | Adds enum `pass_direction` and column `direction`; migrates legacy `'OGP'` rows to `type='NRGP', direction='out'`; hard-fails if any `'IGP'` rows exist; adds `gate_passes_type_is_current` and `gate_passes_nrgp_is_outward`; rewrites `set_pass_number`/`touch_updated_at` so pass numbers carry direction; adds the `gate_passes_delete` policy and its DELETE grant; rebuilds `v_gate_passes`. |
| 011 | `011_drop_dead_type_index.sql` | Drops `gate_passes_type_idx` and documents why the other six indexes on `gate_passes` are kept. |
| 012 | `012_pass_integrity_constraints.sql` | Widens the material-uniqueness index from pending-only to still-open (pending or awaiting_return), closing the gap where a second RGP could be raised for material that had not come back yet; adds seven CHECK constraints for blank text, quantity ceiling, verification pairing, timeline ordering, flag-reason coupling and matched-RGP return obligation; adds the `validate_pass` trigger for the rules that need `now()` or the `'cancelled'` label. |

Pass numbers now look like `RGP-OUT-20260727-0001`. Counters are per `(type, direction, day)`,
which the existing advisory lock in `set_pass_number` handles for free, since it keys on the
whole prefix rather than on `type` alone.

`expires_at` is the end of the **next** day in `gatepass.site_tz()` — not `now() + 48h`.
Computing it in UTC would have shifted the cutoff by five and a half hours (`Asia/Kolkata` is
UTC+5:30) and expired passes raised in the afternoon a day early — a pass raised at 6pm local
time would look expired by the following morning under a naive UTC calculation, well before
the mall's own next business day even ended.

## Working on migrations

Rules that keep a migration from silently failing to reach the database, or from breaking a
guarantee this document relies on:

- **After editing any file in `supabase/migrations/`, run `npm run build:sql`.**
  `APPLY_ALL.sql` is the artifact a human actually pastes into the Supabase SQL editor; a
  migration edited but not re-concatenated is a fix that never reaches the database.
  `tests/security/applyAllIntegrity.test.ts` is the automated backstop that catches the drift.
- **Views need `with (security_invoker = true)`.** Without it, a view runs as its owner and
  bypasses RLS entirely — see `v_gate_passes` above for why this matters concretely (any HOD
  reading every department's passes).
- **`SECURITY DEFINER` functions must pin `set search_path = ''`** and fully qualify every
  reference (`gatepass.foo`, `public.bar`). A mutable search_path on a definer function is a
  privilege-escalation vector — a caller could get their own function found first by
  manipulating their session's search_path.
- **A new enum value cannot be USED in the transaction that adds it.** `alter type … add
  value` is fine inside a transaction on PG12+, but referencing the new label from anything
  Postgres evaluates at DDL time — a `check (…)` constraint, or a `language sql` function
  body — aborts with "unsafe use of new value". Since `APPLY_ALL.sql` is pasted as **one**
  transaction, that kills the entire paste, not just the one offending statement. `plpgsql`
  bodies are stored as text and are safe from this. This is exactly why `008` has no
  `cancelled_needs_reason` check constraint, and why `cancel_pass` is written in plpgsql
  rather than sql. The trap hasn't gone away in later migrations either: `012` needs rules that
  reference the same `'cancelled'` label, so those rules live in the `validate_pass` trigger
  (plpgsql) rather than in a new CHECK constraint. `tests/security/sqlInvariants.test.ts` guards
  this, including pinning `validate_pass` itself as plpgsql.
- **`create or replace view` cannot absorb new base-table columns.** A view's column list is
  fixed at creation time, so `select p.*` does not automatically grow when `gate_passes`
  gains a column — attempting to `create or replace` fails with "cannot change name of view
  column". The view must be dropped and rebuilt instead, which is why `v_gate_passes` was
  dropped and recreated in both `008` and `010` rather than replaced. This is safe with
  `kpis()`, since it's `$$`-quoted and Postgres records no hard dependency on the view.
- **Never leave unused schema in place.** If a table, column, type, function, policy or grant
  is not needed, remove it in the same migration that retires it — see `011` dropping
  `gate_passes_type_idx` as the model case. An orphan column still gets selected by `p.*` into
  a view, an unused function is still `EXECUTE`-able over PostgREST, and a stale grant still
  applies the day someone adds a policy that assumes it isn't there. Audit after every feature
  that changes the data model. There are exactly two hard exceptions, both Postgres
  limitations rather than choices: enum labels cannot be dropped (hence IGP/OGP living on as
  unreachable labels), and dropping a column used by a view requires rebuilding the view
  rather than a plain `alter table drop column`.
- **Extend the SQL invariant tests in the same commit as the migration, never afterwards.**
  `tests/security/sqlInvariants.test.ts` and `applyAllIntegrity.test.ts` are how a migration
  gets tested without a live database connection; a migration that changes a guarantee those
  tests check must update the test in the same commit, or the guarantee is unverified from
  the moment it lands.

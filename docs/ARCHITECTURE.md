# Architecture

How GatePass is put together, and why it is put together that way. GatePass runs the loading
bay of a shopping mall: Mall Management Office department heads raise passes, and security
verifies them at the loading bay. For the database object inventory see
[DATABASE.md](DATABASE.md); for the threat model see [SECURITY.md](SECURITY.md).

---

## 1. The shape of the system

```
┌──────────────────────────────────────────────────────────────┐
│  Browser — React 18 + Vite SPA                               │
│                                                              │
│  App.tsx ── session + role ── RouteGuard ── AppShell         │
│      │                                                        │
│      ├── HOD pages       raise / list / void / delete        │
│      ├── Security pages  scan / verify / returns / history   │
│      └── Admin pages     users / departments / all passes    │
└───────────────────────┬──────────────────────────────────────┘
                        │  supabase-js, anon key, user JWT
        ┌───────────────┴───────────────┬──────────────────────┐
        │ PostgREST                     │ Realtime             │
        │  select on views              │  postgres_changes on │
        │  insert on gate_passes        │  gatepass.gate_passes│
        │  rpc(...) for every state     │                      │
        │      change                   │                      │
        └───────────────┬───────────────┴──────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────────┐
│  Postgres                                                     │
│                                                               │
│  schema `public`    ← owned by VMS. profiles, departments.    │
│                       READ-ONLY to this app.                  │
│  schema `gatepass`  ← ours. gate_passes, verifications,       │
│                       hod_departments, scan_attempts,         │
│                       views, and the RPC state machine.       │
└───────────────────────────────────────────────────────────────┘
```

There is no backend server of our own. The security boundary is Postgres: RLS policies, narrow
grants, and `SECURITY DEFINER` functions. Everything in the browser is untrusted by
construction.

---

## 2. The two-schema rule

This project shares one Supabase project with a separate **VMS visitor system**.

| Schema | Owner | Contents |
|---|---|---|
| `public` | **VMS — treat as read-only** | `profiles`, `departments`, and `auth.users` alongside |
| `gatepass` | this app | `gate_passes`, `verifications`, `hod_departments`, `scan_attempts` |

Three rules follow, and all three are load-bearing:

**Query through the explicit helpers.** `src/supabaseClient.ts` exports exactly two:

```ts
export const gp  = () => supabase.schema('gatepass');  // our tables and RPCs
export const pub = () => supabase.schema('public');    // profiles, departments — VMS's
```

There is deliberately **no default-schema shortcut**. A reader must always be able to tell
which schema a query hits, because the two have completely different ownership and blast
radius.

**Never write a migration that alters anything in `public`.** New objects go in `gatepass` and
reference `public.profiles` / `public.departments` by foreign key only.

**Creating a department writes to VMS's shared `public.departments`, so VMS sees it too.** The
admin UI says so out loud — keep that warning in place.

### Why the view's joins to `public.*` are LEFT JOINs

`gatepass.v_gate_passes` left-joins to department and profile data on purpose. VMS owns those
tables and can narrow its policies without telling us. An inner join would make pass rows
**silently vanish**; a left join degrades to a null name. Visibly wrong beats invisibly wrong,
every time.

### Why profile names come through `gatepass.profile_names`

VMS has a recursive RLS policy on `public.profiles` that throws
`42P17 infinite recursion detected in policy for relation profiles`. Because
`v_gate_passes` runs with `security_invoker = true`, that recursion propagated straight into
our view and broke every list screen.

Migration `006` fixed it with `gatepass.profile_names` — a two-column
(`id`, `full_name`) view that is deliberately **the one owner-rights view in the codebase**. It
runs as its owner, so it never evaluates VMS's policy at all. The role lookup fallback in
`getUserRole()` goes through `gatepass.my_profile()` for the same reason: losing a role lookup
at login is the worst possible moment for it.

---

## 3. The RPC-only state machine

**No client holds `UPDATE` on `gatepass.gate_passes`.** Migration `002` grants `authenticated`
only `select` and `insert`. There is no UPDATE policy on the table in any migration.

This exists because **Postgres RLS cannot express column-level authority**. A policy can say
"you may update this row" but not "you may change `status` but not `visitor_name`". Since the
whole value of a loading-bay log is that the material description cannot be edited after the
fact, column authority has to live somewhere else — so it lives in `SECURITY DEFINER`
functions.

| RPC | Who may call it | What it does |
|---|---|---|
| `match_pass(p_pass_id, p_verified_quantity, p_verified_vehicle, p_remarks)` | security / admin | `pending` → `matched`. Refuses an expired pass. Writes a `verifications` row. |
| `flag_pass(p_pass_id, p_reason)` | security / admin | `pending` → `flagged`. Requires a non-blank reason. **Deliberately does not check expiry.** |
| `mark_returned(p_pass_id, p_remarks)` | security / admin | `awaiting_return` → `returned`. |
| `cancel_pass(p_pass_id, p_reason)` | the HOD who raised it | `pending` → `cancelled`. Requires a non-blank reason. |
| `lookup_pass(p_code)` | security / admin | Resolves a QR token or a typed pass number to an outcome. Logs every attempt. |

Each one row-locks with `for update`, re-checks the caller's role itself rather than trusting
the grant, and pins `search_path = ''` with every reference fully qualified.

**To add a new state change, add a new RPC.** Do not add an UPDATE policy — that would hand
back column authority the entire design exists to keep.

### Why `flag_pass` ignores expiry but `match_pass` enforces it

An expired pass is stale paperwork. Refusing to *match* it is correct: the authorization has
lapsed. Refusing to *flag* it would mean refusing to record a real mismatch because the
paperwork went stale, which is backwards — the mismatch is exactly the thing you most need
written down.

### The one exception: HOD delete

An HOD may **delete** their own pass while it is still `pending`, via the RLS policy
`gate_passes_delete` rather than an RPC. That is not an inconsistency. RPCs exist because RLS
cannot constrain *columns*; deletion has no columns to constrain, so a policy states the whole
rule exactly.

The costs were stated and accepted when this was decided: the pass number is consumed and
leaves a permanent gap, a printed slip becomes unscannable showing only `not_found`, and the
record of the mistake is gone. **Void remains the better path** and stays in the UI beside it.

---

## 4. Auth and role resolution

```
supabase.auth.getSession()          →  Session | null
supabase.auth.onAuthStateChange()   →  re-resolves on every auth event
        │
        └─ getUserRole()  (src/supabaseClient.ts)
               1. user.app_metadata.role          ← authoritative, server-writable only
               2. gp().rpc('my_profile')          ← fallback, never public.profiles directly
```

`App.tsx` holds three pieces of state — `session`, `role`, `resolving` — and renders a
full-page loader until the role resolves. Rendering routes against a null role would flash the
wrong screen at a guard.

**Authorization reads `app_metadata`, never `user_metadata`.** `user_metadata` is writable by
the user themselves; treating it as a role claim would let any account promote itself. RLS in
the database reads the same JWT claim, so the frontend and the database agree by construction.

Accounts must be created with `app_metadata.role` set, or RLS cannot authorize them at all —
`scripts/create-user.ts` does this.

---

## 5. Routing and access

`src/lib/roleRoutes.ts` is the **single source of truth**, enforced once in `App.tsx`:

```ts
ROLE_ROUTES: Record<UserRole, string[]>
  guard:       ['/console', '/verify', '/returns', '/history', '/pass']
  hod:         ['/dashboard', '/raise', '/my-passes', '/pass']
  admin:       ['/admin', '/all-passes', '/pass', '/console', '/verify', '/returns', '/history']
  super_admin: same as admin
  staff:       []                      ← no business in this app at all

ROLE_HOME: guard → /console · hod → /dashboard · admin → /admin · staff → /no-access

isForbidden(pathname, role)   // prefix match; null role means "still resolving"
homeFor(role)
```

Import it. Never duplicate the list.

**This is UX defence in depth, not the security boundary.** An HOD who edits the URL still
cannot read another department's rows — because the database refuses, not because
`RouteGuard` does. If `roleRoutes.ts` were deleted entirely, the app would show wrong-role
screens but leak nothing.

### The route table

| Path | Component | Reachable by |
|---|---|---|
| `/login` | `Login` | signed-out only; redirects to `homeFor(role)` when signed in |
| `/dashboard` | `HOD/Dashboard` | hod |
| `/raise` | `HOD/RaisePass` | hod |
| `/my-passes` | `HOD/MyPasses` | hod |
| `/console` | `Security/GateConsole` | guard, admin, super_admin |
| `/verify/:id` | `Security/Verify` | guard, admin, super_admin |
| `/returns` | `Security/PendingReturns` | guard, admin, super_admin |
| `/history` | `Security/History` | guard, admin, super_admin |
| `/admin` | `Admin/AdminPanel` | admin, super_admin |
| `/all-passes` | `Admin/AllPasses` | admin, super_admin |
| `/pass/:id` | `Shared/PassDetail` | all app roles |
| `/pass/:id/print` | `Shared/PassPrint` | all app roles |
| `*` | → `homeFor(role)` | — |

`BrowserRouter` means deep links like `/pass/<uuid>` 404 on refresh without a server rewrite —
`vercel.json` supplies it.

---

## 6. Realtime

Three components subscribe to `postgres_changes` on `gatepass.gate_passes`:

| File | Channel | Scope |
|---|---|---|
| `src/components/layout/Sidebar.tsx:134` | `sidebar-gate-pass-counts` | badge counts |
| `src/pages/HOD/Dashboard.tsx:114` | `hod-dashboard-gate-passes` | `event: '*'` |
| `src/pages/Security/GateConsole.tsx:103` | `gate-console-gate-passes` | `event: '*'` |
| `src/pages/Security/Verify.tsx:66` | `verify-${id}` | that one row |

Two conventions that matter:

**Always refresh silently** — `load(silent = true)` — so KPI tiles do not flash on every remote
change. A number that blinks every few seconds reads as broken.

**Write subscriptions defensively**: optional chaining plus `try/catch`, so a partially-mocked
Supabase client in tests cannot throw. The mock pattern that works is
`const ch: any = {}; ch.on = () => ch;` — building it inline as a self-referencing object
literal hits a temporal-dead-zone error.

`Verify.tsx` subscribing to its own row is what makes HOD void reach the loading bay live: a
guard standing on the decision screen sees the pass go `cancelled` under them rather than
matching something the HOD already withdrew.

---

## 7. The gate scan path

This is the loading-bay scan, whether it starts from a camera or a typed number — and it
often runs at night, since most tenant fit-out material moves after the mall closes:

```
QrScanner (camera)  ─┐
                     ├─→  lookup_pass(code)  ─→  { outcome, pass_id }  ─→  /verify/:id
typed pass number  ─┘                                   │
                                                        └─→ scan_attempts row, always
```

**The QR encodes `qr_token`, an opaque random uuid — never `pass_number`.** Pass numbers are
sequential (`RGP-OUT-20260727-0001`), so a QR built from one could be forged for a pass nobody
ever held. Printed slips still show the human-readable number, because the typed field is the
fallback when a camera fails.

**The typed pass-number field is always mounted beside the scanner and must stay that way.**
Cameras fail: bad light at a loading bay after dark, a cracked lens, a phone with no
permission granted, a slip that got wet.

`src/lib/qrDecode.ts` prefers the native `BarcodeDetector` and lazy-loads `jsqr` otherwise.
That fallback is the entire iOS/Safari story — no iPhone has `BarcodeDetector`.

`getUserMedia` **only exists in a secure context.** `localhost` qualifies; `http://<lan-ip>:5175`
from a phone does not — the API is not merely blocked, it is absent. Testing the scanner on a
real phone requires HTTPS. See [DEPLOYMENT.md](DEPLOYMENT.md).

`lookup_pass` **returns** outcomes rather than raising, because every one of them is a normal
thing to happen at a loading bay and the guard needs to see which:

`ok` · `not_found` · `expired` · `cancelled` · `already_matched` · `already_flagged`

Only `ok` proceeds to verification. The rest are dead ends with distinct messages — and all six,
including the failures, land in `scan_attempts`. `verifications` records what succeeded; this
records what was *tried*, which is how a forged-QR probe becomes visible at all.

---

## 8. Derived values live in the database

`is_overdue` and `is_expired` are each defined **exactly once**, in `gatepass.v_gate_passes`:

```sql
is_overdue = return_status = 'awaiting_return'
             and expected_return_date is not null
             and expected_return_date < (now() at time zone 'UTC')::date

is_expired = status = 'pending' and expires_at < now()
```

Both are computed at query time, so there is no `pg_cron` dependency and no row that is stale
because a job did not run.

**Never recompute either in TypeScript.** A screen that disagrees with `match_pass` about
expiry is a guard arguing with a driver about whether a piece of paper is still valid, and the
screen will lose.

`expires_at` is set by trigger to **end of the next day in `gatepass.site_tz()`**
(`Asia/Kolkata`), not `now() + 48h`. Computing it in UTC would have shifted the cutoff by five
and a half hours and expired afternoon passes a day early.

---

## 9. Frontend module map

### `src/lib/` — lookup maps and formatters, no logic that belongs in SQL

| File | Contents |
|---|---|
| `roleRoutes.ts` | `ROLE_ROUTES`, `ROLE_HOME`, `isForbidden`, `homeFor` |
| `passTypes.ts` | `PASS_TYPES`, `PASS_DIRECTIONS`, `PASS_CATEGORIES`, `categoryFor`, `allowedDirections`, `requiresReturnDate` |
| `statusStyles.ts` | status → Tailwind class map |
| `profiles.ts` | `my_profile` / `admin_list_profiles` wrappers |
| `errors.ts` | Postgres error code → human message |
| `qrDecode.ts` | `BarcodeDetector` with a lazy `jsqr` fallback |
| `formatDate.ts` | date-fns formatting |
| `exportUtils.ts` | CSV export |
| `theme.tsx` | light/dark provider |

`PASS_CATEGORIES` mirrors the three legal type×direction combinations, and the loading-bay
console filters on it — a guard picks a whole category ("show me what is coming in on a
returnable"), not two independent axes.

### `src/pages/` — grouped by who uses it

**HOD/** — `Dashboard` (KPIs + recent), `RaisePass` (the form), `MyPasses` (list with void and
delete), plus the extracted `PassTypeSelector`, `PassIdentityPanel`, `VoidPassPanel`,
`DeletePassPanel`, `MyPassesTable`, `useDeletePass`.

**Security/** — `GateConsole` (live queue, category filter), `GateLookup` (scan + typed entry),
`Verify` (the match/flag decision screen), `PendingReturns`, `History`, plus `VerifyPanels`.

**Admin/** — `AdminPanel` with `UsersTab` and `DepartmentsTab`, `DeptBreakdownTable`,
`AllPasses`.

**Shared/** — `PassDetail`, `PassPrint`.

The split into sub-components is not decoration: the **300-line cap** is a hard rule, and
`RaisePass` (298), `PassDetail` (289) and `DepartmentsTab` (287) sit close enough to it that the
next feature in any of them has to extract something first.

---

## 10. Gotchas that have actually cost time

- **Supabase's query builder resolves to a `PromiseLike`, which has no `.catch()`.** `await` it
  inside `try/catch`; chaining `.catch()` is a type error.
- **A new enum value cannot be *used* in the transaction that adds it.** `alter type … add
  value` is fine inside a transaction on PG12+, but referencing the new label from anything
  Postgres evaluates at DDL time — a `check (…)` constraint, or a `language sql` function body —
  aborts with `unsafe use of new value`. Since `APPLY_ALL.sql` is pasted as one transaction,
  that kills the entire paste. `plpgsql` bodies are stored as text and are safe. This is why
  `cancel_pass` is plpgsql rather than sql.
- **`create or replace view` cannot absorb new base-table columns.** A view's column list is
  fixed at creation, so `select p.*` does not grow when the table does — it fails with "cannot
  change name of view column". The view must be dropped and rebuilt.
- **A new schema inherits no Supabase grants.** `service_role` is omnipotent over `public` only
  because Supabase granted it there at project creation; nothing propagates that to `gatepass`.
- **`pass_number` generation takes an advisory lock.** A plain `max()+1` lets concurrent
  inserts collide on the unique constraint — VMS had to patch exactly this bug.
- **Error codes tell you which layer failed**, and three of them look identical from the UI:

  | Code | Meaning | Fix |
  |---|---|---|
  | `PGRST106 Invalid schema` | `gatepass` missing from Exposed schemas | Dashboard setting |
  | `PGRST205` / `PGRST202` | not in PostgREST's **schema cache** | Either a missing migration **or a stale cache** — query `pg_catalog` before concluding the migration never ran |
  | `42501 permission denied for schema gatepass` | object exists, role lacks a GRANT | Schema `USAGE` is checked before table privileges, which is why this names the schema and never the table |
  | `42P17 infinite recursion` | VMS's recursive `profiles` policy | Migration `006` makes us immune |

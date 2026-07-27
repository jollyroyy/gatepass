# Deployment

**Status: not deployed yet — the app has only ever run on `localhost`.** There is no
hosted URL. `vercel.json` is written and committed but has never run in production.

See also: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DATABASE.md`](./DATABASE.md),
[`SECURITY.md`](./SECURITY.md), and [`../MANUAL_TEST.md`](../MANUAL_TEST.md).

GatePass is the Material Gate Pass System for a mall management office. Material moves
through the mall's **service gate / loading bay**; guards work that gate, often at night,
because tenant fit-out work happens after mall hours. Passes are raised by department heads
inside the Mall Management Office (Housekeeping, Engineering/MEP, Facilities, Marketing &
Events, Retail Operations, F&B, IT).

## 1. Status

Not deployed. No hosted URL exists. `vercel.json` is written and committed but has never
run in production — everything below is the plan for the first deploy, not a record of one.

## 2. Prerequisites

- A Supabase project. This one **shares a project with a separate VMS visitor management
  system** — schema `public` is VMS's and is read-only to us, schema `gatepass` is ours.
  See [`DATABASE.md`](./DATABASE.md) for the full two-schema rule.
- Node and npm.
- The Supabase **CLI is not installed** in this working environment and the project is not
  linked, so `supabase db push` is **not** available. `psql` is the working path — see §4.

## 3. Environment variables

Vercel needs **exactly two**:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

**Never add `SUPABASE_SERVICE_ROLE_KEY` to the frontend deployment.** It is not used by
any file under `src/`, and Vite inlines every `VITE_*` variable into the public browser
bundle at build time — a `VITE_`-prefixed secret ships an RLS-bypassing credential to
every visitor. The service key belongs only to node scripts in `scripts/`, run locally.

Locally: `cp .env.example .env` and fill it in. `.gitignore` uses `.env*` with
`!.env.example` — deliberately a glob, because an exact-name rule would not catch
`.env.bak` or a renamed copy, and a real database password did land in the wrong env file
once.

## 4. Applying the database schema

Two supported paths:

**a) Paste `supabase/APPLY_ALL.sql`** into the Supabase SQL editor. This is the normal
path. It is generated from `supabase/migrations/` by `npm run build:sql`, and is pasted as
**one transaction**.

**b) `psql` over the session pooler.** Use:

```bash
# host: aws-1-ap-south-1.pooler.supabase.com:5432
# user: postgres.<project-ref>
psql "$SUPABASE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/010_direction_and_hod_delete.sql
```

Notes that have each cost real time:

- The direct `db.<project-ref>.supabase.co` host is **IPv6-only and may not resolve** —
  use the session pooler host instead.
- **Percent-encode special characters in the password.** An `@` must be `%40`, or libpq
  splits the URI at the wrong `@` and reports `could not translate host name "…"`, which
  reads like a DNS failure rather than a credential-format problem.
- Always use `--single-transaction -v ON_ERROR_STOP=1 -f <file>`. Prefer `-f` over pasting
  SQL into a command argument: it sends the file byte-for-byte with no transcription risk.
- This connects as `postgres`, which **bypasses RLS entirely** — it can never prove RLS
  works. Only `set local role` probes or a real anon/authenticated JWT can.

**Migration `005` is an optional demo seed — skip it in a real deployment.**

Run migrations in numeric order, `001` through `011`.

## 5. Expose the `gatepass` schema — and then re-run `009`

In the Supabase dashboard, add `gatepass` to **Exposed schemas**, or PostgREST returns
`PGRST106 Invalid schema` for every query.

**Then re-run migration `009`.** Toggling that setting also runs
`grant all on all tables in schema gatepass to anon, authenticated, service_role`, which
silently hands `anon` and `authenticated` UPDATE and DELETE on `gate_passes` and destroys
a documented invariant. `009` revokes and rebuilds the intended narrow grants and is
written to be idempotent. Full story in [`SECURITY.md`](./SECURITY.md).

## 6. Creating the first users

```bash
npm run create-user -- --email x@y.z --password P --name "N" --role hod --dept ENG
```

Accounts **must** be created with `app_metadata.role` set, or RLS cannot authorize them at
all. Roles map onto VMS's shared `public.user_role` enum: `guard` = loading-bay security,
`hod` = a Mall Management Office department head, `admin`/`super_admin` = mall management
admin, `staff` = no access.

Because `auth.users` is shared with VMS, **every existing VMS guard automatically has
loading-bay console access** and every VMS HOD can raise passes once assigned a department.
Audit the VMS user list before go-live.

An HOD must then be assigned departments in `gatepass.hod_departments` (the admin panel
does this) — the mapping is many-to-many, so one HOD can cover Housekeeping, Engineering
and Facilities at once.

## 7. Deploying to Vercel

`vercel.json` is already in the repo and configures:

- `buildCommand: npm run build`, `outputDirectory: dist`, `framework: vite`
- **SPA rewrite** `{ "source": "/((?!assets/).*)", "destination": "/index.html" }` — the
  app uses `BrowserRouter`, so deep links like `/pass/<uuid>` would otherwise 404 on
  refresh. A guard who reloads the verification screen mid-shift is exactly the person who
  would hit this.
- Immutable one-year caching on `/assets/(.*)`
- Security headers on everything: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and
  `Permissions-Policy: camera=(self), microphone=(), geolocation=()`

**The `camera=(self)` value is load-bearing** — the loading-bay QR scanner needs it. A more
restrictive value silently kills the camera with no error the guard can act on.

Steps: connect the repo to Vercel, set the two environment variables, deploy. Build is
`npm run build`, which runs `tsc -p tsconfig.app.json --noEmit && vite build`.

## 8. The camera scanner needs HTTPS — this is the most likely deployment failure

`getUserMedia` **only exists in a secure context**. `localhost` qualifies.
`http://<lan-ip>:5175` from a phone **does not** — the API is not merely blocked, it is
entirely absent, so the failure looks like a broken build rather than a permissions
problem.

Consequences:

- **The camera scan path cannot be tested over LAN HTTP.** Testing it on a real phone
  requires HTTPS — a Vercel deploy or a tunnel.
- `src/lib/qrDecode.ts` prefers the native `BarcodeDetector` and lazy-loads `jsqr`
  otherwise. That fallback is the entire iOS/Safari story — no iPhone has
  `BarcodeDetector`.
- The **typed pass-number field is always mounted beside the scanner and must stay that
  way.** Cameras fail: bad light at a night-time loading bay, a cracked lens, a phone with
  no permission granted, a slip that got wet.

## 9. Post-deploy verification

Ordered checklist:

1. `npm run check` passes locally (`tsc --noEmit && vitest run`). **Do not use
   `npm run lint`** — it runs bare `tsc --noEmit`, picks up a root `tsconfig.json` that is
   `{"files": [], "references": [...]}`, follows no project references without `--build`,
   type-checks **zero files**, and always exits 0. It once passed cleanly with a real
   missing-enum-key error in the code.
2. `node scripts/verify-rls.mjs` against the deployed database — it uses real anon-key
   JWTs, so it proves RLS as the browser sees it.
3. Sign in as each role and confirm the landing page: `guard` → `/console`,
   `hod` → `/dashboard`, `admin` → `/admin`, `staff` → `/no-access`.
4. Raise a pass, print the slip, and scan it with a real phone camera over HTTPS.
5. Open two windows — HOD and guard — and confirm a voided pass reaches the guard's screen
   live via realtime.
6. Work through [`../MANUAL_TEST.md`](../MANUAL_TEST.md), which covers everything an
   automated test cannot reach: real browsers, realtime across two windows, printing, and
   cameras.

Print check: the slip must be legible on a **cheap mono laser printer** — it is
black-on-white with no colour-dependent information by design.

## 10. Troubleshooting — error code tells you the layer

| Error | Meaning | Fix |
|---|---|---|
| `PGRST106 Invalid schema` | `gatepass` missing from Exposed schemas | Dashboard setting — then re-run `009` |
| `PGRST205` / `PGRST202` | Object not in PostgREST's **schema cache** | Either a genuinely missing migration **or a stale cache**. Query `pg_catalog` before concluding the migration never ran — the error code cannot distinguish the two. |
| `42501 permission denied for schema gatepass` | Object exists and is exposed, but the role lacks a GRANT | Schema `USAGE` is checked before table privileges, which is why this names the schema and never the table. Re-run `009`. |
| `42P17 infinite recursion detected in policy for relation profiles` | VMS's recursive policy on its own `public.profiles` | Migration `006` makes GatePass immune. If it appears, something is reading `public.profiles` directly instead of going through `gatepass.my_profile()`. |
| Deep link 404s on refresh | SPA rewrite missing | Check `vercel.json` is being applied |
| Camera never appears | Page is not on HTTPS, or `Permissions-Policy` is too restrictive | See §8 |

## 11. Rollback

The frontend rolls back by redeploying a previous Vercel build. **The database does not
roll back automatically** — migrations are forward-only and there are no down-migrations.
Before applying a migration to a live mall deployment, take a backup; `010` in particular
is destructive-adjacent, since it rewrites legacy `'OGP'` rows to `type='NRGP',
direction='out'` and hard-fails if any `'IGP'` rows exist.

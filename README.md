# GatePass — Material Gate Pass System

A material gate pass system for a shopping mall's Mall Management Office. Department heads
(HODs) raise passes for material moving through the service gate / loading bay; security
verifies each one physically at the loading bay and either **matches** it or **flags** it.
Everything is timestamped, attributable, and auditable.

React 18 · TypeScript · Vite · Tailwind · Supabase (Auth, Postgres, Realtime, RLS)

---

## What problem it solves

A gate pass is a promise about physical material: *this much of this thing, leaving with this
person, in this vehicle, and — if it is returnable — coming back by this date.* The failure
mode is not a bug, it is a contractor's van leaving the loading bay with the wrong equipment
and nobody able to prove it afterwards.

So the system is built around three properties:

1. **The loading-bay log cannot be retro-edited.** No client anywhere holds `UPDATE` on the
   passes table. Every state change goes through a `SECURITY DEFINER` function that decides
   which columns may move. See [Architecture → The RPC-only state machine](docs/ARCHITECTURE.md#the-rpc-only-state-machine).
2. **A pass is visible only to people who should see it.** Row Level Security scopes each HOD
   to their own departments. The frontend route guard is a UX convenience, not the boundary.
3. **What was tried is recorded, not just what succeeded.** `verifications` logs successful
   loading-bay actions; `scan_attempts` logs *every* scan, including forged and expired ones.

---

## The pass model

Two independent facts, not one conflated type:

```
type      = does it come back?      RGP | NRGP
direction = which way is it going?  in  | out
```

**Exactly three combinations are legal**, enforced by database check constraints rather than
by the dropdown:

| Category | Meaning |
|---|---|
| `RGP-out` | The mall's own equipment leaving, and it must come back — a chiller pump going out for repair, a marketing LED wall going out to a vendor. |
| `RGP-in`  | Someone else's equipment coming in, and it must go back out — a fit-out contractor's scaffolding, scissor lift, or power tools; an event vendor's staging. |
| `NRGP-out` | Material leaving for good — scrap, waste, disposal, a tenant vacating and removing fixtures. |

**NRGP is outward-only.** Permanently inbound material is a goods receipt, not a gate pass:
the loading bay never had custody, so the loading-bay log must not claim it did.

Pass numbers carry the direction — `RGP-OUT-20260727-0001` — and are generated under an
advisory lock so concurrent inserts cannot collide.

---

## Roles

Roles are **not** app-specific. This app shares one Supabase project with a separate VMS
visitor system and maps onto VMS's `public.user_role` enum:

| In this app | `profiles.role` | Lands on | Can do |
|---|---|---|---|
| Security | `guard` | `/console` | Scan, match, flag, and mark returned at the loading bay |
| HOD | `hod` | `/dashboard` | Raise passes for their Mall Management Office departments, void or delete their own pending ones |
| Admin | `admin` / `super_admin` | `/admin` | Everything security can, plus users and departments |
| No access | `staff` | `/no-access` | Nothing |

Role is read from the JWT's **`app_metadata.role`** (server-writable only), with a
`gatepass.my_profile()` fallback. Never authorize off `user_metadata` — users can write it.

A consequence worth knowing before you deploy: **every existing VMS guard automatically has
gate-console access**, and every VMS HOD can raise passes once assigned a department.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in your Supabase URL and anon key
npm run dev               # http://localhost:5174
```

`.env` needs two values for the app to run:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`SUPABASE_SERVICE_ROLE_KEY` is needed only by node scripts under `scripts/`. **Never give it a
`VITE_` prefix** — Vite inlines every `VITE_*` variable into the public browser bundle, and the
service role key bypasses RLS entirely. `tests/security/clientSecrets.test.ts` fails the build
if it ever appears under `src/`.

### Database setup

Paste `supabase/APPLY_ALL.sql` into the Supabase SQL editor, or apply
`supabase/migrations/*.sql` in order. Migration `005` is an **optional demo seed** — skip it in
a real deployment. Full detail in [docs/DATABASE.md](docs/DATABASE.md).

Then add `gatepass` to **Exposed schemas** in the Supabase dashboard — and afterwards
**re-run migration `009`**, because that dashboard toggle silently issues
`grant all on all tables in schema gatepass to anon, authenticated, service_role`.
See [docs/SECURITY.md → Grant drift](docs/SECURITY.md#grant-drift-the-dashboard-undoes-your-grants).

---

## Commands

```bash
npm run dev            # dev server on :5174
npm run check          # tsc --noEmit && vitest run   ← THE gate, use this
npm run build          # typecheck + vite build
npm run build:sql      # regenerate supabase/APPLY_ALL.sql from migrations/
npm run test           # vitest run
npx vitest run tests/unit/roleRoutes.test.tsx        # a single spec

npm run create-user -- --email x@y.z --password P --name "N" --role hod --dept IT
node scripts/verify-rls.mjs           # live RLS checks against the real database
```

> **`npm run lint` is a no-op — do not trust it.** It runs bare `tsc --noEmit`, which picks up
> the root `tsconfig.json`, and that file is `{"files": [], "references": [...]}`. Project
> references are not followed without `--build`, so it type-checks **zero files** and always
> exits 0. It once passed cleanly while `PassDetail.tsx` had a real missing-enum-key error.
> **Use `npm run check`.**

**After editing anything in `supabase/migrations/`, run `npm run build:sql`.** `APPLY_ALL.sql`
is the artifact a human actually pastes; a migration edited but not re-concatenated is a fix
that never reaches the database. `tests/security/applyAllIntegrity.test.ts` is the backstop.

---

## Documentation

| Doc | What is in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System shape, the two-schema rule, the RPC-only state machine, routing, realtime, the frontend module map |
| [docs/DATABASE.md](docs/DATABASE.md) | Every table, enum, constraint, index, function, view, policy and grant — and what each migration did |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, the invariants that must not break, how they are tested, and the ways they have broken before |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel setup, environment variables, why the camera scanner needs HTTPS |
| [MANUAL_TEST.md](MANUAL_TEST.md) | Ordered manual walkthrough — the parts no automated test reaches: real browsers, realtime across two windows, printing, cameras |
| [CLAUDE.md](CLAUDE.md) | Working notes and session handoff state for AI-assisted development |

---

## Project layout

```
src/
  App.tsx                  routing + session/role resolution + route guard
  supabaseClient.ts        the one client; gp() and pub() schema helpers
  types/index.ts           every shared type; mirrors the Postgres enums exactly
  lib/                     lookup maps and formatters (no fuzzy enum matching)
  components/              Badge, KpiCard, QrPass, QrScanner, layout/
  pages/
    HOD/                   Dashboard, RaisePass, MyPasses
    Security/              GateConsole, GateLookup, Verify, PendingReturns, History
    Admin/                 AdminPanel + tabs, AllPasses
    Shared/                PassDetail, PassPrint
supabase/
  migrations/              001 schema → 011, applied in order
  APPLY_ALL.sql            generated; the file a human pastes
  fixes/                   one-off diagnostic SQL
scripts/                   create-user, verify-rls, build-apply-all
tests/
  unit/                    lookup maps, routing, errors, profiles, shell
  security/                static invariants over source and SQL
docs/                      the documents listed above
```

---

## Conventions

These are enforced by review, and some by tests:

- **Max 300 lines per file**, no exceptions — extract sub-components instead.
- **No fuzzy string matching on enums.** Use a `Record<Enum, T>` lookup map, never an
  `includes()` chain. See `src/lib/statusStyles.ts` and `src/lib/passTypes.ts`.
- **Never `window.alert` / `confirm` / `prompt`** — they block the page and break automation.
  Use inline panels or `.modal-overlay`. (`window.print()` in `PassPrint.tsx` is fine, and must
  stay click-triggered rather than firing on mount.)
- **Every list handles loading, empty, and populated explicitly** — `.skeleton`,
  `.empty-state`, then content.
- **`is_overdue` and `is_expired` are defined once each, in the view.** Never recompute them in
  TypeScript: a screen that disagrees with `match_pass` about expiry is a guard arguing with a
  driver.
- **TDD.** Write the failing test, watch it fail for the right reason, then write the smallest
  code that passes. This applies to SQL too — `tests/security/sqlInvariants.test.ts` is how a
  migration gets tested without a database, and it is extended in the same commit as the
  migration, never afterwards.

---

## Design system — Slate + Cyan Ops

Seven colours, and **saturated colour means status, never decoration**.

```
Shell     #0F172A   sidebar / top strip — dark in both themes (chrome, not content)
Primary   #0891B2   cyan    buttons, active nav, focus rings
Accent    #4F46E5   indigo  links, secondary emphasis
Status    amber pending · emerald matched · red flagged · orange overdue
Neutral   slate     meta, borders, baselines
```

The printed slip (`PassPrint.tsx`) is black-on-white with **no colour-dependent
information** — it must read on a cheap mono laser printer. Guard controls (`.btn-match`,
`.btn-flag`) are deliberately oversized, because someone uses them standing at the loading
bay, often at night — most tenant fit-out work happens after the mall closes — one-handed,
with a contractor's van waiting.

---

## Status

The frontend typechecks, builds, and passes its test suite. All migrations `001`–`011` are
applied to the live database, and RLS has been verified live with real anon-key JWTs
(`scripts/verify-rls.mjs`).

Not yet verified in the real world: the phone-camera scan path (needs HTTPS — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), expiry refusal against a genuinely stale pass, and
the duplicate-material index tripping on a real second insert. `CLAUDE.md` tracks the current
state in detail.

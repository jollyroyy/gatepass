# The e2e harness — read this before writing a spec

Playwright drives a **real browser against the real Supabase project**. Nothing here is mocked.
That makes two rules absolute:

1. **A raised gate pass is permanent** (migration 024) and **a recorded return cannot be undone**.
   Create the minimum data a spec actually asserts on, and never touch a department other than
   `E2E` / `E2E2`.
2. **Only ever act as the e2e cast** (`@e2e.local`). Never sign in as, edit, deactivate or
   delete a `@demo.*` account, and never delete a department that is not `E2E`/`E2E2`.

## Running

```bash
npm run e2e                      # whole suite, headless, 4 workers
npx playwright test hod          # one directory or file
npx playwright test --reporter=line
npm run e2e:seed                 # re-provision the cast (idempotent)
npm run e2e:restore              # give the four approval offices back to their real holders
```

`globalSetup` seeds automatically. `E2E_SKIP_SEED=1` skips it when the cast is already in place —
use it while iterating, it saves ~15s a run.

## Imports — always these, never `@playwright/test` directly

```ts
import { test, expect } from './fixtures/test';          // or '../fixtures/test' from a subdir
import { ACCOUNTS, storageStateFor } from './fixtures/accounts';
import { settled, expectPath, assertKpiOpensItsOwnRows, csvFrom, withNoNativeDialog } from './helpers/ui';
import { raisePass, approveThroughLadder, uniqueTag, tomorrow } from './helpers/lifecycle';
```

`./fixtures/test` is `@playwright/test` plus two fixtures:

* **`pageLog`** — console errors, banned native dialogs and failed requests seen by `page`.
  Assert `expect(pageLog.errors).toEqual([])` on any screen a spec renders.
* **`as(role)`** — open a second signed-in browser context mid-test:
  `const gate = await as('guard'); await gate.page.goto('/console')`. Contexts close themselves.

## Signing in

Never fill the login form except in the login spec itself. Declare the role for a describe block:

```ts
test.describe('the HOD dashboard', () => {
  test.use({ storageState: storageStateFor('hod') });
  ...
});
```

Roles: `hod`, `hod2`, `guard`, `admin`, `secHead`, `finHead`, `coo`, `ceo`, `staff`, `deputy`.

## Locator rules, learned the hard way

* **`getByLabel('Password')` is ambiguous on the login page** — the eye toggle carries
  `aria-label="Show password"`. Use `getByRole('textbox', { name: 'Password' })`.
* **Never build a route regex by hand.** `new RegExp('/overdue(?|$)')` throws *Invalid group* and
  the failure looks nothing like a routing bug. Use `expectPath(page, '/overdue')`.
* Prefer `getByRole` > `getByLabel` > `getByPlaceholder` > `getByText`. Fall back to an existing
  `data-testid`; the repo already has ~39 of them (`pass-stack-card`, `pass-ordinal`,
  `approval-kpis`, `record-approval-actions`, …). **Never invent one that is not in the source** —
  if a testid is genuinely needed, note it in the report instead of guessing.
* Repeated text (`Approve`, `View pass`, `Close`) is everywhere. Scope it:
  `page.locator('[data-testid="pass-stack-card"]', { hasText: passNumber }).getByRole('button', { name: 'Approve' })`.

## Waiting

* `await settled(page)` after every `goto` — every list renders `.skeleton`, `.empty-state` or rows
  explicitly, and asserting before the skeleton clears is the main source of flake.
* **Submitting `/raise` does not navigate.** Wait for the "Pass Submitted" dialog.
* Realtime (`postgres_changes`) refreshes silently via `load(true)` — there is no skeleton flash on
  a background change. Assert on row text, never on a loading indicator.
* Notifications are fire-and-forget (`notifyApproval` is not awaited). Never assert them
  synchronously after a click resolves.

## The invariants worth asserting

* **Dashboard invariant** — a KPI's number IS `rows.length` of the page it opens.
  `assertKpiOpensItsOwnRows(page, card, countRows)`.
* **No native dialogs** — `window.alert/confirm/prompt` are banned. `pageLog.dialogs` must stay
  empty, or wrap a single action in `withNoNativeDialog`.
* **A quantity always names its unit**, `nos` included.
* **Rupee values are exact** — `₹3.1K` must never appear anywhere.
* **CSV says what the screen says** — empty is an empty cell, never an em-dash.

## File layout

```
tests/e2e/
  fixtures/    accounts.ts, test.ts        ← do not edit without updating this file
  helpers/     ui.ts, lifecycle.ts
  plan/        P1/P2/P3 — the selector inventories these specs were written from
  smoke-routes.spec.ts                     ← every route × every role renders clean
  journey.spec.ts                          ← the one full RGP lifecycle
  hod/ guard/ admin/ auth/ approver/       ← behavioural specs
```

**Max 300 lines per file** (CLAUDE.md, no exceptions) — split by behaviour, not by size.

# GatePass — manual test walkthrough

Written 2026-07-27 after migrations `008`/`009`; **updated 2026-08-08** for migrations
`024`–`032` (no cancellation, same-day expiry, one department per person), the guard
Dashboard + Pending Returns tab, the admin dashboard split, and the reports rework.
Everything below is the part a test script **cannot** prove on its own: real browsers,
real realtime across two windows, real printing, real cameras. The 2026-08-08 DB truths:

- **Cancellation is gone (`024`).** A raised gate pass is permanent: no Void, no Cancel,
  no HOD delete, and flagged passes can only be **approved**. Any step below that mentions
  voiding is obsolete.
- **Expiry is same-day (`028`).** `expires_at` = end of the raising day, not end of the
  next day.
- **One department per person (`032`).** `hod.it` heads IT and IT only; the admin panel
  refuses a second assignment (unique index on `hod_departments (hod_id)`).
- **HODs cannot create RGP-in passes.** `RaisePass` hardcodes `direction: 'out'`; Bulk
  Create was removed. The gate console's *RGP In* category filter, kept for the data
  shape, can never match a UI-created pass today — inbound returnables need Bulk Create
  back or a direction selector on the form.

**App:** http://localhost:5174  (VMS uses 5173 — both can run at once)

**Every account's password is `demo123`.**

| Role | Email |
|---|---|
| HOD (IT) | `hod.it@demo.vms` |
| Security | `guard@demo.vms` |
| Admin | `admin@demo.vms` |

Other accounts, same password: `hod.fin`, `hod.hr`, `hod2.fin`, `hod2.hr`, `hod2.it`,
`staff@`, `staff.fin`, `staff.hr`, `staff.it`, `delegate.it` (all `@demo.vms`), and
`soham@demo.com`. The `staff`-role ones test the **no-access** path.

All three roles now land on their **KPI board**: HOD → `/dashboard`, guard →
`/guard-dashboard`, admin → `/admin-dashboard` (pinned by `tests/unit/roleRoutes.test.ts`).

Order matters: **do Part 1 first.** The guard has nothing to verify until an HOD raises a pass.

---

## Part 1 — HOD (`hod.it@demo.vms`)

### 1.1 Landing and scope
1. Sign in. ✅ You land on **`/dashboard`** — the KPI drill board, not a blank page.
2. ✅ KPI tiles render: Total Raised, RGP Issued, NRGP Issued, Pending Verification,
   Matched, Mismatched, Awaiting Return, Overdue, Expired (zeros are fine on an empty day).
3. ✅ **Every KPI is a drill** — clicking one lists the matching passes below the tiles on
   the same page (no navigation). The Flagged Review card sits at the bottom.
4. ✅ Navigate to `/my-passes` — expect the **empty state**, not a stuck spinner or raw error.

### 1.2 Raise a pass — the department dropdown is the real test
1. Go to **`/raise`**.
2. ✅ **Two** type cards: **RGP** and **NRGP**. No IGP, no OGP.
3. ✅ The read-only **Pass Identity panel** shows Pass Number (`RGP-OUT-<yyyyMMdd>-####`),
   Date (today) and **Raised By** (you). All greyed out — no pass-number or date field
   exists anywhere in the form; both are server-stamped.
4. ✅ The department dropdown lists **exactly IT** — your own, and only your own since
   `032`. *If FIN or HR appear, `hod_departments` scoping is broken.*
5. Add a material row: description, quantity, unit. **Choosing RGP reveals a per-line
   Return Date** field; NRGP rows do not show one. The return date is required per line and
   cannot be in the past.
6. Fill visitor/purpose, submit. ✅ You land on the pass detail page with a success banner,
   and the pass number looks like **`RGP-20260808-0001`**.

### 1.3 The duplicate rule (your explicit requirement)
1. Back on `/raise`, raise the **same material** in the **same department**, typed
   differently — `  10  DELL  LAPTOPS  ` (extra spaces, different case).
2. ✅ Refused with a readable message — *"A pending gate pass already exists for this
   material in this department…"* — not a raw Postgres code. The rule matches normalized
   text and ignores pass type.
3. ✅ Raise genuinely different material — succeeds.
4. Cross-department duplicates can't be demoed any more (one department per person):
   the index is per-department by construction, so a second HOD in another department
   raising the same material succeeds — that's the independence, DB-enforced.

### 1.4 Print  ⚠️ human-only
1. Open the pass → **Print** on the detail page.
2. ✅ The slip is **black and white only** — no colour carries meaning.
3. ✅ A QR code is present and the **pass number printed as text** beside it.
4. ✅ Print preview opens **only when clicked**, never on page load.
5. **Print it** (or save to PDF shown on a second screen) — you need the physical code for
   2.3.

> No Void step exists any more (`024`): a raised pass is permanent. There is deliberately
> no Cancel/Void/Delete anywhere in the HOD UI.

---

## Part 2 — Security (`guard@demo.vms`)

Guard sidebar order is **Dashboard, Pending Returns, Gate Console**. `/guard-dashboard` is
the KPI/drill board; `/console` is the pending queue; `/returns` is the returnables list.

### 2.1 Landing and queue
1. Sign in. ✅ You land on **`/guard-dashboard`**, not the queue.
2. ✅ KPI cards: **Pending for Gate Approval, Matched at Gate, Mismatch at Gate, Awaiting
   Return, Overdue**. Each number is the length of the very list the click opens.
3. Click **Pending for Gate Approval** → ✅ the IT pass from 1.2 is in the revealed list.
4. ✅ **Awaiting Return and Overdue are all-time** (labelled so on the card) — an RGP that
   went out days ago must show here even though the day's KPIs are today-scoped. Do not
   "fix" the mix: `mark_returned` is reachable only through these drills.
5. `Gate Console` (`/console`) is the queue and nothing else — **no KPI row above it**; a
   compact category/department filter row plus the **pass lookup box anchored to the right
   of the page header** (icon-only QR button beside it).

### 2.2 Typed lookup
1. Type the pass number from 1.2 into the lookup box. ✅ Opens the verify screen.
2. Type garbage (`ZZZZ-1`). ✅ Clear "not found" message, no crash.

### 2.3 Camera scan  ⚠️ human-only (needs a printed slip)
> **HTTPS or localhost only.** `getUserMedia` does not exist on `http://<lan-ip>:5174`,
> so scanning from a phone against the LAN address fails — expected, not a bug. Phone
> scanning needs a Vercel deploy (+ `Permissions-Policy: camera=(self)` in `vercel.json`).

1. Click Scan → allow the camera → hold the printed slip up.
2. ✅ Preview appears; on decode it navigates to the verify screen.
3. ✅ The typed field stays mounted **beside** the scanner the whole time.
4. Deny the camera permission. ✅ Readable error, typed field still works. Never a dead
   screen.
5. ✅ Leaving the page turns the **camera light off** (tracks stopped).

### 2.4 Match
1. On the verify screen check details, then **✓ Match**.
2. ✅ A confirm panel lets you enter counted quantity / vehicle / remarks.
3. Enter a **different quantity** than declared (9 instead of 10).
4. ✅ Back on the console with a success flash; the pass leaves the queue.
5. Pass detail: ✅ timeline shows *Matched at gate* with the guard's name, and the mismatch
   is called out (`Counted 9 — declared 10`).

### 2.5 Double-match refusal
1. Type the same pass number into the lookup again.
2. ✅ Refused — "already matched". No second Match button is offered.

### 2.6 Returns — **Pending Returns tab** (`/returns`, sidebar item 2)
1. Open `/returns`. ✅ Lists exactly the returnables: RGP / ranked **overdue first**, each
   pass with an overdue/count chip, and **partially-returned passes included** (they still
   owe material).
2. Cancel the first pass's lines: click **Record Returns** → per-line buttons
   (quantity-aware). Partially return 3 of the 10 units.
3. ✅ The pass stays in the list with **9 outstanding**; the pass detail's return status is
   `partially_returned` and `returned_at` is stamped only when a line closes (per-item
   timestamps, `029`).
4. Return the rest (or **Return All** for the single-move case). ✅ The pass leaves the
   list; the dashboard's Awaiting Return / Overdue drill counts drop, and the pass detail
   shows its `actual_return_date`. Closed returnables are refused (already returned).
5. Return the dashboard: the **Awaiting Return** drill card on `/guard-dashboard` shows the
   same pass with a Record Returns button — both entries lead to the same RPC.

---

## Part 3 — Realtime (needs two windows side by side)

1. **Window A:** HOD signed in, on `/my-passes`.
2. **Window B:** guard signed in, on `/console`.
3. In Window A, **raise a pass**.
4. ✅ Window B's queue **gains the pass within ~2s, no refresh**, no flash of the loading
   skeleton (silent realtime reload).
5. In Window B, **flag** that pass (verify screen).
6. ✅ Window A: the Flagged Review card on `/dashboard` lists it without a reload.
7. In Window A, **approve/override** it. ✅ Window B's queue drops it (it is no longer
   pending) — the Match button shouldn't be the one to tell the guard "no".

---

## Part 4 — Admin (`admin@demo.vms`)

1. Sign in. ✅ You land on **`/admin-dashboard`** — the four-KPI board (Total, Awaiting
   Return, Return Rate, Overdue). These four are deliberately **not** clickable.
2. **Departments & Users** (`/admin`): ✅ a warning states departments are **shared with
   VMS** — a department created here appears in VMS.
3. **Departments tab:** assign an HOD. ✅ One department per person: the modal's copy says
   "at most one" — assigning an already-assigned HOD **moves** them (delete-then-insert);
   re-inserting the same pair is the only 23505 that can occur, and it surfaces a readable
   message.
4. **Users tab:** creating/editing an HOD shows **single-select department chips** (one
   department per person); edit pre-fills the HOD's current department; leaving it empty
   unassigns. (Multi-select was removed with `032`.)
5. **Reports** (`/all-passes`): three portals — **All Passes** (register + free-text
   search + CSV), **Return Schedule** (RGP Expected/Actual return columns) and
   **Department Summary**. A shared filter bar (type RGP/NRGP + department) applies to all
   three, and the **printed report header states the active scope** — a filtered report
   must not read as the whole org.
6. ✅ Print preview (A4 landscape, Quest letterhead) only when clicked (A5 slip's @page
   untouched).

---

## Part 5 — Route protection (fast, do it last)

Signed in as **guard**, type these in the address bar:

| URL | Expected |
|---|---|
| `/raise` | ❌ blocked / redirected |
| `/admin` | ❌ blocked / redirected |
| `/guard-dashboard` | ✅ |
| `/returns` | ✅ |
| `/console` | ✅ |

Signed in as **HOD**:

| URL | Expected |
|---|---|
| `/console` | ❌ blocked / redirected |
| `/verify/<any-id>` | ❌ blocked / redirected |
| `/dashboard` | ✅ |
| `/raise` | ✅ |
| `/my-passes` | ✅ |

> This is **UX defence in depth, not security.** RLS is the boundary and has been proven
> live; if one of these leaks, the screen may render but the data will not.

---

## Part 6 — Expiry (cannot be waited for; `028` expiry is real)

A pass expires at **end of the raising day**. Force a stale one:

```bash
DBURL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2- | tr -d '\r')
psql "$DBURL" -c "update gatepass.gate_passes set expires_at = now() - interval '1 day' \
  where status = 'pending' order by created_at desc limit 1;"
```

```powershell
# PowerShell equivalent
$u = ((Get-Content .env | Select-String '^SUPABASE_DB_URL=').ToString() -split '=', 2)[1].Trim()
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' $u -c "update gatepass.gate_passes set expires_at = now() - interval '1 day' where status = 'pending' order by created_at desc limit 1;"
```

As the guard open that pass:
1. ✅ Expiry **warning banner** shown.
2. ✅ **Match is disabled / refused.**
3. ✅ **Flag is still enabled** — recording a real mismatch on stale paperwork is
   deliberate. Flag it. ✅ Succeeds, timeline shows the reason.

---

## Part 7 — Scan attempt log

After 2.2 (garbage lookup) and 2.5 (double-scan):

```bash
psql "$DBURL" -c "select scanned_code, outcome, created_at from gatepass.scan_attempts \
  order by created_at desc limit 10;"
```

✅ Expect rows with outcomes `not_found` and `already_matched` — the audit trail that makes
forged-code probing visible (`verifications` records only what succeeded).

---

## Cleaning up afterwards

Live DB has real user data — **never wipe `gate_passes` wholesale** (nothing in the app can
delete a pass by design; `024`). Remove only your probe rows:

```bash
psql "$DBURL" -c "delete from gatepass.verifications v using gatepass.gate_passes gp \
  where v.gate_pass_id = gp.id and gp.pass_number like 'RGP-OUT-20260808-%'; \
  delete from gatepass.gate_passes where pass_number like 'RGP-OUT-20260808-%';"
```

(As `postgres`, which bypasses RLS — the app has no delete path at all.)

```powershell
# PowerShell equivalent: same $u as above, then
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' $u -c "delete from gatepass.verifications v using gatepass.gate_passes gp where v.gate_pass_id = gp.id and gp.pass_number like 'RGP-OUT-20260808-%'; delete from gatepass.gate_passes where pass_number like 'RGP-OUT-20260808-%';"
```
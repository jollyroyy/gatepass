# GatePass — manual test walkthrough

Written 2026-07-27, after migrations `008`/`009` were applied and `verify-rls.mjs --mutate`
passed 17/17. Everything below is the part a test script **cannot** prove: real browsers,
real realtime, real printing, real cameras.

**App:** http://localhost:5175  (5174 if nothing else is using it)

**Every account's password is `demo123`.** (Not `demo` — Supabase enforces a 6-character
minimum and rejects it with `weak_password`.)

| Role | Email | Password |
|---|---|---|
| HOD | `hod.it@demo.vms` | `demo123` |
| Security | `guard@demo.vms` | `demo123` |
| Admin | `admin@demo.vms` | `demo123` |

Other accounts, same password: `hod.fin`, `hod.hr`, `hod2.fin`, `hod2.hr`, `hod2.it`,
`staff@`, `staff.fin`, `staff.hr`, `staff.it`, `delegate.it` (all `@demo.vms`), and
`soham@demo.com`. The `staff`-role ones are useful for testing the **no-access** path.

`hod.it` deliberately owns **three** departments (IT, DEV, SA) — that is what exercises the
many-to-many. Sign out between roles, or use a private window per role.

Order matters: **do Part 1 first.** The guard has nothing to verify until an HOD raises a pass.

---

## Part 1 — HOD (`hod.it@demo.vms`)

### 1.1 Landing and scope
1. Sign in. You should land on **`/dashboard`**, not a blank page.
2. ✅ KPI tiles render with numbers (zeros are correct — the DB starts empty).
3. ✅ Navigate to `/my-passes` — expect the **empty state**, not a spinner that never resolves
   and not a raw error.

### 1.2a Pass types changed — check this first

There are now **two** types, not four. IGP and OGP are gone; direction is a separate choice.

1. ✅ `/raise` shows **two** type cards: RGP and NRGP. No IGP, no OGP.
2. ✅ A **Direction** dropdown sits below them.
3. Select **RGP** → ✅ direction offers both *Inward* and *Outward*.
4. Select **NRGP** → ✅ direction **snaps to Outward and becomes disabled**, with a note
   explaining inbound-permanent is a goods receipt. *If you can pick NRGP + Inward, the
   form can submit something the database rejects outright.*
5. ✅ At the top of the form, a read-only panel shows **Pass Number** (as
   `RGP-OUT-20260727-####`), **Date** (today), and **Raised By** (you). All three are
   greyed out and uneditable. The prefix must update live as you change type or direction.

### 1.2 Raise a pass — the department dropdown is the real test
1. Go to **`/raise`**.
2. ✅ The department dropdown lists **exactly IT, DEV, SA** — no FIN, no HR.
   *If FIN or HR appear, `hod_departments` scoping is broken.*
3. ✅ There is **no field for pass number and no field for date.** Both are server-stamped.
   *If you can type either, that breaks your stated requirement.*
4. Fill in: type **RGP**, material `10 Dell Laptops`, quantity `10`, unit `pcs`,
   visitor name, purpose, and an **expected return date**.
5. ✅ Choosing RGP reveals the expected-return-date field; choosing NRGP/IGP/OGP hides it.
6. Submit. ✅ You are taken to the pass detail page with a success banner.
7. ✅ The pass number looks like **`RGP-20260727-0001`** — today's date, sequence `0001`.

### 1.3 The duplicate rule — your explicit requirement
1. Go back to `/raise`.
2. Raise a **different type** (say **NRGP**) in the **same department (IT)** with material
   typed slightly differently: **`  10  DELL   laptops  `** (extra spaces, different case).
3. ✅ It is **refused**, with a readable message — *"A pending gate pass already exists for
   this material in this department…"* — not a raw Postgres error code.
   *This proves the rule matches on normalised text and ignores pass type, which is the
   strict behaviour you asked for.*
4. Now raise the same material in a **different department (DEV)**.
   ✅ This **succeeds** — departments are independent by design.

### 1.4 Print
1. Open the first pass → **Print Pass** (`/pass/<id>/print`).
2. ✅ The slip is **black and white only** — no colour carries meaning.
3. ✅ A **QR code** is present, and the **pass number is printed as text** beside it.
4. ✅ Print preview opens only when you click Print, never automatically on page load.
5. **Print it on paper** (or save to PDF and display it on a second screen) — you need a
   physical code for Part 2.

### 1.5 Void
1. `/my-passes` → find the DEV pass → **Void**.
2. ✅ An inline panel opens. It must **not** be a browser `confirm()` dialog.
3. ✅ **Confirm is disabled until you type a reason.**
4. Enter a reason, confirm. ✅ Status becomes **Voided**.
5. ✅ The **Void button is now gone** from that row (only pending passes can be voided).

---

## Part 2 — Security (`guard@demo.vms`)

### 2.1 Queue
1. Sign in. ✅ You land on **`/console`**.
2. ✅ The IT pass from 1.2 is in the queue.
3. ✅ The **voided DEV pass is NOT** in the queue.

### 2.2 Typed lookup
1. Type the pass number from 1.2 into the lookup field. ✅ It opens the verify screen.
2. Go back. Type garbage (`ZZZZ-1`). ✅ A clear "not found" message, no crash.

### 2.3 Camera scan — read the limitation first
> **This only works over HTTPS or on `localhost`.** `getUserMedia` does not exist on
> `http://<lan-ip>:5175`, so scanning from your phone against the LAN address **will fail**,
> and that is expected, not a bug. To test on a real phone you need a Vercel deploy.

**On the laptop:** click **Scan**, allow camera, hold the printed slip up to the webcam.
1. ✅ Camera preview appears.
2. ✅ On decode it navigates straight to the verify screen for that pass.
3. ✅ The **typed field stays visible** beside the scanner the whole time.
4. Click Scan then deny camera permission. ✅ A readable message appears and the typed
   field still works. *Never a dead screen.*
5. ✅ After leaving the page the **camera light goes off** (tracks stopped).

### 2.4 Match
1. On the verify screen, check the details, then **✓ Match**.
2. ✅ Confirm panel lets you enter counted quantity / vehicle / remarks.
3. Enter a **different quantity** than declared (e.g. 9 instead of 10) and confirm.
4. ✅ You return to `/console` with a success flash, and the pass leaves the queue.
5. Open the pass detail. ✅ Timeline shows **Matched at gate** with the guard's name, and the
   quantity mismatch is called out (`Counted 9 — declared 10`).

### 2.5 Double-match refusal
1. Type that same pass number into the lookup again.
2. ✅ Refused — *"already matched"*. It must not offer a second Match button.

### 2.6 Returns (RGP only)
1. Go to **`/returns`**. ✅ The RGP you matched appears, awaiting return.
2. Mark it returned. ✅ It leaves the awaiting list and the detail page shows the return date.

---

## Part 3 — Realtime (needs two windows side by side)

This is the behaviour you specifically asked for.

1. **Window A:** HOD signed in, on `/my-passes`, with a **pending** pass.
2. **Window B:** guard signed in, on `/console`, seeing that same pass in the queue.
3. In Window A, **void** the pass.
4. ✅ **Window B's queue drops the pass within a second or two, with no refresh and no
   flicker in the KPI numbers.**

Then the stricter version:
5. Raise a fresh pass as HOD. In Window B, open that pass's **verify screen** and sit there.
6. In Window A, void it.
7. ✅ Window B updates in place — the Match button becomes unavailable rather than the guard
   pressing it and being told "no" afterwards.

---

## Part 4 — Admin (`admin@demo.vms`)

1. Sign in. ✅ You land on **`/admin`**.
2. **Departments tab:** ✅ a visible warning states that departments are **shared with VMS**.
   Read it before creating anything — a department created here appears in VMS too.
3. **Users tab:** ✅ HODs can be assigned to multiple departments.
4. **`/all-passes`:** ✅ shows passes from **every** department, including the voided one.
5. ✅ Admin can also reach `/console` and `/history`.

---

## Part 5 — Route protection (fast, do it last)

Signed in as **guard**, type these in the address bar:

| URL | Expected |
|---|---|
| `/raise` | ❌ blocked / redirected — a guard must never raise a pass |
| `/admin` | ❌ blocked / redirected |
| `/console` | ✅ allowed |

Signed in as **HOD**:

| URL | Expected |
|---|---|
| `/console` | ❌ blocked / redirected |
| `/verify/<any-id>` | ❌ blocked / redirected |
| `/my-passes` | ✅ allowed |

> This is **UX defence in depth, not security.** RLS is the real boundary and is already
> proven (17/17). If one of these leaks, the screen may render but the data will not.

---

## Part 6 — Expiry (cannot be tested by waiting)

A pass is valid until end of the **next** day, so natural expiry takes ~48h. Force it:

```bash
DBURL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2- | tr -d '\r')
# Age the newest pending pass by three days
psql "$DBURL" -c "update gatepass.gate_passes set expires_at = now() - interval '3 days' \
  where status = 'pending' order by created_at desc limit 1;"
```

Then, as the guard, open that pass:
1. ✅ An expiry warning banner is shown.
2. ✅ **Match is disabled.**
3. ✅ **Flag is still enabled** — this is deliberate. A guard who finds something genuinely
   wrong with a stale pass must still be able to record it.
4. Flag it. ✅ It succeeds and lands in the timeline.

---

## Part 7 — Scan attempt log

After doing 2.2 (garbage lookup) and 2.5 (double-scan):

```bash
psql "$DBURL" -c "select scanned_code, outcome, created_at from gatepass.scan_attempts \
  order by created_at desc limit 10;"
```

✅ Expect rows with outcomes `not_found` and `already_matched`. This is the audit trail that
makes someone probing the gate with printed codes visible — `verifications` only ever records
what succeeded.

---

## Cleaning up afterwards

```bash
psql "$DBURL" -c "delete from gatepass.scan_attempts; \
  delete from gatepass.verifications; delete from gatepass.gate_passes;"
```

Safe today because there is no production data. **Do not run this once the system is live** —
`gate_passes` is an audit trail and nothing in the app can delete from it by design.

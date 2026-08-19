# Edge Functions — approval email notifications

One function, `notify-approval`. It sends the emails the approval ladder
(migration 046) needs and migration 047 supports.

## What sends, to whom

The app calls the function after `raise_pass`, `approve_pass_level` and
`reject_pass_level` have **already committed**. The function derives what
happened from the pass's own `pass_approvals` rows — the browser sends a pass id
and nothing else, so it cannot make the system claim an approval that did not
happen.

| When | Who gets it | Subject |
|---|---|---|
| A pass is raised | the **first** office on the ladder | `Approval needed: RGP-… — Security Head` |
| | the raising HOD (copy) | `Raised: RGP-… — awaiting Security Head` |
| An office approves | the **next** office | `Approval needed: …` |
| | the raising HOD (copy) | `Approved by COO: … — now with CEO` |
| The last office approves | the raising HOD | `Fully approved: RGP-…` |
| An office rejects | the raising HOD | `Rejected: RGP-… — COO` |
| No office is designated | the raising HOD | `Raised: … — no approval required` |

**Only the office whose turn it is is written to**, never all four. The ladder is
sequential — 046's `approve_pass_level` refuses anybody but the lowest pending
level — so mailing four people would send three of them a pass they cannot act
on, and teach them to ignore the fourth mail that matters.

A recipient with no email address on file is **dropped**, not faked; the other
message still sends. If one person is both the approver and the raising HOD, they
get **one** mail — the actionable one.

## Why not Supabase's built-in email

It cannot do this. The built-in sender is capped at roughly **two emails per
hour, project-wide** — a cap this project shares with VMS — and it only sends
GoTrue's own auth templates. There is no API for an arbitrary message. That same
limit is why password reset in this app is admin-assisted.

## Setup

### 1. A Resend account and an API key

Free tier: 3,000 messages/month, 100/day, no card. <https://resend.com>

> **The single most common first-run failure.** Until you verify a sending
> domain, Resend allows sending **only** from `onboarding@resend.dev` and **only
> to the address that owns the Resend account**. A mail to anyone else is refused
> — the refusal is recorded verbatim in `gatepass.email_log`.

For a corporate deployment, add your domain in Resend, publish the SPF and DKIM
DNS records it prints, and set `MAIL_FROM` to an address at that domain.

### 2. Set the function's secrets

```bash
supabase link --project-ref oxzzeonftrmohdrancex

supabase secrets set \
  RESEND_API_KEY="re_..." \
  MAIL_FROM="Quest GatePass <gatepass@yourcompany.com>" \
  APP_BASE_URL="https://your-app.vercel.app"
```

`APP_BASE_URL` is where the links in the letter point (`/approvals` for the
approver, `/pass/<id>` for the HOD). **No trailing slash needed** — it is
trimmed either way. The function refuses to run without it rather than sending
mail with dead links.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Do not set them.

### 3. Apply migration 047

Paste `supabase/APPLY_ALL.sql` into the SQL Editor as usual, or just the `047`
section. It adds `gatepass.approval_notice_payload()` and `gatepass.email_log`.

### 4. Deploy

```bash
supabase functions deploy notify-approval
```

The function imports `src/lib/approvalNotice.ts` — the Supabase CLI bundles the
module graph, so that file ships with it. **That file must never gain an
import**: Deno needs a `.ts` extension on local imports and the app's tooling
needs none, so the only way one file satisfies both runtimes is to import
nothing. `tests/unit/approvalNotice.test.ts` fails if an import appears there.

## Checking it works

```sql
-- Every attempt, newest first. Admin-readable in the app too.
select created_at, kind, recipient, subject, ok, error
  from gatepass.email_log
 order by created_at desc
 limit 20;
```

`ok = false` with a populated `error` is the provider's own refusal, verbatim —
that is what to read first. **No row at all** means the function was never
reached: check that it is deployed, and the browser console for
`[gatepass] approval notification was not sent`.

## What is deliberately not done

- **No `pg_net` trigger.** A pass raised outside this app — a `psql` insert, a
  future integration — sends no mail. The trade is argued in full at the top of
  `supabase/migrations/047_approval_email_notifications.sql`: the API key stays
  out of a database that `psql` connects to as `postgres`, and a mail failure can
  never roll back a gate pass.
- **No retry queue.** A refused message is logged and not resent. Retrying needs
  a scheduler and a dedupe key; the log tells an admin what to chase by hand
  until that is worth building.
- **No CSP change.** Edge Functions live at `<project>.supabase.co/functions/v1`,
  which `vercel.json`'s `connect-src` already allows.

# Edge Functions — gate pass email notifications

One function, `notify-approval`. It sends every letter a gate pass's life calls
for: the approval ladder (migrations 046/047), the requester's own receipts, and
the gate's decision (migration 076).

The app calls it after `raise_pass`, `approve_pass_level`, `reject_pass_level`,
`match_pass`, `flag_pass` and `emergency_release_pass` have **already
committed**. The function derives what happened from the pass's own row and its
own `pass_approvals` rows — the browser sends a pass id and nothing else, so it
cannot make the system claim an approval that did not happen, or tell an HOD
their material left a gate it is still standing at.

## What sends, to whom

**The rule (client, 2026-09-01):** *"put the one who raised the pass in all the
communication, but for the approval emails the approver should be only notified
about their own approval. Once it is approved by others and once it is
completed, similarly do this for everybody."*

| When | To | Copied | `kind` |
|---|---|---|---|
| A pass is raised | the requester | — | `raised` |
| …and in the same breath | the **first** office on the ladder | the requester | `awaiting_you` |
| That office approves | the **next** office, and nobody else | the requester | `awaiting_you` |
| The last office signs | the requester | every office that signed | `fully_approved` |
| An office rejects it | the requester | every office on the ladder | `rejected` |
| The gate clears the material | the requester | every office that signed | `gate_cleared` |
| The gate stops it (final, 070) | the requester | every office that signed | `gate_flagged` |
| A fallback office releases it (055) | each office that was skipped | the requester, once | `emergency_release` |

**An approval REQUEST goes to one office and no other.** The ladder is
sequential — 046's `approve_pass_level` refuses anybody but the lowest pending
level — so mailing four people would send three of them a pass they cannot act
on, and teach them to ignore the fourth mail that matters. Every other letter is
an OUTCOME, where there is no wrong reader.

An office with no email address on file is **dropped**, not faked — the pass
still waits for them in `/approvals`. Copies are deduplicated by address (one
person can hold an office and cover another, 072), and are `cc`, never `bcc`: a
gate pass is an internal control document.

**The approve/reject buttons open the app; they do not decide anything by being
fetched.** A link in an email is a GET, and Outlook Safe Links and every other
scanner opens a URL before its reader does — so a URL that approved a pass would
approve passes nobody had read. They open `/pass/<id>?decide=approve|reject`;
the app signs the reader in and offers the decision on screen, under their own
JWT.

## Why not Supabase's built-in email

It cannot do this. The built-in sender is capped at roughly **two emails per
hour, project-wide** — a cap this project shares with VMS — and it only sends
GoTrue's own auth templates. There is no API for an arbitrary message. That same
limit is why password reset in this app is admin-assisted.

## Setup

### 1. A Brevo account and an API key

Free tier: **300 emails a day**, shared between marketing and transactional
sends, unlimited contacts, no card. <https://www.brevo.com> (verified
2026-09-01.) A single mall's gate passes are far below that — but note the cap is
*shared*, so a marketing campaign sent from the same account eats into it.

1. Sign up and choose the **Free** plan.
2. **Verify a sender**, under *Senders, Domains & Dedicated IPs*:
   - **Quick, for testing:** *Senders → Add a sender*. Brevo emails that address
     a confirmation link; click it. Works at once, but the mail will often land
     in spam.
   - **Production — do this before rollout:** *Domains → Add a domain*, then
     publish the **DKIM, DMARC and Brevo-code** DNS records it prints, and press
     Authenticate. This is what stops approval mail going to junk.
3. **API key:** profile menu → *SMTP & API* → *API Keys* → **Generate a new API
   key**. It starts with `xkeysib-` and **Brevo shows it once** — copy it now.

> **The single most common first-run failure.** Until a sender is verified (or a
> domain authenticated) Brevo refuses the message, and the refusal is recorded
> verbatim in `gatepass.email_log`. Read that column first, always.

The key never enters this repo or the database — `psql` connects to this project
as `postgres` and would be able to read it. It lives only in the function's
secrets.

### 2. Set the function's secrets

```bash
supabase link --project-ref oxzzeonftrmohdrancex

supabase secrets set \
  BREVO_API_KEY="xkeysib-..." \
  MAIL_FROM="Quest GatePass <gatepass@yourcompany.com>" \
  APP_BASE_URL="https://your-app.vercel.app"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Do not set them.

`APP_BASE_URL` is where the links in the letter point. **No trailing slash
needed** — it is trimmed either way. The function refuses to run without it
rather than sending mail with dead links.

### `MAIL_OVERRIDE_TO` — every letter to one inbox

Optional, set in **Admin → Settings** (migration 052) or as a secret. When it
carries an address, every message is delivered there whatever office it named,
**and the copies are suppressed** — redirecting the addressee while still copying
the live COO is the exact accident this valve exists to prevent.

The office is still named in the subject line, so four approvals produce four
distinguishable letters in one inbox. `gatepass.email_log` records
`delivered@address (redirected from intended@address)`, so the log never claims
the CEO was written to directly.

**Clearing it, plus a `MAIL_FROM` at an authenticated domain, is the entire
production switch-over.** Nothing in the repo names a test inbox.

⚠ **The stored sender wins over `MAIL_FROM`.** `mail_settings.from_email` is
read first (052), so setting the secret is not enough on a deployment whose
Settings tab has ever been saved — check Admin → Settings and put a
Brevo-verified address there too.

### 3. Apply the migrations

Paste `supabase/APPLY_ALL.sql` into the SQL Editor as usual, or just the `076`
section on top of an existing deployment. 047 added
`gatepass.approval_notice_payload()` and `gatepass.email_log`; **076** adds the
gate's own decision (`flag_reason`, `verified_by_name`, `verified_at`) to that
payload. Without it the two gate letters still send, with the guard's name and
reason missing — a missing fact, never a failed send.

### 4. Deploy

```bash
supabase functions deploy notify-approval
```

The function imports `src/lib/notice/*`. The Supabase CLI bundles the module
graph, so those files ship with it. **Every relative import in that folder must
carry its `.ts` suffix** — Deno resolves nothing without it, and
`allowImportingTsExtensions` in `tsconfig.app.json` is what lets the app's own
tooling accept the same form. `tests/unit/approvalNotice.test.ts` fails if a
suffix goes missing, or if any module there imports a package.

## Checking it works

```sql
-- Every attempt, newest first. Admin-readable in the app too.
select created_at, kind, recipient, subject, ok, error
  from gatepass.email_log
 order by created_at desc
 limit 20;
```

`ok = false` with a populated `error` is the provider's own refusal, verbatim —
that is what to read first. The `subject` carries a `[cc: …]` suffix naming
everyone copied, so the log can answer "was the COO told this pass was stopped?"

**No row at all** means the function was never reached: check that it is
deployed, and the browser console for `[gatepass] approval notification was not
sent`.

## What is deliberately not done

- **No `pg_net` trigger.** A pass raised outside this app — a `psql` insert, a
  future integration — sends no mail. The trade is argued in full at the top of
  `supabase/migrations/047_approval_email_notifications.sql`: the API key stays
  out of a database that `psql` connects to as `postgres`, and a mail failure can
  never roll back a gate pass.
- **No retry queue.** A refused message is logged and not resent. Retrying needs
  a scheduler and a dedupe key; the log tells an admin what to chase by hand
  until that is worth building.
- **No letter when a rung's escalation window elapses.** There is no scheduler on
  this deployment, so the CEO learns a pass has escalated to them (063) by
  opening their queue.
- **No letter for a recorded return, or an overdue one.** The return leg is a
  second axis and nobody asked for it; `src/lib/notice/noticeGate.ts` is where it
  would go and `NoticeKind` is the union to widen.
- **No SMTP transport.** `mail_settings` carries SMTP columns (052) and nothing
  sends through them. Brevo's own relay is `smtp-relay.brevo.com:587`; the HTTP
  API is used instead because it needs no socket from the Deno runtime and
  returns a `messageId` the log can quote.
- **No CSP change.** Edge Functions live at `<project>.supabase.co/functions/v1`,
  which `vercel.json`'s `connect-src` already allows.

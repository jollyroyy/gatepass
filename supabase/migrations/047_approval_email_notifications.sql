-- ============================================================================
-- 047 — the approval ladder sends email
--
-- 046 made the ladder real: a pass waits at an office, and until every office
-- has signed, the guard cannot see it at all. That leaves one gap, and it is
-- the gap the client actually reported — NOTHING TELLS THE APPROVER. A pass
-- sits in a queue nobody has been asked to open, and the material waits at the
-- gate while four people go about their day.
--
-- This migration is the DATABASE half of the fix. It carries no mail transport
-- of its own; Postgres has none. Two objects:
--
--   1. `approval_notice_payload(uuid)` — everything one email needs about one
--      pass, in a single round trip, including the office holders' EMAIL
--      ADDRESSES.
--   2. `email_log` — every send attempt, kept, so "the CEO never got it" is a
--      question with an answer.
--
-- The sender is `supabase/functions/notify-approval`, a Deno Edge Function
-- holding the service-role key and a transactional mail provider's API key.
--
-- ═══ WHY THE SENDER IS NOT IN HERE ═══
--
-- The obvious shape — an AFTER INSERT trigger firing `pg_net.http_post` — was
-- considered and rejected for this deployment, on three counts:
--
--   * `pg_net` is not enabled on this project, and enabling an extension that
--     makes outbound HTTP calls from inside transactions is a security decision
--     of its own, on a database shared with VMS.
--   * the provider's API key would then have to live in the DATABASE (Vault or
--     a settings GUC). It lives in the Edge Function's secrets instead, where
--     nothing with a `postgres` connection can read it — and this repo's own
--     notes are clear that `psql` here connects as `postgres`.
--   * a failed `pg_net` call inside a trigger is either invisible or it rolls
--     back a raised gate pass. Neither is acceptable: THE PASS MATTERS MORE
--     THAN THE EMAIL. The Edge Function is called after the RPC has already
--     committed, so a mail outage can never cost an HOD their pass.
--
-- THE COST, STATED PLAINLY: a pass raised by any route that is not this app —
-- a `psql` insert, a future integration — sends no mail, because nothing calls
-- the function. That is the trade for the three points above. If mail must
-- become unconditional, the honest fix is `pg_net` plus Vault, and this comment
-- is the argument to re-read first.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Everything one notification needs, in one call
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER, and granted to `service_role` ONLY — deliberately NOT to
-- `authenticated`. It returns email addresses of named officers, which is the
-- one fact in this whole schema that no screen has ever shown and no role has
-- ever needed. `gatepass.get_approval_ladder()` (043) is the function every
-- signed-in user may call, and it returns names and departments and no address.
--
-- The two are not redundant: 043 answers "who holds this office" for a printed
-- record, this answers "where do I post this letter" for a machine. Widening
-- 043 to carry an address would have put every user's mailbox behind an
-- anon-key call, which is precisely how a corporate directory leaks.
--
-- Returns jsonb rather than a composite type, because the caller is JavaScript
-- and a composite whose shape changes needs a drop-and-recreate every time
-- (`my_profile()` has been through that twice). A jsonb document costs one
-- `->>` at the other end and never needs a migration to gain a field.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pass', (
      select jsonb_build_object(
               'id',                   p.id,
               'pass_number',          p.pass_number,
               'type',                 p.type,
               'status',               p.status,
               'visitor_name',         p.visitor_name,
               'purpose',              p.purpose,
               -- The vendor's display name, unpacked from the `{"n","a","v"}`
               -- blob by the schema's own helper. Never `visitor_company` raw —
               -- an email printing a JSON object is how this stops being read.
               'vendor_name',          gatepass.company_name_of(p.visitor_company),
               'department_name',      d.name,
               'raised_by',            p.raised_by,
               'raised_by_name',       rb.full_name,
               'raised_by_email',      rb.email,
               'item_count',           coalesce(it.item_count, 0),
               'total_value',          coalesce(it.total_value, 0),
               'expected_return_date', p.expected_return_date,
               'created_at',           p.created_at
             )
        from gatepass.gate_passes p
        left join public.departments d on d.id = p.department_id
        left join public.profiles   rb on rb.id = p.raised_by
        left join lateral (
               select count(*) as item_count, sum(i.approx_value) as total_value
                 from gatepass.gate_pass_items i
                where i.gate_pass_id = p.id
             ) it on true
       where p.id = p_pass_id
    ),
    'approvals', coalesce((
      -- LEFT JOIN into VMS's profiles, the rule the pass view follows: a
      -- narrowed VMS policy must degrade this to an office with no address —
      -- which drops ONE message — rather than to a missing office, which would
      -- silently reroute the mail to the wrong person.
      -- `routed_to` is the office holder SNAPSHOTTED when the pass was raised
      -- (046), not whoever holds the office today. That is what makes the mail
      -- correct: a pass raised under the old COO is still that COO's to sign,
      -- and the letter must go to them. It is nullable — 046 sets it null if
      -- the account is deleted — which drops one message rather than sending it
      -- to nobody.
      select jsonb_agg(jsonb_build_object(
               'role_key',       a.role_key,
               'level_no',       a.level_no,
               'status',         a.status,
               'approver_id',    a.routed_to,
               'approver_name',  ap.full_name,
               'approver_email', ap.email,
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join public.profiles ap on ap.id = a.routed_to
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function gatepass.approval_notice_payload(uuid) from public;
grant execute on function gatepass.approval_notice_payload(uuid) to service_role;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. service_role ONLY — the Edge Function that sends the mail is the only caller. Every signed-in reader uses get_approval_ladder() (043), which carries no address.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. What was sent, and what failed
-- ═══════════════════════════════════════════════════════════════════════════
-- WITHOUT THIS TABLE THE FEATURE IS UNSUPPORTABLE. "The CEO says he never got
-- the mail" has exactly three possible answers — we never tried, we tried and
-- the provider refused, or we sent it and it is in his spam — and only a log
-- can tell them apart. The alternative is reading an Edge Function's console
-- logs, which expire.
--
-- `recipient` is stored. That is a deliberate, narrow retention of one address
-- per row: it IS the fact being audited, and a log that records "a message was
-- sent to somebody" answers nothing.
create table if not exists gatepass.email_log (
  id            uuid primary key default gen_random_uuid(),
  gate_pass_id  uuid references gatepass.gate_passes(id) on delete set null,
  -- Free text, not an enum: NoticeKind lives in TypeScript
  -- (`src/lib/approvalNotice.ts`) and a new kind must not need a migration
  -- before the log can record it. A check constraint here would fail the paste
  -- rather than record an unexpected kind, which is backwards for a log.
  kind          text not null,
  recipient     text not null,
  subject       text not null,
  ok            boolean not null,
  -- The provider's message id when it accepted, its refusal when it did not.
  provider_id   text,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists email_log_pass_idx
  on gatepass.email_log (gate_pass_id, created_at desc);

create index if not exists email_log_failures_idx
  on gatepass.email_log (created_at desc) where not ok;

alter table gatepass.email_log enable row level security;

-- ADMINS READ IT, NOBODY WRITES IT. The Edge Function writes with the service
-- role, which bypasses RLS; no policy for insert therefore exists, and that is
-- the same shape every other table in this schema has — a client that can write
-- a log can forge one.
--
-- Not readable by the HOD whose pass it is, and not by the approver: the rows
-- carry other people's addresses, and "did my approver get the mail" is a
-- support question, not a screen.
drop policy if exists email_log_admin_select on gatepass.email_log;
create policy email_log_admin_select
  on gatepass.email_log for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.email_log to authenticated;

comment on table gatepass.email_log is
  'Every approval notification send attempt, successful or not. Written only by the notify-approval Edge Function under the service role; readable by admins. Retention is manual — trim it when it grows.';

notify pgrst, 'reload schema';

-- ============================================================================
-- 004 — Reporting view and KPI aggregate
-- ============================================================================

-- ⚠ The two profiles joins below are SUPERSEDED BY 006. They are left here so
-- this file still reads as the history of the view, but 006 repoints them at
-- gatepass.profile_names: under security_invoker these LEFT JOINs ran
-- public.profiles' policies as the caller, and a recursive policy on that
-- VMS-owned table (42P17) took down every screen. Read 006 before editing.
--
-- `security_invoker = true` is load-bearing. Without it a view runs with its
-- OWNER's privileges, which would bypass the RLS on gate_passes entirely and let
-- any HOD read every department's passes through the view. Requires PG15+.
--
-- The joins to public.profiles / public.departments are LEFT joins on purpose:
-- those tables belong to VMS and their RLS policies can change without notice.
-- An inner join would make pass rows silently VANISH the day VMS narrows its
-- profiles policy. A left join degrades to a null name instead — visibly wrong
-- rather than invisibly wrong.
create or replace view gatepass.v_gate_passes
with (security_invoker = true) as
select
  p.*,
  -- One definition of "overdue", used by every list and every KPI.
  (p.return_status = 'awaiting_return'
   and p.expected_return_date is not null
   and p.expected_return_date < (now() at time zone 'UTC')::date) as is_overdue,
  d.name  as department_name,
  d.code  as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join public.departments d  on d.id  = p.department_id
left join public.profiles    rb on rb.id = p.raised_by
left join public.profiles    vb on vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

-- ─── KPI aggregate ──────────────────────────────────────────────────────────
-- One round trip for the whole dashboard instead of six count queries.
--
-- NOT security definer: a plain function runs as the invoker, so the RLS on
-- gate_passes scopes these counts to the caller automatically. An HOD gets their
-- own departments' numbers; security and admin get the whole site's.
create or replace function gatepass.kpis(p_department_id uuid default null)
returns table (
  total            bigint,
  pending          bigint,
  matched          bigint,
  flagged          bigint,
  awaiting_return  bigint,
  overdue          bigint,
  raised_today     bigint
)
language sql
stable
as $$
  select
    count(*)                                                        as total,
    count(*) filter (where status = 'pending')                      as pending,
    count(*) filter (where status = 'matched')                      as matched,
    count(*) filter (where status = 'flagged')                      as flagged,
    count(*) filter (where return_status = 'awaiting_return')       as awaiting_return,
    count(*) filter (where is_overdue)                              as overdue,
    count(*) filter (where created_at >= date_trunc('day', now()))  as raised_today
  from gatepass.v_gate_passes
  where p_department_id is null or department_id = p_department_id;
$$;

grant execute on function gatepass.kpis(uuid) to authenticated;

-- ─── Pass detail with its verification history ──────────────────────────────
-- Used by the detail screen so the timeline arrives with the record.
create or replace view gatepass.v_verifications
with (security_invoker = true) as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join public.profiles su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

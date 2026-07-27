-- ============================================================================
-- 006 — Stop reading public.profiles under the caller's RLS
--
-- Symptom: a guard signs in and every screen that resolves a person's name dies
-- with SQLSTATE 42P17, "infinite recursion detected in policy for relation
-- profiles".
--
-- Cause: a policy on public.profiles whose USING clause reads public.profiles.
-- That table belongs to VMS, and VMS has shipped three separate fixes for this
-- exact class of bug (its migrations 006, 013, 022) — so the live policy set does
-- not match its files, and can drift again at any time.
--
-- Why gatepass was taking the hit: gatepass.v_gate_passes is
-- `security_invoker = true` (correctly — it must enforce gate_passes RLS against
-- the caller), and it LEFT JOINed public.profiles. security_invoker applies to
-- EVERY table the view touches, so the recursive profiles policy was evaluated
-- for the guard and the whole query aborted. A LEFT JOIN protects against a
-- NARROWED policy (rows come back with a null name); it cannot protect against a
-- policy that raises.
--
-- Fix: gatepass stops depending on the policies of a table it does not own.
-- Every name lookup now goes through objects in this schema:
--
--   gatepass.profile_names          owner-rights view — id + full_name only
--   gatepass.my_profile()           the caller's own row
--   gatepass.admin_list_profiles()  admin-gated directory
--
-- public is not touched. No policy, table, or function in public is altered by
-- this file — the two-schema rule holds. The recursion itself is still VMS's bug
-- to fix (see supabase/fixes/public_profiles_recursion.sql); this file only makes
-- GatePass immune to it.
-- ============================================================================

-- ─── The one deliberate owner-rights object in this schema ──────────────────
-- NOTE THE ABSENCE OF `security_invoker`. That is the entire point of this view
-- and the only place in this codebase where a view is allowed to omit it.
--
-- Without security_invoker a view reads its base tables as the view's OWNER
-- (postgres, which also owns public.profiles), so the policies on
-- public.profiles are never evaluated — and therefore cannot recurse.
--
-- Safe because of what it exposes, not because of who calls it: two columns,
-- id and full_name, for accounts that already exist in a shared corporate
-- directory. No email, no role, no department, no delegate. Both of VMS's
-- intended profiles SELECT policies (its 013 and 022) are `using (true)` for
-- `authenticated` anyway, so this grants no read that VMS withholds.
--
-- Do NOT add columns here. Anything beyond a display name belongs in the
-- admin-gated function below.
--
-- APPLY THIS AS `postgres` (i.e. paste it into the Supabase SQL Editor, which is
-- how every migration in this repo is applied). The view's owner is what makes it
-- work: `postgres` also owns public.profiles, and a table's owner is not subject
-- to that table's policies. Applied as some other non-owner role, this view would
-- inherit the recursion it exists to avoid — and it would fail loudly the first
-- time a guard loaded the console, not silently.
drop view if exists gatepass.profile_names;
create view gatepass.profile_names as
select p.id, p.full_name
  from public.profiles p;

grant select on gatepass.profile_names to authenticated;

-- ─── The caller's own profile ───────────────────────────────────────────────
-- Replaces `pub().from('profiles').eq('id', session.user.id)` in the app shell,
-- the sidebar, and the role fallback in src/supabaseClient.ts.
--
-- Scoped to auth.uid() inside the function body, so being SECURITY DEFINER
-- widens nothing: a caller can only ever read the row they could already read.
create or replace function gatepass.my_profile()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at
    from public.profiles p
   where p.id = auth.uid();
$$;

-- ─── The admin user directory ───────────────────────────────────────────────
-- Backs the admin Users tab and the HOD picker on the Departments tab. Returns
-- email and role, so it is gated on gatepass.is_admin() rather than left open.
--
-- This is STRICTER than what it replaces: the old client query read
-- public.profiles under VMS's `using (true)` SELECT policy, which let any
-- authenticated user — including a guard — enumerate every email and role.
--
-- p_role filters to one role ('hod' for the picker); null returns everyone.
create or replace function gatepass.admin_list_profiles(p_role text default null)
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can list users.';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at
      from public.profiles p
     where p_role is null or p.role::text = p_role
     order by p.role, p.full_name;
end;
$$;

grant execute on function gatepass.my_profile()                 to authenticated;
grant execute on function gatepass.admin_list_profiles(text)    to authenticated;

-- ─── Repoint the views away from public.profiles ────────────────────────────
-- Supersedes the profiles joins in 004. Everything else about these views is
-- unchanged: still security_invoker (gate_passes RLS is still enforced against
-- the caller), still LEFT JOINs, still one definition of is_overdue.
--
-- The join to public.departments stays as it was — VMS's departments SELECT
-- policy is a flat `using (true)` with no subquery, so it cannot recurse.
--
-- `create or replace` keeps the column list byte-identical, which is required
-- while gatepass.kpis() depends on this view.
create or replace view gatepass.v_gate_passes
with (security_invoker = true) as
select
  p.*,
  (p.return_status = 'awaiting_return'
   and p.expected_return_date is not null
   and p.expected_return_date < (now() at time zone 'UTC')::date) as is_overdue,
  d.name  as department_name,
  d.code  as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join public.departments      d  on d.id  = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

create or replace view gatepass.v_verifications
with (security_invoker = true) as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join gatepass.profile_names su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

-- ─── Self-check ─────────────────────────────────────────────────────────────
-- Run as a guard (not in the SQL editor, which runs as postgres and bypasses
-- RLS — use the app or a signed-in REST call):
--
--   select id, pass_number, raised_by_name from gatepass.v_gate_passes limit 1;
--   select * from gatepass.my_profile();
--
-- Both must return without a 42P17. `select * from gatepass.admin_list_profiles()`
-- must raise 'Only an admin can list users.' for that same guard.

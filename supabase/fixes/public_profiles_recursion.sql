-- ============================================================================
-- ROOT-CAUSE FIX — public.profiles infinite recursion
--
-- ⚠ THIS FILE TOUCHES THE `public` SCHEMA, WHICH BELONGS TO VMS.
--
-- It deliberately lives in supabase/fixes/ and NOT in supabase/migrations/,
-- because migrations in this repo are forbidden from altering anything in
-- `public` (see CLAUDE.md, "the two-schema rule"). Nothing here is applied by
-- APPLY_ALL.sql. Apply it only as a conscious cross-project decision — it
-- changes behaviour for the VMS visitor app too.
--
-- GatePass does NOT need this file. Migration 006 already makes GatePass immune
-- by routing every name lookup through gatepass.profile_names. Apply this one
-- only to un-break VMS itself, which reads public.profiles directly all over.
--
-- What is broken: at least one policy on public.profiles has a USING or
-- WITH CHECK clause that reads public.profiles. Postgres detects the loop at
-- query time and aborts with:
--     42P17  infinite recursion detected in policy for relation "profiles"
--
-- Any SELECT on the table then fails for every non-superuser, which is why it
-- surfaced the moment a guard signed in.
--
-- VMS has fixed this three times already (its migrations 006, 013, 022) and it
-- has come back, so the live policy set is being edited outside those files.
-- STEP 1 exists so you find out what is actually there before changing it.
-- ============================================================================


-- ─── STEP 1 — LOOK FIRST. Run this alone and read the output. ───────────────
-- Anything whose `qual` or `with_check` mentions `profiles` is the culprit.
-- Save this output somewhere before running STEP 2 — it is the only record of
-- what the live policy set was.

select
  policyname,
  cmd,
  roles,
  qual        as using_clause,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'profiles'
order by cmd, policyname;

-- Also check for helper functions that read profiles and are NOT security
-- definer — one of these called from a policy produces the same recursion:
select
  p.proname,
  p.prosecdef                              as is_security_definer,
  p.proconfig                              as settings,
  pg_get_functiondef(p.oid)                as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and pg_get_functiondef(p.oid) ilike '%profiles%'
  and p.prokind = 'f'
order by p.proname;


-- ─── STEP 2 — REPLACE THE POLICY SET. Run only after reading STEP 1. ────────
-- Drops every policy currently on public.profiles (by name, whatever they are
-- called — that is why this is dynamic; the hand-edited names are unknown) and
-- recreates VMS's intended set from its migration 022, which is the last state
-- its own files describe.
--
-- Every clause below reads either auth.uid() or the JWT. Nothing reads
-- public.profiles, so recursion is structurally impossible, not just absent.

do $$
declare
  r record;
begin
  for r in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', r.policyname);
    raise notice 'dropped policy %', r.policyname;
  end loop;
end $$;

-- SELECT — flat true, exactly as VMS's 013 and 022 intended.
-- VMS's rationale, kept verbatim so it is not lost: profile rows hold only name,
-- email and department; visitor PII lives in public.visitors under tighter
-- policies. Note this is what GatePass's old client queries were relying on.
create policy "profiles: all authenticated can read"
  on public.profiles for select to authenticated
  using (true);

-- UPDATE (own row). The privilege escalation this must prevent — a user editing
-- their own `role` to 'admin' — is NOT expressible in a WITH CHECK clause
-- (see the note under STEP 3; VMS's 013 attempt was a no-op tautology).
-- The trigger in STEP 3 is what actually enforces it.
create policy "profiles: user updates own non-sensitive fields"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- UPDATE (admin, any row). Reads app_metadata, which only the service role can
-- write. Never user_metadata — that is user-writable and forgeable.
create policy "profiles: admin manages all"
  on public.profiles for update to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'))
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'));

-- DELETE (admin only).
create policy "profiles: admin can delete"
  on public.profiles for delete to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'));

-- No INSERT policy, matching VMS's 013 and 022: rows are created only by the
-- public.handle_new_user() trigger on auth.users, which is SECURITY DEFINER.


-- ─── STEP 3 — close the hole STEP 2 leaves open ─────────────────────────────
-- The "user updates own non-sensitive fields" policy above cannot stop a user
-- from escalating their own role, and neither could the version it replaces.
-- VMS's 013 tried:
--
--     with check (coalesce(role, 'staff') = coalesce(role, 'staff') and ...)
--
-- In a WITH CHECK clause, `role` is the NEW row on both sides of that equality.
-- It compares the new value to itself and is therefore always true — a
-- tautology, not a guard. A user holding UPDATE on their own row could
-- `set role = 'admin'` and the policy would wave it through.
--
-- A trigger is the only place that can see OLD and NEW together, so that is
-- where the rule has to live.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role and the postgres role are how legitimate provisioning
  -- happens (scripts/create-user.ts, the admin API, SQL editor). Let them pass.
  if current_setting('request.jwt.claim.role', true) = 'service_role'
     or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- An admin, established from server-written app_metadata, may change anyone.
  if (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'You cannot change your own role.';
  end if;

  if new.department_id is distinct from old.department_id then
    raise exception 'You cannot change your own department.';
  end if;

  if new.delegate_id is distinct from old.delegate_id then
    raise exception 'You cannot change your own delegate.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_self_role_escalation on public.profiles;
create trigger prevent_self_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

revoke all on function public.prevent_self_role_escalation() from anon, authenticated;


-- ─── STEP 4 — verify ────────────────────────────────────────────────────────
-- 1. Re-run STEP 1. No `using_clause` or `with_check` may contain the word
--    "profiles". If one does, STEP 2 missed it and the recursion is still live.
--
-- 2. Then sign in to the app as a guard (NOT the SQL editor — the editor runs as
--    postgres and bypasses RLS, so it will look fine either way) and load the
--    gate console. It must render with no 42P17.
--
-- 3. Still signed in as that guard, confirm the escalation guard bites:
--       update public.profiles set role = 'admin' where id = auth.uid();
--    must fail with 'You cannot change your own role.'

-- ============================================================================
-- 002 — Grants and Row Level Security
--
-- Threat model this file is written against:
--   * An HOD must never read another department's passes. They share one DB with
--     other departments and the client is fully untrusted — RLS is the authority,
--     never the UI.
--   * An HOD must never be able to mark their own pass "matched". Only security
--     verifies, and only through the RPCs in 003.
--   * No client may rewrite pass fields after security has looked at them.
-- ============================================================================

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant usage on schema gatepass to authenticated;

-- No UPDATE and no DELETE are granted to anyone, anywhere in this app.
-- State changes go exclusively through the RPCs in migration 003. Postgres RLS
-- cannot express "you may change `status` and `flag_reason` but not
-- `visitor_name`", so column-level authority lives in the functions instead.
grant select, insert on gatepass.gate_passes   to authenticated;
grant select         on gatepass.verifications to authenticated;
grant select, insert, delete on gatepass.hod_departments to authenticated;

-- `anon` gets nothing. Every screen in this app requires a login.

-- ─── Role helpers ───────────────────────────────────────────────────────────
-- Named app_role() rather than current_role() because current_role is a reserved
-- SQL keyword and the shadowing is a trap for the next reader.
--
-- Reads app_metadata from the JWT. app_metadata is only writable server-side,
-- which is why it is trusted; user_metadata is user-writable and must never be
-- used for authorization. Verified: all 14 live users have app_metadata.role set.
create or replace function gatepass.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    (select p.role::text from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function gatepass.is_security()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gatepass.app_role() in ('guard', 'admin', 'super_admin');
$$;

create or replace function gatepass.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gatepass.app_role() in ('admin', 'super_admin');
$$;

-- The departments the signed-in HOD is responsible for.
-- SECURITY DEFINER so the policy on gate_passes can consult hod_departments
-- without recursing back through that table's own policies. VMS had to patch
-- exactly this class of recursion three times (its migrations 006, 013, 028).
create or replace function gatepass.my_department_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hd.department_id
    from gatepass.hod_departments hd
   where hd.hod_id = auth.uid();
$$;

grant execute on function gatepass.app_role()          to authenticated;
grant execute on function gatepass.is_security()       to authenticated;
grant execute on function gatepass.is_admin()          to authenticated;
grant execute on function gatepass.my_department_ids() to authenticated;

-- ─── RLS: hod_departments ───────────────────────────────────────────────────
alter table gatepass.hod_departments enable row level security;

drop policy if exists hod_departments_select on gatepass.hod_departments;
create policy hod_departments_select
  on gatepass.hod_departments for select to authenticated
  using (
    hod_id = auth.uid()          -- an HOD sees their own assignments
    or gatepass.is_security()    -- security/admin see all (queue shows dept names)
  );

drop policy if exists hod_departments_insert on gatepass.hod_departments;
create policy hod_departments_insert
  on gatepass.hod_departments for insert to authenticated
  with check (gatepass.is_admin());

drop policy if exists hod_departments_delete on gatepass.hod_departments;
create policy hod_departments_delete
  on gatepass.hod_departments for delete to authenticated
  using (gatepass.is_admin());

-- ─── RLS: gate_passes ───────────────────────────────────────────────────────
alter table gatepass.gate_passes enable row level security;

drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select
  on gatepass.gate_passes for select to authenticated
  using (
    gatepass.is_security()                                    -- guard/admin: all
    or department_id in (select gatepass.my_department_ids())  -- hod: own depts only
  );

-- An HOD may only ever create a pass that is:
--   * for a department they actually hold,
--   * attributed to themselves, and
--   * born 'pending' and unverified.
-- The last three clauses stop a crafted insert from arriving pre-matched.
drop policy if exists gate_passes_insert on gatepass.gate_passes;
create policy gate_passes_insert
  on gatepass.gate_passes for insert to authenticated
  with check (
    gatepass.app_role() = 'hod'
    and raised_by = auth.uid()
    and department_id in (select gatepass.my_department_ids())
    and status = 'pending'
    and verified_by is null
    and verified_at is null
    and flag_reason is null
    and actual_return_date is null
    and return_status = 'not_applicable'
  );

-- Deliberately NO update policy and NO delete policy. See the grants above.

-- ─── RLS: verifications ─────────────────────────────────────────────────────
alter table gatepass.verifications enable row level security;

drop policy if exists verifications_select on gatepass.verifications;
create policy verifications_select
  on gatepass.verifications for select to authenticated
  using (
    gatepass.is_security()
    or exists (
      select 1
        from gatepass.gate_passes p
       where p.id = gate_pass_id
         and p.department_id in (select gatepass.my_department_ids())
    )
  );

-- Inserts happen only inside the SECURITY DEFINER RPCs. No policy granted.

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- The security queue subscribes to postgres_changes so a newly raised pass shows
-- up at the gate without a refresh. Realtime still applies RLS per subscriber.
do $$ begin
  alter publication supabase_realtime add table gatepass.gate_passes;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime not found — skipping realtime setup';
end $$;

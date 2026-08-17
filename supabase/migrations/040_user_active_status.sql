-- ============================================================================
-- 040 - "inactive" is a STATUS, not a role
--
-- Until now, deactivating someone meant `update public.profiles set role =
-- 'staff'` (021's admin_soft_delete_user). Two things were wrong with that,
-- and the client named the first one: the admin portal's Role column read
-- "Inactive", which is not a role -- and the person's REAL role (guard or HOD)
-- was destroyed by the very act of suspending them, so reactivating meant an
-- admin guessing what the account used to be. The second is quieter: `staff`
-- is a legitimate VMS role for people who simply do not use GatePass, so
-- GatePass was overwriting a shared column to record a fact of its own.
--
-- The fact belongs here, in `gatepass.user_status`, and the role column goes
-- back to holding a role. `staff` stops being writable from the admin portal
-- at all (admin_create_user / admin_update_user now allow guard and hod only),
-- so nothing in this app demotes a person into VMS's role again.
--
-- HOW A DEACTIVATED PERSON IS ACTUALLY SHUT OUT. Not by the client hiding a
-- screen -- their JWT still says `guard`, and a JWT cannot be un-issued. The
-- flag is consulted by the two functions every policy already goes through:
--
--   * app_role()          -> null when inactive, so is_security() and
--                            is_admin() are both false and every policy and
--                            RPC gated on them refuses.
--   * my_department_ids() -> returns nothing when inactive, which is the ONE
--                            path into gate_passes that does not read
--                            app_role() (an HOD reads their own departments).
--
-- Miss either and a suspended person keeps reading passes. Together they mean
-- deactivation is enforced in Postgres, for every existing policy and every
-- policy added later, with no per-policy edit.
--
-- ABSENT ROW = ACTIVE. `is_user_active` coalesces to true, so all 32 existing
-- accounts stay exactly as they are with no backfill, and a row is written
-- only when an admin actually suspends someone. A legacy `staff` account is
-- therefore "active" by this flag and still has no access -- because `staff`
-- has no routes and no policy grants, which was always the case. The portal
-- shows such a row as Staff / Inactive; giving it a real role in Edit is what
-- turns it into a usable account.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The status table
-- ═══════════════════════════════════════════════════════════════════════════
-- Keyed on auth.users rather than public.profiles: this records something
-- about the ability to sign in and be authorized, and `on delete cascade`
-- means removing an account cannot leave a suspension behind that a recycled
-- uuid would inherit.
create table if not exists gatepass.user_status (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  is_active      boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),

  -- A suspension with no timestamp is a suspension nobody can date. The
  -- inverse is deliberately NOT constrained: reactivation clears both columns,
  -- but a row that kept them would still be readable rather than rejected.
  constraint user_status_inactive_is_dated check (is_active or deactivated_at is not null)
);

alter table gatepass.user_status enable row level security;

-- A person may see their own status; an admin sees everyone's (the portal's
-- Status column). Nobody holds INSERT/UPDATE/DELETE -- the two RPCs below are
-- the only writers, exactly as with gate_passes' state machine.
drop policy if exists user_status_select on gatepass.user_status;
create policy user_status_select
  on gatepass.user_status for select to authenticated
  using (user_id = auth.uid() or gatepass.is_admin());

grant select on gatepass.user_status to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The helper every gate reads
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER so the policy on user_status is never evaluated from
-- inside the functions that decide that policy -- the same reason
-- my_department_ids() is one (see 002). It deliberately calls NOTHING: an
-- app_role() or is_admin() call here would recurse through the very policy
-- this function exists to answer.
create or replace function gatepass.is_user_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.is_active from gatepass.user_status s where s.user_id = p_user_id),
    true
  );
$$;

grant execute on function gatepass.is_user_active(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The two gates that now consult it
-- ═══════════════════════════════════════════════════════════════════════════
-- app_role() is unchanged apart from the wrapper: same JWT source, same
-- profiles fallback. A deactivated caller gets null, which every `in (...)`
-- test below it evaluates to false rather than to a role.
create or replace function gatepass.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when gatepass.is_user_active(auth.uid()) then
             coalesce(
               nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
               (select p.role::text from public.profiles p where p.id = auth.uid())
             )
         end;
$$;

-- The one path into gate_passes that does not go through app_role().
-- gate_passes_select admits `department_id in (select my_department_ids())`,
-- so without this a suspended HOD would keep reading their department's
-- passes, and gate_passes_insert would keep letting them raise new ones.
create or replace function gatepass.my_department_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hd.department_id
    from gatepass.hod_departments hd
   where hd.hod_id = auth.uid()
     and gatepass.is_user_active(auth.uid());
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Deactivation writes the flag and KEEPS the role
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces 021's body wholesale. Three differences that matter:
--   * public.profiles is not touched at all, so the role survives the
--     suspension and reactivation needs no guess.
--   * hod_departments assignments SURVIVE too (021 deleted them). They are
--     inert while the flag is false -- my_department_ids() returns nothing --
--     and reactivating restores the person's exact scope instead of an admin
--     re-deriving which department they held.
--   * every session is deleted. Without that, someone already signed in
--     elsewhere keeps a valid JWT and a working screen until it expires; RLS
--     would refuse their reads, so they would sit in front of an app that
--     silently shows nothing. Same reasoning as 036's password reset.
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Mirrors admin_reset_user_password (036): the weakest admin account must
  -- not be a route to suspending a stronger one. A locked-out admin is a
  -- Supabase-dashboard job, deliberately.
  if v_role in ('admin', 'super_admin') then
    raise exception 'An admin account cannot be deactivated from the portal.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, false, now(), auth.uid(), now())
  on conflict (user_id) do update
    set is_active      = false,
        deactivated_at = now(),
        deactivated_by = auth.uid(),
        updated_at     = now();

  delete from auth.sessions where user_id = p_user_id;

  return json_build_object('id', p_user_id::text, 'deactivated', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Reactivation
-- ═══════════════════════════════════════════════════════════════════════════
-- 021 had no such function: "reactivating" meant an admin choosing a role for
-- someone whose role had been erased. Now it restores exactly what was
-- suspended, and it refuses an account with no role to restore -- a `staff`
-- row has no access whether the flag is true or false, so flipping it would
-- report a person as Active who still cannot sign in to anything.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  if v_role not in ('guard', 'hod') then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, true, null, null, now())
  on conflict (user_id) do update
    set is_active      = true,
        deactivated_at = null,
        deactivated_by = null,
        updated_at     = now();

  return json_build_object('id', p_user_id::text, 'reactivated', true);
end;
$$;

grant execute on function gatepass.admin_reactivate_user(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. `staff` is no longer writable from the admin portal
-- ═══════════════════════════════════════════════════════════════════════════
-- Both bodies are 034's admin_create_user and 032's admin_update_user COPIED
-- VERBATIM, with exactly one line changed in each: the allowed-role list loses
-- 'staff'. Everything else is load-bearing and was hard-won -- 034's four
-- auth.users token columns (omit them and the account cannot sign in at all),
-- 023's UPDATE-not-INSERT of the profile row VMS's own trigger already
-- created, 032's one-department guard and its mirror into
-- public.profiles.department_id. Re-read those three migrations before
-- touching either body again.
create or replace function gatepass.admin_create_user(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           text,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_now     timestamptz := now();
  v_dept    uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  -- 040: 'staff' is VMS's role for someone who does not use GatePass, not this
  -- app's off switch. Deactivation is gatepass.user_status now.
  if p_role not in ('guard', 'hod') then
    raise exception 'Invalid role "%". Allowed: guard, hod.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') — corrected below, not
  -- re-inserted, or this collides with the trigger's own row (023).
  --
  -- confirmation_token / recovery_token / email_change / email_change_token_new
  -- are written as '' and MUST stay in this list: they are nullable with no
  -- default, and GoTrue cannot scan a NULL into its Go string field — omitting
  -- them makes the account unable to sign in at all (034).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now, v_now,
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = p_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

  if p_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

create or replace function gatepass.admin_update_user(
  p_user_id        uuid,
  p_full_name      text default null,
  p_role           text default null,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_role text;
  v_dept         uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can update users.';
  end if;

  if p_role is not null then
    if p_role in ('admin', 'super_admin') then
      raise exception 'Cannot promote to admin. Use the CLI with the service-role key.';
    end if;
    -- 040: see admin_create_user above.
    if p_role not in ('guard', 'hod') then
      raise exception 'Invalid role "%". Allowed: guard, hod.', p_role;
    end if;
  end if;

  -- Look up current role to guard against the caller changing their own role
  select role::text into v_current_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  -- Update profile (department_id changes only when the caller spoke of it)
  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    role      = coalesce(p_role::public.user_role, role),
    department_id = case when p_department_ids is not null then v_dept else department_id end
  where id = p_user_id;

  -- Sync role to auth.users app_metadata
  if p_role is not null then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role),
        updated_at = now()
    where id = p_user_id;
  end if;

  -- Reassign the person's single department (only meaningful for HOD)
  if p_department_ids is not null then
    delete from gatepass.hod_departments where hod_id = p_user_id;
    if v_dept is not null then
      insert into gatepass.hod_departments (hod_id, department_id)
      values (p_user_id, v_dept);
    end if;
  end if;

  return json_build_object('id', p_user_id::text, 'updated', true);
end;
$$;

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The flag has to reach the client
-- ═══════════════════════════════════════════════════════════════════════════
-- Both functions are DROPPED and recreated, not replaced: their OUT column
-- lists change, which `create or replace` cannot do (the same dance 025 and
-- 036 did). The execute grants go with the drop and are re-applied here, in
-- the same transaction.
--
-- GatePass never reads public.profiles directly (the 006 rule), so these two
-- functions are the only way either fact reaches a screen.
drop function if exists gatepass.my_profile();

create function gatepass.my_profile()
returns table (
  id                   uuid,
  email                text,
  full_name            text,
  role                 text,
  department_id        uuid,
  avatar_url           text,
  created_at           timestamptz,
  must_change_password boolean,
  is_active            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id,
         p.avatar_url, p.created_at, p.must_change_password,
         gatepass.is_user_active(p.id)
    from public.profiles p
   where p.id = auth.uid();
$$;

grant execute on function gatepass.my_profile() to authenticated;

drop function if exists gatepass.admin_list_profiles(text);

create function gatepass.admin_list_profiles(p_role text default null)
returns table (
  id             uuid,
  email          text,
  full_name      text,
  role           text,
  department_id  uuid,
  created_at     timestamptz,
  is_active      boolean,
  deactivated_at timestamptz
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
    select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at,
           coalesce(s.is_active, true), s.deactivated_at
      from public.profiles p
      left join gatepass.user_status s on s.user_id = p.id
     where p_role is null or p.role::text = p_role
     order by p.full_name;
end;
$$;

grant execute on function gatepass.admin_list_profiles(text) to authenticated;

notify pgrst, 'reload schema';

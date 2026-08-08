-- ============================================================================
-- 032 — One department per person (GatePass and VMS must agree)
--
-- Business rule, 2026-08-08: a person can belong to AT MOST ONE department.
-- VMS models this structurally — public.profiles.department_id is a single
-- column — so VMS was already constrained. GatePass's join table
-- (gatepass.hod_departments) was a many-to-many and the one place a user
-- could acquire two departments. This migration closes that gap three ways:
--
--   1. A UNIQUE index on hod_departments (hod_id): the database itself
--      rejects a second row for the same person. No RPC can be forgotten
--      later, because the failing path is a 23505 no matter who writes.
--   2. The department-bearing admin functions (admin_create_user,
--      admin_update_user) now REJECT more than one department with a clear
--      message, and — critically for "VMS and GatePass" — mirror the chosen
--      department into public.profiles.department_id, VMS's single-column
--      authority. The two apps then read the same fact for the same person.
--   3. The demo seed 005 no longer invents a multi-department HOD (it only
--      ever seeded from profiles.department_id — itself single).
--
-- A department may still have several HODs; the live DB's shape is exactly
-- that (two HODs in HR, two in IT, three in FIN). Only the person→department
-- direction becomes one-to-one.
--
-- No one currently in the database has more than one row (verified 2026-08-08:
-- all 7 HODs carry exactly one assignment), so this migration contains NO data
-- repair. The dedupe below is defensive only — it keeps one row per person
-- (the department the VMS profile already names, else the newest) so a DB that
-- somehow accumulated duplicates cannot break the paste.
-- ============================================================================

-- 1) Defensive dedupe: keep per person the row matching profiles.department_id
--    (VMS is the authority), else the newest. Distinct on (hod_id).
with keeper as (
  select distinct on (hod_id) hod_id, department_id
    from gatepass.hod_departments hd
   order by hod_id,
     department_id = (
       select p.department_id from public.profiles p where p.id = hd.hod_id
     ) desc,
     created_at desc
)
delete from gatepass.hod_departments hd
where (hd.hod_id, hd.department_id) not in (select hod_id, department_id from keeper);

-- 2) THE constraint: one row per person.
create unique index hod_departments_one_department_per_person
  on gatepass.hod_departments (hod_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_create_user — recreated: at most one department, mirrored to VMS
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces the 021/025-era definition. All prior behaviours preserved (023's
-- trigger-collision fix included); the department handling is now single:
--   * more than one department is refused outright;
--   * the chosen (sole) department is written to BOTH gatepass.hod_departments
--     AND public.profiles.department_id (VMS), so the two apps agree.
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

  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
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
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
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

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_update_user — recreated: one department max, mirrored to VMS
-- ═══════════════════════════════════════════════════════════════════════════
-- p_department_ids = null  → departments unchanged
-- p_department_ids = []    → clear the person's assignments (and VMS column)
-- p_department_ids = [d]   → replace with exactly d (VMS column mirrors it)
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
    if p_role not in ('guard', 'hod', 'staff') then
      raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
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

-- 021 grants cover these signatures; re-asserting keeps a fresh paste
-- self-contained (create or replace inherits grants on the same signature,
-- so this is belt-and-braces only).
grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[]) to authenticated;
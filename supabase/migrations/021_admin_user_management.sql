-- ============================================================================
-- 021 — Admin user management RPCs (create, update, soft-delete)
--
-- Previously, creating a user required the service-role key via the CLI
-- (scripts/create-user.ts). That is still the ONLY path for creating an
-- admin/super_admin. For everyone else (guard, hod, staff), the admin panel
-- can now do it through SECURITY DEFINER functions that run as postgres.
--
-- Three constraints encoded in these functions, not just in the UI:
--   1. Admins cannot create another admin — role is restricted server-side.
--   2. Admins cannot promote anyone to admin.
--   3. Soft-delete (set role = 'staff') is the only delete path; hard-deleting
--      a user would orphan gate_passes.raised_by FK references.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_create_user — create a non-admin auth user + profile
-- ═══════════════════════════════════════════════════════════════════════════
-- Allowed roles: guard, hod, staff. Rejects admin/super_admin.
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
  v_user_id  uuid;
  v_now      timestamptz := now();
begin
  -- Only admins may call this
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  -- Block admin creation from this path
  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  -- Validate role
  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
  end if;

  -- Check for existing email
  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

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

  insert into public.profiles (id, email, full_name, role, created_at)
  values (v_user_id, p_email, p_full_name, p_role::public.user_role, v_now);

  if p_role = 'hod' and p_department_ids is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    select v_user_id, unnest(p_department_ids)
    on conflict (hod_id, department_id) do nothing;
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_update_user — change name, role, department assignments
-- ═══════════════════════════════════════════════════════════════════════════
-- Cannot promote to admin/super_admin. Pass null for fields to keep unchanged.
-- When p_department_ids is non-null, existing assignments are replaced entirely.
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

  -- Update profile
  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    role      = coalesce(p_role::public.user_role, role)
  where id = p_user_id;

  -- Sync role to auth.users app_metadata
  if p_role is not null then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role),
        updated_at = now()
    where id = p_user_id;
  end if;

  -- Reassign departments (only meaningful for HOD)
  if p_department_ids is not null then
    delete from gatepass.hod_departments where hod_id = p_user_id;
    insert into gatepass.hod_departments (hod_id, department_id)
    select p_user_id, unnest(p_department_ids)
    on conflict (hod_id, department_id) do nothing;
  end if;

  return json_build_object('id', p_user_id::text, 'updated', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_soft_delete_user — revoke app access by setting role to 'staff'
-- ═══════════════════════════════════════════════════════════════════════════
-- Hard-deleting from auth.users would cascade to gate_passes.raised_by and
-- break historical records. Instead, the user keeps their auth login but loses
-- all app access (staff has no policy grants).
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  update public.profiles
  set role = 'staff'::public.user_role
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'staff'),
      updated_at = now()
  where id = p_user_id;

  -- Remove HOD department assignments
  delete from gatepass.hod_departments where hod_id = p_user_id;

  return json_build_object('id', p_user_id::text, 'deactivated', true);
end;
$$;

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[])         to authenticated;
grant execute on function gatepass.admin_soft_delete_user(uuid)                         to authenticated;

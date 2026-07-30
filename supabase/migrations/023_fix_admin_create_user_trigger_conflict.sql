-- ============================================================================
-- 023 — Fix admin_create_user: false "already exists" on every new user
--
-- Root cause: public.handle_new_user() — VMS's own trigger on auth.users,
-- confirmed live via pg_get_functiondef() — fires on the `insert into
-- auth.users` a few lines below and:
--   1. inserts a row into public.profiles(id, email, full_name) itself,
--      with role defaulted to 'staff' (public.profiles.role default), and
--   2. overwrites auth.users.raw_app_meta_data back to role: 'staff'.
--
-- 021's admin_create_user then ran its own `insert into public.profiles`,
-- which collided with the row the trigger had already created — a 23505
-- unique violation on profiles.id, which src/lib/errors.ts renders as
-- "That record already exists." This fired on every call, for any brand-new
-- email, which is exactly the reported bug.
--
-- Even had that insert been skipped, the trigger's app_metadata overwrite
-- would have silently demoted every new guard/hod back to 'staff'.
--
-- Fix: let the trigger create the row, then UPDATE it (and app_metadata)
-- to the role the admin actually chose, instead of INSERTing a second time.
-- ============================================================================

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

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') and then overwrites
  -- raw_app_meta_data back to role: 'staff' — both corrected below, not
  -- re-inserted, or this collides with the trigger's own row.
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
  set role = p_role::public.user_role
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

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

-- ============================================================================
-- 034 — Users the admin panel creates could never sign in
--
-- Symptom: an admin adds a guard/HOD, the account appears everywhere it should
-- (auth.users, public.profiles, the Users tab, correct role in app_metadata,
-- email already confirmed), and yet signing in with that email and password
-- fails. Not with "invalid credentials" — with a 500 from the auth server.
--
-- Root cause, confirmed in the live auth logs 2026-08-08:
--     "converting NULL to string is unsupported"
--
-- GoTrue scans auth.users' token columns into Go `string` fields, which cannot
-- hold NULL. Four of those columns are nullable AND have no column default:
--
--     confirmation_token        recovery_token
--     email_change              email_change_token_new
--
-- `admin_create_user` (021/023/032) never listed them in its INSERT, so every
-- account it created carried NULL there and blew up inside the auth server on
-- the very first sign-in. Supabase's own signup path writes '' into all four,
-- which is why demo accounts and self-signups were unaffected — and why this
-- was invisible from GatePass's side: the row looks perfectly healthy.
--
-- The remaining string columns (phone_change, phone_change_token,
-- email_change_token_current, reauthentication_token) each default to '' and
-- so were already being written correctly; they are omitted here on purpose.
--
-- Two parts, because fixing the function alone leaves the existing accounts
-- broken forever:
--   1. backfill the rows already written with NULLs;
--   2. recreate admin_create_user so new rows are written with ''.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Repair the accounts already created — they cannot sign in until this runs
-- ─────────────────────────────────────────────────────────────────────────────
-- Touches only NULL→'' on token columns. No password, email, role, metadata or
-- confirmation state is altered, so a healthy row is left byte-for-byte alone.
update auth.users
set confirmation_token      = coalesce(confirmation_token, ''),
    recovery_token          = coalesce(recovery_token, ''),
    email_change            = coalesce(email_change, ''),
    email_change_token_new  = coalesce(email_change_token_new, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) admin_create_user — recreated so new users can actually log in
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to 032's definition in every other respect: the admin check, the
-- no-admin-from-this-path rule, role validation, the one-department guard and
-- its mirror into public.profiles.department_id (032), and 023's "let the VMS
-- trigger create the profile row, then UPDATE it" fix. The ONLY change is the
-- four token columns in the INSERT column list.
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

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;

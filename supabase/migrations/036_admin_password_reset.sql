-- ============================================================================
-- 036 — Admin-assisted password reset, and a forced change on first sign-in
--
-- The "Forgot password?" link was removed from the login card (2026-08-10): the
-- built-in Supabase email sender is capped at ~2 mails/hour PROJECT-WIDE (and
-- that budget is shared with VMS), so the self-serve button failed for most
-- people who pressed it. The replacement is a human — the admin resets it from
-- Admin → Users → Edit User.
--
-- ── ORDERING DEPENDENCY, READ THIS BEFORE APPLYING ──────────────────────────
-- The flag this relies on, public.profiles.must_change_password, is added by
-- **VMS migration 064**, because public is VMS-owned and GatePass must never
-- alter it (the two-schema rule). Apply VMS 064 FIRST. This migration only
-- reads and writes the column's VALUE, exactly as admin_create_user already
-- writes public.profiles.role — that has always been allowed.
--
-- The functions below deliberately MIRROR VMS's rather than calling them: each
-- app authorizes with its own admin check (gatepass.is_admin() reads this app's
-- notion of admin, VMS's reads its own), and each app's callable surface stays
-- inside its own schema. The bcrypt write is the same shape admin_create_user
-- has used since 021 (extensions.crypt / gen_salt('bf')), verified live on
-- 2026-08-08 — GoTrue accepts a hash written this way and the account signs in.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_reset_user_password — an admin sets someone else's password
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gatepass.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_target_role public.user_role;
  v_now         timestamptz := now();
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reset a password.';
  end if;

  -- A 6-character floor matches GoTrue's own minimum and the Add User form.
  -- Enforced HERE because this path writes the hash directly and so never
  -- passes through the auth server's own validation.
  if p_password is null or length(p_password) < 6 then
    raise exception 'The new password must be at least 6 characters.';
  end if;

  select p.role, u.email into v_target_role, v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if v_email is null then
    raise exception 'That user no longer exists.';
  end if;

  -- Deliberate: an admin cannot reset another admin's password. Otherwise the
  -- weakest admin account becomes a takeover route into every stronger one, and
  -- "reset" becomes an undetectable way to seize a super_admin. This matches
  -- admin_create_user, which likewise refuses to mint an admin. The Users tab
  -- already renders no row actions for an admin, so the UI agrees with the RPC.
  if v_target_role in ('admin', 'super_admin') then
    raise exception 'Admin passwords cannot be reset from the panel. Use the Supabase dashboard.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = v_now,
      -- 034's lesson, applied defensively: GoTrue scans these four into Go
      -- strings and returns a 500 on NULL. Costs nothing to keep them sane.
      confirmation_token     = coalesce(confirmation_token, ''),
      recovery_token         = coalesce(recovery_token, ''),
      email_change           = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, '')
  where id = p_user_id;

  update public.profiles
  set must_change_password = true
  where id = p_user_id;

  -- Every existing session dies with the old password. Without this, someone
  -- already signed in on another device keeps full access — which defeats the
  -- point of a reset when the reason for it is a suspected compromise.
  -- refresh_tokens.session_id cascades (verified live: confdeltype 'c'); the
  -- second delete catches legacy rows that predate session_id.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  return json_build_object(
    'id', p_user_id::text,
    'email', v_email,
    'must_change_password', true
  );
end;
$$;

revoke all on function gatepass.admin_reset_user_password(uuid, text) from public;
grant execute on function gatepass.admin_reset_user_password(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) set_my_password — the user chooses their own, and the flag clears with it
-- ─────────────────────────────────────────────────────────────────────────────
-- The flag is cleared HERE, in the same call that writes the password, and
-- nowhere else. A separate "clear the flag" RPC would let the forced-change
-- screen be skipped by calling it from the browser console — the flag can only
-- come down by actually setting a password.
create or replace function gatepass.set_my_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_current text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to change your password.';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'Your new password must be at least 6 characters.';
  end if;

  select encrypted_password into v_current from auth.users where id = v_uid;

  -- Reusing the temporary password the admin just read out over the phone
  -- leaves the account exactly as exposed as it was. Refuse it by name so the
  -- message is actionable rather than a silent no-op.
  if v_current is not null and extensions.crypt(p_password, v_current) = v_current then
    raise exception 'Choose a password you have not used before.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  where id = v_uid;

  update public.profiles
  set must_change_password = false
  where id = v_uid;
end;
$$;

revoke all on function gatepass.set_my_password(text) from public;
grant execute on function gatepass.set_my_password(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) my_profile() must carry the flag — the app gate reads it from here
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP + recreate, not `create or replace`: the return type changes, and
-- Postgres cannot replace a function whose OUT columns differ. This is the same
-- dance 025 did when avatar_url was added — and the execute grant must be
-- re-applied in the same transaction, because the drop takes it with it.
--
-- GatePass never reads public.profiles directly (the 006 rule — VMS's recursive
-- policy raises 42P17), so this function is the ONLY way the flag reaches the
-- client.
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
  must_change_password boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id,
         p.avatar_url, p.created_at, p.must_change_password
    from public.profiles p
   where p.id = auth.uid();
$$;

grant execute on function gatepass.my_profile() to authenticated;

notify pgrst, 'reload schema';

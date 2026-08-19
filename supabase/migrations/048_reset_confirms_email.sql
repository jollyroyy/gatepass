-- ============================================================================
-- 048 — an admin-set password is only useful if the account can actually
--       sign in: the reset now confirms the email address too
--
-- THE BUG, reported by the client 2026-08-19: "when the admin resets the
-- password for a user then he should be able to log in with that password and
-- with the email that is being shown in the user".
--
-- 036's `admin_reset_user_password` writes the bcrypt hash into
-- `auth.users.encrypted_password`, clears every session, and raises the
-- must-change flag. All of that works. What it never touched is
-- `email_confirmed_at` — and GoTrue refuses a sign-in for an unconfirmed
-- address, before it ever looks at the password. So the admin read a fresh
-- password down the phone, the person typed it with the exact email the Users
-- tab prints beside their name, and the login failed for a reason neither of
-- them could see.
--
-- Measured on the live database before writing this, as `postgres`:
--
--   * 7 accounts carry `email_confirmed_at is null`;
--   * EVERY ONE of them has `last_sign_in_at is null` — not one has ever got
--     in — while every account that HAS signed in is confirmed. One of the
--     seven already carries `must_change_password = true`, i.e. an admin had
--     already reset it and it still could not be used;
--   * `public.profiles.email` and `auth.users.email` agree on every row, so
--     the address the portal shows is genuinely the address GoTrue matches on.
--     The email was never the problem — the confirmation was.
--
-- The seven were created through VMS's own sign-up path, which sends a
-- confirmation mail. Accounts minted here have never had this problem:
-- `admin_create_user` (021, carried through 040) has always written
-- `email_confirmed_at = now()`, for the same reason applied below.
--
-- WHY CONFIRMING HERE IS THE RIGHT FIX, not a shortcut past a security control.
-- Email confirmation answers one question: does the person who claimed this
-- address control it? An admin setting the password by hand answers a stronger
-- version of it — they are asserting, from inside the organisation, that this
-- account belongs to a named colleague they are about to hand a credential to.
-- That is the same assertion `admin_create_user` already makes when it mints a
-- confirmed account, and the same one that made this app's password reset
-- admin-assisted in the first place: the built-in sender is capped at ~2 mails
-- an hour PROJECT-WIDE and shared with VMS, so a confirmation link is not a
-- control this deployment can actually deliver (see 036's header).
--
-- `coalesce`, never a bare assignment: an address confirmed in 2026-07 keeps
-- its original timestamp, so a password reset cannot quietly restate when the
-- person proved they owned it.
--
-- Everything else in 036's body is unchanged and is copied here verbatim,
-- including the four GoTrue token columns 034 was written for — dropping any
-- of them turns a sign-in into a 500 with nothing visibly wrong in Postgres.
-- ============================================================================

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
      -- 048: the account must be able to SIGN IN with what the admin just set.
      -- GoTrue rejects an unconfirmed address before it checks the password, so
      -- without this the reset succeeds and the login still fails. coalesce so
      -- an already-confirmed address keeps its original timestamp.
      email_confirmed_at = coalesce(email_confirmed_at, v_now),
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
-- The one account this already happened to
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrowed to `must_change_password` accounts on purpose: that flag is written
-- by exactly one thing, `admin_reset_user_password` above, so the set is
-- "accounts an admin has ALREADY reset and expects to work" — the very case the
-- client reported. It is not a blanket confirmation of every unconfirmed
-- address in the shared directory; the other six have had no such assertion
-- made about them, and resetting their password is what will confirm them.
--
-- Idempotent, and safe to re-run: `is null` matches nothing on a second pass.
update auth.users u
set email_confirmed_at = now(),
    updated_at         = now()
where u.email_confirmed_at is null
  and exists (
    select 1 from public.profiles p
     where p.id = u.id
       and p.must_change_password
       and p.role not in ('admin', 'super_admin')
  );

notify pgrst, 'reload schema';

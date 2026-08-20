-- ============================================================================
-- 056 — APP SETTINGS: one admin-editable row for the things a deployment wants
--       to change without a redeploy
--
-- Shaped exactly like 052's `mail_settings`, and for the same reasons: a
-- single-row lock on a boolean primary key, RLS enabled with NO policy and NO
-- grant on the table, and every read and write through an `is_admin()`-gated
-- SECURITY DEFINER function. Read 052's header first — this migration adds
-- nothing new to that pattern, it applies it.
--
-- ⚠ TWO OF THESE FIELDS ENFORCE SOMETHING TODAY AND THREE DO NOT. That split is
--   deliberate, it is stated on the screen, and it must stay stated:
--
--     ENFORCED NOW
--       * `session_timeout_minutes` — `src/components/SessionTimeout.tsx` is an
--         idle timer that already signs a user out; it reads this instead of a
--         constant. Real from the day this ships.
--
--     STORED, ENFORCING NOTHING (yet)
--       * `require_approver_2fa` — THERE IS NO SECOND FACTOR IN THIS SYSTEM.
--         Supabase Auth ships TOTP and the enforcement point would be an `aal2`
--         check inside `approve_pass_level`, but none of that is built. The
--         client asked for the switch to exist now and be turned on later.
--         ⚠ A CONTROL LABELLED "Require 2FA" THAT SILENTLY DOES NOTHING IS
--         WORSE THAN NO CONTROL — an admin who flips it and walks away believes
--         approvers are protected. The card therefore says, on its face, that
--         it is not enforced. If that sentence is ever removed, this column
--         becomes a lie; delete the column instead.
--       * `app_name`, `brand_color` — branding, saved and not applied. The app
--         keeps its shipped Quest identity until a later phase wires them.
--         Same honest precedent as 052's SMTP columns, which are stored and
--         send nothing.
--
-- WHY NOT WAIT AND ADD THEM WHEN THEY WORK? Because the client asked for the
-- provisions, and a settings table that has to be migrated again for each one
-- is three more migrations against a live database. The cost of doing it this
-- way is exactly one thing: the screen must never overstate what a field does.
-- ============================================================================

create table if not exists gatepass.app_settings (
  -- 052's single-row lock: `id` can only ever be true, so a second row is a
  -- primary key violation rather than a settings table nobody can read
  -- deterministically.
  id boolean primary key default true check (id),

  -- Null = "use what the app ships with". Never the empty string — "unset"
  -- must have exactly one spelling, the rule 052 states.
  app_name    text check (app_name    is null or (btrim(app_name) <> '' and length(app_name) <= 40)),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),

  -- NOT NULL with a default of false: "nobody has decided yet" and "2FA is not
  -- required" are the same thing here, and a nullable boolean would invite a
  -- three-state read of a two-state fact.
  require_approver_2fa boolean not null default false,

  -- Five minutes is the shortest timeout that is not an accident; a day is the
  -- longest that is still a timeout. Null means "use the app's own default"
  -- (5 minutes, `SessionTimeout.tsx`'s shipped value), so clearing the field
  -- restores the shipped behaviour rather than locking everybody out with a
  -- zero.
  session_timeout_minutes int check (
    session_timeout_minutes is null or session_timeout_minutes between 5 and 1440
  ),

  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table gatepass.app_settings is
  'One row. Admin-editable application settings (056). Read and written only through get_app_settings/set_app_settings — see the header for which fields enforce something and which are stored provisions.';

alter table gatepass.app_settings enable row level security;

-- NO POLICY AND NO GRANT for `authenticated`, exactly as 052. Nothing but the
-- three functions below ever touches this table.
--
-- `require_approver_2fa` is withheld from non-admins on purpose: "there is no
-- second factor on this deployment" is reconnaissance about a control, not
-- decoration. The idle timeout is NOT withheld — see get_session_timeout()
-- below for why that one has to be readable by everyone.

create or replace function gatepass.get_app_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the application settings.';
  end if;

  select jsonb_build_object(
           'app_name',                s.app_name,
           'brand_color',             s.brand_color,
           'require_approver_2fa',    s.require_approver_2fa,
           'session_timeout_minutes', s.session_timeout_minutes,
           'updated_at',              s.updated_at,
           'updated_by_name',         p.full_name
         )
    into v
    from gatepass.app_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  -- A table that has never been written is not an error: it is the state every
  -- deployment starts in. The caller gets a document of nulls rather than a
  -- null document, so the form renders identically either way (052's rule).
  return coalesce(v, jsonb_build_object('require_approver_2fa', false));
end;
$fn$;

grant execute on function gatepass.get_app_settings() to authenticated;

create or replace function gatepass.set_app_settings(
  p_app_name                text,
  p_brand_color             text,
  p_require_approver_2fa    boolean,
  p_session_timeout_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := nullif(btrim(coalesce(p_app_name, '')), '');
  v_color text := nullif(btrim(coalesce(p_brand_color, '')), '');
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the application settings.';
  end if;

  -- The CHECKs are restated as sentences, 052's rule: a constraint violation
  -- reaches the browser as 23514, which this app deliberately does not map to
  -- a readable message.
  if v_name is not null and length(v_name) > 40 then
    raise exception 'The application name has to be 40 characters or fewer.';
  end if;

  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'A brand colour has to be a six-digit hex code, like #C6A15B.';
  end if;

  if p_session_timeout_minutes is not null
     and (p_session_timeout_minutes < 5 or p_session_timeout_minutes > 1440) then
    raise exception 'The sign-out timer has to be between 5 minutes and 24 hours.';
  end if;

  insert into gatepass.app_settings as a (
    id, app_name, brand_color, require_approver_2fa, session_timeout_minutes,
    updated_by, updated_at
  )
  values (
    true, v_name, v_color, coalesce(p_require_approver_2fa, false), p_session_timeout_minutes,
    auth.uid(), now()
  )
  on conflict (id) do update
    set app_name                = excluded.app_name,
        brand_color             = excluded.brand_color,
        require_approver_2fa    = excluded.require_approver_2fa,
        session_timeout_minutes = excluded.session_timeout_minutes,
        updated_by              = excluded.updated_by,
        updated_at              = excluded.updated_at;

  return gatepass.get_app_settings();
end;
$fn$;

grant execute on function gatepass.set_app_settings(text, text, boolean, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- The one setting EVERY signed-in user has to be able to read
-- ═══════════════════════════════════════════════════════════════════════════
-- `get_app_settings()` above is admin-only, and correctly so: whether a second
-- factor is required is reconnaissance about a control. But the idle timeout
-- governs the guard at the barrier and the HOD at their desk, not just the
-- admin who set it — their own browser is what has to enforce it, so their own
-- browser has to know the number. Gating it would leave a setting that only
-- changed the behaviour of the person who changed it.
--
-- Withholding it would also protect nothing: a signed-in user can measure their
-- own idle timeout by waiting. This returns that ONE integer and no other field.
create or replace function gatepass.get_session_timeout()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select s.session_timeout_minutes
    from gatepass.app_settings s
   where s.id
     and gatepass.app_role() is not null;
$$;

grant execute on function gatepass.get_session_timeout() to authenticated;

comment on function gatepass.get_session_timeout() is
  'The idle sign-out time in minutes, or null for the app''s own default. Readable by every signed-in user because their own browser enforces it (056). Returns nothing else from app_settings.';

notify pgrst, 'reload schema';

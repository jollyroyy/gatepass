-- ============================================================================
-- 052 — the mail settings are a SETTING, not a deploy
--
-- Until now every fact about outgoing approval mail lived in the Edge
-- Function's secrets: MAIL_FROM, and MAIL_OVERRIDE_TO — the single inbox every
-- letter is redirected to while the Resend account is unverified. Changing the
-- test inbox therefore meant a `supabase secrets set` and a redeploy, which is
-- not something the people who actually run this system can do (client,
-- 2026-08-20: "keep a provision so users can change that one").
--
-- So the settings move into the database, where an admin can edit them, and
-- the function reads them at send time.
--
-- ═══ PRECEDENCE, STATED ONCE ═══
--
--   a value in this table  >  the function's environment variable
--
-- An empty table therefore changes NOTHING about the current deployment: the
-- function keeps using its secrets. That is deliberate — this migration must
-- not be able to silently redirect or stop live mail.
--
-- ═══ WHY THE TABLE IS NOT READABLE ═══
--
-- `smtp_password` is a credential. No signed-in role holds ANY privilege on
-- this table: an admin reads through `get_mail_settings()`, which returns
-- every field EXCEPT the password plus a boolean saying whether one is set,
-- and writes through `set_mail_settings()`. The full document, password
-- included, is `mail_config()`, granted to `service_role` alone — the same
-- shape 047 uses for the office holders' addresses, and for the same reason.
--
-- A password that can be read back is a password that leaks through a screen
-- recording, a support ticket or a browser extension. It goes in and never
-- comes out.
--
-- ═══ SMTP IS PROVISION, NOT TRANSPORT (client, 2026-08-20) ═══
--
-- The SMTP columns are stored and shown, and NOTHING SENDS THROUGH THEM YET:
-- the Edge Function still posts to the Resend API. That is why there is no
-- `transport` column to choose between them — a switch that does nothing is
-- worse than no switch. When an SMTP sender is written, the rule it should
-- follow is "a host is configured, so use it", and the new schema it needs is
-- none.
--
-- ═══ ONE ADDRESS AT A TIME ═══
--
-- `override_to` is ONE address, never a list (client). A comma-separated field
-- would be four times the mail from one deployment that exists precisely
-- because the provider will only write to one inbox, and the CHECK below is
-- what stops somebody discovering that by trying it.
-- ============================================================================

create table if not exists gatepass.mail_settings (
  -- The single-row lock: `id` can only ever be true, so a second row is a
  -- primary key violation rather than a settings table nobody can read
  -- deterministically.
  id            boolean primary key default true check (id),

  -- Null = no redirect: every letter goes to the office holder it names.
  -- Never the empty string — "unset" must have exactly one spelling.
  override_to   text check (override_to is null or override_to <> ''),
  from_email    text check (from_email  is null or from_email  <> ''),
  from_name     text check (from_name   is null or from_name   <> ''),

  smtp_host     text check (smtp_host     is null or smtp_host     <> ''),
  smtp_port     int  check (smtp_port     is null or (smtp_port between 1 and 65535)),
  smtp_username text check (smtp_username is null or smtp_username <> ''),
  smtp_security text check (smtp_security is null or smtp_security in ('none', 'starttls', 'tls')),
  smtp_password text check (smtp_password is null or smtp_password <> ''),

  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),

  -- One address, and it must look like one. Deliberately loose about what a
  -- domain may contain and strict about the two things that matter here: no
  -- separator (so it cannot be a list) and no whitespace or angle brackets (so
  -- it cannot smuggle a second recipient through a display name).
  constraint mail_settings_override_is_one_address check (
    override_to is null
    or override_to ~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$'
  ),
  constraint mail_settings_from_is_one_address check (
    from_email is null
    or from_email ~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$'
  )
);

alter table gatepass.mail_settings enable row level security;

-- NO POLICY AND NO GRANT for `authenticated`, on purpose — see the header.
-- The service role reads the whole row (password included) through
-- `mail_config()`, which is SECURITY DEFINER, so it needs no grant either;
-- nothing but the three functions below ever touches this table.

-- ═══════════════════════════════════════════════════════════════════════════
-- What an ADMIN may see: everything except the credential
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function gatepass.get_mail_settings()
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
    raise exception 'Only an admin can read the mail settings.';
  end if;

  select jsonb_build_object(
           'override_to',       s.override_to,
           'from_email',        s.from_email,
           'from_name',         s.from_name,
           'smtp_host',         s.smtp_host,
           'smtp_port',         s.smtp_port,
           'smtp_username',     s.smtp_username,
           'smtp_security',     s.smtp_security,
           -- The password itself is never returned. This is the only thing a
           -- screen needs to know about it: whether one is stored.
           'smtp_password_set', s.smtp_password is not null,
           'updated_at',        s.updated_at,
           'updated_by_name',   p.full_name
         )
    into v
    from gatepass.mail_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  -- A settings table that has never been written is not an error: it is the
  -- state every deployment starts in, and it means "use the function's
  -- environment". The caller gets nulls, not a null document, so a screen can
  -- render the same fields either way.
  return coalesce(v, jsonb_build_object('smtp_password_set', false));
end;
$fn$;

grant execute on function gatepass.get_mail_settings() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Writing them
-- ═══════════════════════════════════════════════════════════════════════════
-- Every text argument is blank-normalised to null, so "clear this field" and
-- "leave it empty" are the same gesture on a form.
--
-- `p_smtp_password` is the ONE exception and it has three states, because a
-- write-only field cannot be round-tripped through a form:
--     null  → leave whatever is stored alone   (the form did not touch it)
--     ''    → delete the stored password       (an explicit "clear")
--     other → replace it
create or replace function gatepass.set_mail_settings(
  p_override_to   text default null,
  p_from_email    text default null,
  p_from_name     text default null,
  p_smtp_host     text default null,
  p_smtp_port     int  default null,
  p_smtp_username text default null,
  p_smtp_security text default null,
  p_smtp_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_override text := nullif(btrim(p_override_to), '');
  v_from     text := nullif(btrim(p_from_email), '');
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the mail settings.';
  end if;

  -- Said here as well as in the CHECK: a constraint violation reaches the
  -- browser as 23514, which this app deliberately does not map to a sentence.
  if v_override is not null
     and v_override !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
    raise exception 'Enter one email address to redirect approval mail to, or leave it blank.';
  end if;

  if v_from is not null
     and v_from !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
    raise exception 'Enter one sender email address, or leave it blank.';
  end if;

  if nullif(btrim(coalesce(p_smtp_security, '')), '') is not null
     and btrim(p_smtp_security) not in ('none', 'starttls', 'tls') then
    raise exception 'Unknown SMTP security setting.';
  end if;

  insert into gatepass.mail_settings as m (
    id, override_to, from_email, from_name,
    smtp_host, smtp_port, smtp_username, smtp_security, smtp_password,
    updated_by, updated_at
  )
  values (
    true, v_override, v_from, nullif(btrim(p_from_name), ''),
    nullif(btrim(p_smtp_host), ''), p_smtp_port, nullif(btrim(p_smtp_username), ''),
    nullif(btrim(p_smtp_security), ''), nullif(p_smtp_password, ''),
    auth.uid(), now()
  )
  on conflict (id) do update
    set override_to   = excluded.override_to,
        from_email    = excluded.from_email,
        from_name     = excluded.from_name,
        smtp_host     = excluded.smtp_host,
        smtp_port     = excluded.smtp_port,
        smtp_username = excluded.smtp_username,
        smtp_security = excluded.smtp_security,
        smtp_password = case
                          when p_smtp_password is null then m.smtp_password
                          else nullif(p_smtp_password, '')
                        end,
        updated_by    = auth.uid(),
        updated_at    = now();

  return gatepass.get_mail_settings();
end;
$fn$;

grant execute on function gatepass.set_mail_settings(text, text, text, text, int, text, text, text)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- What the SENDER reads — the whole document, credential included
-- ═══════════════════════════════════════════════════════════════════════════
-- service_role ONLY. Never `authenticated`: this is the one function in the
-- schema that returns a stored password, and the Edge Function is the only
-- thing that has ever needed it.
create or replace function gatepass.mail_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select jsonb_build_object(
              'override_to',   s.override_to,
              'from_email',    s.from_email,
              'from_name',     s.from_name,
              'smtp_host',     s.smtp_host,
              'smtp_port',     s.smtp_port,
              'smtp_username', s.smtp_username,
              'smtp_security', s.smtp_security,
              'smtp_password', s.smtp_password
            )
       from gatepass.mail_settings s
      where s.id),
    '{}'::jsonb
  );
$fn$;

grant execute on function gatepass.mail_config() to service_role;

comment on table gatepass.mail_settings is
  'Outgoing approval-mail settings, editable by an admin (052). One row. A value here overrides the notify-approval function''s environment variable; an empty table means the function keeps using its secrets. The SMTP columns are stored provision only — nothing sends through them yet. No signed-in role holds any privilege on this table: read it with get_mail_settings() (no password) or mail_config() (service_role).';

notify pgrst, 'reload schema';

-- ============================================================================
-- 078 — a standing copy list, editable by an admin
--
-- Client, 2026-09-01: "admin should be able to configure three to four email
-- IDs in the setting part and all those emails should be receiving the
-- notifications about the gate pass raising and all those status changes …
-- gate pass creations and approvals."
--
-- Every address the mail system used until now was DERIVED from the pass: the
-- person who raised it, and the office holders on its ladder. That is correct
-- and it is not enough — it cannot copy anybody who is not a participant. A
-- facilities manager, an auditor, a mall GM who wants to see every movement:
-- none of them hold an office, several have no login at all, and there was no
-- way to write to them short of creating them an account.
--
-- ═══ WHY A COLUMN ON `mail_settings` AND NOT A TABLE ═══
--
-- Because the client asked for "three to four email IDs in the setting part",
-- which is a FIELD, not a directory. A table would buy per-recipient event
-- selection, an active flag and an audit trail of who added whom — none of
-- which was asked for, all of which needs a screen to manage. `mail_settings`
-- is already the one row an admin edits, already has the RPC pair that reads
-- and writes it, and already has the grant shape this needs. One column, and
-- the whole feature reaches the Edge Function through `mail_config()`, which
-- the sender already calls once per invocation.
--
-- If per-event selection is ever wanted, THAT is the moment to promote this to
-- `gatepass.mail_recipients` — and the column converts to it cleanly.
--
-- ═══ THE CAP IS FIVE, AND IT IS DELIBERATE ═══
--
-- A standing copy list is a blunt instrument: every address on it receives
-- every letter about every pass, including the approval REQUESTS that the
-- 2026-09-01 routing rule otherwise sends to exactly one office. Past a
-- handful of people that stops being oversight and becomes noise nobody reads,
-- which is worse than no list at all. Five leaves headroom over the four the
-- client asked for; a sixth should be a conversation, not a silent insert.
--
-- ═══ WHAT THE CHECKS ARE FOR ═══
--
-- Each element is validated as ONE address by the SAME regex `override_to`
-- uses (052): no separator, so an element cannot smuggle a list; no whitespace
-- or angle brackets, so it cannot smuggle a second recipient through a display
-- name. That mattered for `override_to` and it matters more here, because
-- these strings are concatenated into a `cc` array by the sender.
--
-- Duplicates are refused case-insensitively. The Edge Function deduplicates
-- again at send time (`ccOf`, which has to, because a listed address may also
-- be the raiser's), but a settings screen that silently accepts the same
-- person twice is a settings screen that lies about what it will do.
--
-- ═══ NULL IS NOT A STATE HERE ═══
--
-- `not null default '{}'` — an empty ARRAY, never null. "Nobody is copied" has
-- exactly one spelling, so neither the RPC nor the Edge Function has to decide
-- what a null list means. Every existing row gets `{}` on this migration, so
-- applying it changes the behaviour of nothing.
-- ============================================================================

alter table gatepass.mail_settings
  add column if not exists notify_cc text[] not null default '{}';

-- ═══ THE RULE IS A FUNCTION, BECAUSE A CHECK MAY NOT HOLD A SUBQUERY ═══
--
-- Validating "every element of this array is one address, and no two are the
-- same person" needs `unnest`, and Postgres refuses a subquery inside a CHECK
-- ("cannot use subquery in check constraint"). A check MAY call a function,
-- provided it is IMMUTABLE — which this is: it reads no table, no setting and
-- no clock, only its own argument.
--
-- `search_path` is pinned and every reference qualified even though this is
-- not SECURITY DEFINER. A function named in a constraint is evaluated on every
-- write by whatever role is writing, and a resolvable-by-search-path call is
-- how that becomes somebody else's function.
create or replace function gatepass.notify_cc_is_valid(p_list text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select
    -- At most five, for the reason argued in the header.
    coalesce(cardinality(p_list), 0) <= 5
    -- Every element is ONE address, by 052's own rule: no separator, so an
    -- element cannot smuggle a list; no whitespace or angle brackets, so it
    -- cannot smuggle a second recipient through a display name. That mattered
    -- for `override_to` and it matters more here, because these strings are
    -- concatenated into a `cc` array by the sender.
    and not exists (
      select 1
        from unnest(coalesce(p_list, '{}'::text[])) as a(addr)
       where a.addr is null
          or a.addr !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$'
    )
    -- No duplicates, case-insensitively. The Edge Function deduplicates again
    -- at send time (`ccOf`, which has to, because a listed address may also be
    -- the raiser's), but a settings screen that silently accepts the same
    -- person twice is a settings screen that lies about what it will do.
    and (
      select count(distinct lower(a.addr))
        from unnest(coalesce(p_list, '{}'::text[])) as a(addr)
    ) = coalesce(cardinality(p_list), 0);
$fn$;

comment on function gatepass.notify_cc_is_valid(text[]) is
  'True when a standing copy list is storable: at most five entries, each one well-formed single address, no case-insensitive duplicates. Immutable so that mail_settings CHECK can call it (078).';

-- Dropped and re-added so a re-run tightens an existing deployment rather than
-- silently keeping an older rule. `if exists` keeps the paste idempotent.
alter table gatepass.mail_settings
  drop constraint if exists mail_settings_notify_cc_is_addresses;
alter table gatepass.mail_settings
  add constraint mail_settings_notify_cc_is_addresses
  check (gatepass.notify_cc_is_valid(notify_cc));

comment on column gatepass.mail_settings.notify_cc is
  'Up to five addresses copied on EVERY gate pass letter — raised, awaiting approval, approved, rejected, and both gate outcomes. Editable by an admin in Admin -> Settings (078). Empty array = nobody. Suppressed entirely while override_to is set, like every other copy.';

-- ═══════════════════════════════════════════════════════════════════════════
-- What an ADMIN may see — 052's function, with the list
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
           'notify_cc',         to_jsonb(s.notify_cc),
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
  -- render the same fields either way. `notify_cc` is an empty ARRAY here too
  -- — the client must never have to treat "unwritten" and "nobody" apart.
  return coalesce(v, jsonb_build_object('smtp_password_set', false, 'notify_cc', '[]'::jsonb));
end;
$fn$;

grant execute on function gatepass.get_mail_settings() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Writing them — a NEW SIGNATURE, so the old one is dropped
-- ═══════════════════════════════════════════════════════════════════════════
-- A default argument does not replace a function, it OVERLOADS it: leaving
-- 052's eight-argument version in place would give PostgREST two candidates
-- for `set_mail_settings` and let a stale client keep writing settings that
-- silently clear nothing. Drop first, then create, then re-grant — all three,
-- because a dropped function takes its grants with it.
drop function if exists gatepass.set_mail_settings(text, text, text, text, int, text, text, text);

create or replace function gatepass.set_mail_settings(
  p_override_to   text default null,
  p_from_email    text default null,
  p_from_name     text default null,
  p_smtp_host     text default null,
  p_smtp_port     int  default null,
  p_smtp_username text default null,
  p_smtp_security text default null,
  p_smtp_password text default null,
  -- NULL means "the form did not touch this list", the same three-state rule
  -- `p_smtp_password` follows. An EMPTY ARRAY is the explicit "copy nobody".
  -- Without that distinction, any older caller — a cached tab, the e2e suite —
  -- would wipe the list every time it saved an unrelated field.
  p_notify_cc     text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cc text[];
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the mail settings.';
  end if;

  -- Normalise before the constraint sees it: trim every element and drop the
  -- blanks, so a half-filled form of five inputs stores the two that were
  -- typed rather than three empty strings the CHECK would reject. The person
  -- typing gets a saved setting, not a constraint violation.
  if p_notify_cc is null then
    select s.notify_cc into v_cc from gatepass.mail_settings s where s.id;
    v_cc := coalesce(v_cc, '{}');
  else
    select coalesce(array_agg(t.addr order by t.ord), '{}')
      into v_cc
      from (
        select btrim(a.addr) as addr, a.ord
          from unnest(p_notify_cc) with ordinality as a(addr, ord)
         where btrim(coalesce(a.addr, '')) <> ''
      ) t;
  end if;

  insert into gatepass.mail_settings as m (
    id, override_to, from_email, from_name, notify_cc,
    smtp_host, smtp_port, smtp_username, smtp_security, smtp_password,
    updated_by, updated_at
  )
  values (
    true,
    nullif(btrim(coalesce(p_override_to, '')), ''),
    nullif(btrim(coalesce(p_from_email, '')), ''),
    nullif(btrim(coalesce(p_from_name, '')), ''),
    v_cc,
    nullif(btrim(coalesce(p_smtp_host, '')), ''),
    p_smtp_port,
    nullif(btrim(coalesce(p_smtp_username, '')), ''),
    nullif(btrim(coalesce(p_smtp_security, '')), ''),
    nullif(coalesce(p_smtp_password, ''), ''),
    auth.uid(), now()
  )
  on conflict (id) do update
    set override_to   = excluded.override_to,
        from_email    = excluded.from_email,
        from_name     = excluded.from_name,
        notify_cc     = excluded.notify_cc,
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

grant execute on function gatepass.set_mail_settings(text, text, text, text, int, text, text, text, text[])
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- What the SENDER reads — 052's function, with the list
-- ═══════════════════════════════════════════════════════════════════════════
-- service_role ONLY, unchanged: this is the one function in the schema that
-- returns a stored password.
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
              'notify_cc',     to_jsonb(s.notify_cc),
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

notify pgrst, 'reload schema';

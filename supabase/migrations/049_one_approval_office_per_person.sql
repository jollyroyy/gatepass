-- ============================================================================
-- 049 — one approval office per person
--
-- FOUND BY THE LIVE PROBE FOR 046, not by reading the code. `verify-046.mjs`
-- lent two of the four offices to the same demo account, and the full climb
-- stopped dead at the second one with "This gate pass is not waiting on your
-- approval." The cause:
--
--     gatepass.my_approval_role()
--       select r.role_key from gatepass.approval_roles r where r.user_id = ...
--
-- is a scalar `returns text` over a query that can yield MORE THAN ONE ROW.
-- Postgres does not error on that — it hands back whichever row came first.
-- So a person holding two offices could act on exactly one of them, chosen
-- arbitrarily and silently, and their queue would show half of what they owe.
-- Nothing in 043 or 046 forbade the designation that causes it: `approval_roles`
-- is keyed by `role_key`, which makes an office single-holder but says nothing
-- about a holder having several offices.
--
-- THE FIX IS THE CONSTRAINT, NOT A `limit 1`. Ordering the query would make the
-- answer deterministic while leaving the person's other office permanently
-- unactionable — a bug that looks like a working screen. This mirrors 032's
-- "one department per person": a unique index says the thing out loud, and the
-- designation that would break the model is refused at the point somebody makes
-- it, with a sentence naming the office already held.
--
-- IF DUAL-HATTING IS EVER WANTED — a small site where the COO is also the
-- Finance Head is perfectly plausible — this index is where to start, and the
-- work is real: `my_approval_role()` becomes a set-returning
-- `my_approval_roles()`, `pass_routed_to_me` matches on membership, both
-- decision RPCs resolve the caller's office FROM the pass's own pending rows
-- rather than from the person, and the queue screen groups by office. That is a
-- deliberate feature, not a constraint to quietly drop.
--
-- LIVE STATE WHEN THIS WAS WRITTEN: four offices, four distinct holders, so the
-- index builds without touching a row.
-- ============================================================================

-- A partial index is not wanted here: `user_id` is NOT NULL, and every row must
-- take part.
create unique index if not exists approval_roles_one_office_per_person
  on gatepass.approval_roles (user_id);

comment on index gatepass.approval_roles_one_office_per_person is
  'One approval office per person. gatepass.my_approval_role() is a scalar over this table and would silently return an arbitrary one of several. See migration 049.';

-- ═══════════════════════════════════════════════════════════════════════════
-- The designation says why, instead of leaking a constraint name
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 043 with one added check. Everything else — the admin gate, the
-- known-key check, the existence check and the upsert — is unchanged.
--
-- The check EXCLUDES the office being set, so re-designating the same person to
-- the office they already hold is still a no-op rather than an error.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      case v_held
        when 'security_head' then 'Security Head'
        when 'coo'           then 'COO'
        when 'ceo'           then 'CEO'
        else                      'Finance HOD'
      end;
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

grant execute on function gatepass.set_approval_role(text, uuid) to authenticated;

-- `admin_create_user` (046) writes the same row directly when an admin creates
-- an office holder. It is left alone on purpose: the account it inserts is
-- brand new and cannot already hold an office, so the check above would be dead
-- code there — and the unique index catches it regardless if that ever changes.

notify pgrst, 'reload schema';

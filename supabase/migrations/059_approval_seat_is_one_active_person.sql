-- ============================================================================
-- 059 — an approval office is held by exactly ONE ACTIVE person, and
--       deactivating its holder vacates it
--
-- Client, 2026-08-20: "if one of the roles, like COO and security head, is
-- deactivated and created again, that should allow me to deactivate one person
-- from that role and create another new person in that same role … but make
-- sure only one account is tacked to that role at the same point in time, so
-- there cannot be two people who are assigned to that role."
--
-- ONE HOLDER PER OFFICE WAS ALREADY ABSOLUTE — `approval_roles.role_key` is the
-- primary key, so the table cannot physically hold two people on one office,
-- and 049's unique index on `user_id` stops one person holding two. Neither of
-- those is what was wrong. What was wrong is that DEACTIVATION LEFT THE SEAT
-- OCCUPIED:
--
--   * `my_approval_role()` gates on `gatepass.is_user_active()` (040), so a
--     suspended holder can approve nothing. The office was silently DEAD — every
--     pass routed to it piled up with nobody able to sign, while the ladder card
--     read as though the office were staffed.
--   * The suspended person still occupied `user_id`, so 049 refused to seat them
--     anywhere else, and the ladder still offered their name as the holder.
--
-- SO DEACTIVATION NOW VACATES EVERY SEAT THE PERSON HELD — the office they held
-- and any office they stood deputy for. The office reads "Not designated yet",
-- which is the truth, and the admin designates the replacement (or creates them
-- straight into the office through Add User, which upserts on `role_key` and so
-- can never produce a second holder).
--
-- ⚠ KNOWN CONSEQUENCE, DELIBERATE AND FLAGGED. 046 never snapshots a VACANT
-- office, so a pass raised in the window between deactivating a holder and
-- designating the replacement does not owe that office a signature at all. The
-- alternative — refusing to deactivate until a replacement is named — was
-- rejected because the client asked for exactly the opposite order, and because
-- a suspended holder is a dead office either way: the choice is between a level
-- nobody CAN sign and a level nobody is ASKED to sign, and only the second one
-- lets material move. Passes ALREADY climbing keep their pending row and are
-- signed by whoever is designated next, because 046 resolves authority from the
-- OFFICE at the moment of the press, not from the person snapshotted at raise.
--
-- REACTIVATION MUST NOT BECOME A ONE-WAY DOOR. 057 widened
-- `admin_reactivate_user` to accept a `staff` target who holds an approval
-- office — "has this person anything to come back to". Vacating the seat
-- destroys that evidence, so a deactivated COO would have been refused
-- reactivation outright. `user_status.vacated_approval_office` remembers the
-- office they were holding when they were suspended; reactivation accepts it and
-- clears it. IT DOES NOT RE-SEAT THEM: somebody else may be in the chair by
-- then, and re-seating would silently displace a working approver.
--
-- AND A SEAT MAY ONLY BE GIVEN TO AN ACTIVE ACCOUNT. `set_approval_role` /
-- `set_approval_deputy` now refuse a suspended person with a sentence, rather
-- than creating the dead office this migration exists to remove.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The marker that keeps reactivation reachable
-- ═══════════════════════════════════════════════════════════════════════════
-- Nullable, and null is the ordinary case. It is NOT a designation — nothing
-- reads it as authority, and `my_approval_role()` never looks here.
alter table gatepass.user_status
  add column if not exists vacated_approval_office text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_status_vacated_office_known'
       and conrelid = 'gatepass.user_status'::regclass
  ) then
    alter table gatepass.user_status
      add constraint user_status_vacated_office_known
      check (vacated_approval_office is null
             or vacated_approval_office in ('security_head', 'coo', 'ceo', 'finance_head'));
  end if;
end
$$;

comment on column gatepass.user_status.vacated_approval_office is
  'The approval office this person was holding when they were deactivated, so that admin_reactivate_user still has evidence they have something to come back to. NOT a designation - it grants nothing and is cleared on reactivation. See migration 059.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Deactivation vacates the seat
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 040 with the vacate step added. The admin gate, the
-- self-deactivation refusal, the admin-target refusal, the status row and the
-- session kill are all unchanged.
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_office text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Mirrors admin_reset_user_password (036): the weakest admin account must not
  -- be a route to suspending a stronger one.
  if v_role in ('admin', 'super_admin') then
    raise exception 'An admin account cannot be deactivated from the portal.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_office is not null then
    delete from gatepass.approval_roles r where r.role_key = v_office;
  end if;

  -- A deputy seat is cleared too, and it is NOT remembered: a deputy is cover,
  -- not an office, and 057's "anything to come back to" test was never about
  -- one. Their own role (guard/hod) or a remembered office is what readmits them.
  update gatepass.approval_roles r
     set deputy_id = null
   where r.deputy_id = p_user_id;

  insert into gatepass.user_status (
    user_id, is_active, deactivated_at, deactivated_by, updated_at, vacated_approval_office
  )
  values (p_user_id, false, now(), auth.uid(), now(), v_office)
  on conflict (user_id) do update
    set is_active               = false,
        deactivated_at          = now(),
        deactivated_by          = auth.uid(),
        updated_at              = now(),
        -- coalesce, never a bare assignment: deactivating somebody twice must
        -- not forget the office the FIRST deactivation took off them.
        -- `user_status.` and not `gatepass.user_status.`: inside ON CONFLICT the
        -- target is reached by the relation's ALIAS, which is the bare name.
        vacated_approval_office = coalesce(excluded.vacated_approval_office,
                                           user_status.vacated_approval_office);

  delete from auth.sessions where user_id = p_user_id;

  return json_build_object(
    'id', p_user_id::text,
    'deactivated', true,
    'vacated_approval_office', v_office
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Reactivation accepts the remembered office, and forgets it
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 057 with ONE added arm. It deliberately does not re-designate:
-- the office may be somebody else's now, and 046 makes that designation real
-- authority.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text;
  v_office  text;
  v_vacated text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  select s.vacated_approval_office into v_vacated
    from gatepass.user_status s
   where s.user_id = p_user_id;

  if v_role not in ('guard', 'hod') and v_office is null and v_vacated is null then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (
    user_id, is_active, deactivated_at, deactivated_by, updated_at, vacated_approval_office
  )
  values (p_user_id, true, null, null, now(), null)
  on conflict (user_id) do update
    set is_active               = true,
        deactivated_at          = null,
        deactivated_by          = null,
        updated_at              = now(),
        vacated_approval_office = null;

  return json_build_object(
    'id', p_user_id::text,
    'reactivated', true,
    'vacated_approval_office', v_vacated
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. A seat may only be given to an ACTIVE account
-- ═══════════════════════════════════════════════════════════════════════════
-- Both setters restated from 054 with ONE added refusal each, in the same
-- position: after the person is known to exist and before any seat check, so a
-- suspended person is told they are suspended rather than told which seat they
-- are not in.
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

  -- New in 059. `my_approval_role()` gates on this same function, so seating a
  -- suspended person creates an office that can approve nothing while the ladder
  -- card reads as staffed.
  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      gatepass.approval_office_title(v_held);
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id;

  if v_held is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat — clear that deputy first.',
      gatepass.approval_office_title(v_held);
  end if;

  -- ON CONFLICT (role_key) is what makes "deactivate one person and put another
  -- in the same role" a single atomic swap: the office cannot end up with two
  -- holders even for the length of a statement, because there is only ever one
  -- row per office.
  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

create or replace function gatepass.set_approval_deputy(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_holder uuid;
  v_seat   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass deputy.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.user_id into v_holder
    from gatepass.approval_roles r
   where r.role_key = p_role_key;

  if v_holder is null then
    raise exception 'The % office has nobody in it yet. Designate the office holder before naming a deputy.',
      gatepass.approval_office_title(p_role_key);
  end if;

  if v_holder = p_user_id then
    raise exception 'That person already holds the % office. A deputy stands in for the holder, so it has to be somebody else.',
      gatepass.approval_office_title(p_role_key);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat — vacate that office first.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id
     and r.role_key <> p_role_key;

  if v_seat is not null then
    raise exception 'That person is already the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  update gatepass.approval_roles r
     set deputy_id = p_user_id
   where r.role_key = p_role_key;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The same sweep over anybody already seated while suspended
-- ═══════════════════════════════════════════════════════════════════════════
-- A rule that only applies to future deactivations would leave exactly the dead
-- office this migration exists to remove. `is_user_active()` is the same test
-- the setters use, so nothing here can disagree with them.
--
-- The marker is written FIRST, off the seat that is about to be removed; the
-- update matches on `is_active = false`, so an active holder cannot be touched.
update gatepass.user_status s
   set vacated_approval_office = coalesce(s.vacated_approval_office, r.role_key),
       updated_at              = now()
  from gatepass.approval_roles r
 where r.user_id = s.user_id
   and s.is_active = false;

delete from gatepass.approval_roles r
 where not gatepass.is_user_active(r.user_id);

update gatepass.approval_roles r
   set deputy_id = null
 where r.deputy_id is not null
   and not gatepass.is_user_active(r.deputy_id);

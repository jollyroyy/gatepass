-- ============================================================================
-- 066 — A DELEGATION GOES TO A DEPARTMENT HEAD, NOT TO STAFF AND NOT TO THE GATE
--
-- Client, 2026-08-23: "in the delegation tab for each and every approver they
-- cannot delegate it to normal staff. They can only delegate it to either their
-- peer-level approver or an HOD."
--
-- 062 offered EVERY active account in the directory. That is a real hole and not
-- only an untidy list: a delegation is the whole office — the approval queue,
-- `approve_pass_level`, `reject_pass_level`, the CEO office's whitelist
-- decisions, and RLS visibility of every pass routed to that rung. Handing it to
-- a guard puts the person who verifies a pass at the gate onto the ladder that
-- authorises it, which is the four-eyes property the ladder exists for; handing
-- it to `staff` grants a portal-less account real authority over material
-- leaving the mall.
--
-- WHAT "PEER-LEVEL APPROVER" RESOLVES TO HERE, and why no arm is written for it:
-- one person holds one approval seat (049 for holders, 054 for deputies, 062 for
-- delegates). Anybody who currently sits on another office is therefore ALREADY
-- refused as a delegate by the seat checks 062 wrote, whatever their VMS role —
-- so a peer is not a reachable choice, and a role arm admitting them would only
-- draw names into the list that the very next check refuses. The reachable half
-- of the client's rule is the HOD, and that is what this narrows to.
--
-- TWO PLACES, BECAUSE A DROPDOWN IS NOT A CONTROL. `list_delegation_candidates`
-- narrows what the office holder is offered; `create_approval_delegation`
-- refuses the same thing on the write, since the RPC is reachable over PostgREST
-- by any authenticated caller with a user id they typed themselves.
--
-- ROLE IS READ FROM `public.profiles`, VMS's own column (the two-schema rule:
-- referenced, never altered). It is the same source `app_role()` falls back to,
-- and the one the admin's user list shows.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The candidate list
-- ═══════════════════════════════════════════════════════════════════════════
-- Every exclusion 062 wrote is kept verbatim — an inactive account, an office
-- holder, a standing deputy, somebody already covering a live-or-future
-- delegation — with the role test added.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gatepass.approval_roles r where r.user_id = auth.uid()
  ) then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and p.role::text = 'hod'
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r
              where r.user_id = p.id or r.deputy_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$$;

comment on function gatepass.list_delegation_candidates() is
  'The people an office holder may delegate to: active department heads (profiles.role = hod) who hold no approval seat of their own. Not staff, not the gate. See migration 066.';

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The write
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's body, unchanged, plus the role refusal. The role and the active flag are
-- read in ONE lookup of the profile row rather than two — and the "that person
-- does not exist" case still keys off the row being absent, so a deleted account
-- is told apart from a live one that may not be given the office.
create or replace function gatepass.create_approval_delegation(
  p_delegate_id    uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_approval_limit numeric default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_seat   text;
  v_role   text;
  v_active boolean;
  v_found  boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office, so there is nothing to delegate.';
  end if;

  if not gatepass.is_user_active(auth.uid()) then
    raise exception 'This account is deactivated.';
  end if;

  if p_delegate_id is null then
    raise exception 'Choose somebody to delegate to.';
  end if;

  if p_delegate_id = auth.uid() then
    raise exception 'You cannot delegate your own office to yourself.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'A delegation needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The delegation has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the
  -- history reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That delegation would already have ended. Choose an end in the future.';
  end if;

  if p_approval_limit is not null and p_approval_limit <= 0 then
    raise exception 'An approval limit has to be more than zero. Leave it blank for no limit.';
  end if;

  select true, p.role::text, gatepass.is_user_active(p.id)
    into v_found, v_role, v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if not v_found then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  -- ── 066: the office goes to a department head. ──────────────────────────
  -- Stated as a rule rather than as a fault, because an approver reading it has
  -- picked a real colleague and needs to know WHO is eligible, not that
  -- something went wrong.
  if v_role is distinct from 'hod' then
    raise exception 'An approval office can only be delegated to a department head. Choose an HOD.';
  end if;

  -- ── The one-seat refusals. See 062's header. ────────────────────────────
  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal. Half-open at both ends, matching
  -- `delegation_is_live`, so back-to-back windows do not collide.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_delegate_id
     and d.revoked_at is null
     and d.starts_at < p_ends_at
     and d.ends_at   > p_starts_at;

  if v_seat is not null then
    raise exception 'That person is already covering the % office under a delegation over part of that period. One person holds one approval seat at a time.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- And the office itself takes one delegate at a time, so that "who is
  -- covering the COO this week" has exactly one answer.
  if exists (
    select 1
      from gatepass.approval_delegations d
     where d.role_key = v_office
       and d.delegator_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at < p_ends_at
       and d.ends_at   > p_starts_at
  ) then
    raise exception 'You have already delegated the % office over part of that period. Revoke that delegation first.',
      gatepass.approval_office_title(v_office);
  end if;

  insert into gatepass.approval_delegations
    (role_key, delegator_id, delegate_id, starts_at, ends_at, approval_limit, reason)
  values
    (v_office, auth.uid(), p_delegate_id, p_starts_at, p_ends_at, p_approval_limit, left(v_reason, 500))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) from public;
grant execute on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 068 — the STANDING DEPUTY is removed from the approval ladder
--
-- WHAT IS GONE. 054 gave every approval office an optional second seat: a
-- standing deputy who could sign exactly what the holder could, at any time,
-- with no date window. The client has withdrawn it (2026-08-31). An office is
-- one person again.
--
-- WHY IT CAN GO CLEANLY. 062 shipped the date-bounded delegation the deputy was
-- chosen INSTEAD of, and it covers the same absence with a window, a value
-- ceiling, a revocation and a record of who handed it over — everything the
-- standing seat deliberately did without. Cover survives; the second permanent
-- seat does not.
--
-- NOTHING IS LOST. Verified on the live project before this was written: zero
-- rows in `approval_roles` carried a `deputy_id`, and zero rows in
-- `pass_approvals` carried `decided_as_deputy = true`. No signature in the
-- history was ever given by a deputy, so dropping the stamp erases no fact. Had
-- either count been non-zero this migration would have had to keep the column.
--
-- WHAT THIS TOUCHES. Every function 054 widened is restated here with its
-- deputy arm removed and NOTHING else changed — each is the latest version as
-- of 067, minus the deputy:
--
--   my_approval_role            054's `or r.deputy_id = auth.uid()` arm
--   set_approval_role           054's "already a deputy" refusal
--   admin_soft_delete_user      059's deputy-seat clear
--   list_delegation_candidates  066/067's `or r.deputy_id = p.id` exclusion
--   create_approval_delegation  062's "delegate is a deputy" refusal
--   approve_pass_level          054's `decided_as_deputy` stamp
--   reject_pass_level           054's `decided_as_deputy` stamp
--   get_pass_approvals          the `decided_as_deputy` output column
--   get_approval_ladder         the `deputy_id` / `deputy_name` output columns
--   approval_notice_payload     the `deputy_name` / `deputy_email` addresses
--
-- and then the schema itself goes: both columns, the uniqueness index and the
-- not-the-holder check. CLAUDE.md's rule — a retired feature leaves no
-- `EXECUTE`-able function and no dead column behind, because both are still
-- reachable over PostgREST by every authenticated user.
--
-- ONE PERSON, ONE SEAT SURVIVES, and is now simpler to state: 049's unique
-- `user_id` and 062's overlapping-delegation refusal are the whole rule. The
-- four-eyes property the ladder rests on — one human can never sign two rungs
-- of the same pass — is unchanged, because removing a seat cannot create one.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Authority follows the holder, or a live delegation. Nothing else.
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function with the deputy arm deleted. Still returns at most one row,
-- and still by refusal rather than by `limit` — 049's unique `user_id` and
-- 062's overlap refusals, with one fewer seat to collide with.
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid())
  union all
  select d.role_key
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at)
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder, or under a live delegation (062) — or null. Scalar by design: the seat refusals in 049 and 062 guarantee at most one row. Suspended accounts hold nothing. The standing-deputy arm was removed in 068.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Seating an office holder
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function minus 054's deputy refusal. The admin gate, the known-key
-- check, the existence check, 059's active check, the "already holds" check,
-- 062's delegation check and the upsert are all unchanged.
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

  select d.role_key into v_held
    from gatepass.approval_delegations d
   where d.delegate_id = p_user_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_held is not null then
    raise exception 'That person is covering the % office under a delegation. One person holds one approval seat — that delegation has to be revoked first.',
      gatepass.approval_office_title(v_held);
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- The two setters 054 added have nothing left to set.
drop function if exists gatepass.set_approval_deputy(text, uuid);
drop function if exists gatepass.clear_approval_deputy(text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Deactivation vacates ONE seat
-- ═══════════════════════════════════════════════════════════════════════════
-- 059's function minus the deputy clear. Everything else — the admin gate, the
-- self-deactivation refusal, the admin-target refusal, the remembered office,
-- the status row and the session kill — is 059's, unchanged.
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
-- 4. Who may be delegated to
-- ═══════════════════════════════════════════════════════════════════════════
-- 067's function with `or r.deputy_id = p.id` removed from the seat exclusion.
-- The pair arm (COO ↔ CEO) is untouched.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_pair   text;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    return query
      select p.id, p.full_name, d.name
        from gatepass.approval_roles r
        join public.profiles p on p.id = r.user_id
        left join public.departments d on d.id = p.department_id
       where r.role_key = v_pair
         and p.id <> auth.uid()
         and gatepass.is_user_active(p.id);
    return;
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
              where r.user_id = p.id
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
  'Who the caller may delegate their approval office to. The COO and the CEO may only delegate to each other (067); every other office may only delegate to an active HOD who holds no seat and is covering nothing (066). The standing-deputy exclusion was removed in 068.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Writing a delegation
-- ═══════════════════════════════════════════════════════════════════════════
-- 067's function minus 062's "that person is a standing deputy" refusal. Every
-- other refusal — the pair rule, the HOD rule, the holder seat, the overlapping
-- delegation on either side, the window checks and the limit check — is
-- unchanged.
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
  v_pair   text;
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

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    -- ── 067: a shared rung is covered by the office that shares it. ────────
    if not exists (
      select 1 from gatepass.approval_roles r
       where r.role_key = v_pair and r.user_id = p_delegate_id
    ) then
      raise exception 'The % office can only be delegated to the %, who signs the same level. Nobody else may cover it.',
        gatepass.approval_office_title(v_office),
        gatepass.approval_office_title(v_pair);
    end if;
    -- The holder-seat refusal in the else arm is SKIPPED here on purpose:
    -- holding the counterpart office is the whole qualification. The
    -- overlapping-delegation refusals below still apply.
  else
    -- ── 066: every other office delegates to a department head. ────────────
    if v_role is distinct from 'hod' then
      raise exception 'An approval office can only be delegated to a department head. Choose an HOD.';
    end if;

    select r.role_key into v_seat
      from gatepass.approval_roles r
     where r.user_id = p_delegate_id;

    if v_seat is not null then
      raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
        gatepass.approval_office_title(v_seat);
    end if;
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The two decisions no longer stamp a seat
-- ═══════════════════════════════════════════════════════════════════════════
-- 063's `approve_pass_level` minus `v_as_deputy`. The escalation gate, the
-- delegation ceiling and the shared-rung close are untouched.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role        text := gatepass.my_approval_role();
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
  v_escalates   timestamptz;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  -- THE ESCALATION GATE. Null means nobody is being waited on, which is the
  -- ordinary case for every office but a CEO sharing level 3 with a COO who
  -- still has time on the clock.
  v_escalates := gatepass.level_escalates_at(p_pass_id, v_role);
  if v_escalates is not null and now() < v_escalates then
    raise exception 'This pass is with the COO until %. It escalates to the CEO only if they have not decided it by then.',
      to_char(v_escalates, 'DD Mon YYYY HH24:MI');
  end if;

  select d.id, d.approval_limit into v_deleg_id, v_deleg_limit
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  if v_deleg_id is not null and v_deleg_limit is not null then
    select coalesce(sum(i.approx_value), 0) into v_value
      from gatepass.gate_pass_items i
     where i.gate_pass_id = p_pass_id;

    if v_value > v_deleg_limit then
      raise exception 'Your delegation of the % office is limited to %. This pass is worth % — the office holder has to sign it.',
        gatepass.approval_office_title(v_role),
        to_char(v_deleg_limit, 'FM999,999,999,990.00'),
        to_char(v_value,       'FM999,999,999,990.00');
    end if;
  end if;

  update gatepass.pass_approvals a
     set status              = 'approved',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  -- ONE SIGNATURE CLOSES THE RUNG. Written as "every other pending row on my
  -- own level" rather than naming the CEO, so the rule belongs to the shared
  -- level and not to one pair of offices.
  update gatepass.pass_approvals a
     set status     = 'not_required',
         decided_at = now(),
         reason     = 'Not required — level ' || v_mine || ' was approved by the '
                      || gatepass.approval_office_title(v_role) || '.'
   where a.gate_pass_id = p_pass_id
     and a.level_no = v_mine
     and a.role_key <> v_role
     and a.status = 'pending';
end;
$fn$;

-- 062's `reject_pass_level` minus `v_as_deputy`. Reject is still never withheld
-- for a value ceiling — 062's reasoning, unchanged.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := gatepass.my_approval_role();
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select d.id into v_deleg_id
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  update gatepass.pass_approvals a
     set status              = 'rejected',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id,
         reason              = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The readers lose their deputy columns
-- ═══════════════════════════════════════════════════════════════════════════
-- BOTH are DROPPED and recreated rather than replaced: `create or replace
-- function` cannot change a RETURN TYPE, and both of these lose one. The grant
-- goes with the drop and is re-applied in the same transaction.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key            text,
  level_no            smallint,
  status              text,
  routed_name         text,
  decided_name        text,
  decided_at          timestamptz,
  reason              text,
  -- 058's column, carried forward. Dropping it would silently strip the
  -- rollout note off every pre-workflow pass's ladder and print whoever held
  -- the office that day as having approved something they never saw.
  grandfathered       boolean,
  decided_as_delegate boolean,
  delegated_by_name   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.grandfathered,
           a.decided_as_delegate,
           gp.full_name
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
      left join gatepass.approval_delegations dl on dl.id = a.delegation_id
      left join public.profiles gp on gp.id = dl.delegator_id
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- 043's shape again: one office, one holder, one name.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'finance_head'  then 3
              when 'ceo'           then 4
            end;
$$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The letter is addressed to one person per office again
-- ═══════════════════════════════════════════════════════════════════════════
-- 055's payload minus the two deputy addresses. Same name, same return type,
-- same service_role-only grant, so `create or replace` is legal and the
-- function keeps its existing privileges.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object(
      'pass', (
        select jsonb_build_object(
                 'id',                   p.id,
                 'pass_number',          p.pass_number,
                 'type',                 p.type,
                 'status',               p.status,
                 'visitor_name',         p.visitor_name,
                 'purpose',              p.purpose,
                 'vendor_name',          gatepass.company_name_of(p.visitor_company),
                 'department_name',      d.name,
                 'raised_by',            p.raised_by,
                 'raised_by_name',       rb.full_name,
                 'raised_by_email',      rb.email,
                 'item_count',           coalesce(it.item_count, 0),
                 'total_value',          coalesce(it.total_value, 0),
                 'expected_return_date', p.expected_return_date,
                 'created_at',           p.created_at
               )
          from gatepass.gate_passes p
          left join public.departments d on d.id = p.department_id
          left join public.profiles   rb on rb.id = p.raised_by
          left join lateral (
                 select count(*) as item_count, sum(i.approx_value) as total_value
                   from gatepass.gate_pass_items i
                  where i.gate_pass_id = p.id
               ) it on true
         where p.id = p_pass_id
      ),
      'approvals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'role_key',       a.role_key,
                 'level_no',       a.level_no,
                 'status',         a.status,
                 'approver_id',    coalesce(r.user_id, a.routed_to),
                 'approver_name',  coalesce(cur.full_name, ap.full_name),
                 'approver_email', coalesce(cur.email, ap.email),
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
         where a.gate_pass_id = p_pass_id
      ), '[]'::jsonb)
    )
  )
  || jsonb_build_object(
       'emergency', (
         select jsonb_build_object(
                  'released_at',   e.released_at,
                  'released_name', rp.full_name,
                  'reason',        e.reason,
                  'reviewed_at',   e.reviewed_at
                )
           from gatepass.emergency_releases e
           left join public.profiles rp on rp.id = e.released_by
          where e.gate_pass_id = p_pass_id
       )
     );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included (047/051), plus the emergency release that cleared this pass if there was one (055). Each level is addressed to whoever holds that office TODAY, falling back to the holder snapshotted at raise when the office is now vacant. The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. And the schema itself
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing reads either column now, and a column nothing reads is still visible
-- over PostgREST to every authenticated user. Both counts were verified zero
-- before this was written (see the header), so no signature and no designation
-- is being erased.
drop index if exists gatepass.approval_roles_one_deputy_per_person;

alter table gatepass.approval_roles
  drop constraint if exists approval_roles_deputy_is_not_holder;

alter table gatepass.approval_roles
  drop column if exists deputy_id;

alter table gatepass.pass_approvals
  drop column if exists decided_as_deputy;

notify pgrst, 'reload schema';

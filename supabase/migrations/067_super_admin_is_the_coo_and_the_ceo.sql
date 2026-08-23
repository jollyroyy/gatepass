-- ============================================================================
-- 067 — THE COO AND THE CEO COVER FOR EACH OTHER, AND THE SUPER ADMIN IS NOW
--       THE TWO OF THEM
--
-- Client, 2026-08-24, in two parts:
--
--   "in the COO's delegation he can only delegate it to CEO … and CEO can also
--    give the delegation only to COO"
--
--   "there is a super admin role but you can mention that the super admin role
--    will be given to COO and CEO … remove the normal super admin person
--    account … Basically the Superadmin role is a kind of fallback role. In the
--    case where nobody is able to approve, in those scenarios the Superadmin
--    can take charge and get it approved. It's basically a role but it doesn't
--    remove their CEO or COO role also."
--
-- ── 1. THE PAIR. ────────────────────────────────────────────────────────────
-- 066 narrowed every office's delegation to a DEPARTMENT HEAD. That stays true
-- of the Security Head and the Finance HOD. The two offices that share level 3
-- (063) now delegate to EACH OTHER and to nobody else, which is a narrowing and
-- not a widening of 066 — one name in the list instead of the whole HOD bench.
--
-- ⚠ THIS IS THE ONE PLACE THE ONE-SEAT RULE BENDS, AND ONLY BECAUSE THE LADDER
-- ALREADY SAYS SO. 049/054/062 refuse a person a second seat so that nobody can
-- sign two rungs of the same pass. The COO and the CEO are not two rungs: 063
-- put them on ONE level that takes ONE signature, and closes the other office's
-- row as `not_required` the moment either signs. So a CEO covering the COO can
-- still only put one signature on level 3 of any pass — which is the property
-- the one-seat rule exists to protect, and it is untouched. The exemption is
-- written as "the counterpart office on my own rung", not as "the CEO", so a
-- future shared rung inherits it and an unshared one never does.
--
-- ── 2. THE FALLBACK. ────────────────────────────────────────────────────────
-- `emergency_release_pass` (055) is the only door in this system that gets a
-- pass past an office that cannot be reached, and it was open to the VMS role
-- `super_admin` alone. That account is being deleted, so the door would close
-- for good and 055 would become dead schema. Instead the two offices at the top
-- of the ladder hold it — IN ADDITION to their office, never instead of it: an
-- office holder keeps exactly the screens 2026-08-22 left them, and this is a
-- power on the pass record, not a portal. `is_super_admin()` is deliberately
-- NOT `is_admin()`: it opens no admin tab, no user list and no settings.
--
-- ⚠ A POWER YOU CANNOT REACH THE SUBJECT OF IS NOT A POWER. 061 makes an
-- approver blind to a pass until every rung below theirs is approved — which is
-- precisely the pass this fallback exists for. So one narrow arm is added to
-- the two select policies: a COO or CEO may SEE a pass that is STUCK, meaning
-- pending, still owing a signature, and sitting on its current rung longer than
-- `coo_escalation_hours` (063's own window — the same number that decides when
-- level 3 escalates, so there is one definition of "waited too long" and not
-- two). Not act on it — `approve_pass_level` still refuses every rung but the
-- lowest, and this adds nothing there. See, and release in writing.
--
-- 061's rule is otherwise untouched: before that window elapses the pass is as
-- invisible to them as it ever was, and a rejected pass is never stuck — it
-- stopped, it is not waiting — so it never becomes visible this way.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Which office shares my rung
-- ═══════════════════════════════════════════════════════════════════════════
-- Read off `pass_approvals` this would be a per-pass answer; this is the ORG
-- CHART's answer and has to hold for a pass that does not exist yet, so it is
-- stated against the ladder itself. Null for an office that shares its rung
-- with nobody, which is every office but these two.
create or replace function gatepass.approval_office_pair(p_role_key text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_role_key
           when 'coo' then 'ceo'
           when 'ceo' then 'coo'
           else null
         end;
$fn$;

comment on function gatepass.approval_office_pair(text) is
  'The office that shares a ladder rung with this one, or null. COO and CEO share level 3 (063); no other pair does. See migration 067.';

revoke all on function gatepass.approval_office_pair(text) from public;
grant execute on function gatepass.approval_office_pair(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The candidate list
-- ═══════════════════════════════════════════════════════════════════════════
-- 066's body, with one arm in front of it. The pair arm returns AT MOST ONE
-- NAME and may return none — an office whose counterpart is vacant or suspended
-- has nobody to hand its rung to, and the form says so rather than falling back
-- to the HOD bench the client just took away from these two offices.
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
  'The people an office holder may delegate to. An office that shares a rung (COO, CEO) may delegate only to its counterpart; every other office may delegate only to an active department head holding no approval seat. See migrations 066 and 067.';

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The write
-- ═══════════════════════════════════════════════════════════════════════════
-- 066's body. The role refusal and the holder-seat refusal are now the ELSE arm
-- of the pair rule rather than unconditional, because for these two offices the
-- delegate is REQUIRED to be a seat holder and is required not to be an HOD.
-- Every other refusal 062 wrote is unchanged and applies to both arms.
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
    -- holding the counterpart office is the whole qualification. The deputy
    -- seat and the overlapping-delegation refusals below still apply.
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

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
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

revoke all on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) from public;
grant execute on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. When a pass is STUCK
-- ═══════════════════════════════════════════════════════════════════════════
-- The moment the pass arrived on the rung it is sitting on now: the latest
-- decision on any rung BELOW it, and for a pass whose first rung is still
-- pending, the moment it was raised. `level_escalates_at` (063) computes the
-- same instant for one office; this asks it of the pass. Never `now()` minus
-- something, and never a column anybody could write.
create or replace function gatepass.pass_rung_reached_at(p_pass_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           (select max(b.decided_at)
              from gatepass.pass_approvals b
             where b.gate_pass_id = p_pass_id
               and b.level_no < (select min(a.level_no)
                                   from gatepass.pass_approvals a
                                  where a.gate_pass_id = p_pass_id
                                    and a.status = 'pending')
               and b.status in ('approved', 'not_required')),
           (select g.created_at from gatepass.gate_passes g where g.id = p_pass_id)
         )
   where exists (
     select 1 from gatepass.pass_approvals a
      where a.gate_pass_id = p_pass_id and a.status = 'pending'
   );
$fn$;

comment on function gatepass.pass_rung_reached_at(uuid) is
  'When a pending gate pass arrived on the rung it is waiting on now; null when it owes no signature. See migration 067.';

revoke all on function gatepass.pass_rung_reached_at(uuid) from public;
grant execute on function gatepass.pass_rung_reached_at(uuid) to authenticated;

-- Pending, still owing a signature, and on that rung longer than the window
-- level 3 escalates over. A cancelled pass is NOT stuck — it stopped, and
-- overturning a written refusal is not what any of this is for (055's rule).
create or replace function gatepass.pass_is_stuck(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.gate_passes g
            where g.id = p_pass_id and g.status = 'pending'
         )
     and gatepass.pass_rung_reached_at(p_pass_id)
           + make_interval(hours => gatepass.get_escalation_hours()::int) <= now();
$fn$;

comment on function gatepass.pass_is_stuck(uuid) is
  'True when a pending gate pass has waited on its current approval rung longer than app_settings.coo_escalation_hours. The one definition of "nobody has approved this". See migration 067.';

revoke all on function gatepass.pass_is_stuck(uuid) from public;
grant execute on function gatepass.pass_is_stuck(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Who is the super admin
-- ═══════════════════════════════════════════════════════════════════════════
-- The VMS role is KEPT as an arm rather than replaced: it is VMS's column, this
-- app does not own it, and an operator who seats one again must not find the
-- door bolted. What the client removed is the ACCOUNT, not the concept.
create or replace function gatepass.holds_fallback_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.approval_roles r
            where r.role_key in ('coo', 'ceo')
              and r.user_id = auth.uid()
         )
     and gatepass.is_user_active(auth.uid());
$fn$;

comment on function gatepass.holds_fallback_office() is
  'True for the sitting COO or CEO. Deputies and delegates are deliberately excluded: emergency release is the last door and belongs to the officer, not to their cover. See migration 067.';

revoke all on function gatepass.holds_fallback_office() from public;
grant execute on function gatepass.holds_fallback_office() to authenticated;

create or replace function gatepass.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select gatepass.app_role() = 'super_admin' or gatepass.holds_fallback_office();
$fn$;

comment on function gatepass.is_super_admin() is
  'The VMS super_admin role, or the sitting COO or CEO. Grants the emergency release and nothing else — it is NOT is_admin() and opens no admin screen. See migration 067.';

revoke all on function gatepass.is_super_admin() from public;
grant execute on function gatepass.is_super_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Seeing the pass you are being asked to unstick
-- ═══════════════════════════════════════════════════════════════════════════
-- `pass_routed_to_me` is left EXACTLY as 063 wrote it — its name states 061's
-- rule and this is not that rule. The arm is added to the two select policies
-- instead, where somebody auditing who can see a pass is already looking.
-- `can_see_pass` is SECURITY INVOKER over `gate_passes`, so `pass_approvals`,
-- `pass_remarks` and `emergency_releases` widen with it and no third copy of
-- this rule exists.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select on gatepass.gate_passes
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(id))
  );

drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select on gatepass.gate_pass_items
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(gate_pass_id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(gate_pass_id))
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The release itself
-- ═══════════════════════════════════════════════════════════════════════════
-- 055's body, with the pool widened and ONE condition added: an office holder
-- may release only a pass that is actually stuck. A VMS super admin is not so
-- limited — that role operates the whole system and 055 gave it the
-- unrestricted door; an office holder is one rung of the very ladder they are
-- about to skip, and "the pass has waited longer than the escalation window" is
-- what makes skipping it their business rather than an override of colleagues
-- who are simply still reading it.
create or replace function gatepass.emergency_release_pass(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_owed    integer;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  if not gatepass.is_super_admin() then
    raise exception 'Only a super admin — the COO or the CEO — can release a gate pass past its approval ladder.';
  end if;

  if length(v_reason) < 10 then
    raise exception 'An emergency release needs a written reason of at least 10 characters.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;

  -- A cancelled pass was REJECTED by an office, or voided by its HOD. Releasing
  -- it would overturn a decision somebody made and wrote a reason for, which is
  -- a different and much larger power than unsticking a silent queue. A matched
  -- pass has already left. Neither is what this is for.
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select count(*) into v_owed
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_owed = 0 then
    raise exception 'This gate pass does not owe any approvals — there is nothing to release.';
  end if;

  if gatepass.app_role() is distinct from 'super_admin'
     and not gatepass.pass_is_stuck(p_pass_id) then
    raise exception 'This gate pass has not been waiting long enough on its current approval level. It can be released this way only once it has been sitting there for % hours.',
      gatepass.get_escalation_hours();
  end if;

  -- Every remaining level at once. Releasing them one at a time would leave a
  -- pass that is half-overridden if the caller stopped, and the ladder's own
  -- slip order makes a partial release meaningless anyway.
  update gatepass.pass_approvals a
     set status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         reason     = v_reason,
         emergency  = true
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  insert into gatepass.emergency_releases (gate_pass_id, released_by, reason)
  values (p_pass_id, auth.uid(), v_reason);
end;
$$;

revoke all on function gatepass.emergency_release_pass(uuid, text) from public;
grant execute on function gatepass.emergency_release_pass(uuid, text) to authenticated;

comment on function gatepass.emergency_release_pass(uuid, text) is
  'Clears every approval level a pending gate pass still owes, in one act, recording who did it and why. Open to a VMS super admin, and to the sitting COO or CEO once the pass is stuck. Does not change the pass''s own status — see migrations 055 and 067.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Who holds the fallback, for the admin's Settings screen
-- ═══════════════════════════════════════════════════════════════════════════
-- Read-only, and admin-only because the Settings tab is. It names both offices
-- whether or not they are filled — an empty one is the whole point of the card,
-- since it means nobody at all can unstick a pass.
create or replace function gatepass.list_super_admins()
returns table (role_key text, title text, user_id uuid, full_name text, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the super admin list.';
  end if;

  return query
    select k.key,
           gatepass.approval_office_title(k.key),
           r.user_id,
           p.full_name,
           case when r.user_id is null then null
                else gatepass.is_user_active(r.user_id) end
      from (values ('ceo'), ('coo')) as k(key)
      left join gatepass.approval_roles r on r.role_key = k.key
      left join public.profiles p on p.id = r.user_id;
end;
$$;

comment on function gatepass.list_super_admins() is
  'The two offices that carry the super admin fallback — CEO and COO — and who sits in them today. See migration 067.';

revoke all on function gatepass.list_super_admins() from public;
grant execute on function gatepass.list_super_admins() to authenticated;

notify pgrst, 'reload schema';

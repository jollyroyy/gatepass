-- ============================================================================
-- 054 — every approval office may have ONE STANDING DEPUTY
--
-- THE GAP THIS CLOSES. Until now the ladder had exactly one way to move: the
-- sitting holder of an office pressed Approve. There is no delegation, no
-- escalation, no timeout and no reminder anywhere in 043/046/049 —
-- `pass_approvals` carries `created_at` and `decided_at` and nothing that ages.
-- So a CEO on leave stopped every pass at level 3 until somebody re-pointed the
-- office, which moves the whole queue permanently and leaves no trace of why.
--
-- WHAT THE MARKET DOES, and what is taken from it. SAP (substitution), Oracle
-- (vacation rules), ServiceNow, Coupa and Workday (delegation) all solve this
-- the same two ways: a named stand-in, and escalation on a timer. Only the
-- first is built here. A date-bounded delegation has to be switched on BEFORE
-- the absence, which is precisely when it is forgotten, and it buys nothing a
-- mall management office needs. Two details are worth stealing and are stolen:
--
--   * Coupa refuses to delegate DOWNWARD — a stand-in must hold equal or
--     greater authority. Here the ADMIN picks the deputy, so that is a policy
--     rule enforced by who gets chosen rather than by a seniority column this
--     schema has no way to know.
--   * Workday stamps the audit trail "On Behalf Of X". `decided_as_deputy`
--     below is that stamp, and the reason it is a stored column rather than a
--     join is in section 4.
--
-- ONE PERSON, ONE SEAT — 049 EXTENDED, NOT CONTRADICTED. 049 made `user_id`
-- unique because `my_approval_role()` is a scalar `returns text` over a query
-- that can yield several rows, and Postgres hands back an arbitrary one rather
-- than erroring. A deputy widens that query, so it reopens exactly that hazard
-- unless a deputy is unique too. Hence a partial unique index on `deputy_id`,
-- AND the two setters refusing anyone who already occupies a seat of either
-- kind. The rule that falls out is: **one human can never sign two rungs of the
-- same pass**, which is the four-eyes property the whole ladder rests on.
--
-- WHY THIS MIGRATION IS SMALL. Authority in 046 is resolved through
-- `my_approval_role()` at the moment of the press. Both RLS policies,
-- `pass_routed_to_me`, `pass_awaits_approval`, `approve_pass_level`,
-- `reject_pass_level` and the whole slip-order rule read through that one
-- function. Widening it by one `or` is what gives the deputy the entire
-- existing workflow — the queue, the record, the RLS visibility and the guard's
-- blindness to an unapproved pass — with nothing else changed.
--
-- WHAT A DEPUTY IS NOT. Not a role, not a login, not a route: exactly like the
-- office itself (046), it is a grant carried beside whatever VMS role the
-- person already has. And it does not change WHAT a pass owes — the levels are
-- still snapshotted at raise by the 046 trigger and are untouched here.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The column
-- ═══════════════════════════════════════════════════════════════════════════
-- Nullable: an office with no deputy is the normal case and must stay legal.
-- `on delete set null` matches `routed_to` in 046 — deleting a person empties
-- the seat rather than deleting the office, which would take the ladder with it.
alter table gatepass.approval_roles
  add column if not exists deputy_id uuid references public.profiles(id) on delete set null;

-- The holder cannot be their own deputy. Not pedantry: `my_approval_role()`
-- would still return one row, but `decided_as_deputy` would then be recorded
-- false for a person who is listed in both seats, and the audit line would be
-- deciding which of two true things to say.
alter table gatepass.approval_roles
  drop constraint if exists approval_roles_deputy_is_not_holder;
alter table gatepass.approval_roles
  add constraint approval_roles_deputy_is_not_holder
  check (deputy_id is null or deputy_id <> user_id);

-- Partial, unlike 049's — `deputy_id` IS nullable and the empty seat is the
-- common case, so every vacant office would collide on a plain unique index.
create unique index if not exists approval_roles_one_deputy_per_person
  on gatepass.approval_roles (deputy_id)
  where deputy_id is not null;

comment on index gatepass.approval_roles_one_deputy_per_person is
  'One deputy seat per person, for the reason 049 gives for holders: gatepass.my_approval_role() is a scalar over this table and would silently return an arbitrary one of several. See migration 054.';

comment on column gatepass.approval_roles.deputy_id is
  'Optional standing stand-in for this office. May approve exactly what the holder may, at any time, with no date window. Recorded on the decision as decided_as_deputy. See migration 054.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Authority follows either seat
-- ═══════════════════════════════════════════════════════════════════════════
-- The ONE function this migration exists to widen. Still returns at most one
-- row: `user_id` is unique (049), `deputy_id` is unique among non-nulls (above),
-- and section 3 refuses to seat one person in both. All three are load-bearing
-- together — drop any one and this silently becomes arbitrary again.
--
-- `is_user_active` still gates it, so suspending a deputy empties their queue
-- exactly as it does a holder's (040).
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where (r.user_id = auth.uid() or r.deputy_id = auth.uid())
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder OR as its standing deputy (054) — or null. Scalar by design: three separate rules guarantee at most one row. Suspended accounts hold nothing.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Seating people — and refusing anyone who already has a seat
-- ═══════════════════════════════════════════════════════════════════════════
-- The office title as a person reads it. Four functions below need this same
-- mapping inside a refusal sentence; 049 inlined the `case` once and a second
-- copy is a second thing to get wrong. Not SECURITY DEFINER — it reads nothing,
-- so it needs no elevated rights and no search_path pin.
create or replace function gatepass.approval_office_title(p_role_key text)
returns text
language sql
immutable
as $$
  select case p_role_key
           when 'security_head' then 'Security Head'
           when 'coo'           then 'COO'
           when 'ceo'           then 'CEO'
           when 'finance_head'  then 'Finance HOD'
           else                      p_role_key
         end;
$$;

revoke all on function gatepass.approval_office_title(text) from public;

-- Restated from 049 with ONE added refusal: a person already sitting as some
-- office's deputy cannot also be made a holder. Everything else — the admin
-- gate, the known-key check, the existence check, the "already holds" check and
-- the upsert — is 049's, unchanged.
--
-- Both checks EXCLUDE the office being set, so re-designating the same person
-- to the office they already hold stays a no-op rather than an error.
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
      gatepass.approval_office_title(v_held);
  end if;

  -- New in 054. Includes the office being set: making this office's own deputy
  -- its holder must clear the deputy seat first, or the row would violate
  -- approval_roles_deputy_is_not_holder with a constraint name instead of a
  -- sentence.
  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id;

  if v_held is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat — clear that deputy first.',
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

-- The deputy's own setter. Admin-gated like its holder counterpart, and for the
-- same reason 043 gives: designating somebody is an org-chart act, not a
-- security escalation the designator gains anything from.
--
-- AN UNDESIGNATED OFFICE CANNOT TAKE A DEPUTY, and that is not an arbitrary
-- order of operations: `approval_roles.user_id` is NOT NULL, so the row simply
-- cannot exist without a holder. Saying so is better than a null-violation.
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

create or replace function gatepass.clear_approval_deputy(p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change a gate pass deputy.';
  end if;

  update gatepass.approval_roles r
     set deputy_id = null
   where r.role_key = p_role_key;
end;
$$;

grant execute on function gatepass.set_approval_deputy(text, uuid) to authenticated;
grant execute on function gatepass.clear_approval_deputy(text)     to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The decision records WHICH SEAT signed it
-- ═══════════════════════════════════════════════════════════════════════════
-- `decided_by` already names the human. This says which capacity they acted in,
-- and it is a STORED COLUMN rather than a join back to `approval_roles` on
-- purpose: the seat is a fact about the MOMENT of the decision, and both seats
-- move. Re-pointing an office next month must not retroactively turn "approved
-- by the CEO" into "approved by a deputy", or the other way round. This is the
-- same argument 046 makes for snapshotting `routed_to`, and the same one 051
-- makes for NOT snapshotting the mail address — a decision is history, an
-- address is a lookup.
alter table gatepass.pass_approvals
  add column if not exists decided_as_deputy boolean not null default false;

comment on column gatepass.pass_approvals.decided_as_deputy is
  'True when the person named by decided_by signed as the office''s standing deputy rather than as its holder, recorded at the moment of the decision. See migration 054.';

-- Both decision RPCs are restated from 046 with ONE added assignment each.
-- Every guard, every sentence and the slip-order rule are unchanged — a deputy
-- is refused out-of-turn approval exactly as a holder is, because both resolve
-- through the same `my_approval_role()`.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
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
  v_as_deputy boolean;
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

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  update gatepass.pass_approvals a
     set status            = 'approved',
         decided_by        = auth.uid(),
         decided_at        = now(),
         decided_as_deputy = coalesce(v_as_deputy, false)
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

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
  v_as_deputy boolean;
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

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  update gatepass.pass_approvals a
     set status            = 'rejected',
         decided_by        = auth.uid(),
         decided_at        = now(),
         decided_as_deputy = coalesce(v_as_deputy, false),
         reason            = v_reason
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
-- 5. The readers
-- ═══════════════════════════════════════════════════════════════════════════
-- BOTH are DROPPED and recreated rather than replaced: `create or replace
-- function` cannot change a RETURN TYPE, and both of these gain a column. The
-- grant goes with the drop, so it is re-applied in the same transaction — the
-- rule CLAUDE.md states and `my_profile()` has already been bitten by twice.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key          text,
  level_no          smallint,
  status            text,
  routed_name       text,
  decided_name      text,
  decided_at        timestamptz,
  reason            text,
  decided_as_deputy boolean
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
           a.decided_as_deputy
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- The ladder card needs to show both seats, so the admin can see at a glance
-- which offices have cover and which do not. `deputy_name` is LEFT-joined for
-- the reason the pass view gives: a narrowed VMS policy must degrade to a
-- missing NAME, never to a missing office.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz,
  deputy_id       uuid,
  deputy_name     text
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
         r.designated_at,
         r.deputy_id,
         dp.full_name as deputy_name
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
    left join public.profiles   dp on dp.id = r.deputy_id
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
-- 6. The letter tells the deputy too
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 051 with two keys added. A deputy who is never written to is a
-- deputy who does not know there is anything to sign, which would leave this
-- whole migration working only for somebody already watching the screen.
--
-- The deputy is resolved from `approval_roles` — TODAY's deputy, exactly as 051
-- made the holder today's holder, and for the identical reason: authority is
-- resolved at the moment of the press, so the address must be too. There is no
-- `routed_to` fallback for a deputy because a pass was never routed to one; a
-- vacant deputy seat simply yields nulls, and the sender drops the recipient.
--
-- Everything else — the name, the jsonb shape, the service_role-only grant —
-- is unchanged.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
               'deputy_name',    dep.full_name,
               'deputy_email',   dep.email,
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join gatepass.approval_roles r on r.role_key = a.role_key
        left join public.profiles       cur on cur.id = r.user_id
        left join public.profiles        ap on ap.id  = a.routed_to
        left join public.profiles       dep on dep.id = r.deputy_id
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. Each level is addressed to whoever holds that office TODAY (051) and to its standing deputy (054), falling back to the holder snapshotted at raise when the office is now vacant. service_role ONLY; every signed-in reader uses get_approval_ladder() (043/054), which carries no address.';

notify pgrst, 'reload schema';

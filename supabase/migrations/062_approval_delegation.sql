-- ============================================================================
-- 062 — AN APPROVER DELEGATES THEIR OWN OFFICE, FOR A STATED PERIOD
--
-- WHAT THIS ADDS THAT 054 DELIBERATELY DID NOT. 054 gave every office a
-- STANDING DEPUTY: admin-designated, permanent, no dates. Its header argues at
-- length against the date-bounded delegation SAP / Oracle / Workday ship,
-- because such a thing has to be switched on BEFORE the absence, which is
-- exactly when it is forgotten. The client has now asked for it by name
-- ("Make sure to create a Delegation Tab for all the approvers … In their
-- absence they can delegate it"), so it is built. THE ARGUMENT IN 054 IS STILL
-- TRUE and the deputy is still there: the two are complementary, not rivals —
-- a deputy is standing cover somebody else named for you, a delegation is a
-- window you declare yourself before you go.
--
-- THE ONE DIFFERENCE THAT MATTERS: A DELEGATION IS THE HOLDER'S OWN ACT
-- (client, 2026-08-22: "instead of that put it in the approvers section so
-- whatever the approvers choose it should be automatically delegated"). An
-- office holder creates it, names the window, and revokes it. NO ADMIN IS
-- INVOLVED AT ANY POINT — which is the whole point of a self-service leave
-- hand-over — and that is why the gate on `create_approval_delegation` is "you
-- hold this office YOURSELF", not `is_admin()`. A deputy may NOT sub-delegate
-- (they hold cover, not the office), and a delegate may not re-delegate onward:
-- a chain of stand-ins is a chain nobody can audit.
--
-- WHY THIS MIGRATION IS SMALL, AGAIN. The same reason 054's was: authority is
-- resolved through `gatepass.my_approval_role()` at the moment of the press,
-- and both RLS policies, `pass_routed_to_me`, `pass_awaits_approval`,
-- `can_see_pass`, `approve_pass_level`, `reject_pass_level` and the whole
-- slip-order rule read through that ONE function. Widening it by one arm gives
-- the delegate the entire existing workflow — the queue, the record, the RLS
-- visibility, the guard's blindness to an unapproved pass — with nothing else
-- changed.
--
-- ⚠ ONE PERSON, ONE SEAT — THE INVARIANT 049 AND 054 REST ON, EXTENDED A THIRD
-- TIME. `my_approval_role()` is a scalar `returns text` over a query that can
-- yield several rows, and Postgres returns an ARBITRARY one rather than
-- erroring. A delegation is a third way to occupy a seat, so it reopens exactly
-- that hazard unless every combination is refused. Four refusals do it, and all
-- four are load-bearing together:
--
--   * a delegate may not hold an office            (create_approval_delegation)
--   * a delegate may not be a standing deputy      (create_approval_delegation)
--   * a delegate may not already be a delegate     (create_approval_delegation,
--     on an OVERLAPPING window — two windows that do not overlap are two
--     separate absences and are fine)
--   * a person with a live-or-future delegation may not be seated as a holder
--     or a deputy                                  (set_approval_role /
--                                                   set_approval_deputy, both
--                                                   restated below)
--
-- Drop any one and one human can sign two rungs of the same pass, which is the
-- four-eyes property the whole ladder exists for.
--
-- THE HOLDER DOES NOT LOSE AUTHORITY while a delegation runs. Both may sign,
-- and the first press closes the rung — the office is covered rather than
-- handed over. That is deliberate: a holder who checks in from leave, or whose
-- delegate is unreachable, must not find themselves locked out of their own
-- office by a form they filled in last week. Revoking is instant and is the
-- only thing that ends it early.
--
-- WHAT A DELEGATION IS NOT. Not a role, not a login, not a route — exactly like
-- the office (046) and the deputy (054), it is a grant carried beside whatever
-- VMS role the person already has. And it does not change WHAT a pass owes:
-- the levels are still snapshotted at raise by the 046 trigger and are
-- untouched here.
--
-- NO GATE, NO SITE, NO PASS-TYPE SCOPE. The client's mock-up carried an
-- Approval Type, a Location / Site and a Gate Pass Type scope, and struck all
-- three out by name ("no need to give any option or field to select the gate …
-- no need to mention the type of delegation gate pass"). There is nothing in
-- this schema to hang them on anyway: this app has no gate entity (see the
-- Pending OUT column note in CLAUDE.md) and no site. A delegation covers the
-- office entirely, and the only narrowing it takes is the VALUE ceiling below.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The table
-- ═══════════════════════════════════════════════════════════════════════════
-- `role_key` is SNAPSHOTTED from the delegator's office at the moment of
-- creation rather than resolved through `approval_roles` on every read. The
-- same argument 046 makes for `routed_to` and 054 for `decided_as_deputy`: an
-- office moves, and a delegation the COO wrote must not silently become a
-- delegation of whatever office that person holds next month.
--
-- `status` is NOT stored. It is `revoked_at` plus the clock, and a stored copy
-- would need something to age it — this schema has no pg_cron and derives
-- `is_overdue` / `is_expired` at query time for the identical reason.
create table if not exists gatepass.approval_delegations (
  id             uuid primary key default gen_random_uuid(),
  role_key       text        not null,
  delegator_id   uuid        not null references public.profiles(id) on delete cascade,
  delegate_id    uuid        not null references public.profiles(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  -- The mock's "Approval Limit (Optional)". Null is "No Limit" and is the
  -- ordinary case. Enforced in section 4 against the pass's own declared value.
  approval_limit numeric(14,2),
  reason         text,
  revoked_at     timestamptz,
  revoked_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint approval_delegations_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head')),
  -- A delegation to yourself is a no-op that would make `my_approval_role()`
  -- return two rows for one person — the exact hazard section 3 exists to close.
  constraint approval_delegations_not_self
    check (delegate_id <> delegator_id),
  constraint approval_delegations_window_forward
    check (ends_at > starts_at),
  constraint approval_delegations_limit_positive
    check (approval_limit is null or approval_limit > 0),
  -- Blank is null. Same blank-vs-null rule 045 applies to the item columns: a
  -- reason of three spaces reads as a stated reason on screen and is not one.
  constraint approval_delegations_reason_not_blank
    check (reason is null or btrim(reason) <> '')
);

comment on table gatepass.approval_delegations is
  'A time-boxed hand-over of ONE approval office, created by that office''s own holder. The delegate may approve exactly what the holder may, between starts_at and ends_at, unless revoked. See migration 062.';

comment on column gatepass.approval_delegations.role_key is
  'The office as it stood when the delegation was written — snapshotted, not resolved, so re-seating the delegator later cannot silently move what they delegated.';

comment on column gatepass.approval_delegations.approval_limit is
  'Optional ceiling in rupees on the declared value of a pass this delegate may sign. Null means no ceiling. Enforced in approve_pass_level, never on screen alone.';

create index if not exists approval_delegations_delegate_idx
  on gatepass.approval_delegations (delegate_id, starts_at, ends_at);
create index if not exists approval_delegations_delegator_idx
  on gatepass.approval_delegations (delegator_id, created_at desc);

-- RLS ON, NO POLICY AND NO GRANT — the shape 052's `mail_settings` and 060's
-- `department_delete_requests` both take. The RPCs below are the only readers
-- and the only writers, so there is no query anybody can send that reaches this
-- table directly. It carries who covers for whom and to what value ceiling,
-- which is not something every signed-in guard should be able to enumerate.
alter table gatepass.approval_delegations enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Is this delegation live right now?
-- ═══════════════════════════════════════════════════════════════════════════
-- Stated ONCE. Six things below ask it — the authority function, both decision
-- RPCs, the two seat setters and the candidate list — and a second copy of a
-- three-clause predicate is a second thing to get wrong.
--
-- HALF-OPEN ON PURPOSE: `>= starts_at` and `< ends_at`. A window that ends at
-- one instant and one that starts at the same instant must not both be live for
-- that instant, or two people hold the same seat at once.
--
-- Not SECURITY DEFINER: it reads nothing, so it needs no elevated rights.
create or replace function gatepass.delegation_is_live(
  p_revoked_at timestamptz,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
)
returns boolean
language sql
stable
as $$
  select p_revoked_at is null
     and now() >= p_starts_at
     and now() <  p_ends_at;
$$;

revoke all on function gatepass.delegation_is_live(timestamptz, timestamptz, timestamptz) from public;
grant execute on function gatepass.delegation_is_live(timestamptz, timestamptz, timestamptz) to authenticated;

-- The status a person reads, derived from the same two facts. Four values, not
-- the mock's three: a delegation created BEFORE the absence — which is the
-- entire point of declaring one — is neither active nor expired until its
-- window opens, and calling it "Active" a week early would be a screen lying
-- about who can sign today.
create or replace function gatepass.delegation_status(
  p_revoked_at timestamptz,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
)
returns text
language sql
stable
as $$
  select case
           when p_revoked_at is not null then 'revoked'
           when now() >= p_ends_at       then 'expired'
           when now() <  p_starts_at     then 'scheduled'
           else                               'active'
         end;
$$;

revoke all on function gatepass.delegation_status(timestamptz, timestamptz, timestamptz) from public;
grant execute on function gatepass.delegation_status(timestamptz, timestamptz, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Authority follows the delegation too
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ONE FUNCTION THIS MIGRATION EXISTS TO WIDEN, for the third time (046
-- wrote it, 054 added the deputy arm). Still returns at most one row, and that
-- is guaranteed by the four refusals listed in this file's header — NOT by a
-- `limit` clause, which is deliberately absent. A `limit 1` would paper over a
-- broken invariant by picking an arbitrary seat, which is precisely the failure
-- 049 was written to stop.
--
-- `is_user_active` still gates every arm, so suspending a delegate empties
-- their queue exactly as it does a holder's (040).
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
     and gatepass.is_user_active(auth.uid())
  union all
  select d.role_key
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at)
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder, as its standing deputy (054), or under a live delegation (062) — or null. Scalar by design: the seat refusals in 049, 054 and 062 together guarantee at most one row. Suspended accounts hold nothing.';

-- The live delegation this caller is acting under, if any. Both decision RPCs
-- need it: one to stamp the decision, the other to read the value ceiling off
-- it. Returns at most one row for the same reason above.
create or replace function gatepass.my_live_delegation()
returns table (id uuid, role_key text, approval_limit numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.role_key, d.approval_limit
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at);
$$;

revoke all on function gatepass.my_live_delegation() from public;
grant execute on function gatepass.my_live_delegation() to authenticated;

-- ─── The two seat setters, restated with ONE added refusal each ─────────────
-- Everything else in both is 054's, unchanged. Without these, an admin could
-- seat somebody who is already covering an office under a delegation, and
-- `my_approval_role()` would go back to returning an arbitrary one of two.
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

  -- 059's refusal, carried forward. `my_approval_role()` gates on this same
  -- function, so seating a suspended person creates an office that can approve
  -- nothing while the ladder card reads as staffed.
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

  -- New in 062. A delegation that has not started yet counts: seating the
  -- person now would leave them holding two seats the moment its window opens,
  -- and nothing would be watching at that hour to notice.
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

  -- 059's refusal, carried forward. `my_approval_role()` gates on this same
  -- function, so seating a suspended person creates an office that can approve
  -- nothing while the ladder card reads as staffed.
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

  -- New in 062, for the reason given in set_approval_role above.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_user_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_seat is not null then
    raise exception 'That person is covering the % office under a delegation. One person holds one approval seat — that delegation has to be revoked first.',
      gatepass.approval_office_title(v_seat);
  end if;

  update gatepass.approval_roles r
     set deputy_id = p_user_id
   where r.role_key = p_role_key;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The decision records that a DELEGATE signed it, and honours the ceiling
-- ═══════════════════════════════════════════════════════════════════════════
-- TWO COLUMNS, not one, and they do different jobs:
--
--   * `decided_as_delegate` is THE FACT, stored beside 054's
--     `decided_as_deputy` for the identical reason: the seat is a fact about
--     the MOMENT of the decision, and a delegation expires. A join back at read
--     time would turn "signed by the delegate" into "signed by the CEO" the day
--     after the window closed, which is the one thing an audit trail must not
--     do. It survives even if the delegation row itself is ever removed.
--   * `delegation_id` is HOW THE RECORD NAMES THE DELEGATOR (client,
--     2026-08-22: "it should be mentioned that the person has this approver who
--     was delegated by the original approver and the approver's name"). The
--     name is resolved through it at read time rather than snapshotted,
--     because a person's NAME is a lookup, not history — the same call 051
--     makes about the mail address, against 046's call about `routed_to`.
alter table gatepass.pass_approvals
  add column if not exists decided_as_delegate boolean not null default false;

alter table gatepass.pass_approvals
  add column if not exists delegation_id uuid
    references gatepass.approval_delegations(id) on delete set null;

comment on column gatepass.pass_approvals.decided_as_delegate is
  'True when the person named by decided_by signed under a time-boxed delegation of that office (062) rather than as its holder or standing deputy. Recorded at the moment of the decision, and true even if delegation_id is later nulled.';

comment on column gatepass.pass_approvals.delegation_id is
  'The delegation signed under, so the pass record can name who delegated the office. Nullable on delete: the FACT is decided_as_delegate, this is only how the name is found.';

-- Both decision RPCs are restated from 054 with the delegate stamp and, on
-- approval, the value ceiling. Every other guard, every sentence and the whole
-- slip-order rule are unchanged — a delegate is refused out-of-turn approval
-- exactly as a holder is, because all three resolve through the same
-- `my_approval_role()`.
--
-- ⚠ THE CEILING IS CHECKED HERE AND NOWHERE ELSE. A screen that hid the button
-- would be a courtesy; this is the rule. It reads the pass's own declared value
-- — `sum(approx_value)` over its lines, the same figure `v_gate_passes.
-- total_value` (038) carries and the same one the card and the record print —
-- and NEVER a figure sent by the caller.
--
-- AN UNPRICED PASS PASSES ANY CEILING. `approx_value` is optional and has been
-- since 019 (and was not collected at all between the eleventh and seventeenth
-- frontend passes), so "nothing declared" sums to 0. Refusing such a pass would
-- strand every legacy pass in a delegate's queue with no way to sign it and no
-- sentence that explains why; declaring a ceiling is a narrowing of what is
-- known, not a demand that everything be priced.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role        text := gatepass.my_approval_role();
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_as_deputy   boolean;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
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
         decided_as_deputy   = coalesce(v_as_deputy, false),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

-- ⚠ NO CEILING ON A REJECTION, AND THAT IS DELIBERATE. An approval limit caps
-- what somebody may COMMIT the business to; refusing to let a delegate stop a
-- pass they think is wrong, because it is worth too much, is the rule pointing
-- exactly the wrong way. The same call 043 makes about an expired pass at the
-- gate: Approve is withheld, Reject never is.
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

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  select d.id into v_deleg_id
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  update gatepass.pass_approvals a
     set status              = 'rejected',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_deputy   = coalesce(v_as_deputy, false),
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

-- THE RECORD NAMES THE DELEGATOR (client, 2026-08-22). The ladder and the
-- merged timeline both render this one function, so saying it here is saying it
-- everywhere a rung is drawn.
--
-- DROPPED and recreated, not replaced: `create or replace function` cannot
-- change a RETURN TYPE, and the grant goes with the drop and is re-applied in
-- the same transaction — the rule CLAUDE.md states and `my_profile()` has been
-- bitten by twice.
--
-- `delegated_by_name` is LEFT-joined twice over (the delegation, then its
-- delegator's profile) for the reason the pass view gives: a narrowed VMS
-- policy must degrade to a missing NAME, never to a missing rung. A rung whose
-- delegator failed to resolve still reads "signed under a delegation".
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
  decided_as_deputy   boolean,
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
           a.decided_as_deputy,
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Writing one
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GATE IS "YOU HOLD THIS OFFICE YOURSELF", not `my_approval_role()`. That
-- function answers true for a deputy and for a delegate as well, and neither
-- may hand on what they are only covering — a chain of stand-ins is a chain
-- nobody can audit, and every link would be another seat for one person to
-- occupy. An admin is not admitted either: this is the holder's own act, which
-- is the whole of what the client asked for.
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
  v_active boolean;
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

  select gatepass.is_user_active(p.id) into v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if v_active is null then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  -- ── The one-seat refusals. See this file's header. ──────────────────────
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
    raise exception 'That person is already covering the % office over part of that period. One person holds one approval seat at a time.',
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

-- Revoking. THE DELEGATOR OR AN ADMIN — nobody else, and deliberately not the
-- delegate: somebody covering an office must not be able to quietly hand it
-- back while the holder is away, which would leave the seat empty with no
-- notice to anyone.
--
-- Revoking is not a delete. The row stays in the history saying who covered
-- what, until when it was meant to run, and that it was ended early — which is
-- the whole reason there is a history at all.
create or replace function gatepass.revoke_approval_delegation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_revoked timestamptz;
begin
  select d.delegator_id, d.revoked_at into v_owner, v_revoked
    from gatepass.approval_delegations d
   where d.id = p_id;

  if v_owner is null then
    raise exception 'That delegation does not exist.';
  end if;

  if v_owner <> auth.uid() and not gatepass.is_admin() then
    raise exception 'Only the approver who created a delegation can revoke it.';
  end if;

  if v_revoked is not null then
    raise exception 'That delegation has already been revoked.';
  end if;

  update gatepass.approval_delegations d
     set revoked_at = now(),
         revoked_by = auth.uid()
   where d.id = p_id;
end;
$$;

revoke all on function gatepass.revoke_approval_delegation(uuid) from public;
grant execute on function gatepass.revoke_approval_delegation(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The readers
-- ═══════════════════════════════════════════════════════════════════════════
-- Everything this caller has delegated, newest first, with the DERIVED status
-- rather than a stored one. The delegate's name is LEFT-joined for the reason
-- the pass view gives: a narrowed VMS policy must degrade to a missing NAME,
-- never to a missing row — a delegation whose name failed to resolve is still
-- a delegation somebody has to be able to revoke.
create or replace function gatepass.list_my_delegations()
returns table (
  id              uuid,
  role_key        text,
  delegate_id     uuid,
  delegate_name   text,
  department_name text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  approval_limit  numeric,
  reason          text,
  status          text,
  created_at      timestamptz,
  revoked_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id,
         d.role_key,
         d.delegate_id,
         p.full_name,
         dept.name,
         d.starts_at,
         d.ends_at,
         d.approval_limit,
         d.reason,
         gatepass.delegation_status(d.revoked_at, d.starts_at, d.ends_at),
         d.created_at,
         d.revoked_at
    from gatepass.approval_delegations d
    left join public.profiles    p    on p.id = d.delegate_id
    left join public.departments dept on dept.id = p.department_id
   where d.delegator_id = auth.uid()
   order by d.created_at desc;
$$;

revoke all on function gatepass.list_my_delegations() from public;
grant execute on function gatepass.list_my_delegations() to authenticated;

-- Who this office holder may delegate to.
--
-- IT IS NOT THE DIRECTORY. `admin_list_profiles` (006) is admin-gated because
-- it returns emails and roles, and an approver is not an admin — so this is a
-- second, much narrower list: id, name and department, for ACTIVE accounts
-- only, with every person already occupying a seat filtered out. Filtering here
-- rather than only refusing in section 5 is not defence in depth for its own
-- sake: offering a name the database will refuse is a form that fails after it
-- is filled in.
--
-- Gated on HOLDING an office, because that is exactly who may write one.
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

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

notify pgrst, 'reload schema';

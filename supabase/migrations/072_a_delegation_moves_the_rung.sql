-- ============================================================================
-- 072 — A DELEGATION ACTUALLY MOVES THE RUNG, EVEN BETWEEN THE COO AND THE CEO
--
-- Client, 2026-08-31: "whenever any delegation of approval is created in either
-- ceo/coo, it should appropriately go to the respective approver. I can see
-- it's still going to coo for approval when he is on absence and has raised
-- delegation for a particular time period, same for ceo."
--
-- ── THE BUG, AND IT IS ONE 049 PREDICTED IN WRITING. ────────────────────────
-- `gatepass.my_approval_role()` is `returns text` — a SCALAR — over a two-arm
-- `union all`: the office you HOLD, and the office you are covering under a
-- live delegation (062, 068). Every seat refusal in 049, 062 and 066 exists to
-- guarantee that query yields AT MOST ONE ROW, because a `language sql` scalar
-- over a multi-row body does not error: Postgres returns the FIRST row and
-- discards the rest, silently.
--
-- 067 THEN BROKE THAT GUARANTEE ON PURPOSE. The COO and the CEO delegate only
-- to each other, and the one-seat refusal is skipped for that pair alone — "only
-- because covering a shared rung cannot put two signatures on one pass", which
-- is true and is not the property that was load-bearing here. The property that
-- was load-bearing is SCALARITY, and 067 did not carry it.
--
-- So with a live COO → CEO delegation the CEO's `my_approval_role()` returns
-- `ceo` (the holder arm sorts first) and the `coo` arm is thrown away. The
-- consequences, all three of them silent:
--
--   * `pass_routed_to_me` (061/063) matches on `ceo`, so the COO's rung is not
--     the CEO's to see as the COO's;
--   * `approve_pass_level` (068) resolves `ceo`, hits 063's escalation gate —
--     the COO still has hours on the clock — and REFUSES;
--   * the queue at /approvals is empty, and the pass sits, addressed to a
--     person who declared themselves absent.
--
-- Verified against the live project on 2026-08-31: the sitting CEO was both the
-- `ceo` holder and the live delegate of `coo`, and the two arms returned two
-- rows.
--
-- ── THE FIX: AUTHORITY IS A SET, IDENTITY IS A SCALAR. ──────────────────────
-- 049's own comment named the work: "`my_approval_role()` becomes a set-returning
-- `my_approval_roles()`, `pass_routed_to_me` matches on membership". That is
-- what this migration does, and nothing more.
--
--   * `my_approval_roles()` — every office this caller may act for, holder arm
--     first. THE AUTHORITY TEST. Both arms still gated on `is_user_active` (040).
--   * `my_approval_role()` — the FIRST of those, kept because identity is a real
--     and separate question: which office's Delegation tab do I open, which
--     title sits under my name in the sidebar. It is no longer an authority test
--     and its comment says so.
--   * `my_acting_role(pass, respect_escalation)` — WHICH of my offices may act
--     on THIS pass right now. One office, chosen by rule rather than by the
--     accident of a `union all`'s row order.
--
-- WHY A DELEGATED OFFICE OUTRANKS MY OWN when both could act. It can only ever
-- happen on level 3, the one rung the COO and the CEO share, and the delegation
-- is the whole reason the pass can move at all: signing as the absent office
-- clears the rung with no escalation window to wait out, and 063's sibling-close
-- writes the other row off as `not_required` in the same statement. Signing as
-- my own office instead would mean waiting 48 hours to do the identical thing.
-- One signature either way — the four-eyes property is untouched, because a
-- rung closed is a rung closed.
--
-- A REJECTION IS STILL NEVER ESCALATION-GATED (063's rule, restated): the
-- rejection path asks `my_acting_role(..., false)`.
--
-- ── AND THE PASS HAS TO SAY SO ON SCREEN AND IN THE POST. ───────────────────
-- Two readers were still being handed the absent holder's name, and both are
-- the client's "it should go to the respective approver":
--
--   * `approval_notice_payload` (051, 068) addresses each level to whoever holds
--     the office TODAY. Today, for a delegated office, is the delegate — the
--     person the database will actually accept a press from. 051's own argument
--     ("the letter asked a person the database would have refused") applies
--     verbatim; it just never considered a delegation.
--   * `get_approval_ladder` (043, 068) names the holder, so the "Waiting with"
--     strip on the admin and HOD boards printed the absent COO. It gains
--     `acting_user_id` / `acting_name` / `delegated` — the holder columns are
--     untouched, because who HOLDS the office is still a fact worth reading.
--
-- NOT TOUCHED, DELIBERATELY: `holds_fallback_office()` (067) still reads
-- `approval_roles` alone. The super admin fallback is the SEAT's, not a
-- stand-in's — 067 says so by name — and so is `raise_pass`'s admission of the
-- pair (069) and the CEO's whitelist decision (053). A delegation hands over a
-- rung on the ladder, not the emergency door.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Authority — every office this caller may act for
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's body, unchanged except that it is now allowed to return what it always
-- could. THE ORDER IS PART OF THE CONTRACT: the holder arm first, so
-- `my_approval_role()` below keeps returning exactly what it returned before
-- for the ~every caller who holds one office and covers none.
--
-- Still no `limit`. 049's argument survives intact for every office but the
-- shared rung: a person holding two SEATS is still a broken invariant, and this
-- function must keep exposing it rather than truncating it away.
create or replace function gatepass.my_approval_roles()
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
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
$fn$;

comment on function gatepass.my_approval_roles() is
  'Every approval office this caller may act for — as its holder, or under a live delegation (062) — holder first. THE AUTHORITY TEST: since 067 let the COO and the CEO delegate to each other, one person can legitimately be both, and a scalar silently dropped the second. Suspended accounts hold nothing (040). See migration 072.';

revoke all on function gatepass.my_approval_roles() from public;
grant execute on function gatepass.my_approval_roles() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Identity — the one office this caller IS
-- ═══════════════════════════════════════════════════════════════════════════
-- The holder arm when there is one, else the office being covered. This is what
-- the sidebar prints under a name, what the Delegation tab hands to
-- `create_approval_delegation` (which gates on holding the office YOURSELF and
-- would refuse a covered one anyway), and what decides which routes open.
--
-- ⚠ IT IS NOT AN AUTHORITY TEST ANY MORE. Nothing that decides whether a press
-- is allowed may read this function; they read `my_approval_roles()` or
-- `my_acting_role()`. Taking the first row here is honest — this function asks
-- for one office and says so — where the old implicit truncation was not.
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.role_key from gatepass.my_approval_roles() t(role_key) limit 1;
$fn$;

comment on function gatepass.my_approval_role() is
  'The office this caller IS — their own seat if they hold one, else the office they are covering. IDENTITY ONLY: routes, titles and the Delegation tab. Authority is gatepass.my_approval_roles() (072), which can return two since 067 let the COO and the CEO cover each other.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Which of my offices may act on THIS pass
-- ═══════════════════════════════════════════════════════════════════════════
-- Among the offices I may act for: the ones with a pending row on this pass, on
-- the LOWEST pending level, that are not waiting out 063's escalation window.
-- A delegated office wins a tie — see the header.
--
-- `p_respect_escalation` is false on the rejection path alone. 063: "a limit
-- caps what somebody may COMMIT the business to, and refusing to let an office
-- STOP a pass points the rule exactly the wrong way."
--
-- Null means "none of my offices may act on this pass right now", and the two
-- RPCs below diagnose WHY rather than passing that null on to a user.
--
-- SECURITY DEFINER for the reason `level_escalates_at` is (063): it reads
-- `pass_approvals`, whose own policy would otherwise recurse through it (42P17).
-- Deliberately NOT granted to `authenticated` — nothing outside these RPCs has
-- any business asking, and an ungranted function is one fewer thing reachable
-- over PostgREST.
create or replace function gatepass.my_acting_role(
  p_pass_id             uuid,
  p_respect_escalation  boolean default true
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  with mine as (
    select t.role_key,
           exists (
             select 1 from gatepass.my_live_delegation() d
              where d.role_key = t.role_key
           ) as delegated
      from gatepass.my_approval_roles() t(role_key)
  ),
  open_rungs as (
    select a.role_key, a.level_no
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.status = 'pending'
  ),
  lowest as (
    select min(level_no) as level_no from open_rungs
  )
  select m.role_key
    from mine m
    join open_rungs o on o.role_key = m.role_key
    join lowest    l on l.level_no  = o.level_no
   where not p_respect_escalation
      or coalesce(gatepass.level_escalates_at(p_pass_id, m.role_key) <= now(), true)
   order by m.delegated desc, m.role_key
   limit 1;
$fn$;

comment on function gatepass.my_acting_role(uuid, boolean) is
  'Which of this caller''s approval offices may decide this pass right now — lowest pending rung, escalation window respected unless a rejection asks it not to be, a covered office preferred over their own on a shared rung. Null when none may. See migration 072.';

revoke all on function gatepass.my_acting_role(uuid, boolean) from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Visibility matches on MEMBERSHIP
-- ═══════════════════════════════════════════════════════════════════════════
-- 063's body with one line changed: `= my_approval_role()` becomes `in
-- (my_approval_roles())`. 061's rule — an office sees a pass only once every
-- rung BELOW it is closed in its favour — is untouched, and so is the reason
-- `not_required` counts as closed.
create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key in (select t.role_key from gatepass.my_approval_roles() t(role_key))
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status not in ('approved', 'not_required')
       )
  );
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The two decisions act for the office that can actually act
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's `approve_pass_level`, with the office resolved per pass instead of per
-- caller. Every refusal it made before, it still makes, in the same order and
-- with the same words — the escalation sentence included, which is now reached
-- by way of "no office of mine may act, and the reason is the window".
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles       text[] := array(select t.role_key from gatepass.my_approval_roles() t(role_key));
  v_role        text;
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
  v_escalates   timestamptz;
begin
  if cardinality(v_roles) = 0 then
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

  -- The lowest rung ANY of my offices is pending on.
  select min(a.level_no) into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = any(v_roles)
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

  v_role := gatepass.my_acting_role(p_pass_id);

  -- THE ESCALATION GATE, reached the only way it can still be reached: my rung
  -- is the lowest one open and I am STILL not allowed to sign it. Only the CEO
  -- behind a COO who has time left can be in that position (063).
  if v_role is null then
    v_escalates := gatepass.level_escalates_at(p_pass_id, 'ceo');
    if v_escalates is not null then
      raise exception 'This pass is with the COO until %. It escalates to the CEO only if they have not decided it by then.',
        to_char(v_escalates, 'DD Mon YYYY HH24:MI');
    end if;
    raise exception 'This gate pass is not waiting on your approval.';
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

  -- ONE SIGNATURE CLOSES THE RUNG (063). Unchanged, and it is what makes the
  -- COO's delegate signing the COO's row also discharge the CEO's — the pair
  -- share level 3, and a rung takes one signature.
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

-- 068's `reject_pass_level`, resolved the same way and NEVER escalation-gated.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles     text[] := array(select t.role_key from gatepass.my_approval_roles() t(role_key));
  v_role      text;
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if cardinality(v_roles) = 0 then
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

  select min(a.level_no) into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = any(v_roles)
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

  -- `false`: a rejection is never withheld for a clock (063's rule).
  v_role := gatepass.my_acting_role(p_pass_id, false);
  if v_role is null then
    raise exception 'This gate pass is not waiting on your approval.';
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
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The ladder names who is HOLDING the rung today
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropped and recreated: `create or replace function` cannot add columns to a
-- return type. The grant goes with the drop and comes back in the same
-- transaction.
--
-- The holder columns are UNCHANGED and still first — an admin seating an office
-- reads `user_id` / `full_name`, and a delegation must not make the seat look
-- vacant or occupied by somebody else. `acting_*` is the separate question the
-- "Waiting with" strip asks: who does this pass sit with TODAY.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz,
  acting_user_id  uuid,
  acting_name     text,
  delegated       boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at,
         coalesce(dg.delegate_id, r.user_id) as acting_user_id,
         coalesce(dp.full_name, p.full_name) as acting_name,
         (dg.delegate_id is not null)        as delegated
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
    -- AT MOST ONE. 062 refuses overlapping windows on one office, so the
    -- lateral is a lookup and not a choice; the `limit 1` is belt to that
    -- constraint's braces and keeps the join shape a single row either way.
    left join lateral (
           select dd.delegate_id
             from gatepass.approval_delegations dd
            where dd.role_key = r.role_key
              and gatepass.delegation_is_live(dd.revoked_at, dd.starts_at, dd.ends_at)
            order by dd.starts_at desc
            limit 1
         ) dg on true
    left join public.profiles   dp on dp.id = dg.delegate_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'finance_head'  then 3
              when 'ceo'           then 4
            end;
$fn$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

comment on function gatepass.get_approval_ladder() is
  'Who holds each approval office, and who is ACTING for it today — a live delegation (062) puts the delegate in acting_user_id / acting_name and sets delegated. The holder columns never move: an admin seating an office reads those. See migration 072.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The letter goes to whoever can actually sign
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's payload with one address resolved further along. 051 fixed this once
-- already, for a re-designated office, and its sentence is the whole argument
-- here too: "the letter asked a person the database would have refused, while
-- the person who actually had to sign was never written to. That is the worst
-- of the two failure modes: the ladder silently stops, and the only symptom is
-- an inbox that stays empty."
--
-- THE CHAIN IS: live delegate → current holder → the person the pass was routed
-- to when it was raised. Each fallback is a step further from who may press the
-- button, and every join into `public.*` stays LEFT, so a narrowed VMS policy
-- drops ONE address rather than rerouting the mail.
--
-- `delegated` rides along so the Edge Function's template can say why a stranger
-- is being asked to sign. It needs no redeploy to ignore it.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
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
                 'approver_id',    coalesce(dg.delegate_id, r.user_id, a.routed_to),
                 'approver_name',  coalesce(dp.full_name, cur.full_name, ap.full_name),
                 'approver_email', coalesce(dp.email, cur.email, ap.email),
                 'delegated',      (dg.delegate_id is not null),
                 'holder_name',    cur.full_name,
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
          left join lateral (
                 select dd.delegate_id
                   from gatepass.approval_delegations dd
                  where dd.role_key = a.role_key
                    and gatepass.delegation_is_live(dd.revoked_at, dd.starts_at, dd.ends_at)
                  order by dd.starts_at desc
                  limit 1
               ) dg on true
          left join public.profiles        dp on dp.id = dg.delegate_id
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
$fn$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included (047/051/072), plus the emergency release that cleared this pass if there was one (055). Each level is addressed to whoever may SIGN it today — the live delegate, else the office''s current holder, else the holder snapshotted at raise. The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

notify pgrst, 'reload schema';

-- ============================================================================
-- 077 — AN HOD HANDS THE RAISING OF PASSES TO SOMEBODY IN THEIR OWN DEPARTMENT,
--       AND THEN SIGNS WHAT THAT PERSON RAISES
--
-- Client, 2026-09-01: "the HOD of all the departments should be able to delegate
-- the pass creation capabilities … to the person he has asked. This should not
-- be any of the department heads or CEO … it should be from his own department
-- only. Show the names as a dropdown within his department under each HOD and
-- whoever he chooses should be able to log in and create passes the way the HOD
-- is raising it. In those scenarios those passes should be approved by the HOD
-- as first-level approver and the following is routine, followed as usual."
--
-- ── IT IS NOT AN APPROVAL DELEGATION, AND IT IS NOT AN OFFICE. ──────────────
-- 062 hands over a rung on the ladder; this hands over the KEYBOARD. The two
-- must not share a table: an `approval_delegations` row grants
-- `approve_pass_level`, RLS visibility of every pass routed to that rung and —
-- through `my_approval_roles()` — the approver's whole set of routes. Writing
-- "raising" into it would be one row meaning two unrelated grants, and the next
-- widening of that function would quietly hand a department assistant the CEO's
-- queue. `gatepass.pass_raisers` grants exactly one verb: `raise_pass`.
--
-- THE RAISER SEES NOTHING NEW. 069 already admits `raised_by = auth.uid()` on
-- `gate_passes_select` and `raised_by_me()` on the items, which is the whole of
-- what this account may read — their own passes, and no other pass in the
-- department. No policy is touched by this migration, deliberately: a grant that
-- widens RLS is a grant that has to be argued about, and this one does not.
--
-- ── THE HOD'S SIGNATURE IS A REAL RUNG, AT LEVEL 0. ─────────────────────────
-- "Approved by the HOD as first-level approver, and the following is routine"
-- is the whole design constraint: everything AFTER that signature has to be the
-- ladder this app already has. So the HOD is not a fifth office and not a flag
-- on the pass — it is one more `pass_approvals` row, at a level BELOW the
-- Security Head's 1, and every mechanism the ladder already owns then applies to
-- it unchanged:
--
--   * `pass_awaits_approval` tests `pending`, so the gate cannot see the pass
--     until the HOD has signed it — the same blindness 046 gave the four
--     offices, with no new code;
--   * 061's linear visibility hides the pass from the Security Head until the
--     HOD has signed, because level 0 is a rung below theirs;
--   * `reject_pass_level` cancels the pass and writes the `verifications` row;
--   * `approval_notice_payload` (051/076) resolves an approver's name and email
--     through `coalesce(…, a.routed_to)`, so the letter reaches the HOD with
--     nothing added to it;
--   * `get_pass_approvals` returns the rung and the record draws it.
--
-- ⚠ LEVEL 0 AND NOT A RENUMBERING. 057 and 063 both renumbered, and both said
-- why they could: `level_no` is the ORDER the remaining signatures are collected
-- in. Here renumbering would rewrite the level printed against every signature
-- ever given, on every live row, to make room for a rung those passes do not
-- have. Zero is free, sorts first, and is what "before level 1" means.
--
-- ⚠ `role_key = 'department_hod'` IS A RUNG KEY, NOT AN OFFICE KEY. It never
-- appears in `approval_roles`, in `approval_delegations`, in `ApprovalRoleKey`
-- or on the admin's ladder card. `approval_office_title` learns the words for it
-- because three of the sentences these RPCs raise are built from that function,
-- and nothing else about an office follows.
--
-- ── WHO MAY SIGN IT: ANY ACTIVE HOD OF THAT DEPARTMENT. ─────────────────────
-- `routed_to` is the HOD who wrote the delegation — that is the fact the letter
-- and the record state — but the AUTHORITY is `heads_pass_department()`, on the
-- back of 032, which lets a department host several HODs. It cannot widen
-- anything: an HOD who heads the department already reads, and already answers
-- for, every pass raised in it.
--
-- THE AUTHORITY TEST IS PER PASS, WHICH 072 SAID IT WOULD HAVE TO BE. That
-- migration split "what may I sign" (a set) from "who am I" (a scalar).
-- `my_pass_rungs(pass)` is the same set, with one member that exists only in the
-- context of one pass, and `my_acting_role` picks from it exactly as before.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The grant
-- ═══════════════════════════════════════════════════════════════════════════
-- `department_id` is SNAPSHOTTED from the HOD's own department at the moment the
-- authority is written, on 062's precedent for `role_key`: an HOD who moves
-- department must not silently take their assistant's authority into a
-- department that assistant was never a member of.
create table if not exists gatepass.pass_raisers (
  id            uuid primary key default gen_random_uuid(),
  hod_id        uuid        not null references public.profiles(id)    on delete cascade,
  raiser_id     uuid        not null references public.profiles(id)    on delete cascade,
  department_id uuid        not null references public.departments(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text,
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- Delegating to yourself is the no-op that would put a rung on the pass
  -- addressed to the person who raised it.
  constraint pass_raisers_not_self
    check (raiser_id <> hod_id),
  constraint pass_raisers_window_forward
    check (ends_at > starts_at),
  -- Blank is null (045's rule): a reason of three spaces reads as a stated
  -- reason on screen and is not one.
  constraint pass_raisers_reason_not_blank
    check (reason is null or btrim(reason) <> '')
);

comment on table gatepass.pass_raisers is
  'A time-boxed authority to RAISE gate passes for one department, written by an HOD of that department. It grants raise_pass and nothing else — never an approval, never a route of the HOD''s. Each pass so raised carries a level-0 department_hod rung that HOD signs. See migration 077.';

comment on column gatepass.pass_raisers.department_id is
  'The department as it stood when the authority was written — snapshotted, not resolved, so an HOD moving department cannot carry their raiser into a new one.';

create index if not exists pass_raisers_raiser_idx
  on gatepass.pass_raisers (raiser_id, starts_at, ends_at);
create index if not exists pass_raisers_hod_idx
  on gatepass.pass_raisers (hod_id, created_at desc);

-- RLS ON, NO POLICY AND NO GRANT — 052's `mail_settings` and 062's
-- `approval_delegations` both take this shape. The RPCs below are the only
-- readers and the only writers, so there is no query anybody can send that
-- reaches this table directly.
alter table gatepass.pass_raisers enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. What the grant answers
-- ═══════════════════════════════════════════════════════════════════════════
-- `delegation_is_live` (062) is REUSED rather than restated: it takes the three
-- columns and no table, is half-open at both ends, and "is this window running"
-- is one question this schema should answer in one place.
--
-- SETOF, NOT A SCALAR — 072's lesson, applied before it can bite. Section 5
-- refuses a second overlapping grant, so this returns at most one row today;
-- writing it as a scalar would mean a later widening silently discards a row
-- instead of erroring, which is exactly how `my_approval_role()` broke.
create or replace function gatepass.my_raising_departments()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.department_id
    from gatepass.pass_raisers r
   where r.raiser_id = auth.uid()
     and gatepass.delegation_is_live(r.revoked_at, r.starts_at, r.ends_at)
     and gatepass.is_user_active(auth.uid());
$fn$;

comment on function gatepass.my_raising_departments() is
  'The departments this caller may raise a gate pass for under an HOD''s standing authority (077). Empty for everybody else, and for a suspended account (040).';

-- Ungranted: nothing outside `raise_pass` and the read below has any business
-- asking, and an ungranted function is one fewer thing reachable over PostgREST.
revoke all on function gatepass.my_raising_departments() from public;

-- What the CLIENT needs: the department it may raise for, and whose authority it
-- is acting under — the sidebar draws a Raise tab from the first, and the form
-- says the second out loud. Granted, and it can tell a caller nothing about
-- anybody but themselves.
create or replace function gatepass.my_raising_grant()
returns table (
  id              uuid,
  department_id   uuid,
  department_name text,
  hod_id          uuid,
  hod_name        text,
  starts_at       timestamptz,
  ends_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.department_id, d.name, r.hod_id, h.full_name, r.starts_at, r.ends_at
    from gatepass.pass_raisers r
    left join public.departments d on d.id = r.department_id
    left join public.profiles    h on h.id = r.hod_id
   where r.raiser_id = auth.uid()
     and gatepass.delegation_is_live(r.revoked_at, r.starts_at, r.ends_at)
     and gatepass.is_user_active(auth.uid())
   order by r.starts_at desc;
$fn$;

comment on function gatepass.my_raising_grant() is
  'The live raising authority this caller holds, if any — the department, and the HOD who granted it. The client draws the Raise Gate Pass tab from this. See migration 077.';

revoke all on function gatepass.my_raising_grant() from public;
grant execute on function gatepass.my_raising_grant() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The rung, and who may sign it
-- ═══════════════════════════════════════════════════════════════════════════
-- The two checks 046 wrote, each with one branch added. Existing rows satisfy
-- both unchanged, so neither needs a data fix.
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_key_known;
alter table gatepass.pass_approvals
  add constraint pass_approvals_key_known
  check (role_key in ('department_hod', 'security_head', 'coo', 'ceo', 'finance_head'));

alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_level_matches;
alter table gatepass.pass_approvals
  add constraint pass_approvals_level_matches
  check (level_no = case role_key
                      when 'department_hod' then 0
                      when 'security_head'  then 1
                      when 'finance_head'   then 2
                      when 'coo'            then 3
                      when 'ceo'            then 3
                    end);

-- 054's title function, with the words for the new rung. It is NOT an office —
-- see the header — but three sentences below are built from this function and
-- would otherwise print the raw key at a person.
create or replace function gatepass.approval_office_title(p_role_key text)
returns text
language sql
immutable
as $$
  select case p_role_key
           when 'department_hod' then 'Department HOD'
           when 'security_head'  then 'Security Head'
           when 'coo'            then 'COO'
           when 'ceo'            then 'CEO'
           when 'finance_head'   then 'Finance HOD'
           else                       p_role_key
         end;
$$;

revoke all on function gatepass.approval_office_title(text) from public;

-- 063's trigger with the level-0 rung written FIRST when — and only when — the
-- raiser held a live authority for this department at the moment of the insert.
--
-- IT IS STILL A TRIGGER AND NOT A LINE IN `raise_pass`, for 046's reason: every
-- insert path gets it, and no later rewrite of the raise RPC can quietly drop
-- the HOD's signature by forgetting a line.
--
-- THE AUTHORITY IS RE-READ HERE RATHER THAN PASSED IN. `new.raised_by` and
-- `new.department_id` are the two facts it needs and both are on the row, so the
-- rung cannot disagree with the pass it belongs to.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Level 0 — the HOD whose authority this pass was raised under (077). At most
  -- one row: section 5 refuses an overlapping grant, and `order by`/`limit` says
  -- so rather than relying on it.
  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id, 'department_hod', 0::smallint, r.hod_id
    from gatepass.pass_raisers r
   where r.raiser_id = new.raised_by
     and r.department_id = new.department_id
     and gatepass.delegation_is_live(r.revoked_at, r.starts_at, r.ends_at)
   order by r.starts_at desc
   limit 1;

  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id,
         r.role_key,
         (case r.role_key
            when 'security_head' then 1
            when 'finance_head'  then 2
            when 'coo'           then 3
            when 'ceo'           then 3
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$fn$;

-- Does this caller head the department this pass belongs to?
--
-- SECURITY DEFINER for the reason every other predicate these policies reach
-- through is (046's 42P17 note): it reads `gate_passes`, whose own policy would
-- otherwise recurse through it. It answers about `auth.uid()` alone, so it can
-- tell a caller nothing about anybody else.
--
-- `my_department_ids()` returns NOTHING for a suspended account (040), so a
-- suspended HOD holds no rung — the same rule every office arm already obeys.
create or replace function gatepass.heads_pass_department(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select gatepass.app_role() = 'hod'
     and exists (
           select 1
             from gatepass.gate_passes g
            where g.id = p_pass_id
              and g.department_id in (select gatepass.my_department_ids())
         );
$fn$;

comment on function gatepass.heads_pass_department(uuid) is
  'True when the caller is an active HOD of the department this pass was raised for. The authority behind the level-0 department_hod rung (077) — routed_to names the HOD who wrote the delegation, but any HOD of the department may sign, because a department may host several (032) and one of them may be away.';

revoke all on function gatepass.heads_pass_department(uuid) from public;

-- EVERY RUNG THIS CALLER MAY ACT FOR ON THIS PASS — 072's `my_approval_roles()`
-- plus the one rung that exists only in the context of a pass. This is now the
-- authority test the two decision RPCs read.
--
-- The `department_hod` arm is gated on the ROW EXISTING as well as on the
-- caller heading the department, so an HOD's own ordinary pass — which carries
-- no such rung — grants them nothing to press.
create or replace function gatepass.my_pass_rungs(p_pass_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.role_key from gatepass.my_approval_roles() t(role_key)
  union all
  select 'department_hod'
   where gatepass.heads_pass_department(p_pass_id)
     and exists (
           select 1 from gatepass.pass_approvals a
            where a.gate_pass_id = p_pass_id
              and a.role_key = 'department_hod'
         );
$fn$;

comment on function gatepass.my_pass_rungs(uuid) is
  'Every rung of THIS pass''s ladder the caller may act for: their approval offices (072) and, on a pass raised under their authority, the level-0 department_hod rung (077). THE AUTHORITY TEST for approve_pass_level and reject_pass_level.';

revoke all on function gatepass.my_pass_rungs(uuid) from public;

-- 072's `my_acting_role`, reading the per-pass set. Everything else — the lowest
-- open rung, the escalation window, a covered office preferred on a shared rung —
-- is its, unchanged. `my_live_delegation()` never matches `department_hod`, so
-- the HOD's rung sorts as an un-delegated one and the tie-break is untouched.
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
      from gatepass.my_pass_rungs(p_pass_id) t(role_key)
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
  'Which rung of this pass the caller may decide right now — lowest pending rung, escalation window respected unless a rejection asks it not to be, a covered office preferred over their own on a shared rung. Reads my_pass_rungs (077), so the HOD''s level-0 rung is one of the answers. Null when none may.';

revoke all on function gatepass.my_acting_role(uuid, boolean) from public;

-- 061's linear visibility, matching on the per-pass set so an HOD sees a pass
-- routed to their own rung. It changes nothing for them in practice — the
-- department arm of `gate_passes_select` already admits it — and it is stated
-- because `pass_routed_to_me` is what the ladder's own name means, and a rung
-- this caller may sign that this function denies is a disagreement waiting to be
-- read as a bug.
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
       and a.role_key in (select t.role_key from gatepass.my_pass_rungs(p_pass_id) t(role_key))
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
-- 4. Raising, under somebody else's authority
-- ═══════════════════════════════════════════════════════════════════════════
-- 074's function — TEN arguments, `p_pass_number` last — with ONE arm added to
-- each of its two guards and NOTHING else changed. `create or replace` cannot
-- change an argument list, so restating 074's signature exactly is what keeps
-- this a REPLACEMENT rather than a second overload sitting beside it: two
-- candidates and PostgREST resolving between them by the argument names in the
-- request body is how half the callers would silently miss this migration.
--
-- `p_pass_number` is passed straight through to the INSERT and validated by
-- 074's `set_pass_number()` BEFORE INSERT trigger, never here. Nothing about a
-- delegated raiser changes that: the trigger checks the reservation was the
-- CALLER'S OWN, unspent, unexpired and for this same type and department, and
-- discards it otherwise.
--
-- THE DEPARTMENT IS NOT A RAISER'S TO CHOOSE. Their list is the one department
-- they were given, and this refuses any other in a sentence rather than as a
-- foreign-key violation.
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null,
  p_pass_number          text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_item           jsonb;
  v_line           int := 0;
  v_office         text;
  v_any_department boolean;
  v_raiser_depts   uuid[];
begin
  -- Read ONCE: it decides both guards AND what is stamped on the row.
  v_office         := gatepass.my_fallback_office();
  v_any_department := v_office is not null;
  -- 077: the departments an HOD has authorised this caller to raise for. Empty
  -- for everybody else, which is why every branch below reads as it did.
  v_raiser_depts   := array(select gatepass.my_raising_departments());

  if gatepass.app_role() <> 'hod'
     and not v_any_department
     and cardinality(v_raiser_depts) = 0 then
    raise exception 'Only an HOD, somebody their HOD has authorised to raise on their behalf, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_department then
    -- ANY department, but a REAL one. The `gate_passes.department_id` foreign
    -- key would refuse an invented uuid anyway; this refuses it in a sentence a
    -- person can read instead of as a constraint violation.
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif gatepass.app_role() = 'hod' then
    -- 069's arm, unmoved and tested BEFORE the raiser arm: an HOD who has also
    -- been handed somebody else's authority is still confined to the department
    -- they head.
    if p_department_id not in (select gatepass.my_department_ids()) then
      raise exception 'You can only raise a pass for a department you head.';
    end if;
  else
    -- 077: raising under an HOD's standing authority, for that HOD's department
    -- and no other. The level-0 rung is written by the snapshot trigger.
    if p_department_id <> all(v_raiser_depts) then
      raise exception 'You can only raise a pass for the department your HOD authorised you for.';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  insert into gatepass.gate_passes
    (type, direction, department_id, raised_by, raised_by_office, visitor_name,
     visitor_company, vehicle_number, purpose, expected_return_date, pass_number)
  values
    (p_type, p_direction, p_department_id, auth.uid(), v_office, p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date,
     -- Nothing is trusted about this yet; set_pass_number() decides.
     nullif(trim(coalesce(p_pass_number, '')), ''))
  returning * into v_pass;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    insert into gatepass.gate_pass_items
      (gate_pass_id, line_no, name, description, purpose, quantity, unit,
       serial_no, approx_value, expected_return_date, department_id,
       make_model, invoice_no, remarks)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none (045).
      coalesce(
        nullif(trim(coalesce(v_item ->> 'purpose', '')), ''),
        nullif(trim(coalesce(p_purpose, '')), ''),
        'Material movement'
      ),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id,
      nullif(trim(coalesce(v_item ->> 'make_model', '')), ''),
      nullif(trim(coalesce(v_item ->> 'invoice_no', '')), ''),
      nullif(trim(coalesce(v_item ->> 'remarks', '')), '')
    );
  end loop;

  return v_pass;
end;
$$;

comment on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text
) is
  'Raises a gate pass. An HOD may raise only for a department they head; a '
  'person holding an HOD''s raising authority (077) only for that HOD''s '
  'department; the sitting COO or CEO (my_fallback_office(), 071) for any '
  'department, with that office stamped onto the row. p_pass_number carries a '
  'number reserved by reserve_pass_number() (074) and is validated — not '
  'trusted — by set_pass_number(). See migrations 069, 071, 074 and 077.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The two decisions read the per-pass set
-- ═══════════════════════════════════════════════════════════════════════════
-- 072's bodies with ONE line changed in each — `my_approval_roles()` becomes
-- `my_pass_rungs(p_pass_id)` — and one sentence reworded, because "you do not
-- hold a gate pass approval office" is now the wrong thing to tell an HOD.
-- Every other refusal is made in the same order and with the same words.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles       text[] := array(select t.role_key from gatepass.my_pass_rungs(p_pass_id) t(role_key));
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
    raise exception 'You have nothing to approve on this gate pass.';
  end if;

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

  -- ONE SIGNATURE CLOSES THE RUNG (063). Level 0 has exactly one row, so this is
  -- a no-op there; it is what makes the COO's delegate signing the COO's row
  -- also discharge the CEO's.
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

create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles     text[] := array(select t.role_key from gatepass.my_pass_rungs(p_pass_id) t(role_key));
  v_role      text;
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if cardinality(v_roles) = 0 then
    raise exception 'You have nothing to reject on this gate pass.';
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
-- 6. The HOD's dropdown, and the write behind it
-- ═══════════════════════════════════════════════════════════════════════════
-- TWO PLACES, BECAUSE A DROPDOWN IS NOT A CONTROL — 066's rule. The list narrows
-- what the HOD is offered; `create_pass_raiser` refuses the same things on the
-- write, since the RPC is reachable over PostgREST by any authenticated caller
-- with a user id they typed themselves.
--
-- WHO IS ELIGIBLE, and why each exclusion is here (client, 2026-09-01: "this
-- should not be any of the department heads or CEO … it should be from his own
-- department only"):
--
--   * SAME DEPARTMENT — `profiles.department_id`, VMS's own column and the one
--     032 mirrors an HOD's assignment into. Read, never altered.
--   * NOT AN HOD — the client's words, and an HOD already raises for their own
--     department without anybody's permission.
--   * NOT AN ADMIN OR SUPER ADMIN — they hold every screen already, and 067's
--     fallback pair are super admins by office.
--   * NOT A GUARD — the person who clears material at the barrier must not
--     originate it. This is the four-eyes property `officeReplacesRole` and 069
--     both exist to protect, and it is the one exclusion the client did not name.
--   * NOT AN APPROVER of any kind — an office holder, or anybody covering one
--     under a live-or-future delegation. They would be signing a rung of a pass
--     they raised.
--   * ACTIVE (040), and not the HOD themselves.
create or replace function gatepass.list_raiser_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only a department head can authorise somebody to raise passes.';
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and p.department_id in (select gatepass.my_department_ids())
       and p.role::text not in ('hod', 'admin', 'super_admin', 'guard')
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r where r.user_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$fn$;

comment on function gatepass.list_raiser_candidates() is
  'The people an HOD may authorise to raise passes for them: active members of their own department who are not department heads, admins, guards or approvers of any kind. See migration 077.';

revoke all on function gatepass.list_raiser_candidates() from public;
grant execute on function gatepass.list_raiser_candidates() to authenticated;

-- The write. 062's shape — the HOD's own act, no admin anywhere in it.
create or replace function gatepass.create_pass_raiser(
  p_raiser_id uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dept   uuid;
  v_role   text;
  v_found  boolean := false;
  v_pdept  uuid;
  v_seat   text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only a department head can authorise somebody to raise passes.';
  end if;

  -- 032: one department per person, so this is the department. A `limit` on a
  -- unique index is a statement of that fact, not a truncation of a real set.
  select d into v_dept from gatepass.my_department_ids() d limit 1;
  if v_dept is null then
    raise exception 'You do not head a department yet, so there is nothing to hand over.';
  end if;

  if p_raiser_id is null then
    raise exception 'Choose somebody to authorise.';
  end if;

  if p_raiser_id = auth.uid() then
    raise exception 'You already raise passes for your own department.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'An authority needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The authority has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the history
  -- reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That authority would already have ended. Choose an end in the future.';
  end if;

  select true, p.role::text, p.department_id
    into v_found, v_role, v_pdept
    from public.profiles p
   where p.id = p_raiser_id;

  if not v_found then
    raise exception 'That person does not exist.';
  end if;

  if not gatepass.is_user_active(p_raiser_id) then
    raise exception 'That account is deactivated. Reactivate it first, or choose somebody else.';
  end if;

  if v_pdept is distinct from v_dept then
    raise exception 'You can only authorise somebody in your own department.';
  end if;

  -- Stated as a rule rather than as a fault: an HOD reading it has picked a real
  -- colleague and needs to know WHO is eligible, not that something went wrong.
  if v_role in ('hod', 'admin', 'super_admin') then
    raise exception 'A department head, an admin or a super admin already raises passes in their own right. Choose somebody else in your department.';
  end if;

  if v_role = 'guard' then
    raise exception 'The gate cannot raise the material it clears. Choose somebody else in your department.';
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_raiser_id;

  if v_seat is not null then
    raise exception 'That person holds the % office, so they would be signing a pass they raised.',
      gatepass.approval_office_title(v_seat);
  end if;

  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_raiser_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_seat is not null then
    raise exception 'That person is covering the % office under a delegation, so they would be signing a pass they raised.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- OVERLAP, not existence — 062's rule, and the reason `my_raising_departments`
  -- can be relied on to answer with one department. Half-open at both ends, so
  -- back-to-back windows do not collide. It is deliberately GLOBAL rather than
  -- per-HOD: two HODs authorising one person over the same days is exactly the
  -- ambiguity this refuses.
  if exists (
       select 1 from gatepass.pass_raisers r
        where r.raiser_id = p_raiser_id
          and r.revoked_at is null
          and r.starts_at < p_ends_at
          and r.ends_at   > p_starts_at
     ) then
    raise exception 'That person is already authorised to raise passes over part of that period.';
  end if;

  insert into gatepass.pass_raisers
    (hod_id, raiser_id, department_id, starts_at, ends_at, reason)
  values
    (auth.uid(), p_raiser_id, v_dept, p_starts_at, p_ends_at, v_reason)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function gatepass.create_pass_raiser(uuid, timestamptz, timestamptz, text) is
  'An HOD authorises one active member of their own department to raise gate passes on their behalf, for a stated window. Never an HOD, an admin, a guard or an approver. See migration 077.';

revoke all on function gatepass.create_pass_raiser(uuid, timestamptz, timestamptz, text) from public;
grant execute on function gatepass.create_pass_raiser(uuid, timestamptz, timestamptz, text) to authenticated;

-- End one early. NOT a delete — the row stays in the history saying who was
-- authorised and that it was stopped before its time. The passes already raised
-- under it keep their level-0 rung, which is the whole point of snapshotting.
create or replace function gatepass.revoke_pass_raiser(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hod uuid;
begin
  select r.hod_id into v_hod from gatepass.pass_raisers r where r.id = p_id;

  if v_hod is null then
    raise exception 'That authority does not exist.';
  end if;

  if v_hod <> auth.uid() then
    raise exception 'Only the department head who wrote this authority can revoke it.';
  end if;

  update gatepass.pass_raisers
     set revoked_at = now(),
         revoked_by = auth.uid()
   where id = p_id
     and revoked_at is null;
end;
$fn$;

revoke all on function gatepass.revoke_pass_raiser(uuid) from public;
grant execute on function gatepass.revoke_pass_raiser(uuid) to authenticated;

-- Everything this HOD has ever authorised, newest first. `status` is DERIVED
-- (062's `delegation_status`), never stored — this schema has no scheduler and
-- ages nothing.
create or replace function gatepass.list_my_pass_raisers()
returns table (
  id              uuid,
  raiser_id       uuid,
  raiser_name     text,
  department_name text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  reason          text,
  revoked_at      timestamptz,
  status          text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id,
         r.raiser_id,
         p.full_name,
         d.name,
         r.starts_at,
         r.ends_at,
         r.reason,
         r.revoked_at,
         gatepass.delegation_status(r.revoked_at, r.starts_at, r.ends_at),
         r.created_at
    from gatepass.pass_raisers r
    left join public.profiles    p on p.id = r.raiser_id
    left join public.departments d on d.id = r.department_id
   where r.hod_id = auth.uid()
   order by r.created_at desc;
$fn$;

comment on function gatepass.list_my_pass_raisers() is
  'Every raising authority this HOD has written, live, scheduled, expired or revoked. See migration 077.';

revoke all on function gatepass.list_my_pass_raisers() from public;
grant execute on function gatepass.list_my_pass_raisers() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The reference number, for a raiser too
-- ═══════════════════════════════════════════════════════════════════════════
-- 074's `reserve_pass_number` hands the Raise form the REAL number the pass will
-- carry, and its guard is a verbatim copy of `raise_pass`'s — "a reservation is
-- the first half of raising and must not be obtainable by somebody who could not
-- go on to submit it". So the two have to move together: without this, a raiser
-- is REFUSED a reservation and the form falls back to the `RGP-IT-####`
-- placeholder while the submit itself succeeds — a screen quietly telling one
-- reader less than it tells everybody else.
--
-- The guard below is 077's `raise_pass` guard, arm for arm and sentence for
-- sentence. Everything under it — the advisory lock, the sweep, the serial and
-- the twelve-hour reservation — is 074's, untouched.
create or replace function gatepass.reserve_pass_number(
  p_type          gatepass.pass_type,
  p_department_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix       text;
  v_number       text;
  v_office       text;
  v_any_dept     boolean;
  v_raiser_depts uuid[];
begin
  v_office       := gatepass.my_fallback_office();
  v_any_dept     := v_office is not null;
  v_raiser_depts := array(select gatepass.my_raising_departments());

  if gatepass.app_role() <> 'hod'
     and not v_any_dept
     and cardinality(v_raiser_depts) = 0 then
    raise exception 'Only an HOD, somebody their HOD has authorised to raise on their behalf, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_dept then
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif gatepass.app_role() = 'hod' then
    if p_department_id not in (select gatepass.my_department_ids()) then
      raise exception 'You can only raise a pass for a department you head.';
    end if;
  else
    if p_department_id <> all(v_raiser_depts) then
      raise exception 'You can only raise a pass for the department your HOD authorised you for.';
    end if;
  end if;

  v_prefix := p_type::text || '-' || gatepass.dept_code(p_department_id);

  -- The same lock, on the same string, that set_pass_number takes. Held to the
  -- end of the transaction, so the read and the insert below cannot interleave
  -- with another reserver or with a pass being raised.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('gatepass_pass_number_' || v_prefix)
  );

  -- SWEEP FIRST, so an abandoned form's number is back in the pool before we
  -- count. Scoped to this prefix: there is no reason to touch another
  -- department's rows while holding only this department's lock, and doing so
  -- would deadlock two reservers working on different prefixes.
  delete from gatepass.pass_number_reservations
   where consumed_at is null
     and expires_at <= now()
     and type = p_type
     and department_id = p_department_id;

  v_number := v_prefix || '-' || lpad(gatepass.next_pass_serial(v_prefix)::text, 4, '0');

  insert into gatepass.pass_number_reservations
    (pass_number, type, department_id, reserved_by, expires_at)
  values
    (v_number, p_type, p_department_id, auth.uid(), now() + interval '12 hours');

  return v_number;
end;
$$;

comment on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) is
  'Hands the caller the real pass number their next pass will carry (074), so '
  'the Raise form can show it in full. Same authorisation as raise_pass, which '
  'since 077 includes a person their HOD authorised to raise. Good for 12 '
  'hours; release_pass_number() gives it back.';

revoke all on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) from public;
grant execute on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 063 — the ladder is Security Head → Finance HOD → COO *or* CEO, and the CEO
--       only becomes able to sign once the COO has sat on it long enough
--
-- Client, 2026-08-22:
--
--   "there's a little bit of a change in the approval workflow so Level one
--    approver will be the security head. Level two approver will be the finance
--    head and level three approval approver will be either co or CEO. If the
--    [COO] has given the approval then it will not go to the CEO. I think if the
--    [COO] has not given the approval within one or two days then it will
--    escalate to CEO."
--
-- ── 1. THE ORDER. ───────────────────────────────────────────────────────────
-- 057 numbered it Security Head 1 · COO 2 · Finance HOD 3 · CEO 4. Finance now
-- signs SECOND, and the COO and the CEO SHARE level 3. The paper moves with it
-- (`src/pages/Shared/printSignatureBoxes.ts`) and so does `APPROVAL_LADDER` in
-- `src/lib/approvalLadder.ts` — the order is one fact stated in three places
-- and they move together, or a guard comparing the slip in their hand to the
-- record on the tablet finds a level on one that is missing from the other.
--
-- THE EXISTING ROWS ARE RENUMBERED, on 057's own precedent and for its reason:
-- `level_no` is not an audit fact, it is the ORDER the remaining signatures are
-- collected in. Who signed and when is untouched.
--
-- ── 2. TWO OFFICES ON ONE RUNG. ─────────────────────────────────────────────
-- Level 3 is ONE signature that either of two offices may give. Both rows are
-- still snapshotted, because both offices must be able to READ the pass (061
-- grades visibility on the levels BELOW a row, so a shared level lets both see
-- it) and because the record has to be able to say afterwards which of the two
-- actually signed.
--
-- SO A NEW STATUS: `not_required`. When one of the two signs, the other's
-- pending row is closed as `not_required` in the same statement — nobody signed
-- it, so `decided_by` stays NULL, and the sentence in `reason` says which
-- office made it unnecessary. That is the client's "if the COO has given the
-- approval then it will not go to the CEO", recorded rather than implied.
--
-- ⚠ IT IS NOT `approved`, AND THAT IS THE WHOLE POINT OF THE NEW LABEL. An
-- `approved` row with no author is what 058 had to invent `grandfathered` for,
-- and it prints a tick against an office that never pressed anything. The
-- printed slip now draws a TICK BOX per office (client, same message), so the
-- difference between "signed" and "did not have to sign" is ink on paper that
-- leaves the building.
--
-- `pass_awaits_approval` is untouched and needs to be: it tests `pending`, so a
-- `not_required` row stops blocking the gate the moment it is written.
--
-- ── 3. THE ESCALATION. ──────────────────────────────────────────────────────
-- The CEO may not sign level 3 while the COO still can, until the pass has sat
-- on that rung for `app_settings.coo_escalation_hours` (default 48 — the client
-- said "one or two days", and this is the field that settles it without a
-- migration). Until then the CEO sees the pass, reads it in full, and is told
-- on screen when it becomes theirs.
--
-- WHEN DID IT REACH THE RUNG? The moment the level below it was approved —
-- `max(decided_at)` over the approved rows beneath, falling back to the pass's
-- own `created_at` for a pass whose level 3 is its first rung. Never `now()`
-- minus something, and never a column somebody could write.
--
-- ⚠ NOTHING SENDS THE CEO A LETTER WHEN THE WINDOW ELAPSES, and nothing can:
-- there is no scheduler on this deployment (no pg_cron — the same reason expiry
-- is derived at query time and never stamped). The escalation is DERIVED at
-- read time, so it is true the moment it is true on every screen that asks; the
-- CEO learns of it by opening their queue, not by being told. Making it a push
-- means a cron job, and that is a deployment decision, not this migration's.
--
-- ⚠ A REJECTION IS NEVER ESCALATION-GATED. The ceiling on a delegate (062) is
-- the same call: a limit caps what somebody may COMMIT the business to, and
-- refusing to let an office STOP a pass points the rule exactly the wrong way.
-- The CEO may reject level 3 at any time it is the lowest pending rung.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. How long the COO gets
-- ═══════════════════════════════════════════════════════════════════════════
-- 056's table, one column. NOT NULL with a default, like `require_approver_2fa`
-- and unlike the two nullable ones: "nobody has decided yet" and "48 hours" are
-- the same thing here, and a null would invite a three-state read of a rule the
-- RPC has to answer with a number.
alter table gatepass.app_settings
  add column if not exists coo_escalation_hours smallint not null default 48;

alter table gatepass.app_settings
  drop constraint if exists app_settings_escalation_window;

alter table gatepass.app_settings
  add constraint app_settings_escalation_window
  check (coo_escalation_hours between 1 and 720);

comment on column gatepass.app_settings.coo_escalation_hours is
  'Hours the COO has to decide level 3 before the CEO may sign it instead (063). One hour to thirty days; the client asked for "one or two days" and 48 is the default.';

-- Readable by ANY signed-in user, and deliberately so — the same argument
-- `get_session_timeout` (056) makes. The CEO's own screen has to be able to say
-- when a pass becomes theirs, and an approver holding a pass is not an admin.
-- It leaks one integer and no other field.
create or replace function gatepass.get_escalation_hours()
returns smallint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           (select s.coo_escalation_hours from gatepass.app_settings s where s.id),
           48::smallint);
$fn$;

grant execute on function gatepass.get_escalation_hours() to authenticated;

-- 056's getter and setter, each with ONE field added. The setter is DROPPED
-- first: a 4-arg and a 5-arg overload both reachable by named arguments is
-- exactly the ambiguity PostgREST guesses at (045's lesson), so the old
-- signature must not survive this migration.
create or replace function gatepass.get_app_settings()
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
    raise exception 'Only an admin can read the application settings.';
  end if;

  select jsonb_build_object(
           'app_name',                s.app_name,
           'brand_color',             s.brand_color,
           'require_approver_2fa',    s.require_approver_2fa,
           'session_timeout_minutes', s.session_timeout_minutes,
           'coo_escalation_hours',    s.coo_escalation_hours,
           'updated_at',              s.updated_at,
           'updated_by_name',         p.full_name
         )
    into v
    from gatepass.app_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  return coalesce(v, jsonb_build_object(
           'require_approver_2fa', false,
           'coo_escalation_hours', 48));
end;
$fn$;

grant execute on function gatepass.get_app_settings() to authenticated;

drop function if exists gatepass.set_app_settings(text, text, boolean, int);

create function gatepass.set_app_settings(
  p_app_name                text,
  p_brand_color             text,
  p_require_approver_2fa    boolean,
  p_session_timeout_minutes int,
  p_coo_escalation_hours    int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := nullif(btrim(coalesce(p_app_name, '')), '');
  v_color text := nullif(btrim(coalesce(p_brand_color, '')), '');
  v_esc   int  := coalesce(p_coo_escalation_hours, 48);
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the application settings.';
  end if;

  if v_name is not null and length(v_name) > 40 then
    raise exception 'The application name has to be 40 characters or fewer.';
  end if;

  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'A brand colour has to be a six-digit hex code, like #C6A15B.';
  end if;

  if p_session_timeout_minutes is not null
     and (p_session_timeout_minutes < 5 or p_session_timeout_minutes > 1440) then
    raise exception 'The sign-out timer has to be between 5 minutes and 24 hours.';
  end if;

  if v_esc < 1 or v_esc > 720 then
    raise exception 'The COO escalation window has to be between 1 hour and 30 days.';
  end if;

  insert into gatepass.app_settings as a (
    id, app_name, brand_color, require_approver_2fa, session_timeout_minutes,
    coo_escalation_hours, updated_by, updated_at
  )
  values (
    true, v_name, v_color, coalesce(p_require_approver_2fa, false), p_session_timeout_minutes,
    v_esc, auth.uid(), now()
  )
  on conflict (id) do update
    set app_name                = excluded.app_name,
        brand_color             = excluded.brand_color,
        require_approver_2fa    = excluded.require_approver_2fa,
        session_timeout_minutes = excluded.session_timeout_minutes,
        coo_escalation_hours    = excluded.coo_escalation_hours,
        updated_by              = excluded.updated_by,
        updated_at              = excluded.updated_at;

  return gatepass.get_app_settings();
end;
$fn$;

grant execute on function gatepass.set_app_settings(text, text, boolean, int, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Finance signs second, and level 3 belongs to two offices
-- ═══════════════════════════════════════════════════════════════════════════
-- The constraint comes off first: it pins level_no to role_key row by row, so
-- no single UPDATE can satisfy both mappings at once (057's note).
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_level_matches;

update gatepass.pass_approvals set level_no = 2 where role_key = 'finance_head';
update gatepass.pass_approvals set level_no = 3 where role_key in ('coo', 'ceo');

alter table gatepass.pass_approvals
  add constraint pass_approvals_level_matches
  check (level_no = case role_key
                      when 'security_head' then 1
                      when 'finance_head'  then 2
                      when 'coo'           then 3
                      when 'ceo'           then 3
                    end);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. `not_required` — the rung the other office never had to sign
-- ═══════════════════════════════════════════════════════════════════════════
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_status_known;

alter table gatepass.pass_approvals
  add constraint pass_approvals_status_known
  check (status in ('pending', 'approved', 'rejected', 'not_required'));

-- 058's shape, with ONE arm added. A `not_required` row has a MOMENT (the
-- decision that made it unnecessary happened at a real time) and a SENTENCE
-- (which office signed instead), and deliberately NO AUTHOR: nobody decided it,
-- and a `decided_by` here would print a name against a signature that was never
-- given.
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_decision_shape;

alter table gatepass.pass_approvals
  add constraint pass_approvals_decision_shape
  check (
    (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
    -- 058's two approval arms, verbatim: the rollout is approved, stamped and
    -- authored by nobody; an ordinary approval has a real author.
    or (status = 'approved' and grandfathered and decided_by is null and decided_at is not null)
    or (status = 'approved' and not grandfathered and decided_by is not null and decided_at is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null
        and length(btrim(coalesce(reason, ''))) between 1 and 500)
    or (status = 'not_required' and decided_by is null and decided_at is not null
        and length(btrim(coalesce(reason, ''))) between 1 and 500)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The snapshot, renumbered
-- ═══════════════════════════════════════════════════════════════════════════
-- 057's function with the new mapping and nothing else changed: still a trigger
-- rather than a line inside `raise_pass`, still skipping a vacant office, still
-- freezing what a pass owes on the day it is raised. `create or replace` keeps
-- the existing trigger bound to it — dropping and recreating would open a
-- window in which an insert snapshots nothing at all.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. When does this rung become the CEO's?
-- ═══════════════════════════════════════════════════════════════════════════
-- Null unless the office asked about is genuinely waiting behind another one on
-- the same level. So: null for every office but the CEO, null on a pass with no
-- pending COO row (a vacant COO office was never snapshotted, and the CEO is
-- then the only holder of level 3 and may sign at once), and null again once
-- the sibling row has been decided either way.
--
-- SECURITY DEFINER because it reads `pass_approvals`, which is what the policy
-- on that table would otherwise recurse through (42P17, 046's note).
create or replace function gatepass.level_escalates_at(p_pass_id uuid, p_role_key text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
           when p_role_key <> 'ceo' then null
           when not exists (
                  select 1 from gatepass.pass_approvals c
                   where c.gate_pass_id = p_pass_id
                     and c.role_key = 'coo'
                     and c.status = 'pending'
                ) then null
           else (
             select coalesce(
                      (select max(b.decided_at)
                         from gatepass.pass_approvals b
                        where b.gate_pass_id = a.gate_pass_id
                          and b.level_no < a.level_no
                          and b.status = 'approved'),
                      g.created_at
                    ) + make_interval(hours => gatepass.get_escalation_hours()::int)
               from gatepass.pass_approvals a
               join gatepass.gate_passes g on g.id = a.gate_pass_id
              where a.gate_pass_id = p_pass_id
                and a.role_key = 'ceo'
                and a.status = 'pending'
           )
         end;
$fn$;

grant execute on function gatepass.level_escalates_at(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Approving, with the shared rung and the escalation window
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function — the delegation ceiling and the deputy flag are its, verbatim
-- — with TWO things added and nothing removed:
--
--   * the CEO is refused while the COO's window is still open, in a sentence
--     that names the moment rather than leaving them to guess;
--   * the sibling row on the same level is closed as `not_required` in the same
--     transaction as the signature that made it unnecessary.
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
  v_as_deputy   boolean;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. `get_pass_approvals` IS DELIBERATELY UNTOUCHED
-- ═══════════════════════════════════════════════════════════════════════════
-- It already returns `status`, so a `not_required` rung reaches the record and
-- the printed slip with no signature change at all. The escalation MOMENT is
-- not added to it on purpose: the approver's queue reads `pass_approvals` in
-- one query across every pass and could not use a per-pass function's column,
-- so the screens derive the moment once in `src/lib/approvalDecision.ts` from
-- the rows they already hold plus `get_escalation_hours()`. Returning it here
-- as well would be the same rule computed in two places — and this one is only
-- ever DISPLAY. `approve_pass_level` above is what enforces it, and it calls
-- `level_escalates_at` itself.

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. A closed rung below me is a rung that has passed
-- ═══════════════════════════════════════════════════════════════════════════
-- 061's predicate, with `not_required` counted alongside `approved`. It cannot
-- matter today — only level 3 has two offices on it and nothing sits above it —
-- but a shared rung LOWER down would otherwise hide the pass from every office
-- above it for ever, which is the failure mode 061 exists to make impossible.
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
       and a.role_key = gatepass.my_approval_role()
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status not in ('approved', 'not_required')
       )
  );
$fn$;

notify pgrst, 'reload schema';

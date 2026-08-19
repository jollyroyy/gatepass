-- ============================================================================
-- 046 — the approval ladder becomes a WORKFLOW, and the gate stops seeing
--       passes that have not climbed it
--
-- 043 gave the four offices between the issuing HOD and the gate — Security
-- Head, COO, CEO, Finance Head — a name each, and said in its own header that
-- it was an ORG CHART and not a workflow: "nothing here gates the gate". The
-- client has now asked for the other half. 2026-08-19:
--
--   * an admin creates a CEO / Finance / COO / Security Head user like any
--     other user;
--   * that person signs in and gets a Pending Approvals screen — the passes
--     waiting on their signature, with Approve and Reject (Reject takes a
--     written reason);
--   * "the guard cannot see any partially approved or unapproved gate passes.
--     He can only see when all four approvals have been done."
--
-- THE LAST SENTENCE IS THE WHOLE MIGRATION. It is not a screen filter — it is
-- RLS. `gate_passes_select` is rewritten so that for a `guard` a pass that
-- still owes a signature does not exist: not in the Pending OUT queue, not in
-- a search, not behind a scanned QR code, not at `/pass/<uuid>` typed by hand.
-- A trigger on gate_passes says the same thing a second time, because
-- `match_pass` is SECURITY DEFINER and would otherwise bypass every policy
-- here.
--
-- WHAT IS SNAPSHOTTED, AND WHY. An AFTER INSERT trigger writes one
-- `pass_approvals` row per office that is DESIGNATED AT THE MOMENT THE PASS IS
-- RAISED. Two consequences, both deliberate:
--
--   * a vacant office is skipped and never appears on that pass again, which
--     is the rollout: `approval_roles` is empty on this database today, so
--     every pass raised before an admin designates anybody needs no approval
--     at all and reaches the gate exactly as it does now. The 60 live passes
--     are grandfathered by the same rule — no backfill, no data migration;
--   * designating a new CEO tomorrow does NOT reopen a pass that already
--     cleared. A pass's requirements are frozen the day it is raised, which is
--     what makes "approved" mean something a week later.
--
-- IT IS A TRIGGER, NOT A CHANGE TO `raise_pass`. Every insert path gets it —
-- `raise_pass`, `bulk_create_passes`, anything added later — and no future
-- rewrite of the raise RPC can quietly drop it by forgetting a line.
--
-- AUTHORITY FOLLOWS THE OFFICE, NOT THE PERSON. `routed_to` records who held
-- the office on the day, for the record; who may actually press Approve is
-- resolved from `approval_roles` at the moment of the press. A CEO who leaves
-- does not take a queue of undecided passes with them.
--
-- REJECTION IS TERMINAL, and it reuses the shape 027 already built for an HOD
-- upholding a security flag: the pass goes to `cancelled`, a `verifications`
-- row records who and why, and nothing about it can move again. A raised pass
-- is permanent in this app (024) — it is closed, never deleted, and the HOD
-- raises a fresh one.
--
-- HOW AN APPROVER SIGNS IN. `public.profiles.role` is VMS's enum and this app
-- does not add to it (the two-schema rule), so an office holder is created as
-- `staff` — the VMS role for "does not use VMS" — and the row in
-- `gatepass.approval_roles` is what grants them everything they get here: the
-- route, the queue, and the two policies below. Nothing about VMS changes, and
-- an office holder gains no ability to raise, verify or return anything.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. One row per signature a pass owes
-- ═══════════════════════════════════════════════════════════════════════════
-- Keyed (gate_pass_id, role_key): an office signs a pass at most once, so
-- "has the COO approved this?" has exactly one answer and no ordering decides
-- it. `level_no` is stored rather than derived so the slip order is frozen
-- alongside the requirement — and the check keeps the two from disagreeing.
--
-- `routed_to` is ON DELETE SET NULL, unlike approval_roles' RESTRICT: this is a
-- historical note about a decision, and a pass must not become undeletable-
-- adjacent because the person who once held an office was removed.
create table if not exists gatepass.pass_approvals (
  gate_pass_id uuid        not null references gatepass.gate_passes(id) on delete cascade,
  role_key     text        not null,
  level_no     smallint    not null,
  routed_to    uuid        references public.profiles(id) on delete set null,
  status       text        not null default 'pending',
  decided_by   uuid        references public.profiles(id) on delete set null,
  decided_at   timestamptz,
  reason       text,
  created_at   timestamptz not null default now(),

  primary key (gate_pass_id, role_key),

  -- The same four offices 043 knows, restated because a foreign key to
  -- approval_roles would delete a pass's history when an office is vacated.
  constraint pass_approvals_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head')),

  constraint pass_approvals_level_matches
    check (level_no = case role_key
                        when 'security_head' then 1
                        when 'coo'           then 2
                        when 'ceo'           then 3
                        when 'finance_head'  then 4
                      end),

  constraint pass_approvals_status_known
    check (status in ('pending', 'approved', 'rejected')),

  -- A decision has an author and a moment, and a rejection has a reason a
  -- person wrote. Checked here and not only in the RPC, because a row with
  -- status 'rejected' and no reason is a rejection nobody can answer.
  constraint pass_approvals_decision_shape
    check (
      (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
      or (status = 'approved' and decided_by is not null and decided_at is not null)
      or (status = 'rejected' and decided_by is not null and decided_at is not null
          and length(btrim(coalesce(reason, ''))) between 1 and 500)
    )
);

-- The queue read: "everything my office still owes a signature on".
create index if not exists pass_approvals_queue_idx
  on gatepass.pass_approvals (role_key, status);

alter table gatepass.pass_approvals enable row level security;

-- READABLE BY WHOEVER CAN READ THE PASS, the rule 044 established for remarks
-- and for the same reason: restating `gate_passes_select` here in a second form
-- is how the two drift apart. `can_see_pass` (044) is SECURITY INVOKER, so the
-- pass policy below decides — and the approver arm of that policy reaches this
-- table through a SECURITY DEFINER function, which is what stops the two
-- policies recursing into each other (42P17).
drop policy if exists pass_approvals_select_with_pass on gatepass.pass_approvals;
create policy pass_approvals_select_with_pass
  on gatepass.pass_approvals for select to authenticated
  using (gatepass.can_see_pass(gate_pass_id));

-- No insert/update/delete policy anywhere: the trigger and the two RPCs below
-- are the only writers, exactly as gate_passes itself works.
grant select on gatepass.pass_approvals to authenticated;

comment on table gatepass.pass_approvals is
  'One row per office a pass must be signed off by, snapshotted from gatepass.approval_roles when the pass is raised. A pending row hides the pass from the gate.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Snapshotting the ladder onto a new pass
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because nobody — not even the HOD raising the pass — holds
-- INSERT on pass_approvals, which is the point of the table.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id,
         r.role_key,
         (case r.role_key
            when 'security_head' then 1
            when 'coo'           then 2
            when 'ceo'           then 3
            when 'finance_head'  then 4
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$$;

drop trigger if exists gate_passes_snapshot_approvals on gatepass.gate_passes;
create trigger gate_passes_snapshot_approvals
  after insert on gatepass.gate_passes
  for each row execute function gatepass.snapshot_pass_approvals();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The three questions every policy below asks
-- ═══════════════════════════════════════════════════════════════════════════
-- Which office, if any, does the caller hold? A SUSPENDED holder holds none:
-- `is_user_active` (040) is the same gate `my_department_ids` applies to an
-- HOD, so deactivating an approver empties their queue rather than leaving
-- passes addressed to somebody who cannot sign in.
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
     and gatepass.is_user_active(auth.uid());
$$;

-- Is this pass still climbing the ladder? A pass that has left `pending` has
-- either cleared the gate or been closed, and a stray undecided row on it must
-- not make it invisible for ever.
create or replace function gatepass.pass_awaits_approval(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gatepass.pass_approvals a
      join gatepass.gate_passes g on g.id = a.gate_pass_id
     where a.gate_pass_id = p_pass_id
       and a.status = 'pending'
       and g.status = 'pending'
  );
$$;

-- Is this pass addressed to the office I hold — at any status, so an approver
-- can still read what they signed last week.
create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key = gatepass.my_approval_role()
  );
$$;

grant execute on function gatepass.my_approval_role()          to authenticated;
grant execute on function gatepass.pass_awaits_approval(uuid)  to authenticated;
grant execute on function gatepass.pass_routed_to_me(uuid)     to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE GATE STOPS SEEING AN UNAPPROVED PASS
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces 002's policy. Four arms, and the second one is the client's rule:
--
--   admin      everything, at every stage. Somebody has to be able to see a
--              pass stuck at level 2, and it is not the guard.
--   guard      everything EXCEPT a pass still owing a signature. Not a filter
--              in a query — a pass that owes one is not in the table as far as
--              a guard is concerned.
--   hod        their own department's passes, at every stage, unchanged. The
--              HOD who raised it must be able to watch it climb.
--   approver   passes addressed to the office they hold. This is the ONLY read
--              an office holder gets: no department, no site, no history that
--              was never routed to them.
--
-- `is_security()` is deliberately NOT used here any more — it means
-- guard-or-admin, and those two now differ. It is untouched elsewhere.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select
  on gatepass.gate_passes for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(id)
  );

-- The material lines follow the pass exactly. An approver reads them because
-- the queue screen opens a row to show what is actually going out — approving
-- a pass without being able to see its contents is a signature on a blank page.
drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select
  on gatepass.gate_pass_items for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(gate_pass_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. …and a trigger says it again, because RLS is not in the room
-- ═══════════════════════════════════════════════════════════════════════════
-- `match_pass`, `flag_pass` and every other state transition is SECURITY
-- DEFINER and bypasses section 4 entirely. Without this, a guard who somehow
-- learned a pass id could still clear it out of the building. The policy hides
-- it; this refuses it.
--
-- 'cancelled' is deliberately absent from the list: rejection (section 7) moves
-- a still-climbing pass to exactly that state, and must not be refused by the
-- rule protecting it.
create or replace function gatepass.block_unapproved_gate_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and old.status = 'pending'
     and new.status in ('matched', 'flagged', 'held')
     and gatepass.pass_awaits_approval(old.id) then
    raise exception 'This gate pass has not been approved by every level yet.';
  end if;

  return new;
end;
$$;

drop trigger if exists gate_passes_block_unapproved on gatepass.gate_passes;
create trigger gate_passes_block_unapproved
  before update on gatepass.gate_passes
  for each row execute function gatepass.block_unapproved_gate_move();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Reading a pass's ladder, with names
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the join into `public.profiles` only — the rows are
-- already gated by `can_see_pass`, the same predicate the policy applies. LEFT
-- JOINs for the reason the pass view uses them: VMS may narrow its policies
-- without notice, and a missing name is visibly wrong where a missing LEVEL is
-- invisibly wrong.
create or replace function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key     text,
  level_no     smallint,
  status       text,
  routed_name  text,
  decided_name text,
  decided_at   timestamptz,
  reason       text
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
           a.reason
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Approving, and rejecting
-- ═══════════════════════════════════════════════════════════════════════════
-- IN SLIP ORDER. The caller's row must be the LOWEST still-pending level on
-- the pass, which is what "Security Head → COO → CEO → Finance Head" means. A
-- vacant office was never snapshotted, so it is skipped rather than blocking:
-- with only the CEO designated, the CEO is level 1 in practice.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text := gatepass.my_approval_role();
  v_mine    smallint;
  v_lowest  smallint;
  v_status  text;
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

  update gatepass.pass_approvals a
     set status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now()
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

-- REJECTION CLOSES THE PASS, the shape 027 built for an HOD upholding a flag:
-- status 'cancelled', a `verifications` row carrying who and why, and no way
-- back. The reason is the client's own field — the modal's "Reason for
-- Rejection", 500 characters — and it is required at both ends.
--
-- The remaining pending levels are left exactly as they are rather than being
-- back-filled with an invented state: nobody below signed anything, and the
-- record should not claim otherwise. They stay out of every queue because the
-- pass itself is no longer `pending`.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text := gatepass.my_approval_role();
  v_mine   smallint;
  v_lowest smallint;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
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

  update gatepass.pass_approvals a
     set status     = 'rejected',
         decided_by = auth.uid(),
         decided_at = now(),
         reason     = v_reason
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

revoke all on function gatepass.approve_pass_level(uuid)      from public;
revoke all on function gatepass.reject_pass_level(uuid, text) from public;
grant execute on function gatepass.approve_pass_level(uuid)      to authenticated;
grant execute on function gatepass.reject_pass_level(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The scanner says what is actually wrong
-- ═══════════════════════════════════════════════════════════════════════════
-- `lookup_pass` is SECURITY DEFINER and reads gate_passes directly, so section
-- 4 does not reach it. Without this branch a guard scanning a slip that is
-- still climbing the ladder would be told 'not_found' — which is untrue, and
-- sends them looking for a typo instead of telling the driver to wait.
--
-- `pass_id` is returned NULL on that outcome ON PURPOSE: the screen opens the
-- record for any outcome carrying an id, and this is precisely the pass a guard
-- may not read. Restated from 033's version; the blacklist logic, the scan
-- log and the expiry rule are unchanged.
create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid, blacklist_match text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_code           text := trim(coalesce(p_code, ''));
  v_uuid           uuid;
  v_outcome        text;
  v_blacklist_item record;
  v_blacklist_text text := null;
  v_visible_id     uuid;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can scan a gate pass.';
  end if;

  if v_code = '' then
    raise exception 'Nothing was scanned.';
  end if;

  begin
    v_uuid := v_code::uuid;
  exception when invalid_text_representation then
    v_uuid := null;
  end;

  if v_uuid is not null then
    select * into v_pass from gatepass.gate_passes where qr_token = v_uuid;
  else
    select * into v_pass from gatepass.gate_passes where pass_number = upper(v_code);
  end if;

  if not found then
    v_outcome := 'not_found';
  elsif gatepass.pass_awaits_approval(v_pass.id) then
    v_outcome := 'awaiting_approval';
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_value is not null
            and lower(trim(b.list_value))
                = lower(trim(gatepass.company_name_of(v_pass.visitor_company))))
        or (b.list_type = 'vehicle'
            and gatepass.normalize_vehicle(b.list_value)
                = gatepass.normalize_vehicle(v_pass.vehicle_number))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  -- The scan is logged against the real pass either way — the attempt happened,
  -- and a gate log that omits the ones it turned away is not a gate log.
  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  v_visible_id := case when v_outcome = 'awaiting_approval' then null else v_pass.id end;

  return query select v_outcome, v_visible_id, v_blacklist_text;
end;
$$;

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Creating an approver from Admin → Users
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 040's version. ONE difference: `p_role` now also accepts the
-- four office keys, and an office holder is created as VMS `staff` and
-- designated in `gatepass.approval_roles` in the same transaction.
--
-- `staff` is not a demotion here — it is the honest value. VMS's enum has no
-- word for "signs gate passes", this app must not add one (the two-schema
-- rule), and every ability the person actually gets comes from the
-- approval_roles row. Which is also why `raw_app_meta_data.role` is written as
-- `staff` too: `app_role()` reads it, and a value VMS has never seen appearing
-- in a field VMS also reads is exactly the drift that rule exists to prevent.
--
-- AN OFFICE HAS ONE HOLDER. `approval_roles` is keyed by role_key, so creating
-- a second CEO MOVES the office rather than adding one — the upsert is the same
-- one `set_approval_role` (043) performs, and the admin screen says so out loud
-- before the press.
create or replace function gatepass.admin_create_user(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           text,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid;
  v_now          timestamptz := now();
  v_dept         uuid;
  v_office       text := null;
  v_profile_role text := p_role;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  if p_role in ('security_head', 'coo', 'ceo', 'finance_head') then
    v_office       := p_role;
    v_profile_role := 'staff';
  elsif p_role not in ('guard', 'hod') then
    raise exception 'Invalid role "%". Allowed: guard, hod, security_head, coo, ceo, finance_head.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- confirmation_token / recovery_token / email_change / email_change_token_new
  -- are written as '' and MUST stay in this list: they are nullable with no
  -- default, and GoTrue cannot scan a NULL into its Go string field — omitting
  -- them makes the account unable to sign in at all (034).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now, v_now,
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', v_profile_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = v_profile_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', v_profile_role)
  where id = v_user_id;

  if v_profile_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  if v_office is not null then
    insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
    values (v_office, v_user_id, auth.uid(), v_now)
    on conflict (role_key) do update
      set user_id       = excluded.user_id,
          designated_by = excluded.designated_by,
          designated_at = excluded.designated_at;
  end if;

  -- `role` echoes what the ADMIN ASKED FOR, not the VMS row that was written:
  -- the caller pressed "CEO" and a reply of "staff" would read as a failure.
  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

revoke all on function gatepass.admin_create_user(text, text, text, text, uuid[]) from public;
grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;

-- PostgREST caches function signatures and table shapes; a new table and two
-- new RPCs are invisible to it until it is told.
notify pgrst, 'reload schema';

-- ============================================================================
-- 055 — EMERGENCY RELEASE: a super admin can clear a stuck ladder, in writing,
--       and a different admin has to review it afterwards
--
-- THE QUESTION THIS ANSWERS. 046 made the ladder mandatory and 054 gave every
-- office a standing deputy, so an absent approver is covered. What is still not
-- covered is nobody being reachable at all — a Sunday night, a power cut, four
-- people on one flight — while a truck waits at the barrier. Before this
-- migration the only route was an admin re-pointing offices one by one on the
-- ladder card, which grants real authority to whoever is to hand, leaves that
-- grant standing afterwards, and records nothing about why any of it happened.
-- That is a worse outcome than a documented override, which is the whole
-- argument for this migration existing.
--
-- WHAT THIS IS MODELLED ON. SAP GRC's Emergency Access Management (Firefighter)
-- is the reference implementation, and stripped of its enterprise scaffolding
-- it is exactly four things: a small PRE-NAMED pool who may invoke it, a
-- WRITTEN REASON captured at the moment of use, a NATURAL END, and MANDATORY
-- REVIEW BY SOMEBODY WHO WAS NOT THE ACTOR. NIST SP 800-53 (AC-2, AU-6), ISO
-- 27001:2022 A.8.2 and SOX/COSO on "management override of controls" all land
-- on the same four. Here they are, in order:
--
--   1. THE POOL is `super_admin`, checked inline. 039 (`set_ceo_approver`) is
--      the only other place in this schema that demands more than `is_admin()`,
--      and it is the precedent this follows deliberately: an ordinary admin can
--      already create users and reset passwords, so gating on `is_admin()`
--      would hand the whole ladder to the same group that administers it.
--   2. THE REASON is NOT NULL, 10–500 characters, and is copied onto every
--      level it clears. Ten rather than one because "ok", "." and "asap" are
--      not reasons, and this column is the entire defence if the release is
--      ever questioned.
--   3. THE END is inherent: this releases ONE pass, once. There is no elevated
--      session to expire, nothing to un-grant, and no standing permission
--      created — which is precisely why it is safer than the re-designation it
--      replaces.
--   4. THE REVIEW is `review_emergency_release`, and it REFUSES the person who
--      invoked it. That refusal is the control; everything else is bookkeeping.
--      Without it this is not an override, it is a bypass.
--
-- ⚠ WHY THIS DOES NOT TOUCH `gate_passes.status`, and it matters. The pass stays
--   `pending`. Clearing the pending `pass_approvals` rows makes
--   `pass_awaits_approval()` false, and from that instant the pass behaves like
--   any other approved one: the guard can SEE it (046's `gate_passes_select`),
--   `lookup_pass` stops answering `awaiting_approval`, and `match_pass` works
--   normally. So this migration:
--     * adds NO update or delete grant on `gate_passes` — the RPC-only state
--       machine is untouched, and `sqlInvariants` still passes;
--     * never trips `block_unapproved_gate_move`, because it moves no status;
--     * invents no new pass status, which would need an enum label that cannot
--       be USED in the same transaction that adds it (the APPLY_ALL.sql trap).
--   The release is recorded on the APPROVALS, where the missing signatures
--   actually are, rather than smuggled into the pass's own state.
--
-- WHAT IS DELIBERATELY NOT BUILT: no auto-expiry, no time-boxed elevated
-- session, no quorum. A second approver would deadlock the exact situation this
-- exists for — nobody being reachable — and the four-eyes property is preserved
-- where it can actually be honoured, at the review.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The record of the override, and of its review
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per released pass, which is why `gate_pass_id` is the primary key: a
-- pass whose ladder has already been cleared has nothing left to release, and
-- the RPC refuses a second attempt rather than writing a second row.
--
-- `released_by` is NOT NULL and has NO `on delete set null`, unlike `routed_to`
-- and `decided_by` elsewhere in this schema. Deleting the person must not be
-- able to anonymise an override — `on delete restrict` (the default here, via
-- the plain reference) makes the account undeletable while the record stands,
-- and that is the correct trade for the one table in this app whose entire
-- purpose is accountability.
create table if not exists gatepass.emergency_releases (
  gate_pass_id uuid primary key references gatepass.gate_passes(id) on delete cascade,
  released_by  uuid not null references public.profiles(id),
  reason       text not null,
  released_at  timestamptz not null default now(),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,

  -- Ten characters is the shortest thing that can be a reason. 500 matches the
  -- rejection reason in 046, so the two free-text fields on this ladder have
  -- one limit between them.
  constraint emergency_releases_reason_is_written
    check (length(btrim(reason)) between 10 and 500),

  -- A review is who AND when, or neither. A reviewed_at with no reviewer is an
  -- audit line that says something happened and refuses to say who did it.
  constraint emergency_releases_review_is_whole
    check ((reviewed_by is null) = (reviewed_at is null))
);

comment on table gatepass.emergency_releases is
  'One row per gate pass released past its approval ladder by a super admin (055). Carries the written justification captured at the moment of use, and the independent review that must follow it.';

create index if not exists emergency_releases_unreviewed_idx
  on gatepass.emergency_releases (released_at desc)
  where reviewed_at is null;

alter table gatepass.emergency_releases enable row level security;

-- Readable by exactly the people who can already read the pass — which is the
-- raising HOD, the offices it was routed to, every admin, and (once released)
-- the guard. That is the point: an override nobody can see is not a control.
-- `can_see_pass` is SECURITY INVOKER, so this inherits `gate_passes_select`
-- rather than restating it.
drop policy if exists emergency_releases_select_with_pass on gatepass.emergency_releases;
create policy emergency_releases_select_with_pass
  on gatepass.emergency_releases for select to authenticated
  using (gatepass.can_see_pass(gate_pass_id));

grant select on gatepass.emergency_releases to authenticated;

-- No insert, update or delete policy and no such grant, for anybody. The two
-- RPCs below are the only writers — the same rule `gate_passes` itself follows.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The mark on the levels that were never actually signed
-- ═══════════════════════════════════════════════════════════════════════════
-- WITHOUT THIS COLUMN the ladder would read "Approved by Sudeshna Pal" against
-- four offices Sudeshna Pal does not hold, which is a fabricated audit trail —
-- the exact thing 046's header refuses to do when it declines to backfill the
-- 60 grandfathered passes. With it, the rung reads "Released under emergency"
-- and names the reason.
alter table gatepass.pass_approvals
  add column if not exists emergency boolean not null default false;

comment on column gatepass.pass_approvals.emergency is
  'True when this level was cleared by gatepass.emergency_release_pass (055) rather than signed by the office. decided_by is then the super admin who released the pass, NOT an approver.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The release
-- ═══════════════════════════════════════════════════════════════════════════
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
  -- 039's inline form, not is_admin(). See the header.
  if gatepass.app_role() <> 'super_admin' then
    raise exception 'Only a super admin can release a gate pass past its approval ladder.';
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
  'Clears every approval level a pending gate pass still owes, in one act, recording the super admin who did it and why. Does not change the pass''s own status — see migration 055.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The review, by somebody else
-- ═══════════════════════════════════════════════════════════════════════════
-- `is_admin()` and not `super_admin`: requiring the same privilege as the
-- release would mean a single super admin could release and then review their
-- own override in two clicks, which is the failure this whole section exists to
-- prevent. Widening the reviewer pool is what makes the refusal below bite.
create or replace function gatepass.review_emergency_release(p_pass_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released_by uuid;
  v_reviewed    timestamptz;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can review an emergency release.';
  end if;

  select e.released_by, e.reviewed_at into v_released_by, v_reviewed
    from gatepass.emergency_releases e
   where e.gate_pass_id = p_pass_id;

  if v_released_by is null then
    raise exception 'That gate pass was not released under emergency.';
  end if;

  -- THE FOUR-EYES CONTROL, and the only line in this migration that turns an
  -- override into a reviewed one.
  if v_released_by = auth.uid() then
    raise exception 'An emergency release has to be reviewed by somebody other than the person who made it.';
  end if;

  -- A review is a one-way act, like every other decision on this ladder. Re-
  -- reviewing would let a later admin quietly replace an earlier one's note.
  if v_reviewed is not null then
    raise exception 'This emergency release has already been reviewed.';
  end if;

  update gatepass.emergency_releases e
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where e.gate_pass_id = p_pass_id;
end;
$$;

revoke all on function gatepass.review_emergency_release(uuid, text) from public;
grant execute on function gatepass.review_emergency_release(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Reading them back
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the names alone: `public.profiles` is VMS's and is
-- narrowed by 006, so a plain join from the client would return an override
-- with nobody's name on it. Admin-gated because this is the review queue, and
-- an admin is who works it. Unreviewed first, oldest first within that — the
-- order the work should actually be done in.
create or replace function gatepass.list_emergency_releases()
returns table (
  gate_pass_id  uuid,
  pass_number   text,
  released_by   uuid,
  released_name text,
  reason        text,
  released_at   timestamptz,
  reviewed_by   uuid,
  reviewed_name text,
  reviewed_at   timestamptz,
  review_note   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the emergency release log.';
  end if;

  return query
    select e.gate_pass_id,
           g.pass_number,
           e.released_by,
           rp.full_name,
           e.reason,
           e.released_at,
           e.reviewed_by,
           vp.full_name,
           e.reviewed_at,
           e.review_note
      from gatepass.emergency_releases e
      left join gatepass.gate_passes g on g.id = e.gate_pass_id
      left join public.profiles     rp on rp.id = e.released_by
      left join public.profiles     vp on vp.id = e.reviewed_by
     order by (e.reviewed_at is not null), e.released_at desc;
end;
$$;

revoke all on function gatepass.list_emergency_releases() from public;
grant execute on function gatepass.list_emergency_releases() to authenticated;

-- The pass record needs the banner without being an admin — the raising HOD
-- must see why their pass moved. One row, scoped by the table's own policy, so
-- this is SECURITY INVOKER and carries no name: the banner names the person
-- through `list_emergency_releases` on the admin side and prints the reason
-- alone elsewhere.
create or replace function gatepass.pass_emergency_release(p_pass_id uuid)
returns table (
  released_at timestamptz,
  reason      text,
  reviewed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.released_at, e.reason, e.reviewed_at
    from gatepass.emergency_releases e
   where e.gate_pass_id = p_pass_id;
$$;

grant execute on function gatepass.pass_emergency_release(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The letter the skipped offices get
-- ═══════════════════════════════════════════════════════════════════════════
-- 047's payload, with ONE key added. The Edge Function must be able to tell
-- "this pass was just released" from "this pass just reached the next office"
-- WITHOUT being told which by its caller — 047's header makes that a rule, and
-- it is a real one: the browser sends a pass id and nothing else, so no client
-- can ask this system to send a letter describing an event that did not happen.
-- The presence of this object IS the event, derived from the database's own
-- record of it.
--
-- Same name, same return type, same service_role-only grant, so `create or
-- replace` is legal here and the function keeps its existing privileges.
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
  'One approval notification''s worth of facts, addresses included (047/051/054), plus the emergency release that cleared this pass if there was one (055). The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

notify pgrst, 'reload schema';

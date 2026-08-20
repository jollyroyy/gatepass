-- ============================================================================
-- 057 — the ladder is Security Head → COO → Finance HOD → CEO, and a pass that
--       is still climbing it never offers the gate a button
--
-- TWO THINGS, and they are one client report. 2026-08-20:
--
--   "After the approval the security head is getting this error [`This gate
--    pass has not been approved by every level yet`] so make sure you make the
--    approval process linear, one by one: 1. The security head has to approve
--    2. COO 3. Finance 4. CEO. The approval cannot progress until the first,
--    second, third, and fourth levels are approved."
--
-- ── 1. THE ORDER. ───────────────────────────────────────────────────────────
-- 043 took its order from the printed A5 slip, which prints
-- `Security Head → COO → CEO → Finance HOD`, and 046 froze that into
-- `pass_approvals.level_no` and its own CHECK. The client has now put Finance
-- BEFORE the CEO: the CEO signs last, on a pass finance has already costed.
-- So `finance_head` is level 3 and `ceo` is level 4 — here, in the snapshot
-- trigger, in the check constraint, and on the printed slip
-- (`src/pages/Shared/signatureBlocks.ts` moves with this migration; the screen
-- and the paper must name the same offices in the same order, or a guard
-- comparing the two finds a level on one that is missing from the other).
--
-- THE EXISTING ROWS ARE RENUMBERED, unlike almost everything else in this app.
-- `level_no` is not an audit fact — it is the ORDER the remaining signatures
-- are collected in, and every ceo/finance row on this database is `pending`
-- (checked as `postgres`, 2026-08-20: 5 passes, 20 rows, `security_head` the
-- only office that has decided anything). Renumbering a DECIDED row would
-- change nothing about who signed or when; it would only move a rung that has
-- already been climbed.
--
-- ── 2. THE ERROR. ───────────────────────────────────────────────────────────
-- The linear rule was never broken. `approve_pass_level` has refused any caller
-- who is not the LOWEST still-pending rung since 046, and the live table shows
-- exactly that — `security_head` approved, the other three still pending. What
-- the client actually hit is this, and it is real:
--
--   THE SECURITY HEAD ON THIS DEPLOYMENT IS A `guard` ACCOUNT (sec@demo.vms;
--   043 explicitly allows it). 046's `gate_passes_select` gives an office
--   holder `pass_routed_to_me(id)`, so that person can see a pass that is still
--   climbing — which is correct, they have to read what they are signing. But
--   they ALSO keep every gate screen. So the pass they had just approved at
--   level 1 appeared in their own Pending OUT queue carrying an **Approve OUT**
--   button, and pressing it ran `match_pass`, and `block_unapproved_gate_move`
--   refused it with the sentence the client quoted.
--
--   The trigger is right and is untouched. What was wrong is a screen drawing a
--   button the database was always going to refuse — the one thing this
--   codebase's own rule (`canVerifyAtGate` restates what `match_pass` enforces,
--   so a button that always fails is never drawn) exists to prevent. It could
--   not, because nothing on `v_gate_passes` said whether a pass still owed a
--   signature.
--
-- So the view gains `awaits_approval`, and the gate queue filters on it
-- SERVER-SIDE. TRAP 2 (CLAUDE.md) applies: `create or replace view` cannot
-- absorb a new column, so the view is DROPPED and rebuilt with its grant
-- re-applied in the same transaction, and `security_invoker = true` is restated
-- — without it the view runs as its owner and every HOD reads every department.
-- The body below is 038's, edited mechanically rather than retyped.
--
-- `gatepass.pass_awaits_approval(id)` rather than an inline EXISTS: it is
-- SECURITY DEFINER, so it answers the same for every reader and costs one
-- primary-key probe per row, where an inline subquery under `security_invoker`
-- would re-run `can_see_pass` for every pass on every report.
--
-- WHAT THIS DOES NOT DO: it does not hide the pass from the office holder. They
-- still read it, still find it in their approvals queue, and still sign it. It
-- removes exactly one thing — the gate action on a pass the gate may not clear.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Finance signs third, the CEO signs last
-- ═══════════════════════════════════════════════════════════════════════════
-- The constraint has to come off before the rows can move: it pins level_no to
-- role_key row by row, so no single UPDATE can satisfy both mappings at once.
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_level_matches;

update gatepass.pass_approvals set level_no = 3 where role_key = 'finance_head';
update gatepass.pass_approvals set level_no = 4 where role_key = 'ceo';

alter table gatepass.pass_approvals
  add constraint pass_approvals_level_matches
  check (level_no = case role_key
                      when 'security_head' then 1
                      when 'coo'           then 2
                      when 'finance_head'  then 3
                      when 'ceo'           then 4
                    end);

comment on constraint pass_approvals_level_matches on gatepass.pass_approvals is
  'Slip order: Security Head 1, COO 2, Finance HOD 3, CEO 4 (client, 2026-08-20 - Finance signs before the CEO).';

-- The snapshot, restated from 046 (and from 054, which re-stated it for the
-- deputy work) with the two levels swapped. Everything else about it is
-- unchanged: it is a trigger and not a line inside `raise_pass`, a vacant
-- office is never snapshotted, and what a pass owes freezes the day it is
-- raised.
--
-- `create or replace function` keeps the existing trigger bound to it, so the
-- trigger is deliberately NOT dropped and re-created here — that would open a
-- window, however short, in which an insert snapshots nothing at all.
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
            when 'finance_head'  then 3
            when 'ceo'           then 4
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The view says whether a pass still owes a signature
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
    p.visitor_name,
    p.visitor_company,
    p.vehicle_number,
    p.purpose,
    p.expected_return_date,
    p.return_status,
    p.actual_return_date,
    p.verified_by,
    p.verified_at,
    p.flag_reason,
    p.created_at,
    p.updated_at,
    p.qr_token,
    p.expires_at,
    p.direction,
    p.image_url,
    p.category,
    ( SELECT max(f.created_at) AS max
           FROM gatepass.verifications f
          WHERE f.gate_pass_id = p.id AND f.action = 'flagged'::gatepass.verify_action) AS flagged_at,
    ( SELECT max(r.created_at) AS max
           FROM gatepass.verifications r
          WHERE r.gate_pass_id = p.id AND r.action = 'hod_reviewed'::gatepass.verify_action) AS hod_reviewed_at,
    p.return_status = 'awaiting_return'::gatepass.return_status AND p.expected_return_date IS NOT NULL AND p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date AS is_overdue,
    p.status = 'pending'::gatepass.pass_status AND p.expires_at < now() AS is_expired,
        CASE
            WHEN p.expected_return_date IS NULL OR (p.return_status::text <> ALL (ARRAY['awaiting_return'::text, 'partially_returned'::text])) THEN 'not_applicable'::text
            WHEN p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date THEN 'overdue'::text
            WHEN p.expected_return_date = (now() AT TIME ZONE gatepass.site_tz())::date THEN 'due_today'::text
            WHEN p.expected_return_date = ((now() AT TIME ZONE gatepass.site_tz())::date + 1) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS due_state,
    gatepass.pass_awaits_approval(p.id) AS awaits_approval,
    COALESCE(it.item_count, 0::bigint) AS item_count,
    COALESCE(it.total_quantity, 0::numeric) AS total_quantity,
    COALESCE(it.returned_quantity, 0::numeric) AS returned_quantity,
    it.material_summary,
    COALESCE(it.total_value, 0::numeric) AS total_value,
    d.name AS department_name,
    d.code AS department_code,
    rb.full_name AS raised_by_name,
    vb.full_name AS verified_by_name
   FROM gatepass.gate_passes p
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            sum(i.quantity) AS total_quantity,
            sum(i.returned_qty) AS returned_quantity,
            string_agg(i.name, ', '::text ORDER BY i.line_no) AS material_summary,
            sum(i.approx_value) AS total_value
           FROM gatepass.gate_pass_items i
          WHERE i.gate_pass_id = p.id) it ON true
     LEFT JOIN public.departments d ON d.id = p.department_id
     LEFT JOIN gatepass.profile_names rb ON rb.id = p.raised_by
     LEFT JOIN gatepass.profile_names vb ON vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

comment on view gatepass.v_gate_passes is
  'Pass rows with rollups. is_overdue / is_expired / due_state / total_value / '
  'awaits_approval are defined HERE and exactly once - never recompute them in '
  'TypeScript. awaits_approval true means the pass is still climbing the '
  'approval ladder, and no gate action on it can succeed (046).';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. An office holder can be suspended AND restored
-- ═══════════════════════════════════════════════════════════════════════════
-- Client, 2026-08-20: "make sure that all these four roles should have the
-- deactivate and edit option also for the admin."
--
-- Edit already worked, and so did Deactivate on the server:
-- `admin_soft_delete_user` refuses only an admin target and the caller's own
-- account, and an office holder is neither. The admin DIRECTORY simply drew no
-- Deactivate control on those rows (a deliberate rule since 046 — "their office
-- moves on the ladder card, not from a row action"), and this instruction
-- overrules it. `UsersTable.tsx` moves with this migration.
--
-- REACTIVATION IS THE HALF THAT WAS ACTUALLY BROKEN, and it would have shipped
-- as a one-way door: an office holder's VMS role is `staff` (046 — the role for
-- "does not use VMS"), and 040's `admin_reactivate_user` refuses any target
-- whose role is not guard/hod, with "Give this person a role (Guard or HOD)
-- before reactivating." So an admin could suspend a COO and then have no way
-- back except through the portal's role-choice modal, which would make them a
-- guard and cost them their office.
--
-- 040's REASON for that refusal is still exactly right and is NOT relaxed: a
-- bare `staff` row has no access whether the flag is true or false, so flipping
-- it would report a restoration that restored nothing. An office holder is the
-- one `staff` row that is false — `gatepass.approval_roles` is what grants them
-- their route and their queue, and `my_approval_role()` gates on
-- `is_user_active`, which is precisely the flag this function writes. So the
-- test becomes "has this person anything to come back TO", and holding an
-- office is one of the two ways to have something.
--
-- Body copied from 040 with that one condition widened; everything else —
-- the admin check, the not-found check, the upsert — is verbatim.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
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
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_role not in ('guard', 'hod') and v_office is null then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, true, null, null, now())
  on conflict (user_id) do update
    set is_active      = true,
        deactivated_at = null,
        deactivated_by = null,
        updated_at     = now();

  return json_build_object('id', p_user_id::text, 'reactivated', true);
end;
$$;

grant execute on function gatepass.admin_reactivate_user(uuid) to authenticated;

notify pgrst, 'reload schema';

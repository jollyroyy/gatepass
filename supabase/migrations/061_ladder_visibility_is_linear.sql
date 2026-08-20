-- ============================================================================
-- 061 — AN APPROVER CANNOT SEE A PASS UNTIL IT IS THEIR TURN.
--
-- Client, 2026-08-20: "that gate pass will first go to the security. The
-- next-level approver should not be able to see anything about that gate pass
-- until and unless the security approves it ... the next-level approver should
-- not have any visibility over the gate passes which are pending for the
-- approval of their previous approver. Strictly implement this."
--
-- THE ORDER OF ACTING WAS ALREADY LINEAR AND IS UNCHANGED. `approve_pass_level`
-- and `reject_pass_level` (046, renumbered by 057) refuse any caller who is not
-- the LOWEST still-pending rung, and no migration here touches them. What was
-- wrong is VISIBILITY: `pass_routed_to_me` answered true from the moment the
-- pass was raised, because the 046 trigger snapshots all four levels at once.
-- So the COO could read — and list on their queue — a pass the Security Head
-- had not yet signed. They could not act on it, but they could see it, and the
-- client's rule is about seeing.
--
-- THE NEW RULE, in one line: I may see a pass routed to my office when EVERY
-- RUNG BELOW MINE IS APPROVED.
--
--   * Still climbing, and a lower office has not signed → invisible. Not
--     filtered on a screen: not in the table, as far as I am concerned.
--   * My turn (every lower rung approved, mine pending) → visible, and
--     `approve_pass_level` already agrees that I am the one who may press.
--   * Signed by me and gone on up, or cleared at the gate months ago → still
--     visible. An approver must be able to read back what they signed.
--   * REJECTED BELOW ME → stays invisible for ever, and that is deliberate.
--     Responsibility never reached my desk; a pass I was never shown must not
--     appear in my history the moment somebody below refuses it.
--
-- WHY ONE FUNCTION IS THE WHOLE CHANGE. `pass_routed_to_me` is the approver arm
-- of `gate_passes_select` AND of `gate_pass_items_select` (046), and
-- `pass_approvals` / `pass_remarks` / `emergency_releases` all read through
-- `can_see_pass`, which is that same policy. So the queue, the record, the
-- material lines, the ladder rungs and the remarks all narrow together — there
-- is deliberately no second copy of this rule in a screen or a query.
--
-- NOT AFFECTED: the admin (sees everything at every stage — somebody must be
-- able to see a pass stuck at level 2), the raising HOD (their own department,
-- at every stage — they must be able to watch it climb), and the guard (still
-- blind to anything that owes a signature at all).
--
-- THE LETTERS WERE ALREADY ONE AT A TIME. `approval_notice_payload` (047, 051)
-- writes to the lowest still-pending office only, so no office is ever told
-- about a pass it cannot yet see.
-- ============================================================================

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
       -- Every rung BELOW mine is approved. `<> 'approved'` rather than
       -- `= 'pending'` on purpose: a rejection below me is not a turn that
       -- passed to me, it is a pass that stopped before it got here.
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status <> 'approved'
       )
  );
$$;

comment on function gatepass.pass_routed_to_me(uuid) is
  'True when the pass is addressed to the office the caller holds (or deputises for, 054) AND every level below theirs has been approved (061). The approver arm of gate_passes_select — an office sees a pass only once it is their turn, and goes on seeing it afterwards.';

-- Unchanged from 046, restated because a redefinition drops nothing but is
-- worth being explicit about: only signed-in users may ask, and the function is
-- SECURITY DEFINER so it can read `pass_approvals` without recursing back
-- through that table's own policy (42P17).
revoke all on function gatepass.pass_routed_to_me(uuid) from public;
grant execute on function gatepass.pass_routed_to_me(uuid) to authenticated;

-- 041 — the HOD decides what happens to a pass that expired at the gate
--
-- ============================================================================
-- THE GAP THIS CLOSES
-- ============================================================================
-- A pass that is never presented at the gate before its own `expires_at` is
-- already NULL AND VOID in every way that matters at the barrier: `match_pass`
-- (008) refuses an expired pass outright, so nothing the guard does will ever
-- release that material. What was missing is the other end — the HOD who raised
-- it had no way to CLOSE it. It sat at `pending` for ever, counted in "Pending
-- Approvals" on both dashboards, and the only way to move the material was to
-- raise a second pass and leave the first one open beside it.
--
-- Client, 2026-08-17: "if something is not out and has expired, make it null and
-- void and notify the HOD about that so that he can either raise it or reject
-- it. He can review it and raise it or maybe void it completely."
--
-- ============================================================================
-- WHY THERE IS NO SCHEDULED JOB, AND NO 'expired' STATUS
-- ============================================================================
-- Expiry stays DERIVED from `expires_at`, exactly as `is_overdue` is, and
-- surfaced by `v_gate_passes.is_expired`. A pg_cron job that flipped every
-- expired pass to 'cancelled' at midnight would introduce a scheduled dependency
-- this schema has deliberately never had, and would write a state change with
-- nobody's name on it — `verifications.security_user_id` is `not null`, so an
-- automatic void has no honest author to record.
--
-- So the row moves to a terminal state exactly once: when a human decides. This
-- function is that decision, and the HOD is that human.
--
-- ============================================================================
-- WHY IT IS NOT A BRANCH OF hod_review_flagged_pass
-- ============================================================================
-- That function (015/027/035) has an 'approve' branch, and 035 made approval
-- REFRESH `expires_at` to the end of the current day. Widening it to admit an
-- expired pending pass would therefore hand every HOD a way to un-expire their
-- own paperwork with no security involvement at all — the exact control this
-- migration exists to enforce. This function has ONE outcome, void, and no
-- approve branch to grow one later.
--
-- The terminal state is 'cancelled', which already exists in both
-- gatepass.pass_status and gatepass.verify_action (008). That matters: a NEW
-- enum label cannot be referenced by a check constraint or a `language sql` body
-- in the transaction that adds it, and APPLY_ALL.sql is pasted as ONE
-- transaction. Reusing an existing label sidesteps that entirely.
--
-- This does not reopen what 024 closed. 024 stopped an HOD voiding a LIVE pass
-- on a whim. This applies only to a pass the database itself will no longer
-- honour, only to the HOD who raised it, and adds no DELETE grant and no UPDATE
-- policy — the state machine stays RPC-only.

create or replace function gatepass.hod_void_expired_pass(
  p_pass_id uuid,
  p_reason  text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    gatepass.gate_passes;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.raised_by <> v_user_id then
    raise exception 'Only the HOD who raised this pass can void it.';
  end if;

  -- Only a pass still waiting at the gate. One that reached ANY outcome —
  -- matched, flagged, held, hod_reviewed, already cancelled — is a decision
  -- somebody has already taken, and expiry does not reopen it.
  if v_pass.status::text <> 'pending' then
    raise exception 'Only a pass still waiting at the gate can be voided this way. This pass is %.', v_pass.status;
  end if;

  -- EXPIRY IS CHECKED HERE, ON THE SERVER, AND NOT TAKEN FROM THE CALLER.
  -- The screen decides which button to draw; the database decides what is true.
  -- Without this, the browser could void a perfectly live pass by calling the
  -- RPC directly — which is the HOD cancellation 024 removed, restored by the
  -- back door.
  if v_pass.expires_at is null or v_pass.expires_at >= now() then
    raise exception 'This pass has not expired, so it cannot be voided.';
  end if;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  -- The audit trail. `verifications` is where every state change in this schema
  -- is recorded, and a void with no row there is a pass that changed state for
  -- no recorded reason. The default text says WHY rather than WHAT: "cancelled"
  -- is already the action column.
  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
     coalesce(nullif(trim(coalesce(p_reason, '')), ''),
              'Expired without reaching the gate; voided by the raising HOD'));

  return v_pass;
end;
$$;

comment on function gatepass.hod_void_expired_pass(uuid, text) is
  'Voids a pass that expired without ever being presented at the gate. Raising HOD only, pending only, and only once expires_at is genuinely in the past.';

revoke all on function gatepass.hod_void_expired_pass(uuid, text) from public;
grant execute on function gatepass.hod_void_expired_pass(uuid, text) to authenticated;

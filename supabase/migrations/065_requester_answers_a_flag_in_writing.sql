-- 065 — the requester's answer to a gate flag is written down
--
-- Client, 2026-08-23: the guard's second answer is now "Flag to Requester", and
-- when the raising HOD answers it "he can put it as a proof" — a written note
-- saying why they cleared the flag or why they upheld it.
--
-- The REJECT branch already wrote `p_reason` into its `verifications` row (035).
-- The APPROVE branch did not: it wrote the fixed sentence 'HOD approved
-- override of security flag' and threw the HOD's own words away, so the one
-- decision that sends material back out through a barrier a guard had stopped
-- was the one decision with no stated reason on the record.
--
-- p_reason STAYS OPTIONAL at this boundary, deliberately. The portal makes it
-- mandatory where a person answers a flag (FlaggedReviewActions), but
-- `voidSupersededPass` calls this same RPC with a generated reason when a
-- corrected pass supersedes a flagged one, and a required argument here would
-- turn that automatic step into a prompt nobody can answer. An absent note
-- falls back to the sentence this function has always written.
--
-- NOTHING ELSE ABOUT THE FUNCTION CHANGES. It still refuses anyone who is not
-- the raising HOD, still refuses a pass that is not `flagged`, and still
-- refreshes `expires_at` to the end of the current site day on approve (035) so
-- the pass is matchable at the gate it was stopped at. It also still does not
-- touch `gatepass.pass_approvals`: a flag is answered by the requester and by
-- nobody else, and the three approval offices signed this pass before it ever
-- reached the barrier.
create or replace function gatepass.hod_review_flagged_pass(
  p_pass_id uuid,
  p_action  text,
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
  v_note    text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  v_note := nullif(trim(coalesce(p_reason, '')), '');

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.raised_by <> v_user_id then
    raise exception 'Only the HOD who raised this pass can review it.';
  end if;

  if v_pass.status::text <> 'flagged' then
    raise exception 'Only a flagged pass can be reviewed. This pass is %.', v_pass.status;
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'A flagged pass can only be approved or rejected.';
  end if;

  if p_action = 'approve' then
    -- Same-day re-expiry (028's expression): the clearance gives the pass the
    -- rest of TODAY to reach the gate. flag_reason deliberately survives (026).
    update gatepass.gate_passes
       set status    = 'hod_reviewed'::gatepass.pass_status,
           expires_at = ((date_trunc('day', (now() at time zone gatepass.site_tz())) + interval '1 day')
                          at time zone gatepass.site_tz()) - interval '1 microsecond'
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'hod_reviewed'::gatepass.verify_action, v_user_id,
       coalesce(v_note, 'HOD approved override of security flag'));
  else
    -- flag_reason is deliberately preserved (see 026): a pass closed this way
    -- must keep the record of WHY security stopped it.
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
       coalesce(v_note, 'HOD upheld the security flag and rejected this pass'));
  end if;

  return v_pass;
end;
$$;

revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- 035 — an override approval makes the pass FRESH at the gate,
--       and every card can show the full timeline in one row
--
-- ============================================================================
-- PART 1 — hod_review_flagged_pass refreshes expires_at on approve
-- ============================================================================
-- Business rule (user decision, 2026-08-08): when the HOD override-approves a
-- flagged pass, the pass becomes a FRESH gate pass — it must be matchable at
-- the gate, and match_pass refuses anything whose expires_at has passed. Before
-- 035 an override-approved pass kept whatever expiry it was born with, so a
-- pass flagged near midnight (or re-raised for approval a day later) was
-- cleared by the HOD only to be refused by match_pass the moment it arrived at
-- the barrier — the whole override flow was a dead end.
--
-- The refresh reuses 028's exact end-of-day expression (end of the CURRENT
-- day in site_tz()): the override gives the pass the rest of today to reach
-- the gate, mirroring the same-day rule any new pass obeys. This is the
-- db-side half; the view side (flagged_at / hod_reviewed_at) is PART 3, and
-- the guard queue re-derives visibility from the view in the frontend.
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
    raise exception 'Only the HOD who raised this pass can review it.';
  end if;

  if v_pass.status::text <> 'flagged' then
    raise exception 'Only a flagged pass can be reviewed. This pass is %.', v_pass.status;
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'A flagged pass can only be approved or rejected.';
  end if;

  if p_action = 'approve' then
    -- Same-day re-expiry (028's expression): the override gives the pass the
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
       'HOD approved override of security flag');
  else
    -- flag_reason is deliberately preserved (see 026): a rejected pass must
    -- keep the record of WHY security stopped it.
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
       coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                'HOD upheld the security flag and rejected this pass'));
  end if;

  return v_pass;
end;
$$;

revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- ============================================================================
-- PART 2 — flag_pass accepts hod_reviewed (the mismatch option stays open)
-- ============================================================================
-- Approval is the HOD's judgement, not a fact about the material. A guard
-- standing at the gate with the truck in front of them must still be able to
-- say "this still does not match" after an override — otherwise the HOD's
-- decision papered over a real mismatch the gate could not re-open.
--
-- hod_reviewed → flagged is a second round of the same loop: the pass goes
-- back to the HOD for another review. flag_reason is overwritten with the new
-- mismatch's reason; the old one remains in verifications.
drop function if exists gatepass.flag_pass(uuid, text, text, jsonb, jsonb);

create or replace function gatepass.flag_pass(
  p_pass_id     uuid,
  p_reason      text,
  p_gate_name   text  default null,
  p_device_info jsonb default null,
  p_checks      jsonb default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can flag a gate pass.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when flagging a pass.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- pending/hold, plus hod_reviewed (035): a pass the HOD has override-approved
  -- can be re-flagged at the gate — the mismatch option must survive the paper.
  if v_pass.status::text not in ('pending', 'held', 'hod_reviewed') then
    raise exception 'This pass is already %. Only a pending, held or HOD-approved pass can be flagged.',
      v_pass.status;
  end if;

  -- NO expiry check here, deliberately, and this is not an oversight: refusing
  -- to record a real mismatch because the paperwork went stale is backwards.
  -- match_pass refuses an expired pass; flag_pass must not.
  update gatepass.gate_passes
     set status      = 'flagged',
         flag_reason = trim(p_reason),
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks, gate_name, device_info, checks)
  values
    (p_pass_id, 'flagged', auth.uid(), trim(p_reason),
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info, p_checks);

  return v_pass;
end;
$$;

grant execute on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- PART 3 — the view carries the timeline: raised → mismatched → override
-- ============================================================================
-- Every card in the app renders a pass from ONE v_gate_passes row. The card
-- timeline ("Raised 09:14 · Mismatch 10:02 · HOD override 11:30") needs the
-- flag and the override moments, which live in verifications, not on the pass.
-- Adding two scalar subselects keeps every list row single-query and leaves
-- verified_at alone (it is the LATEST verification; flagged_at/hod_reviewed_at
-- are the SPECIFIC moments the timeline names, which later matches would
-- otherwise overwrite).
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  (select max(f.created_at)
     from gatepass.verifications f
    where f.gate_pass_id = p.id
      and f.action = 'flagged'::gatepass.verify_action)          as flagged_at,

  (select max(r.created_at)
     from gatepass.verifications r
    where r.gate_pass_id = p.id
      and r.action = 'hod_reviewed'::gatepass.verify_action)     as hod_reviewed_at,

  p.return_status = 'awaiting_return'
    and p.expected_return_date is not null
    and p.expected_return_date < (now() at time zone gatepass.site_tz())::date
                                                                    as is_overdue,
  p.status = 'pending' and p.expires_at < now()                     as is_expired,

  case
    when p.expected_return_date is null
      or p.return_status::text not in ('awaiting_return', 'partially_returned')
                                                              then 'not_applicable'
    when p.expected_return_date <  (now() at time zone gatepass.site_tz())::date
                                                              then 'overdue'
    when p.expected_return_date =  (now() at time zone gatepass.site_tz())::date
                                                              then 'due_today'
    when p.expected_return_date =  (now() at time zone gatepass.site_tz())::date + 1
                                                              then 'due_soon'
    else 'ok'
  end                                                           as due_state,

  coalesce(it.item_count, 0)                                        as item_count,
  coalesce(it.total_quantity, 0)                                    as total_quantity,
  coalesce(it.returned_quantity, 0)                                 as returned_quantity,
  it.material_summary,

  d.name       as department_name,
  d.code       as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join lateral (
  select count(*)                        as item_count,
         sum(i.quantity)                 as total_quantity,
         sum(i.returned_qty)             as returned_quantity,
         string_agg(i.name, ', ' order by i.line_no) as material_summary
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p.id
) it on true
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. is_overdue, is_expired, due_state and '
  'the item roll-ups are defined here and ONLY here. flagged_at and '
  'hod_reviewed_at come from the verifications audit so every card can show '
  'the raised/mismatch/override timeline without a second query.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';
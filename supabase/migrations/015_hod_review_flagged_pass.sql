-- ============================================================================
-- 015 — HOD review workflow for flagged passes
--
-- Currently, flagged is terminal: once a guard flags a pass, nothing can
-- change its status. The HOD who raised it has no way to respond — they can
-- see the flag reason in PassDetail but cannot act on it.
--
-- This migration makes flagged a REVERSIBLE state by adding:
--
--   1. `hod_reviewed` — a new pass_status (and verify_action), reachable only
--      from flagged, set by the HOD who raised the pass.
--   2. `gatepass.hod_review_flagged_pass` — the RPC an HOD calls to review
--      their own flagged pass. Two actions:
--        'approve'  → status becomes hod_reviewed; guard can then match
--        'reject'   → status becomes cancelled with a reason
--   3. `gatepass.match_pass` — updated to also accept hod_reviewed, so a
--      guard can finalise dispatch after HOD approval.
--   4. `gatepass.lookup_pass` — updated to treat hod_reviewed as `ok`
--      (the guard scans and proceeds to verify/match).
--
-- TRAP 1 applies (see 008's header): 'hod_reviewed' is added by THIS
-- migration, and APPLY_ALL.sql is one transaction. No `language sql` function
-- body and no CHECK constraint in this file may name 'hod_reviewed' — that
-- would abort the entire paste. All references are in plpgsql bodies, which
-- are stored as text and only syntax-checked at CREATE time.
-- ============================================================================

-- ─── New enum values ────────────────────────────────────────────────────────
alter type gatepass.pass_status   add value if not exists 'hod_reviewed' after 'flagged';
alter type gatepass.verify_action add value if not exists 'hod_reviewed' after 'flagged';

-- ─── HOD review RPC ─────────────────────────────────────────────────────────
-- Only the HOD who raised the pass may review it:
--   'approve' → hod_reviewed (guard dispatches)
--   'reject'  → cancelled (pass voided)
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

  -- ::text comparison avoids any DDL-time enum resolution (TRAP 1)
  if v_pass.status::text <> 'flagged' then
    raise exception 'Only a flagged pass can be reviewed. This pass is %.', v_pass.status;
  end if;

  if p_action = 'approve' then
    update gatepass.gate_passes
       set status = 'hod_reviewed'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'hod_reviewed'::gatepass.verify_action, auth.uid(),
       'HOD approved override of security flag');
  elsif p_action = 'reject' then
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status,
           cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Rejected by HOD after security flag')
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(),
       coalesce(nullif(trim(p_reason), ''), 'Rejected by HOD after security flag'));
  else
    raise exception 'Invalid action. Use ''approve'' or ''reject''.';
  end if;

  return v_pass;
end;
$$;

grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- ─── match_pass — accept hod_reviewed ───────────────────────────────────────
-- A pass the HOD approved after flagging can now be matched by the guard.
drop function if exists gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb);

create or replace function gatepass.match_pass(
  p_pass_id     uuid,
  p_lines       jsonb default null,
  p_vehicle     text  default null,
  p_remarks     text  default null,
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
  v_pass  gatepass.gate_passes;
  v_total numeric;
  v_lines jsonb;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can verify a gate pass.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- Accept pending, held, OR hod_reviewed (HOD-approved-after-flag)
  if v_pass.status::text not in ('pending', 'held', 'hod_reviewed') then
    raise exception 'This pass is already %. Only a pending, held, or HOD-reviewed pass can be verified.',
      v_pass.status;
  end if;

  if v_pass.expires_at < now() then
    raise exception 'This pass expired on %. Raise a new one.',
      to_char(v_pass.expires_at at time zone gatepass.site_tz(), 'DD Mon YYYY HH24:MI');
  end if;

  select jsonb_agg(jsonb_build_object(
           'item_id',      i.id,
           'description',  i.description,
           'declared_qty', i.quantity,
           'verified_qty', coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity)
         ) order by i.line_no),
         sum(coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity))
    into v_lines, v_total
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p_pass_id;

  update gatepass.gate_passes
     set status        = 'matched',
         verified_by   = auth.uid(),
         verified_at   = now(),
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                              else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle,
     remarks, gate_name, device_info, line_details, checks)
  values
    (p_pass_id, 'matched', auth.uid(), v_total,
     nullif(trim(coalesce(p_vehicle, '')), ''),
     p_remarks,
     nullif(trim(coalesce(p_gate_name, '')), ''),
     p_device_info, v_lines, p_checks);

  return v_pass;
end;
$$;

grant execute on function gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb) to authenticated;

-- ─── lookup_pass — treat hod_reviewed as scannable ──────────────────────────
-- A guard scanning a hod_reviewed pass should get 'ok' so they can proceed
-- to verify and match it.
create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    gatepass.gate_passes;
  v_code    text := trim(coalesce(p_code, ''));
  v_uuid    uuid;
  v_outcome text;
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
  elsif v_pass.status::text = 'cancelled' then
    v_outcome := 'cancelled';
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome)
  values (v_code, v_pass.id, auth.uid(), v_outcome);

  return query select v_outcome, v_pass.id;
end;
$$;

-- No grant needed — lookup_pass grant from 008 still covers this replacement.

notify pgrst, 'reload schema';

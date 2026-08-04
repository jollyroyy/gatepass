-- ============================================================================
-- 024 — Cancellation removed: a raised gate pass is permanent
--
-- Business rule (2026-08-04): once a gate pass is raised it cannot be cancelled
-- or deleted. Every cancellation path is removed in one migration:
--
--   1. gatepass.cancel_pass — the HOD void of a still-pending pass
--   2. gate_passes_delete policy + the DELETE grant — the HOD hard-delete
--   3. The 'reject' branch of hod_review_flagged_pass — a flagged pass can now
--      only be APPROVED; it can never be voided
--   4. The now-dead cancel_reason column, and the validate_pass / lookup_pass
--      'cancelled' branches that existed solely to support cancellation
--
-- The enum labels 'cancelled' (pass_status, verify_action) stay in the enums —
-- Postgres cannot drop enum values. They become unreachable: no code path sets
-- them, and historical rows (scan_attempts, verifications) keep their labels
-- for the audit trail. `hod_reviewed` stays: approving a flag override is not a
-- cancellation, it is how a mismatch is resolved.
-- ============================================================================

-- ─── 1. Drop the HOD void RPC ───────────────────────────────────────────────
drop function if exists gatepass.cancel_pass(uuid, text);

-- ─── 2. Drop the HOD delete path ────────────────────────────────────────────
-- The policy was the schema's only DELETE grant; both go together so the
-- RPC-only state machine is complete even for the service key.
revoke delete on gatepass.gate_passes from authenticated;
drop policy if exists gate_passes_delete on gatepass.gate_passes;

-- ─── 3. hod_review_flagged_pass — approve only ──────────────────────────────
-- 'reject' voided a flagged pass into 'cancelled'. Cancellation is gone, so
-- the review has exactly one action. The signature and grant are unchanged
-- (015), so the audit trail and grants keep working.
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

  if p_action <> 'approve' then
    raise exception 'A flagged pass can only be approved. It cannot be cancelled once raised.';
  end if;

  update gatepass.gate_passes
     set status = 'hod_reviewed'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'hod_reviewed'::gatepass.verify_action, auth.uid(),
     'HOD approved override of security flag');

  return v_pass;
end;
$$;

-- ─── 4. Drop cancel_reason ──────────────────────────────────────────────────
-- Dead once cancellation is gone. The view selects p.*, so it must be dropped
-- BEFORE the column (its fixed column list depends on cancel_reason) and
-- rebuilt in section 7 (TRAP 2).
drop view if exists gatepass.v_gate_passes;

alter table gatepass.gate_passes
  drop column if exists cancel_reason;

-- ─── 5. validate_pass — remove the cancelled branches ───────────────────────
-- Restated from 019's final version, minus the 'cancelled' / cancel_reason
-- rules. The remaining rules (birth-date sanity, return-before-verified) are
-- unchanged.
create or replace function gatepass.validate_pass()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if tg_op = 'INSERT' then
    new.visitor_name    := trim(new.visitor_name);
    -- Blank optional fields collapse to NULL so "not given" has one spelling.
    new.visitor_company := nullif(trim(coalesce(new.visitor_company, '')), '');
    new.vehicle_number  := nullif(upper(trim(coalesce(new.vehicle_number, ''))), '');

    -- Dates are judged against the mall's wall clock, not UTC. site_tz() is
    -- Asia/Kolkata; using UTC here would misjudge everything raised after
    -- 18:30 local by a full day.
    v_today := (now() at time zone gatepass.site_tz())::date;

    if new.expected_return_date is not null then
      if new.expected_return_date < v_today then
        raise exception 'Expected return date % is already in the past. A pass cannot be born overdue.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;

      -- Catches a mistyped year (2260 for 2026), which would otherwise sit in
      -- the awaiting-return list forever and never once show as overdue.
      if new.expected_return_date > v_today + 365 then
        raise exception 'Expected return date % is more than a year away. Check the year.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
    end if;
  end if;

  -- Material cannot come back before it went out.
  if new.return_status = 'returned'
     and new.actual_return_date is not null
     and new.verified_at is not null
     and new.actual_return_date < new.verified_at then
    raise exception 'Return recorded at %, before the pass was verified at %.',
      new.actual_return_date, new.verified_at;
  end if;

  return new;
end;
$$;

-- ─── 6. lookup_pass — remove the cancelled outcome ──────────────────────────
-- Restated from 016's final version minus the 'cancelled' branch. hod_reviewed
-- still scans as 'ok', and the blacklist check is unchanged.
drop function if exists gatepass.lookup_pass(text);

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
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  -- Blacklist check — only for found passes with a company or vehicle
  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_type = 'company' and lower(b.list_value) = lower(trim(coalesce(v_pass.visitor_company, ''))))
        or (b.list_type = 'vehicle' and lower(b.list_value) = lower(trim(coalesce(v_pass.vehicle_number, ''))))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  return query select v_outcome, v_pass.id, v_blacklist_text;
end;
$$;

-- ─── 7. Rebuild v_gate_passes (TRAP 2 — cancel_reason is gone from p.*) ─────
-- Restated verbatim from 019 so nothing else drifts.
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

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
  end                                                               as due_state,

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
  'the item roll-ups are defined here and ONLY here.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

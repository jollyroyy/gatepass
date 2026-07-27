-- ============================================================================
-- 014 — What the guard actually did at the loading bay
--
-- 013 gave a pass many material lines. This migration makes VERIFICATION match
-- that shape, and records the three things a disputed sign-off always turns on:
-- which lines were counted and to what, who was standing where, and what they
-- physically checked before releasing the material.
--
-- Four additions:
--
-- 1. PER-LINE VERIFIED QUANTITIES. `verifications.verified_quantity` was a
--    single number, which stopped meaning anything the moment a pass could
--    carry five lines. It stays as the TOTAL counted (so existing rows and the
--    "did the total match?" question both survive), and `line_details` holds
--    the breakdown.
--
-- 2. THE CHECKLIST. A guard releasing material ticks: item matches, quantity
--    matches, serial/asset tag checked, carrying person checked, paperwork
--    checked. Storing it turns "the guard says they checked the serial" into a
--    record. The UI refuses to enable Match until the required ticks are
--    present; this column is what makes that claim auditable afterwards.
--
-- 3. GATE NAME AND DEVICE. A mall has more than one service entrance. "Signed
--    off at 23:40" is a different fact at the loading bay than at the basement
--    ramp, and today the log cannot tell them apart.
--
-- 4. HOLD. Match and Flag are both terminal, so a guard facing "the paperwork
--    says 3, I count 3, but the serial is wrong and I want the HOD on the
--    phone" has to pick one and be wrong. `held` is the honest third answer:
--    material stopped at the gate, nothing released, nothing accused, and the
--    pass stays actionable. Match and Flag both accept a held pass, so a hold
--    is a pause in the state machine rather than a branch out of it.
--
-- TRAP 1 applies to 'held' exactly as it did to 'partially_returned' in 013 —
-- and 013's header records the sharper version of that rule discovered by dry
-- run: a plpgsql body is exempt at CREATE time, but NOT if this migration also
-- EXECUTES it before commit. Nothing here is executed during the migration, so
-- CREATE-time exemption is enough; ::text comparisons are used anyway so that a
-- future migration which does run one of these in-transaction cannot be broken
-- by a rule nobody re-derives.
-- ============================================================================

alter type gatepass.pass_status   add value if not exists 'held' after 'pending';
alter type gatepass.verify_action add value if not exists 'held' after 'flagged';

-- ─── 1. The verification record grows ───────────────────────────────────────
alter table gatepass.verifications
  add column if not exists gate_name    text,
  add column if not exists device_info  jsonb,
  add column if not exists line_details jsonb,
  add column if not exists checks       jsonb;

comment on column gatepass.verifications.gate_name is
  'Which entrance this happened at. Free text rather than a lookup table: the '
  'set of gates changes with construction hoarding, and a stale FK would block '
  'a sign-off at a gate that exists.';
comment on column gatepass.verifications.line_details is
  'Per-line breakdown: [{item_id, description, declared_qty, verified_qty}]. '
  'Audit evidence, not a queryable relation — the authoritative per-line state '
  'is gate_pass_items.returned_qty.';
comment on column gatepass.verifications.checks is
  'The checklist the guard ticked, e.g. {"carrier":true,"paperwork":true,'
  '"lines":{"<item_id>":{"item":true,"qty":true,"serial":true}}}.';

alter table gatepass.verifications
  drop constraint if exists verifications_gate_name_not_blank,
  add  constraint verifications_gate_name_not_blank
    check (gate_name is null or length(trim(gate_name)) > 0);

-- ─── 2. Hold ────────────────────────────────────────────────────────────────
create or replace function gatepass.hold_pass(
  p_pass_id     uuid,
  p_reason      text,
  p_gate_name   text  default null,
  p_device_info jsonb default null
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
    raise exception 'Only security can hold a gate pass.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when holding a pass.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status::text <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be held.', v_pass.status;
  end if;

  -- Deliberately does NOT set verified_by/verified_at. A hold is not a
  -- verification — the material has not been released or refused, and
  -- gate_passes_verified_pair plus validate_pass both treat those two columns
  -- as the record of a completed decision.
  update gatepass.gate_passes
     set status = 'held'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks, gate_name, device_info)
  values
    (p_pass_id, 'held'::gatepass.verify_action, auth.uid(), trim(p_reason),
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info);

  return v_pass;
end;
$$;

-- ─── 3. Match, per line ─────────────────────────────────────────────────────
-- Replaces 003's signature. The old (uuid, numeric, text, text) form is dropped
-- rather than left callable: two overloads that both "match a pass" but disagree
-- about whether per-line counts are recorded is precisely the kind of unused
-- surface CLAUDE.md forbids leaving behind — and PostgREST would happily route
-- to either.
drop function if exists gatepass.match_pass(uuid, numeric, text, text);

create or replace function gatepass.match_pass(
  p_pass_id     uuid,
  p_lines       jsonb default null,   -- [{item_id, verified_qty}]
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

  -- Lock the row so two guards cannot both verify the same pass.
  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- A held pass is explicitly resumable: hold exists so the guard can come back
  -- to this decision, not so the pass becomes unverifiable.
  if v_pass.status::text not in ('pending', 'held') then
    raise exception 'This pass is already %. Only a pending or held pass can be verified.',
      v_pass.status;
  end if;

  if v_pass.expires_at < now() then
    raise exception 'This pass expired on %. Raise a new one.',
      to_char(v_pass.expires_at at time zone gatepass.site_tz(), 'DD Mon YYYY HH24:MI');
  end if;

  -- Fill in the declared quantities for any line the caller did not mention, so
  -- line_details is always a complete picture of the pass rather than only the
  -- lines that happened to be disputed.
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
         -- An RGP now owes a return. Everything else is finished at the gate.
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                              else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle,
     remarks, gate_name, device_info, line_details, checks)
  values
    (p_pass_id, 'matched', auth.uid(), v_total,
     nullif(trim(coalesce(p_vehicle, '')), ''), p_remarks,
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info, v_lines, p_checks);

  return v_pass;
end;
$$;

-- ─── 4. Flag, with the same gate context ────────────────────────────────────
drop function if exists gatepass.flag_pass(uuid, text);

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

  if v_pass.status::text not in ('pending', 'held') then
    raise exception 'This pass is already %. Only a pending or held pass can be flagged.',
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

-- ─── 5. The verification view, rebuilt ──────────────────────────────────────
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- absorb the four new base-table columns (TRAP 2 — a view's column list is
-- fixed at creation).
drop view if exists gatepass.v_verifications;

create view gatepass.v_verifications
with (security_invoker = true)
as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join gatepass.profile_names su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

-- ─── 6. Grants ──────────────────────────────────────────────────────────────
-- Callable by any signed-in user; each function enforces its own role check, so
-- an HOD calling match_pass gets a clean refusal rather than a permission error.
grant execute on function gatepass.hold_pass(uuid, text, text, jsonb)                        to authenticated;
grant execute on function gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb)   to authenticated;
grant execute on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb)                 to authenticated;

notify pgrst, 'reload schema';

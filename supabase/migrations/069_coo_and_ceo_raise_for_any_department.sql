-- ============================================================================
-- 069 — THE COO AND THE CEO MAY RAISE A PASS FOR ANY DEPARTMENT
--
-- Client, 2026-08-31: "make sure CEO and COO has the ability to raise pass on
-- behalf of any department in their logins, so create those forms exactly as
-- the hod sees it except one thing that ceo and coo can select the department
-- to raise the gatepass."
--
-- TWO OFFICES ONLY, AND DELIBERATELY THE SAME TWO 067 ALREADY NAMES. The
-- Security Head and the Finance HOD gain nothing here: they sign a pass at the
-- gate's own rung and at level 2, and letting them originate the material they
-- vet is the collision 061/062's whole design exists to prevent. The COO and
-- the CEO are the fallback pair — 067 already trusts them with the emergency
-- release — so `holds_fallback_office()` is reused rather than restated. One
-- predicate, one place to change if the pair ever changes, and a deputy or a
-- time-boxed delegate is excluded from this exactly as they are from the
-- release: covering someone's signatures is not the same as raising material
-- in a department you do not head.
--
-- THE LADDER IS NOT SPECIAL-CASED. A pass raised by the COO is snapshotted by
-- the 063 trigger like any other and routes to the COO's own rung at level 3,
-- which they then sign themselves (client's explicit choice, 2026-08-31: "they
-- sign their own rung"). Nothing here touches `snapshot_pass_approvals`,
-- `approve_pass_level` or the escalation window — a COO-raised pass still needs
-- the Security Head and the Finance HOD, in that order, before it reaches them.
--
-- THE RAISER CAN SEE WHAT THEY RAISED, which is the other half of the feature
-- and is not automatic. `gate_passes_select` (067) admits a pass through the
-- department arm (`my_department_ids()` — an office holder has none, they are
-- VMS `staff`), the approver arm (`pass_routed_to_me` — 061 hides the pass
-- until every rung BELOW theirs is signed) or the stuck-pass arm. So without
-- the arm added below, a COO could raise a pass and then not be able to open,
-- print or even find it until the Security Head and Finance had both signed.
-- The arm is `raised_by = auth.uid()`: you may always read the pass you raised.
-- It widens nothing for anyone else — a guard cannot raise, and an HOD's own
-- passes are already admitted by the department arm.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Raising, for a department you do not head
-- ═══════════════════════════════════════════════════════════════════════════
-- 045's function verbatim from the item loop down; only the two guards at the
-- top change. SAME 9-ARGUMENT SIGNATURE, so no grant, no caller and no
-- PostgREST overload moves — `create or replace` keeps the existing grant.
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_item           jsonb;
  v_line           int := 0;
  v_any_department boolean;
begin
  -- Read ONCE: it is two catalog lookups, and the answer decides both guards.
  v_any_department := gatepass.holds_fallback_office();

  if gatepass.app_role() <> 'hod' and not v_any_department then
    raise exception 'Only an HOD, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_department then
    -- ANY department, but a REAL one. The `gate_passes.department_id` foreign
    -- key would refuse an invented uuid anyway; this refuses it in a sentence a
    -- person can read instead of as a constraint violation.
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise a pass for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  insert into gatepass.gate_passes
    (type, direction, department_id, raised_by, visitor_name, visitor_company,
     vehicle_number, purpose, expected_return_date)
  values
    (p_type, p_direction, p_department_id, auth.uid(), p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
  returning * into v_pass;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    insert into gatepass.gate_pass_items
      (gate_pass_id, line_no, name, description, purpose, quantity, unit,
       serial_no, approx_value, expected_return_date, department_id,
       make_model, invoice_no, remarks)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none (045).
      coalesce(
        nullif(trim(coalesce(v_item ->> 'purpose', '')), ''),
        nullif(trim(coalesce(p_purpose, '')), ''),
        'Material movement'
      ),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id,
      nullif(trim(coalesce(v_item ->> 'make_model', '')), ''),
      nullif(trim(coalesce(v_item ->> 'invoice_no', '')), ''),
      nullif(trim(coalesce(v_item ->> 'remarks', '')), '')
    );
  end loop;

  return v_pass;
end;
$$;

comment on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) is
  'Raises a gate pass. An HOD may raise only for a department they head; the sitting COO or CEO (holds_fallback_office(), 067) may raise for any department. See migration 069.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. You may always read the pass you raised
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER, for the reason every other arm of these policies is: the
-- line policy has to ask a question about the PARENT, and doing that with a
-- plain subquery would run `gate_passes_select` inside `gate_pass_items_select`
-- on every row. Cheap, single-column, and it answers about `auth.uid()` alone,
-- so it can tell no caller anything about anybody else.
create or replace function gatepass.raised_by_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.gate_passes g
            where g.id = p_pass_id
              and g.raised_by = auth.uid()
         );
$fn$;

comment on function gatepass.raised_by_me(uuid) is
  'True when the caller raised this pass. The originator arm of the two select policies (069) — a COO or CEO raising for a department they do not head has no other way to see their own pass until the ladder reaches them.';

revoke all on function gatepass.raised_by_me(uuid) from public;
grant execute on function gatepass.raised_by_me(uuid) to authenticated;

-- 067's two policies with ONE arm added to each, and nothing else touched.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select on gatepass.gate_passes
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or raised_by = auth.uid()
    or gatepass.pass_routed_to_me(id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(id))
  );

drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select on gatepass.gate_pass_items
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.raised_by_me(gate_pass_id)
    or gatepass.pass_routed_to_me(gate_pass_id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(gate_pass_id))
  );

notify pgrst, 'reload schema';

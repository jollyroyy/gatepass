-- 045 — the raise form is the client's mock-up: a vendor keeps its address, and
--       a line carries make / model, an invoice reference and remarks.
--
-- Client, 2026-08-19, with the "Raise Gate Pass" mock-up in hand. The form they
-- drew collects, per material line:
--
--   Item Description · Quantity · Make / Model / Size · Serial / Asset Tag ·
--   Invoice / Reference No. · Remarks / Description
--
-- Three of those have nowhere to go today, so this migration gives them one.
-- The other two columns the old form had — the per-item PURPOSE and the
-- per-item UOM — are not dropped: `purpose` is NOT NULL and is what every
-- record screen prints, and `unit` is what `isWholeUnit` and every return box
-- reason about. The form simply stops asking for them:
--
--   * purpose — the mock asks ONCE, for the whole pass ("Purpose / Description",
--     500 characters). `raise_pass` already takes `p_purpose`; it now also uses
--     it as each line's purpose when the caller sends none, so a line's reason
--     is the pass's reason rather than the literal 'Material movement'.
--   * unit — the mock has no UOM column (client: remove it), so every new line
--     is raised in the column default, 'nos'. KNOWN COST, FLAGGED TO THE CLIENT:
--     material that is genuinely counted in bags or drums can no longer be
--     raised in its own unit until a UOM control comes back.
--
-- VENDOR ADDRESS BECOMES REAL DATA. The mock's "Vendor Address (Auto-filled)"
-- cannot auto-fill from a blob: the address has only ever existed inside
-- `gate_passes.visitor_company`'s packed `{"n","a","v"}` JSON, which is a record
-- of ONE pass and is not queryable by vendor. It moves onto the vendor profile,
-- which is the row the form looks up by name. The packed blob is unchanged —
-- the pass still records the address as it was on the day, so editing a vendor
-- later cannot rewrite history on a printed slip.
--
-- No new `gate_passes` column, so `v_gate_passes` is untouched (TRAP 2 does not
-- apply). `gate_pass_items` is not in that view's select list at all — the
-- lateral join reads `name`, `quantity`, `returned_qty` and `approx_value` only.

-- ── 1. The vendor keeps its address ──────────────────────────────────────────
alter table gatepass.vendor_profiles
  add column if not exists address text;

alter table gatepass.vendor_profiles
  drop constraint if exists vendor_profiles_address_not_blank;
alter table gatepass.vendor_profiles
  add constraint vendor_profiles_address_not_blank
  check (address is null or length(trim(address)) > 0);

comment on column gatepass.vendor_profiles.address is
  'Vendor address, auto-filled into the raise form when the vendor is picked. The pass keeps its own copy in visitor_company packed JSON, so a later edit here never rewrites an issued pass.';

-- `list_vendor_profiles` returns `setof gatepass.vendor_profiles`, so the new
-- column joins its result with no change to the function. PostgREST caches the
-- composite type, hence the reload at the bottom of this file.

-- ── 2. save_vendor_profile takes the address ────────────────────────────────
-- A new parameter is a NEW function in Postgres, not a replacement, and two
-- overloads reachable by named arguments is exactly the ambiguity PostgREST
-- resolves by guessing. The 6-arg form is dropped in the same migration that
-- creates the 7-arg one — the same thing 031 did to 018's `raise_pass`.
drop function if exists gatepass.save_vendor_profile(text, uuid, text, text, text, text);

create or replace function gatepass.save_vendor_profile(
  p_company_name     text,
  p_department_id    uuid,
  p_contact_person   text default null,
  p_phone            text default null,
  p_vehicle_number   text default null,
  p_typical_material text default null,
  p_address          text default null
)
returns gatepass.vendor_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile gatepass.vendor_profiles;
begin
  if gatepass.app_role() not in ('hod', 'admin', 'super_admin') then
    raise exception 'Only HODs or admins can manage vendor profiles.';
  end if;

  insert into gatepass.vendor_profiles
    (company_name, department_id, contact_person, phone, vehicle_number,
     typical_material, address, created_by)
  values
    (p_company_name, p_department_id, p_contact_person, p_phone, p_vehicle_number,
     p_typical_material, nullif(trim(coalesce(p_address, '')), ''), auth.uid())
  on conflict (company_name, department_id)
  do update set
    contact_person   = coalesce(p_contact_person, vendor_profiles.contact_person),
    phone            = coalesce(p_phone, vendor_profiles.phone),
    vehicle_number   = coalesce(p_vehicle_number, vendor_profiles.vehicle_number),
    typical_material = coalesce(p_typical_material, vendor_profiles.typical_material),
    -- Blank never erases a stored address: the form sends what it has, and an
    -- HOD who raised a pass without retyping the address must not wipe it for
    -- everyone else.
    address          = coalesce(nullif(trim(coalesce(p_address, '')), ''), vendor_profiles.address),
    updated_at       = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function gatepass.save_vendor_profile(
  text, uuid, text, text, text, text, text
) to authenticated;

-- ── 3. A material line carries make / model, an invoice ref and remarks ─────
alter table gatepass.gate_pass_items
  add column if not exists make_model text,
  add column if not exists invoice_no text,
  add column if not exists remarks    text;

-- Blank-vs-null discipline, the same rule 013 put on `serial_no`: an empty
-- string and a null both read as "not given", and two spellings of nothing is
-- how a filter starts disagreeing with a report.
alter table gatepass.gate_pass_items
  drop constraint if exists gate_pass_items_mockup_text_not_blank;
alter table gatepass.gate_pass_items
  add constraint gate_pass_items_mockup_text_not_blank
  check (
    (make_model is null or length(trim(make_model)) > 0)
    and (invoice_no is null or length(trim(invoice_no)) > 0)
    and (remarks    is null or length(trim(remarks))    > 0)
  );

comment on column gatepass.gate_pass_items.make_model is
  'Make / Model / Size, as drawn on the raise mock-up. Required by the form, optional in the column: the rows that predate it have none.';
comment on column gatepass.gate_pass_items.invoice_no is
  'Invoice / Reference No. for the line — the paper the material came in on.';
comment on column gatepass.gate_pass_items.remarks is
  'Free remarks for the line. Distinct from `description`, which is the material itself and is NOT NULL.';

-- ── 4. raise_pass writes them ───────────────────────────────────────────────
-- SAME 9-ARGUMENT SIGNATURE as 019 — nothing new is asked of the caller, the
-- three new facts ride in each element of `p_items` beside `serial_no`. That is
-- deliberate: an overload change here would have to be reflected in every
-- caller and in the grant, for three optional strings.
--
-- Reproduced in full: `create or replace function` has no partial form.
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
  v_pass  gatepass.gate_passes;
  v_item  jsonb;
  v_line  int := 0;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only an HOD can raise a gate pass.';
  end if;

  if p_department_id is null
     or p_department_id not in (select gatepass.my_department_ids()) then
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
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none. The
      -- mock asks for purpose once, for the whole pass; falling through to the
      -- literal 'Material movement' would print that on every record screen
      -- while the real reason sat one field away on the same pass.
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

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) to authenticated;

notify pgrst, 'reload schema';

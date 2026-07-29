-- ============================================================================
-- 019 — Per-item name, purpose, and expected return date
--
-- Each material line now carries its own short name, detailed description,
-- individual purpose (reason), and expected return date. The pass-level
-- `purpose` and `expected_return_date` become convenience fields for bulk
-- pre-fill; the authoritative data lives on the items.
--
-- 1. Adds name, purpose, expected_return_date to gate_pass_items
-- 2. Makes gate_passes.purpose nullable
-- 3. Relaxes the RGP return-date constraint (dates are now per-item)
-- 4. Updates raise_pass / bulk_create_passes to accept per-item fields
-- 5. Rebuilds v_gate_pass_items and v_gate_passes
-- ============================================================================

-- ─── 1. Add columns to gate_pass_items ───────────────────────────────────────
alter table gatepass.gate_pass_items
  add column if not exists name               text,
  add column if not exists purpose            text,
  add column if not exists expected_return_date date;

-- Backfill existing rows: name from description, purpose empty, date from parent
update gatepass.gate_pass_items i
  set name = i.description,
      purpose = '',
      expected_return_date = p.expected_return_date
  from gatepass.gate_passes p
  where p.id = i.gate_pass_id
    and i.name is null;

-- Now enforce NOT NULL
alter table gatepass.gate_pass_items
  alter column name    set not null,
  alter column purpose set not null;

-- ─── 2. Relax pass-level constraints ─────────────────────────────────────────
-- Purpose can be null because the real reasons live on items now.
alter table gatepass.gate_passes
  alter column purpose drop not null;

-- The old return-date constraint forced every RGP-out to have a pass-level date.
-- With per-item dates, the pass-level field is just a convenience default.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_return_date_required,
  drop constraint if exists rgp_needs_return_date,
  drop constraint if exists gate_passes_expected_return_date_check;

-- ─── 3. Update check constraint on items ─────────────────────────────────────
alter table gatepass.gate_pass_items
  drop constraint if exists gate_pass_items_text_not_blank;

alter table gatepass.gate_pass_items
  add constraint gate_pass_items_text_not_blank
  check (length(trim(name)) > 0 and length(trim(description)) > 0 and length(trim(purpose)) > 0 and length(trim(unit)) > 0);

-- ─── 4. validate_pass ──────────────────────────────────────────────────────
-- Restated only to remove purpose from the insert-side trim block (purpose is
-- now on items, not the pass). The body is otherwise identical.
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

    v_today := (now() at time zone gatepass.site_tz())::date;

    if new.expected_return_date is not null then
      if new.expected_return_date < v_today then
        raise exception 'Expected return date % is already in the past. A pass cannot be born overdue.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
      if new.expected_return_date > v_today + 365 then
        raise exception 'Expected return date % is more than a year away. Check the year.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
    end if;
  end if;

  if new.status = 'cancelled' then
    if new.cancel_reason is null or length(trim(new.cancel_reason)) = 0 then
      raise exception 'A voided pass must record why. An unexplained void is indistinguishable from a cover-up.';
    end if;
    if new.verified_by is not null or new.verified_at is not null then
      raise exception 'A voided pass cannot also carry a loading-bay verification.';
    end if;
  elsif new.cancel_reason is not null then
    raise exception 'cancel_reason is set but the pass is %, not cancelled.', new.status;
  end if;

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

-- ─── 5. Update raise_pass ──────────────────────────────────────────────────
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb
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
       serial_no, approx_value, expected_return_date, department_id)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      coalesce(nullif(trim(coalesce(v_item ->> 'purpose', '')), ''), 'Material movement'),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id
    );
  end loop;

  return v_pass;
end;
$$;

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) to authenticated;

-- ─── 6. Update bulk_create_passes ──────────────────────────────────────────
create or replace function gatepass.bulk_create_passes(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb,
  p_count                int,
  p_name_prefix          text default 'Worker'
)
returns table (pass_id uuid, pass_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass   gatepass.gate_passes;
  v_item   jsonb;
  v_line   int;
  v_seq    int;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only an HOD can raise gate passes.';
  end if;

  if p_department_id is null
     or p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise passes for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  if p_count < 2 or p_count > 100 then
    raise exception 'Batch size must be between 2 and 100.';
  end if;

  for v_seq in 1 .. p_count
  loop
    insert into gatepass.gate_passes
      (type, direction, department_id, raised_by, visitor_name, visitor_company,
       vehicle_number, purpose, expected_return_date)
    values
      (p_type, p_direction, p_department_id, auth.uid(),
       p_name_prefix || ' - ' || lpad(v_seq::text, 3, '0'),
       p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
    returning * into v_pass;

    v_line := 0;
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_line := v_line + 1;
      insert into gatepass.gate_pass_items
        (gate_pass_id, line_no, name, description, purpose, quantity, unit,
         serial_no, approx_value, expected_return_date, department_id)
      values (
        v_pass.id,
        v_line,
        v_item ->> 'name',
        v_item ->> 'description',
        coalesce(nullif(trim(coalesce(v_item ->> 'purpose', '')), ''), 'Material movement'),
        (v_item ->> 'quantity')::numeric,
        coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
        nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
        nullif(v_item ->> 'approx_value', '')::numeric,
        nullif(v_item ->> 'expected_return_date', '')::date,
        p_department_id
      );
    end loop;

    pass_id   := v_pass.id;
    pass_number := v_pass.pass_number;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, date, jsonb, int, text
) to authenticated;

-- ─── 7. Rebuild v_gate_pass_items view ─────────────────────────────────────
create or replace view gatepass.v_gate_pass_items
with (security_invoker = true)
as
select
  i.*,
  i.quantity - i.returned_qty as outstanding_qty,
  p.pass_number,
  p.status      as pass_status,
  p.return_status
from gatepass.gate_pass_items i
join gatepass.gate_passes p on p.id = i.gate_pass_id;

grant select on gatepass.v_gate_pass_items to authenticated;

-- ─── 8. Rebuild v_gate_passes (material_summary now uses name, not description)
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
  'Gate passes plus every derived field. material_summary uses item name, not description.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

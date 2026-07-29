-- ============================================================================
-- 018 — Material image attachment and NRGP category (capital / non-capital)
--
-- 1. Adds image_url text column (optional, any pass type)
-- 2. Adds category  text column with check constraint 'capital'/'non_capital'
--    only for NRGP passes
-- 3. Creates storage.pass-images bucket for image uploads
-- 4. Rebuilds raise_pass and bulk_create_passes to accept p_image_url/p_category
-- 5. Rebuilds v_gate_passes to expose the new columns
-- ============================================================================

-- ─── 1. Add columns ───────────────────────────────────────────────────────────
alter table gatepass.gate_passes
  add column if not exists image_url text,
  add column if not exists category  text;

alter table gatepass.gate_passes
  add constraint gate_passes_category_nrgp_only
  check (category is null or (category in ('capital', 'non_capital') and type = 'NRGP'));

-- ─── 2. Storage bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('pass-images', 'pass-images', true)
on conflict (id) do nothing;

do $$ begin
  create policy "authenticated can upload pass-images"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "anyone can view pass-images"
    on storage.objects for select
    to authenticated, anon
    using (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;

-- ─── 3. Update raise_pass ────────────────────────────────────────────────────
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb,
  p_image_url            text default null,
  p_category             text default null
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
     vehicle_number, purpose, expected_return_date, image_url, category)
  values
    (p_type, p_direction, p_department_id, auth.uid(), p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date,
     p_image_url, p_category)
  returning * into v_pass;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    insert into gatepass.gate_pass_items
      (gate_pass_id, line_no, description, quantity, unit, serial_no, approx_value, department_id)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      p_department_id
    );
  end loop;

  return v_pass;
end;
$$;

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text, text
) to authenticated;

-- ─── 4. Update bulk_create_passes ─────────────────────────────────────────────
create or replace function gatepass.bulk_create_passes(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb,
  p_count                int,
  p_name_prefix          text default 'Worker',
  p_category             text default null
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
       vehicle_number, purpose, expected_return_date, category)
    values
      (p_type, p_direction, p_department_id, auth.uid(),
       p_name_prefix || ' - ' || lpad(v_seq::text, 3, '0'),
       p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date, p_category)
    returning * into v_pass;

    v_line := 0;
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_line := v_line + 1;
      insert into gatepass.gate_pass_items
        (gate_pass_id, line_no, description, quantity, unit, serial_no, approx_value, department_id)
      values (
        v_pass.id,
        v_line,
        v_item ->> 'description',
        (v_item ->> 'quantity')::numeric,
        coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
        nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
        nullif(v_item ->> 'approx_value', '')::numeric,
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
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, date, jsonb, int, text, text
) to authenticated;

-- ─── 5. Rebuild v_gate_passes view ────────────────────────────────────────────
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
         string_agg(i.description, ', ' order by i.line_no) as material_summary
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p.id
) it on true
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. is_overdue, is_expired, due_state, '
  'item roll-ups, image_url and category.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

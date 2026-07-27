-- ============================================================================
-- 016 — KPI extensions, returnable aging, vendor profiles, blacklist, bulk create
--
-- Five features in one migration because they all touch the same schema objects
-- (v_gate_passes, kpis, lookup_pass) and splitting them would force five
-- rebuilds of the view and five rounds of APPLY_ALL.sql churn.
--
-- 1. Extends kpis() with overdue_value, flagged_rate, return_rate
-- 2. Adds returnable_aging() — age-bucketed analysis of outstanding RGPs
-- 3. Adds vendor_profiles table — reusable company data for RaisePass
-- 4. Adds blacklist table — company/vehicle/driver blocks with scan-time check
-- 5. Adds bulk_create_passes — generate N passes from one template
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extended KPIs
-- ═══════════════════════════════════════════════════════════════════════════
-- CTE-based so `language sql` works without subqueries in aggregate context.
-- `overdue_value` is the sum of gate_pass_items.approx_value where the pass
-- is overdue. `flagged_rate` and `return_rate` are computed as percentages.
--
-- The item-value sum is approximate by design (gate_pass_items stores
-- indicative worth, not audited value). Never use it for financial reporting.
drop function if exists gatepass.kpis(uuid);

create or replace function gatepass.kpis(p_department_id uuid default null)
returns table (
  total            bigint,
  pending          bigint,
  matched          bigint,
  flagged          bigint,
  awaiting_return  bigint,
  overdue          bigint,
  raised_today     bigint,
  overdue_value    numeric,
  flagged_rate     numeric,
  return_rate      numeric
)
language sql
stable
as $$
  with base as (
    select *
    from gatepass.v_gate_passes v
    where p_department_id is null or v.department_id = p_department_id
  ),
  pass_values as (
    select
      i.gate_pass_id,
      coalesce(sum(i.approx_value), 0) as pass_value
    from gatepass.gate_pass_items i
    join base b on b.id = i.gate_pass_id
    group by i.gate_pass_id
  )
  select
    count(*)                                                        as total,
    count(*) filter (where status = 'pending')                      as pending,
    count(*) filter (where status = 'matched')                      as matched,
    count(*) filter (where status = 'flagged')                      as flagged,
    count(*) filter (where return_status::text in ('awaiting_return', 'partially_returned'))
                                                                    as awaiting_return,
    count(*) filter (where is_overdue)                              as overdue,
    count(*) filter (where created_at >= date_trunc('day', now()))  as raised_today,
    -- Sum of item values on overdue passes
    coalesce(sum(case when b.is_overdue then pv.pass_value else 0 end), 0)
                                                                    as overdue_value,
    -- Flagged as a percentage of total
    case when count(*) > 0
      then round((count(*) filter (where status = 'flagged')::numeric / count(*)::numeric) * 100, 1)
      else 0
    end                                                             as flagged_rate,
    -- Return rate: returned / (returned + awaiting_return + partially_returned) for RGPs only
    case when count(*) filter (where type = 'RGP'
      and return_status::text in ('returned', 'awaiting_return', 'partially_returned')) > 0
      then round(
        (count(*) filter (where type = 'RGP' and return_status = 'returned')::numeric /
         count(*) filter (where type = 'RGP'
           and return_status::text in ('returned', 'awaiting_return', 'partially_returned'))::numeric
        ) * 100, 1)
      else 0
    end                                                             as return_rate
  from base b
  left join pass_values pv on pv.gate_pass_id = b.id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Returnable aging
-- ═══════════════════════════════════════════════════════════════════════════
-- How long have items been out? Bucketed so the HOD can see if material that
-- was supposed to be back in a week is now in the 90+ bracket.
-- Uses `verified_at` (when the material actually left) with a fallback to
-- `created_at` for passes that were raised but never matched.
create or replace function gatepass.returnable_aging(p_department_id uuid default null)
returns table (
  bucket      text,
  item_count  bigint,
  total_value numeric
)
language sql
stable
as $$
  with active_rgp as (
    select p.id,
           coalesce(p.verified_at, p.created_at) as aging_start
    from gatepass.v_gate_passes p
    where p.type = 'RGP'
      and p.return_status::text in ('awaiting_return', 'partially_returned')
      and (p_department_id is null or p.department_id = p_department_id)
  ),
  aged as (
    select
      case
        when now() - ar.aging_start < interval '8 days'  then '0-7d'
        when now() - ar.aging_start < interval '31 days' then '8-30d'
        when now() - ar.aging_start < interval '91 days' then '31-90d'
        else '90+'
      end as bkt,
      i.approx_value
    from gatepass.gate_pass_items i
    join active_rgp ar on ar.id = i.gate_pass_id
  )
  select
    aged.bkt,
    count(*)::bigint,
    coalesce(sum(aged.approx_value), 0)
  from aged
  group by aged.bkt
  order by min(
    case aged.bkt
      when '0-7d' then 1
      when '8-30d' then 2
      when '31-90d' then 3
      when '90+' then 4
      else 5
    end);
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Vendor profiles
-- ═══════════════════════════════════════════════════════════════════════════
-- Reusable company data. An HOD saves a vendor's details once and selects
-- them from a dropdown when raising a pass, which pre-fills company name,
-- contact person, vehicle and typical material.
create table if not exists gatepass.vendor_profiles (
  id               uuid primary key default gen_random_uuid(),
  company_name     text not null,
  contact_person   text,
  phone            text,
  vehicle_number   text,
  typical_material text,
  department_id    uuid not null references public.departments(id),
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint vendor_profiles_unique_per_dept unique (company_name, department_id),
  constraint vendor_profiles_name_not_blank  check (length(trim(company_name)) > 0)
);

-- List vendors — scoped to the caller's departments unless p_department_id given
create or replace function gatepass.list_vendor_profiles(p_department_id uuid default null)
returns setof gatepass.vendor_profiles
language sql
stable
as $$
  select *
  from gatepass.vendor_profiles v
  where (p_department_id is null or v.department_id = p_department_id)
  order by v.company_name;
$$;

-- Upsert a vendor profile (create or update by company_name + department_id)
create or replace function gatepass.save_vendor_profile(
  p_company_name     text,
  p_department_id    uuid,
  p_contact_person   text default null,
  p_phone            text default null,
  p_vehicle_number   text default null,
  p_typical_material text default null
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
     typical_material, created_by)
  values
    (p_company_name, p_department_id, p_contact_person, p_phone, p_vehicle_number,
     p_typical_material, auth.uid())
  on conflict (company_name, department_id)
  do update set
    contact_person   = coalesce(p_contact_person, vendor_profiles.contact_person),
    phone            = coalesce(p_phone, vendor_profiles.phone),
    vehicle_number   = coalesce(p_vehicle_number, vendor_profiles.vehicle_number),
    typical_material = coalesce(p_typical_material, vendor_profiles.typical_material),
    updated_at       = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Delete a vendor profile
create or replace function gatepass.delete_vendor_profile(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if gatepass.app_role() not in ('hod', 'admin', 'super_admin') then
    raise exception 'Only HODs or admins can delete vendor profiles.';
  end if;

  delete from gatepass.vendor_profiles where id = p_id;
  if not found then
    raise exception 'Vendor profile not found.';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Blacklist / watchlist
-- ═══════════════════════════════════════════════════════════════════════════
-- Three entry types: company, vehicle, driver. A pass tied to a blacklisted
-- company or vehicle still gets an 'ok' outcome at scan time but with a
-- blacklist_match warning; the guard sees it and can decide how to handle it.
--
-- Created_by/blocked_by is set automatically to the admin who added it.
create table if not exists gatepass.blacklist (
  id          uuid primary key default gen_random_uuid(),
  list_type   text not null,
  list_value  text not null,
  reason      text not null,
  blocked_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  constraint blacklist_type_valid   check (list_type in ('company', 'vehicle', 'driver')),
  constraint blacklist_value_not_blank check (length(trim(list_value)) > 0),
  constraint blacklist_reason_not_blank check (length(trim(reason)) > 0),
  constraint blacklist_unique_entry unique (list_type, list_value)
);

-- Check blacklist — returns matches for a given company and/or vehicle
create or replace function gatepass.check_blacklist(
  p_company text default null,
  p_vehicle text default null,
  p_driver  text default null
)
returns table (list_type text, list_value text, reason text)
language sql
stable
as $$
  select b.list_type, b.list_value, b.reason
  from gatepass.blacklist b
  where (p_company is not null and b.list_type = 'company' and lower(b.list_value) = lower(trim(p_company)))
     or (p_vehicle is not null and b.list_type = 'vehicle' and lower(b.list_value) = lower(trim(p_vehicle)))
     or (p_driver  is not null and b.list_type = 'driver'  and lower(b.list_value) = lower(trim(p_driver)));
$$;

-- Admin: add blacklist entry
create or replace function gatepass.add_blacklist_entry(
  p_list_type  text,
  p_list_value text,
  p_reason     text
)
returns gatepass.blacklist
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry gatepass.blacklist;
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  insert into gatepass.blacklist (list_type, list_value, reason, blocked_by)
  values (p_list_type, trim(p_list_value), trim(p_reason), auth.uid())
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Admin: remove blacklist entry
create or replace function gatepass.remove_blacklist_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  delete from gatepass.blacklist where id = p_id;
  if not found then
    raise exception 'Blacklist entry not found.';
  end if;
end;
$$;

-- Admin: list all blacklist entries
create or replace function gatepass.list_blacklist_entries()
returns setof gatepass.blacklist
language sql
stable
as $$
  select *
  from gatepass.blacklist
  order by created_at desc;
$$;

grant execute on function gatepass.check_blacklist(text, text, text) to authenticated;
grant execute on function gatepass.add_blacklist_entry(text, text, text) to authenticated;
grant execute on function gatepass.remove_blacklist_entry(uuid) to authenticated;
grant execute on function gatepass.list_blacklist_entries() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Extend scan_attempts for blacklist audit trail
-- ═══════════════════════════════════════════════════════════════════════════
-- Records why a scan attempt triggered a blacklist warning, so the question
-- "how many blacklisted vehicles were scanned last night" has an answer.
alter table gatepass.scan_attempts
  add column if not exists blacklist_note text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Update lookup_pass — blacklist awareness
-- ═══════════════════════════════════════════════════════════════════════════
-- Outcome is still 'ok' (the guard CAN proceed), but blacklist_match carries
-- the reason text when the pass's company or vehicle is blacklisted.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Bulk create passes
-- ═══════════════════════════════════════════════════════════════════════════
-- Raises p_count passes from a single template. Each pass differs only in
-- its visitor_name (p_name_prefix + sequential number) and its pass_number.
-- All other fields (type, direction, department, items, purpose, vehicle,
-- expected_return_date) are identical across the batch.
--
-- Designed for scenarios like "30 workers from an agency arriving for an
-- event" or "12 trucks delivering sand for construction" — one HOD action
-- instead of 12 individual forms.
--
-- Each pass is an independent row with its own advisory-lock serial-number
-- generation, so the batch leaves no gaps in the day's sequence.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Grants
-- ═══════════════════════════════════════════════════════════════════════════
grant execute on function gatepass.kpis(uuid)          to authenticated;
grant execute on function gatepass.returnable_aging(uuid) to authenticated;
grant execute on function gatepass.list_vendor_profiles(uuid) to authenticated;
grant execute on function gatepass.save_vendor_profile(text, uuid, text, text, text, text) to authenticated;
grant execute on function gatepass.delete_vendor_profile(uuid) to authenticated;
-- lookup_pass grant was re-stated after the drop+recreate above
grant execute on function gatepass.lookup_pass(text) to authenticated;

grant execute on function gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, date, jsonb, int, text
) to authenticated;

notify pgrst, 'reload schema';

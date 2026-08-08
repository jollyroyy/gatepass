-- ============================================================================
-- 033 — blacklist: strict Indian vehicle format + company name always blocks
--
-- Two verified-live defects, both reported by the user 2026-08-08:
--
-- 1. A VENDOR NAME STORED UNDER THE WRONG TYPE WAS NEVER ENFORCED. The live
--    blacklist holds 'Yadav Infotech' with list_type = 'vehicle' (a form
--    mistake — the admin typed a company name while 'Vehicle' was selected).
--    The 027 trigger only compared the company against entries whose type is
--    'company', so a pass raised WITH that company name sailed through; the
--    HOD/guard had no warning and the gate pass was created. Verification of
--    027 on 2026-08-08 used an entry that happened to be typed under the
--    correct type 'company', so it looked enforced.
--
--    FIX: an inserted pass is refused if its vendor company name matches ANY
--    blacklist value, regardless of the entry's type. The error message names
--    the type and value that matched, so an admin who misfiled an entry can
--    see it. Vehicle plates still compare only against 'vehicle' entries and
--    driver names only against 'driver' — but a company name cannot be
--    smuggled past the ban by filing the entry under the wrong type.
--
-- 2. VEHICLE ENTRIES ACCEPTED ANY TEXT. The form stored whatever the admin
--    typed ('thar', 'Yadav Infotech') with no shape enforcement. A vehicle
--    that cannot be a registration number is noise — and, worse, could be a
--    company or person's name that silently never matched the plate column.
--    From now on a 'vehicle' entry MUST be a valid Indian registration number
--    (e.g. WB 09 AB 1234 — two letters, 1-2 digits, 1-3 letters, four digits;
--    the Bharat-series 22 BH 1234 XY is also accepted), and the value is
--    NORMALIZED before storage (uppercase, spaces/dashes removed) so a plate
--    can never be stored in two spellings that dodge each other. Existing
--    poorly-typed rows are left alone (they were entered deliberately); the
--    rule applies to new entries, and the company cross-match in (1) covers
--    the name-like ones anyway.
-- ============================================================================

-- ─── Normalisation + format check ─────────────────────────────────────────
-- WB 09 AB 1234 → WB09AB1234. A single-digit district is zero-padded
-- (WB 9 AB 1234 → WB09AB1234) so the same plate can never be stored or
-- matched in two spellings. Immutable so it is safe inside comparisons and
-- (like normalize_material) could back an index later without Postgres
-- suspecting volatile output.
create or replace function gatepass.normalize_vehicle(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- POSIX [:alnum:] — a plain [A-Z0-9] class under this server's collation
    -- mis-handles letters (verified live: 'WB9AB1234' came back as '91234').
    when upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g'))
         ~ '^[A-Z]{2}[0-9][A-Z]'
    then left(upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g')), 2)
         || '0'
         || substring(upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g')) from 3)
    else upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g'))
  end
$$;

comment on function gatepass.normalize_vehicle(text) is
  'Upper-cases a vehicle registration and strips everything but letters/digits, so WB 09 AB 1234 and wb-09-ab-1234 compare equal.';

-- The strict Indian plate shape, checked on the NORMALIZED form:
--   standard  WB 09 AB 1234  => WB09AB1234  ([A-Z]{2} [0-9]{1,2} [A-Z]{1,3} [0-9]{4})
--   Bharat   22 BH 1234 XY    => 22BH1234XY  ([0-9]{2} BH [0-9]{4} [A-Z]{2})
-- Anything else — 'thar', '12345', 'XY', 'ABC 1' — is not a car number and is
-- refused at add time (see add_blacklist_entry below).
create or replace function gatepass.is_indian_vehicle(p_raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    where gatepass.normalize_vehicle(p_raw) ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$'
       or gatepass.normalize_vehicle(p_raw) ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{2}$'
  )
$$;

comment on function gatepass.is_indian_vehicle(text) is
  'True only for a syntactically valid Indian registration number (normalised). Blocks random alphanumerics from entering the vehicle blacklist.';

-- ─── The raise-time trigger: company names block regardless of entry type ──
create or replace function gatepass.enforce_blacklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_vehicle text;
  v_driver  text;
  v_hit     record;
begin
  v_company := gatepass.company_name_of(new.visitor_company);
  v_vehicle := gatepass.normalize_vehicle(new.vehicle_number);
  v_driver  := lower(trim(coalesce(new.visitor_name, '')));

  select b.list_type, b.list_value, b.reason
    into v_hit
    from gatepass.blacklist b
   where (v_company is not null
          and lower(trim(b.list_value)) = lower(trim(v_company)))
      or (v_vehicle is not null
          and b.list_type = 'vehicle'
          and gatepass.normalize_vehicle(b.list_value) = v_vehicle)
      or (v_driver <> ''
          and b.list_type = 'driver'
          and lower(trim(b.list_value)) = v_driver)
   limit 1;

  if found then
    -- The reason is part of the refusal on purpose: an HOD told only "blocked"
    -- has no way to tell a deliberate ban from a typo, and will just retry.
    raise exception 'Blocked: % % is blacklisted (%). Reason: %',
      v_hit.list_type,
      v_hit.list_value,
      v_hit.list_type,
      coalesce(nullif(trim(coalesce(v_hit.reason, '')), ''), 'no reason recorded');
  end if;

  return new;
end;
$$;

-- BEFORE INSERT only, deliberately. Firing on UPDATE would mean that
-- blacklisting a vendor today breaks the gate for passes raised before the ban:
-- the guard could no longer match or flag material already standing at the
-- barrier. A ban stops NEW passes; it does not rewrite history.
drop trigger if exists gate_passes_enforce_blacklist on gatepass.gate_passes;
create trigger gate_passes_enforce_blacklist
  before insert on gatepass.gate_passes
  for each row execute function gatepass.enforce_blacklist();

comment on function gatepass.enforce_blacklist() is
  'BEFORE INSERT on gate_passes. Company name compares against EVERY list entry (a ban cannot be dodged by filing the vendor under the wrong type); vehicle numbers and driver names compare against their own types, case-insensitively.';

-- ============================================================================
-- add_blacklist_entry: strict format for vehicles, normalised storage
-- ============================================================================
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
  v_entry  gatepass.blacklist;
  v_value  text;
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  if p_list_type not in ('company', 'vehicle', 'driver') then
    raise exception 'Unknown blacklist type %. Expected company, vehicle or driver.', p_list_type;
  end if;

  if p_list_value is null or trim(p_list_value) = '' then
    raise exception 'A blacklist value is required.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required for every blacklist entry.';
  end if;

  if p_list_type = 'vehicle' then
    if not gatepass.is_indian_vehicle(p_list_value) then
      raise exception 'The blacklist vehicle is not a valid Indian registration number — expected e.g. WB 09 AB 1234 (got "%").',
        trim(p_list_value);
    end if;
    v_value := gatepass.normalize_vehicle(p_list_value);
  else
    v_value := trim(p_list_value);
  end if;

  -- Distinct-spelling duplicates are pointless (and dodge the case-insensitive
  -- matching above). normalize_vehicle already uppercased a plate; normalise
  -- names/drivers on the way in so 'bsc' and 'BSC' cannot both sit in the list.
  insert into gatepass.blacklist (list_type, list_value, reason, blocked_by)
  values (p_list_type, case when p_list_type = 'vehicle' then v_value else upper(v_value) end, trim(p_reason), auth.uid())
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function gatepass.add_blacklist_entry(text, text, text) from public;
grant execute on function gatepass.add_blacklist_entry(text, text, text) to authenticated;

-- ============================================================================
-- lookup_pass: the gate-side warning uses the SAME matching rules, so the
-- note a guard sees on a scan agrees with the refusal an HOD got at raise time
-- ============================================================================
drop function if exists gatepass.lookup_pass(p_code text);

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

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_value is not null
            and lower(trim(b.list_value))
                = lower(trim(gatepass.company_name_of(v_pass.visitor_company))))
        or (b.list_type = 'vehicle'
            and gatepass.normalize_vehicle(b.list_value)
                = gatepass.normalize_vehicle(v_pass.vehicle_number))
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

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ─── Existing rows that were stored under the wrong type ───────────────────
-- e.g. a company name filed under 'vehicle' — they now block company raises
-- via the cross-type match above; nothing needs migrating. Entries that were
-- formally plates are matched via normalize_vehicle on both sides.

notify pgrst, 'reload schema';
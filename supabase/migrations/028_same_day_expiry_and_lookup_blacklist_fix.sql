-- 028 — a pass that never reaches the gate expires at the end of ITS OWN day,
--       and the guard-side blacklist check stops reading raw JSON
--
-- ============================================================================
-- PART 1 — same-day expiry
-- ============================================================================
-- 008 set expires_at to the end of the NEXT day in gatepass.site_tz()
-- (`date_trunc('day', now) + interval '2 days' - 1us`). The business rule is
-- now: if material does not come to the gate on the day the pass was raised,
-- the pass is dead at midnight. So the window becomes the raising day only.
--
-- TRADE-OFF, STATED EXPLICITLY: a pass raised at 23:50 is now valid for ten
-- minutes. The old +2 days existed precisely to avoid that cliff. This is the
-- requested rule and it is implemented as asked, but late-evening passes will
-- expire almost immediately and have to be re-raised the next morning. If that
-- bites, the fix is to make the window "end of the raising day, but never less
-- than N hours", not to go back to +2 days.
--
-- There is deliberately NO new 'expired' enum label and NO pg_cron job.
-- Expiry is derived at query time from expires_at, exactly like is_overdue:
-- `is_expired` already exists in gatepass.v_gate_passes and needs no change.
-- A background job that flipped a status column would be a second source of
-- truth that is wrong between runs, and enum labels cannot be dropped once
-- added. The UI renders a pending pass with is_expired = true as "Expired".
--
-- match_pass already refuses an expired pass, and flag_pass deliberately still
-- does not — refusing to record a real mismatch because the paperwork went
-- stale is backwards. Neither is changed here.
create or replace function gatepass.set_pass_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  date_str text;
  prefix   text;
  seq_val  integer;
  tz       text := gatepass.site_tz();
begin
  date_str := pg_catalog.to_char((pg_catalog.now() at time zone 'UTC')::date, 'YYYYMMDD');
  prefix   := new.type::text || '-' || upper(new.direction::text) || '-' || date_str;

  -- Serialise number generation for this prefix. A plain max()+1 lets two
  -- concurrent inserts pick the same value and collide on the unique index.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gatepass_pass_number_' || prefix));

  select coalesce(max(substring(pass_number from '\d+$')::integer), 0)
    into seq_val
    from gatepass.gate_passes
   where pass_number like prefix || '-%';

  new.pass_number := prefix || '-' || lpad((seq_val + 1)::text, 4, '0');

  -- Server-owned columns. The client must never choose any of these: the number
  -- and timestamp are the audit anchor, and a crafted qr_token could pre-register
  -- a code for a pass nobody ever held.
  new.created_at  := pg_catalog.now();
  new.updated_at  := pg_catalog.now();
  new.qr_token    := gen_random_uuid();

  -- End of the raising day in site_tz (was: end of the NEXT day).
  new.expires_at  := ((date_trunc('day', (pg_catalog.now() at time zone tz)) + interval '1 day')
                       at time zone tz) - interval '1 microsecond';

  return new;
end;
$$;

-- ============================================================================
-- PART 2 — lookup_pass compared the blacklist against raw JSON
-- ============================================================================
-- `visitor_company` does NOT hold a plain company name: RaisePass writes
-- JSON.stringify({n: name, a: address, v: phone}), so the column holds
-- '{"n":"BSC","a":"...","v":"..."}'. lookup_pass compared
--     lower(b.list_value) = lower(trim(coalesce(v_pass.visitor_company,'')))
-- which can never equal 'bsc'. So the guard's scan NEVER surfaced a blacklist
-- note for a company — it silently returned null every time, which reads
-- exactly like "this vendor is fine".
--
-- 027 introduced gatepass.company_name_of() for precisely this and fixed the
-- raise-time path; this is the same bug on the gate-side read path. The vehicle
-- branch was always fine (vehicle_number is a bare string).
--
-- DROP first, not `create or replace`: the live function's OUT-parameter row
-- type differs from the one declared below, and Postgres refuses to change a
-- function's return type in place ("cannot change return type of existing
-- function"). Migration 025 hit the same wall with my_profile(). The execute
-- grant is re-applied immediately after, in this same transaction, so the
-- function is never left callable-by-nobody.
drop function if exists gatepass.lookup_pass(text);

create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid, blacklist_note text)
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
  elsif v_pass.expires_at < pg_catalog.now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_type = 'company'
            and lower(b.list_value)
                = lower(trim(coalesce(gatepass.company_name_of(v_pass.visitor_company), ''))))
        or (b.list_type = 'vehicle'
            and lower(b.list_value) = lower(trim(coalesce(v_pass.vehicle_number, ''))))
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

revoke all on function gatepass.lookup_pass(text) from public;
grant execute on function gatepass.lookup_pass(text) to authenticated;

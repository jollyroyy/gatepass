-- ============================================================================
-- 031 — RLS + read grants for reference data, lookup column rename, dead code
--
-- Four mutually-reinforcing defects, all verified live on 2026-08-08:
--
-- 1. `gatepass.blacklist` and `gatepass.vendor_profiles` had RLS DISABLED and
--    no SELECT grant at all. `list_blacklist_entries()` and
--    `list_vendor_profiles()` are plain (invoker) SQL functions, so every call
--    threw `42501 permission denied for table` — live-proven on 2026-08-08.
--    The RLS policies below are not decoration: they are what keeps a guard
--    from reading the blacklist (a gate-side summary of criminal vendors) and
--    an HOD from reading another department's vendor profiles, which the
--    earlier "no grants at all" posture achieved by throwing an error on
--    everyone. Scoped rows beat a blanket 42501.
--
-- 2. `lookup_pass` returned its blacklist column as `blacklist_note`, but
--    every client (GateLookup.tsx:76,88; types/index.ts:225) reads
--    `blacklist_match`. The guard scan silently dropped the reason. 028 fixed
--    the VALUE (raw-JSON comparison) but shipped it under the wrong column
--    name. The table column for the audit trail stays `blacklist_note`
--    (scan_attempts.audit); only the RPC's return name changes.
--
-- 3. Dead code sweep — the 'held' state has no UI button anywhere
--    (search verify-rls.mjs 'hm strong claim' — no caller in src/), bulk
--    create was deleted from the app 2026-08-08 and `bulk_create_passes` has
--    THREE overloads accumulated across 016/018/019, the 018-era 11-arg
--    `raise_pass` is superseded by the 019 9-arg (the only one the client
--    calls), `delete_vendor_profile` lost its page in the same frontend cut,
--    and `check_blacklist` is a plpgsql/sql function nobody calls (027's
--    trigger inlines its own lookup). All dropped. The `held` enum label
--    stays — Postgres cannot drop enum values — but no code path can set it
--    after this.
--
-- 4. The 020 per-pass material index was widened to unblock
--    bulk_create_passes (which is now dropped). With no bulk path, restore
--    the ORIGINAL invariant: one OPEN line per (department, material) —
--    migration 008's actual, documented intent, whose comment says precisely
--    "one pending pass per material per department".
--
-- 5. `storage.pass-images` was created `public=true` with an **anon** read
--    policy — anyone with the project ref could read a photographed
--    material. Nothing inside the app writes to it anymore (image upload
--    died with the 018-era UI). Lock it down: bucket private, read policy
--    restricted to authenticated.
--
-- ============================================================================

-- ─── 1. RLS on reference tables + read grants ───────────────────────────────
alter table gatepass.blacklist       enable row level security;
alter table gatepass.vendor_profiles enable row level security;

-- Blacklist: only admins may read it. A non-admin reading the blacklist needs
-- to be an explicit, reviewed decision — the gate's blacklist warning arrives
-- via lookup_pass (SECURITY DEFINER), never a table scan.
drop policy if exists blacklist_select_only_admin on gatepass.blacklist;
create policy blacklist_select_only_admin
  on gatepass.blacklist for select to authenticated
  using (gatepass.is_admin());

-- Vendor profiles: admins read all; an HOD reads only their own departments.
-- my_department_ids() is SECURITY DEFINER (002) so this policy cannot recurse.
drop policy if exists vendor_profiles_select_scoped on gatepass.vendor_profiles;
create policy vendor_profiles_select_scoped
  on gatepass.vendor_profiles for select to authenticated
  using (
    gatepass.is_admin()
    or (
      gatepass.app_role() = 'hod'
      and department_id in (select gatepass.my_department_ids())
    )
  );

-- The missing grants behind every 42501 above. Execute grants for the RPCs
-- already exist (016); these table grants let the invoker bodies run.
grant select on gatepass.blacklist       to authenticated;
grant select on gatepass.vendor_profiles to authenticated;

-- ─── 2. lookup_pass: blacklist_note → blacklist_match (return column) ───────
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

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ─── 3. Dead code ───────────────────────────────────────────────────────────
-- Bulk create (016/018-era successor overwritten only twice... actually three
-- overloads exist live, from 016, 018 and 019). Drop all three.
drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  text, date, jsonb, integer, text);

drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  integer, text, date, jsonb, text);

drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  text, date, jsonb, integer, text, text);

-- The 018-era raise_pass that took p_image_url/p_category (superseded by 019's
-- 9-arg signature, the only one the client calls).
drop function if exists gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text,
  text, date, jsonb, text, text);

-- No caller in src/ since the HOD Vendor Profiles page was deleted.
drop function if exists gatepass.delete_vendor_profile(uuid);

-- Nobody calls it; the per-pass hold UI never shipped.
drop function if exists gatepass.hold_pass(uuid, text, text, jsonb);

-- Nobody calls: the 027 trigger inlines the sole blacklist lookup.
drop function if exists gatepass.check_blacklist(text, text, text);

-- ─── 4. Restore the per-department material-uniqueness index ────────────────
-- 020 widened it to per-pass to let bulk_create_passes insert N identical
-- lines in one transaction. Bulk create is gone (dropped above); the intent
-- this index enforces is 008's: one OPEN line per (department, material).
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

create unique index gate_pass_items_one_open_per_department_material_idx
  on gatepass.gate_pass_items
     (department_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_department_material_idx is
  'One OPEN line per (department, material) — the 008 invariant, restored in 031 '
  '(020 widened this per-pass to unblock the now-deleted bulk_create_passes).';

-- ─── 5. Lock down storage.pass-images ───────────────────────────────────────
update storage.buckets
   set public = false
 where id = 'pass-images';

do $$ begin
  drop policy if exists "anyone can view pass-images" on storage.objects;
exception when others then null; end $$;

do $$ begin
  create policy "authenticated can view pass-images"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;
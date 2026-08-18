-- 042 — the pass number stops carrying the direction.
--
-- Client, 2026-08-18: "don't make the pass reference numbering of the RGP as
-- RGP out. It should be only RGP — no need to mention out or in."
--
--   before   RGP-OUT-20260818-0001
--   after    RGP-20260818-0001
--
-- 010 put the direction in the number so a guard could read which way the
-- material was moving off the slip. It never earned its place: NRGP is outward
-- only by check constraint, and `RaisePass` hardcodes `p_direction => 'out'`,
-- so every number ever generated says OUT. The column `direction` still holds
-- the fact, and the slip and every screen still read it from there — this
-- changes the LABEL only, no column, no constraint, no enum.
--
-- ONLY NEW PASSES CHANGE. The 45 existing rows keep the numbers that are on
-- printed slips and in people's hands: a pass number is an audit anchor, and
-- rewriting one silently invalidates the paper a guard is holding.
--
-- SEQUENCE SAFETY. The counter keys on the whole prefix, so it is now per
-- (type, day) instead of per (type, direction, day) — an RGP-in and an RGP-out
-- raised on the same day take consecutive numbers rather than colliding on
-- `gate_passes_pass_number_key`. The legacy rows cannot interfere either way:
-- 'RGP-20260818-%' does not match 'RGP-OUT-20260818-0001'.
--
-- Reproduced in full from 010 because a plpgsql body cannot be patched in
-- place; only the `prefix :=` line differs.
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
  date_str := to_char((now() at time zone 'UTC')::date, 'YYYYMMDD');
  prefix   := new.type::text || '-' || date_str;

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
  new.created_at  := now();
  new.updated_at  := now();
  new.qr_token    := gen_random_uuid();
  new.expires_at  := ((date_trunc('day', (now() at time zone tz)) + interval '2 days')
                       at time zone tz) - interval '1 microsecond';

  return new;
end;
$$;

comment on function gatepass.set_pass_number() is
  'Assigns pass_number as TYPE-YYYYMMDD-NNNN (042; the direction was dropped '
  'from the label — gate_passes.direction still carries the fact). Counter is '
  'per (type, day), serialised by an advisory lock on the prefix.';

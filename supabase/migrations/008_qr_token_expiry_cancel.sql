-- ============================================================================
-- 008 — Scannable QR token, pass expiry, HOD void, and a failed-scan log
--
-- Four related gaps, all on the gate-side path:
--
--   1. The QR code encoded the plaintext pass_number (IGP-20260726-0001), which
--      is SEQUENTIAL. Anyone holding one valid slip can read off the format and
--      print a code for a pass they never saw. An opaque random token fixes the
--      enumeration; the human-readable pass_number stays on the printed slip for
--      the typed fallback.
--   2. A 'pending' pass never expired. match_pass checked status and nothing
--      else, so a pass raised weeks ago was still good at the gate today.
--   3. An HOD who raised a pass by mistake had no way to void it. Nothing holds
--      UPDATE on gate_passes, so "just edit it" was never an option — the only
--      exits were match and flag, both of which need a guard.
--   4. Only SUCCESSFUL actions were recorded (gatepass.verifications). An
--      unknown code, an expired pass, or a second attempt on an already-matched
--      pass left no trace at all — exactly the events you want to see when
--      someone is probing the gate.
--   5. The same material could be issued twice: nothing stopped two pending
--      passes for "10 Dell laptops" in one department, and matching both sends
--      twice the material out on one authorisation.
--
-- A voided pass reaches the guard live with no extra work: gate_passes is
-- already in the supabase_realtime publication (002), the console subscribes
-- with event '*' (GateConsole.tsx:113), and its queue re-queries status =
-- 'pending' — so a cancel simply drops the row out of the gate queue.
--
-- ─── TWO POSTGRES TRAPS THIS FILE IS WRITTEN AROUND ─────────────────────────
--
-- TRAP 1: `alter type ... add value` may run inside a transaction (PG12+), but
-- the new value CANNOT BE USED in that same transaction. APPLY_ALL.sql is pasted
-- into the SQL Editor and runs as ONE transaction, so anything evaluated at DDL
-- time that mentions 'cancelled' fails with:
--
--     unsafe use of new value "cancelled" of enum type gatepass.pass_status
--
-- Consequences, both deliberate:
--   * There is NO check constraint like `cancelled_needs_reason` here, even
--     though it would mirror flagged_needs_reason (001:89-92). A CHECK is
--     evaluated when added and would abort the whole paste. The reason
--     requirement is enforced inside cancel_pass instead — which is the only
--     writer that can ever exist, since no client holds UPDATE.
--   * gatepass.kpis() is NOT extended with a cancelled counter here. It is
--     `language sql`, whose body IS parse-validated at creation, so a literal
--     'cancelled' in it would hit the same error. Add it in a LATER migration,
--     never this one.
--   * plpgsql bodies are stored as text and only syntax-checked, so cancel_pass
--     may reference 'cancelled' freely. That is why it is plpgsql, not sql.
--
-- If you are adding a status value in future: put the `alter type` in its own
-- migration, and use it in the next one.
--
-- TRAP 2: v_gate_passes selects `p.*`. A view's column list is FIXED when it is
-- created, so adding columns to gate_passes does not flow into it, and
-- `create or replace view` REFUSES to insert the new columns mid-list
-- ("cannot change name of view column"). The view must be dropped and rebuilt.
-- That is safe here: kpis() reads it but is $$-quoted, so Postgres records no
-- dependency and the drop succeeds — the function is simply broken for the
-- instant between the drop and the create, both inside one transaction.
-- ============================================================================

-- ─── Site timezone ──────────────────────────────────────────────────────────
-- The existing code stamps dates in UTC: the pass-number date (001:137) and
-- is_overdue (004:24-27). At UTC+5:30 that means a pass raised at 03:00 IST
-- already carries YESTERDAY's date, and a "same day" rule would expire at
-- 05:30 local. Expiry is a hard gate decision — a guard turning a truck away —
-- so it is pinned to real local time rather than inheriting that skew.
--
-- The pre-existing UTC stamping is left alone on purpose: changing pass-number
-- dates would renumber history, and changing is_overdue is a separate decision.
-- Fix those together, deliberately, in their own migration.
create or replace function gatepass.site_tz()
returns text
language sql
immutable
as $$ select 'Asia/Kolkata'::text $$;

comment on function gatepass.site_tz() is
  'Single source of truth for the site''s wall-clock timezone. Change here, not inline.';

-- ─── New columns ────────────────────────────────────────────────────────────
-- qr_token: what the QR code actually encodes. Random and opaque, so holding one
-- pass tells you nothing about any other. gen_random_uuid() is VOLATILE, so
-- adding the column rewrites the table and every existing row gets its own
-- distinct value — which is what makes the unique index below safe to add.
alter table gatepass.gate_passes
  add column if not exists qr_token uuid not null default gen_random_uuid();

create unique index if not exists gate_passes_qr_token_idx
  on gatepass.gate_passes (qr_token);

-- expires_at: when this pass stops being presentable at the gate.
alter table gatepass.gate_passes
  add column if not exists expires_at timestamptz;

-- cancel_reason: why the HOD voided it. Required by cancel_pass (see TRAP 1 —
-- this cannot be a check constraint in this migration).
alter table gatepass.gate_passes
  add column if not exists cancel_reason text;

-- ─── Enum extensions ────────────────────────────────────────────────────────
-- 'cancelled' is terminal, like 'flagged'. See TRAP 1 before using it anywhere
-- that Postgres evaluates at DDL time.
alter type gatepass.pass_status  add value if not exists 'cancelled';
alter type gatepass.verify_action add value if not exists 'cancelled';

-- ─── Expiry stamping ────────────────────────────────────────────────────────
-- Replaces the 001 trigger function wholesale (same name, so the trigger binding
-- is untouched). The pass_number half is unchanged — reproduced here because
-- `create or replace function` has no way to patch a body.
--
-- Validity runs to the END OF THE NEXT DAY, local time: a pass raised at 18:00
-- still works next morning, and an overnight delay does not force a re-raise,
-- but a forgotten pass goes stale within ~48h.
--
-- qr_token and expires_at are forced here rather than left to their column
-- defaults for the same reason created_at is (001:158): the client must not get
-- to choose them. A crafted insert naming its own qr_token would otherwise be
-- able to collide with, or pre-register, a token.
create or replace function gatepass.set_pass_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  date_str text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  prefix   text;
  seq_val  int;
  tz       text := gatepass.site_tz();
begin
  prefix := new.type::text || '-' || date_str;

  perform pg_advisory_xact_lock(hashtext('gatepass_pass_number_' || prefix));

  select coalesce(max(substring(pass_number from '(\d+)$')::int), 0)
    into seq_val
    from gatepass.gate_passes
   where pass_number like prefix || '-%';

  new.pass_number := prefix || '-' || lpad((seq_val + 1)::text, 4, '0');
  new.created_at  := now();   -- server owns the clock, not the client
  new.updated_at  := now();
  new.qr_token    := gen_random_uuid();

  -- Midnight tonight (local) + 2 days, minus a tick = 23:59:59.999999 tomorrow.
  new.expires_at  := ((date_trunc('day', (now() at time zone tz)) + interval '2 days')
                       at time zone tz) - interval '1 microsecond';
  return new;
end;
$$;

-- Also pin the new columns against later mutation, exactly as pass_number and
-- created_at already are. Nothing holds UPDATE today; this survives the day
-- something does.
create or replace function gatepass.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- These are immutable once written, whatever the client sends.
  new.pass_number := old.pass_number;
  new.created_at  := old.created_at;
  new.qr_token    := old.qr_token;
  new.expires_at  := old.expires_at;
  return new;
end;
$$;

-- Backfill rows that predate this migration. Their created_at is historic, so
-- the window is computed from it rather than from now() — a pass raised last
-- week must come out already expired, not freshly valid for two more days.
update gatepass.gate_passes
   set expires_at = ((date_trunc('day', (created_at at time zone gatepass.site_tz()))
                       + interval '2 days') at time zone gatepass.site_tz())
                     - interval '1 microsecond'
 where expires_at is null;

alter table gatepass.gate_passes alter column expires_at set not null;

-- ─── One pending pass per material, per department ──────────────────────────
-- Stops the same material being issued twice while the first pass is still open
-- at the gate — the double-issue hole: raise two passes for "10 Dell laptops",
-- match both, and twice the material leaves on one department's authority.
--
-- Enforced as a UNIQUE INDEX rather than a trigger check because it must be
-- RACE-SAFE. Two HODs submitting the same material in the same second would both
-- pass a `select ... if exists` test and both insert; only the index makes the
-- second one fail. Same reasoning as the advisory lock on pass_number.
--
-- SCOPE, and how to change it:
--   * Only 'pending' rows are indexed, so once a pass is matched, flagged or
--     voided the material is immediately free to be raised again.
--   * Scoped per DEPARTMENT: two departments moving identically-described
--     material are unrelated and must not block each other.
--   * Deliberately NOT scoped by `type`. Adding type to the index would let an
--     IGP and an NRGP for the same laptops both sit pending, which is the exact
--     double-issue this prevents. The cost is that a simultaneous inbound and
--     outbound pass for identically-worded material is refused; if that turns
--     out to be a real workflow, add `type` to the index and accept the trade.
--
-- Matching is on NORMALISED text, not the raw string, so "10 Dell Laptops",
-- "10  dell laptops" and " 10 Dell laptops " collide as they should. It is still
-- an exact match after normalisation — deliberately NOT fuzzy. A guard needs to
-- be able to predict whether a pass will be refused, and "sounds similar" is not
-- something anyone can reason about at a gate with a truck waiting.
create or replace function gatepass.normalize_material(p_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g'))
$$;

comment on function gatepass.normalize_material(text) is
  'Case/whitespace-insensitive key for the one-pending-pass-per-material rule. '
  'IMMUTABLE because a unique index depends on it — do not make it read tables.';

-- `status = 'pending'` is an EXISTING enum value, so this predicate is safe to
-- evaluate in the same transaction as the 'cancelled' ADD VALUE above (TRAP 1
-- applies only to the new value).
create unique index if not exists gate_passes_one_pending_per_material_idx
  on gatepass.gate_passes (department_id, gatepass.normalize_material(material_description))
  where status = 'pending';

grant execute on function gatepass.normalize_material(text) to authenticated;

-- ─── Scan attempt log ───────────────────────────────────────────────────────
-- Append-only, and deliberately records FAILURES — the successes already live in
-- gatepass.verifications. A run of 'not_found' rows from one guard's device is
-- what someone probing the gate with printed codes looks like.
--
-- scanned_code is text, not uuid: the whole point is to capture the garbage too.
create table if not exists gatepass.scan_attempts (
  id            uuid primary key default gen_random_uuid(),
  scanned_code  text not null,
  gate_pass_id  uuid references gatepass.gate_passes(id) on delete set null,
  scanned_by    uuid not null references public.profiles(id),
  outcome       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists scan_attempts_created_idx
  on gatepass.scan_attempts (created_at desc);
create index if not exists scan_attempts_outcome_idx
  on gatepass.scan_attempts (outcome) where outcome <> 'ok';

alter table gatepass.scan_attempts enable row level security;

-- Readable by security/admin only: an HOD has no reason to see what is being
-- waved at the gate, and the log necessarily contains other departments' codes.
drop policy if exists scan_attempts_select on gatepass.scan_attempts;
create policy scan_attempts_select
  on gatepass.scan_attempts for select to authenticated
  using (gatepass.is_security());

grant select on gatepass.scan_attempts to authenticated;
-- No INSERT grant and no INSERT policy: lookup_pass is the only writer, and it
-- is security definer. Same pattern as gatepass.verifications (002:157).

-- ─── Lookup: the one entry point for a scan ─────────────────────────────────
-- Accepts EITHER a qr_token (camera scan) or a pass_number (typed / wedge
-- scanner), so the console has a single code path for both.
--
-- Returns an outcome rather than raising, because every one of these is a normal
-- thing to happen at a gate and the guard needs to see WHY, not a stack trace.
-- The exception is authorization, which does raise — that is a bug or an attack,
-- not a gate event.
--
-- Note it returns pass_id, not the pass: the caller then reads v_gate_passes
-- under its OWN privileges, so this security definer function never becomes a
-- way to read a pass the caller could not otherwise see.
create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    gatepass.gate_passes;
  v_code    text := trim(coalesce(p_code, ''));
  v_uuid    uuid;
  v_outcome text;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can scan a gate pass.';
  end if;

  if v_code = '' then
    raise exception 'Nothing was scanned.';
  end if;

  -- A qr_token is a uuid; a pass_number never parses as one. Try the token
  -- first, and fall back to the printed number.
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
  elsif v_pass.status = 'cancelled' then
    v_outcome := 'cancelled';
  elsif v_pass.status <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;   -- already_matched / already_flagged
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome)
  values (v_code, v_pass.id, auth.uid(), v_outcome);

  return query select v_outcome, v_pass.id;
end;
$$;

-- ─── Expiry enforcement ─────────────────────────────────────────────────────
-- Replaces 003's match_pass, adding ONE check. Everything else is byte-identical
-- and reproduced because a function body cannot be patched in place.
--
-- flag_pass deliberately does NOT get this check. A guard who finds something
-- wrong with an expired pass must still be able to flag it — refusing to record
-- a real mismatch because the paperwork went stale is exactly backwards.
create or replace function gatepass.match_pass(
  p_pass_id          uuid,
  p_verified_quantity numeric default null,
  p_verified_vehicle  text    default null,
  p_remarks           text    default null
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
    raise exception 'Only security can verify a gate pass.';
  end if;

  -- Lock the row so two guards cannot both verify the same pass.
  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be verified.',
      v_pass.status;
  end if;

  if v_pass.expires_at < now() then
    raise exception 'This pass expired on %. Ask the HOD to raise a new one.',
      to_char(v_pass.expires_at at time zone gatepass.site_tz(), 'DD Mon YYYY');
  end if;

  update gatepass.gate_passes
     set status        = 'matched',
         verified_by   = auth.uid(),
         verified_at   = now(),
         -- An RGP now owes a return. Everything else is finished at the gate.
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                             else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  -- Record what the guard actually saw, which may differ from what was declared.
  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle, remarks)
  values
    (p_pass_id, 'matched', auth.uid(), p_verified_quantity, p_verified_vehicle, p_remarks);

  return v_pass;
end;
$$;

-- ─── Void: the HOD withdraws their own pass ─────────────────────────────────
-- Only the HOD who RAISED it, and only while it is still pending. Not security
-- (they have flag_pass) and not admin — an admin voiding another department's
-- paperwork with no trail is exactly the hole this system exists to close.
--
-- Terminal, like flagged. A voided pass is never revived; the HOD raises a new
-- one, which gets a new number and a new token.
create or replace function gatepass.cancel_pass(
  p_pass_id uuid,
  p_reason  text
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only the HOD who raised a pass can void it.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when voiding a pass.';
  end if;

  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- Checked after the row is loaded so the message can be specific, and against
  -- raised_by rather than department: holding the department is not enough, it
  -- must be YOUR pass.
  if v_pass.raised_by <> auth.uid() then
    raise exception 'You can only void a pass you raised yourself.';
  end if;

  if v_pass.status <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be voided.',
      v_pass.status;
  end if;

  update gatepass.gate_passes
     set status        = 'cancelled',
         cancel_reason = trim(p_reason)
   where id = p_pass_id
   returning * into v_pass;

  -- Same audit trail as every other state change, so the timeline on the detail
  -- screen stays complete. security_user_id holds the actor; here that is the HOD.
  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled', auth.uid(), trim(p_reason));

  return v_pass;
end;
$$;

grant execute on function gatepass.site_tz()               to authenticated;
grant execute on function gatepass.lookup_pass(text)       to authenticated;
grant execute on function gatepass.cancel_pass(uuid, text) to authenticated;

-- ─── Rebuild the view so the new columns appear ─────────────────────────────
-- See TRAP 2. Dropped and recreated, not `create or replace`, because p.* has
-- grown two columns in the middle of the list.
--
-- Everything else is carried forward from 006 UNCHANGED and must stay that way:
-- security_invoker (gate_passes RLS is enforced against the caller), LEFT JOINs
-- to tables VMS owns, joins to gatepass.profile_names rather than
-- public.profiles (the 42P17 fix), and exactly ONE definition of is_overdue.
--
-- is_expired joins it as the second computed column, for the same reason: one
-- definition, so no screen can ever disagree with match_pass about whether a
-- pass is still good.
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true) as
select
  p.*,
  (p.return_status = 'awaiting_return'
   and p.expected_return_date is not null
   and p.expected_return_date < (now() at time zone 'UTC')::date) as is_overdue,
  (p.status = 'pending' and p.expires_at < now()) as is_expired,
  d.name  as department_name,
  d.code  as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join public.departments      d  on d.id  = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

-- ─── Self-check ─────────────────────────────────────────────────────────────
-- As a signed-in GUARD (not the SQL editor, which is postgres and bypasses RLS):
--
--   select outcome, pass_id from gatepass.lookup_pass('<a qr_token>');   -- ok
--   select outcome, pass_id from gatepass.lookup_pass('nonsense');       -- not_found
--   select scanned_code, outcome from gatepass.scan_attempts order by created_at desc limit 5;
--
-- As the HOD who raised it: cancel_pass(<id>, 'wrong vehicle') succeeds, and a
-- second call refuses with 'This pass is already cancelled.'
-- As a DIFFERENT HOD: 'You can only void a pass you raised yourself.'

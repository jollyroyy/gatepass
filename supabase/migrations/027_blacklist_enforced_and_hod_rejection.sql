-- 027 — enforce the blacklist at raise time, and give the HOD a final rejection
--
-- ============================================================================
-- PART 1 — the blacklist was decorative
-- ============================================================================
-- `gatepass.blacklist` and `gatepass.check_blacklist()` have existed since 016,
-- but NOTHING called check_blacklist at raise time. A blacklisted vendor could
-- be given a gate pass exactly as easily as any other; the list was advisory
-- data that no code path consulted. (Live proof: the table already holds
-- company 'BSC' / reason 'not good', and passes for it were never refused.)
--
-- WHY A TRIGGER AND NOT A CHECK INSIDE raise_pass
--
-- The requirement is that a blacklisted vendor cannot be raised *anywhere*.
-- Enforcing inside raise_pass only covers the paths someone remembered to
-- patch, and this schema currently carries TWO raise_pass overloads (a 9-arg
-- and a stale 11-arg one from 018) plus bulk_create_passes. A BEFORE INSERT
-- trigger on the table covers every one of them, including any RPC added
-- later, and cannot be bypassed by picking a different overload.
--
-- THE JSON TRAP
--
-- `visitor_company` does NOT hold a plain company name. RaisePass writes
-- JSON.stringify({n: name, a: address, v: phone}), so the column holds
-- '{"n":"BSC","a":"...","v":"..."}'. check_blacklist compares
-- lower(list_value) = lower(trim(p_company)), which can never match that blob —
-- so a naive hook-up would have looked correct, passed review, and blocked
-- nothing at all. company_name_of() below unwraps it, falling back to the raw
-- text for older passes that stored a bare name.

create or replace function gatepass.company_name_of(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_raw is null or trim(p_raw) = '' then
    return null;
  end if;

  -- Older rows hold a bare company name, which is not valid JSON. A failed
  -- cast is the signal to treat the value as the name itself, not an error.
  begin
    v := p_raw::jsonb;
  exception when others then
    return trim(p_raw);
  end;

  if jsonb_typeof(v) = 'object' then
    return nullif(trim(coalesce(v ->> 'n', '')), '');
  end if;

  return trim(p_raw);
end;
$$;

comment on function gatepass.company_name_of(text) is
  'Unwraps the {"n","a","v"} JSON in gate_passes.visitor_company to the company name. Falls back to the raw text for legacy rows that stored a bare name.';

create or replace function gatepass.enforce_blacklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_hit     record;
begin
  v_company := gatepass.company_name_of(new.visitor_company);

  select b.list_type, b.list_value, b.reason
    into v_hit
    from gatepass.blacklist b
   where (v_company is not null
          and b.list_type = 'company'
          and lower(b.list_value) = lower(trim(v_company)))
      or (new.vehicle_number is not null
          and b.list_type = 'vehicle'
          and lower(b.list_value) = lower(trim(new.vehicle_number)))
      or (new.visitor_name is not null
          and b.list_type = 'driver'
          and lower(b.list_value) = lower(trim(new.visitor_name)))
   limit 1;

  if found then
    -- The reason is part of the refusal on purpose: an HOD told only "blocked"
    -- has no way to tell a deliberate ban from a typo, and will just retry.
    raise exception 'Blocked: this % is blacklisted (%). Reason: %',
      v_hit.list_type,
      v_hit.list_value,
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

-- ============================================================================
-- PART 2 — the HOD can now finally reject a flagged pass, not only approve it
-- ============================================================================
-- 024 removed the 'reject' branch, leaving approve as the only outcome: a
-- flagged pass the HOD did NOT want to release just sat at 'flagged' forever,
-- with no way to say "security was right, this material stays".
--
-- The terminal state is 'cancelled', which already exists in BOTH
-- gatepass.pass_status and gatepass.verify_action. That matters: a NEW enum
-- label cannot be referenced by a check constraint in the transaction that adds
-- it, and APPLY_ALL.sql is pasted as ONE transaction — so introducing a
-- 'rejected' label would abort the whole paste at the constraint below.
-- Reusing an existing label sidesteps that entirely.
--
-- This does NOT reopen the cancellation 024 closed. 024 stopped an HOD voiding
-- their own pass on a whim. This is narrower by construction: it applies only
-- to a pass security has ALREADY stopped, and only the raising HOD may do it.
-- Nothing here restores a DELETE grant or an UPDATE policy; the state machine
-- stays RPC-only.
create or replace function gatepass.hod_review_flagged_pass(
  p_pass_id uuid,
  p_action  text,
  p_reason  text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    gatepass.gate_passes;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.raised_by <> v_user_id then
    raise exception 'Only the HOD who raised this pass can review it.';
  end if;

  if v_pass.status::text <> 'flagged' then
    raise exception 'Only a flagged pass can be reviewed. This pass is %.', v_pass.status;
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'A flagged pass can only be approved or rejected.';
  end if;

  if p_action = 'approve' then
    update gatepass.gate_passes
       set status = 'hod_reviewed'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'hod_reviewed'::gatepass.verify_action, v_user_id,
       'HOD approved override of security flag');
  else
    -- flag_reason is deliberately preserved (see 026): a rejected pass must
    -- keep the record of WHY security stopped it.
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
       coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                'HOD upheld the security flag and rejected this pass'));
  end if;

  return v_pass;
end;
$$;

revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- 026 widened this to an allow-list of flagged/hod_reviewed/matched. A rejected
-- pass is 'cancelled' and keeps its reason, so that state must be permitted too
-- — but the constraint is INVERTED to a deny-list rather than simply appending
-- 'cancelled', and that is not a style choice.
--
-- 'cancelled' is added to gatepass.pass_status by migration 008. APPLY_ALL.sql
-- is pasted as ONE transaction, and Postgres evaluates a CHECK expression at
-- DDL time, so a constraint naming 'cancelled' aborts the entire paste with
-- "unsafe use of new value". It would work on this live database (where 008 ran
-- long ago) and fail on every fresh deploy — the worst kind of bug to ship.
-- tests/security/sqlInvariants.test.ts catches exactly this and caught it here.
--
-- Naming only 'pending' and 'held' — both original 001 labels — sidesteps it,
-- and states 012's real intent more directly anyway: no accusation may sit on a
-- pass that nobody has acted on yet. Every state that CAN carry a reason is a
-- state something has already happened in.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_flag_reason_only_when_flagged,
  add  constraint gate_passes_flag_reason_only_when_flagged
    check (flag_reason is null
        or status not in ('pending', 'held'));

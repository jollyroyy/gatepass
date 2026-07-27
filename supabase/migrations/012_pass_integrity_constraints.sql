-- ============================================================================
-- 012 — Pass integrity constraints
--
-- Two things, one theme: make the database refuse a pass that cannot describe a
-- real movement of material through the loading bay.
--
-- 1. THE OPEN-PASS RULE (the reason this migration exists).
--
--    008 gave us `gate_passes_one_pending_per_material_idx`, keyed
--    `where status = 'pending'`. That only covers the window between an HOD
--    raising a pass and a guard verifying it. The moment the guard MATCHES an
--    RGP the row becomes matched/awaiting_return, falls out of the predicate,
--    and nothing stops a second RGP being raised for material that is still
--    physically outside the mall.
--
--    Concretely: Engineering raises RGP-OUT for "chiller pump #3", the guard
--    matches it, the pump leaves for the vendor. Ten minutes later the same
--    department can raise a second RGP-OUT for "Chiller Pump #3" and the
--    database says yes — despite there being exactly one pump, and it not being
--    on site. The loading-bay log now shows two live obligations for one object.
--
--    The predicate is widened to "still open": pending (not yet at the gate) OR
--    awaiting_return (out, and owed back). Flagged, cancelled, returned and
--    matched-NRGP all fall out, because none of them leaves an obligation
--    outstanding — a returned pump SHOULD be sendable out again.
--
--    Both 'pending' and 'awaiting_return' are enum values from 001, so this
--    predicate is safe to evaluate in the same transaction APPLY_ALL.sql pastes.
--    TRAP 1 applies only to values added by a LATER `alter type ... add value`.
--
-- 2. THE EDGE CASES a pass could previously express and should not.
--
--    Split by what Postgres will let us use, not by preference:
--
--    * CHECK constraints — anything immutable. Cheap, always enforced, visible
--      in the catalog. Used for everything that does not need the clock.
--    * The `validate_pass` trigger — anything needing now(), and anything
--      naming 'cancelled'. That label was added in 008, and APPLY_ALL.sql runs
--      008 and 012 in ONE transaction, so a CHECK constraint mentioning it
--      would abort the entire paste with "unsafe use of new value". plpgsql
--      bodies are stored as text and are exempt. This is the same trap that
--      kept 008 from adding `cancelled_needs_reason`; it has not gone away, so
--      the rule lives in a trigger instead of finally becoming a constraint.
--
-- Safe to run against existing data: gate_passes is empty, and every rule here
-- is one the RPCs already upheld in code. They are being moved into the
-- database so they survive a caller that forgets.
-- ============================================================================

-- ─── 1. One OPEN pass per material per department ───────────────────────────
-- Dropped, not kept alongside: two overlapping unique indexes on the same key
-- means the narrow one goes on rejecting inserts the wide one was rewritten to
-- allow, and the error message would name an index whose stated rule is no
-- longer the rule.
drop index if exists gatepass.gate_passes_one_pending_per_material_idx;

create unique index if not exists gate_passes_one_open_per_material_idx
  on gatepass.gate_passes (department_id, gatepass.normalize_material(material_description))
  where status = 'pending' or return_status = 'awaiting_return';

comment on index gatepass.gate_passes_one_open_per_material_idx is
  'One OPEN pass per material per department. Open = pending (not yet verified at '
  'the loading bay) or awaiting_return (out, and owed back). Race-safe by '
  'construction — a `select ... if exists` check in the app is not, because two '
  'simultaneous submissions both pass it. Scoped per department on purpose: '
  'material_description is free text, and two departments each moving something '
  'they both call "trolley" is not a duplicate.';

-- ─── 2a. Immutable rules — CHECK constraints ────────────────────────────────
-- `not null` does not mean "has a value": '' and '   ' both satisfy it. A blank
-- visitor_name defeats attributability, which is most of the point of the log.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_text_not_blank,
  add  constraint gate_passes_text_not_blank
    check (length(trim(visitor_name)) > 0
       and length(trim(material_description)) > 0
       and length(trim(purpose)) > 0
       and length(trim(unit)) > 0);

-- Optional columns: absent is fine, present-but-blank is not. '' and NULL
-- meaning different things in the same column is how a report ends up counting
-- the same missing vehicle twice.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_optional_text_not_blank,
  add  constraint gate_passes_optional_text_not_blank
    check ((visitor_company is null or length(trim(visitor_company)) > 0)
       and (vehicle_number  is null or length(trim(vehicle_number))  > 0));

-- Upper bound on quantity. 001 already forbids <= 0; the other end was open, so
-- a fat-fingered "99999999" passed. Nothing that moves through a mall loading
-- bay on one pass is a million units, and a wrong quantity is exactly what the
-- guard is standing there to compare against.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_quantity_sane,
  add  constraint gate_passes_quantity_sane
    check (quantity <= 1000000);

-- Verification is one event: who and when are set together or not at all.
-- Half-set means a matched pass with no verifier name, which reads as tampering
-- and is indistinguishable from it.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_verified_pair,
  add  constraint gate_passes_verified_pair
    check ((verified_by is null) = (verified_at is null));

-- Time cannot run backwards. Each of these is reachable only by a bad direct
-- write, which is precisely the case the RPCs cannot defend against.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_timeline_sane,
  add  constraint gate_passes_timeline_sane
    check ((verified_at        is null or verified_at        >= created_at)
       and (actual_return_date is null or actual_return_date >= created_at)
       and expires_at > created_at);

-- 001 requires a reason WHEN flagged; this requires flagged when there is a
-- reason. Without it a pending pass can carry an accusation nobody acted on.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_flag_reason_only_when_flagged,
  add  constraint gate_passes_flag_reason_only_when_flagged
    check (flag_reason is null or status = 'flagged');

-- A matched RGP owes a return, always — match_pass sets awaiting_return and
-- mark_returned moves it to returned. 'not_applicable' on a matched RGP means
-- material left the mall with nothing tracking its way back.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_matched_rgp_owes_return,
  add  constraint gate_passes_matched_rgp_owes_return
    check (status <> 'matched'
        or type <> 'RGP'
        or return_status <> 'not_applicable');

-- ─── 2b. Clock- and 'cancelled'-dependent rules — trigger ───────────────────
-- Named `validate_pass` deliberately: Postgres fires BEFORE triggers in
-- alphabetical order, and 's'(set_pass_number) < 't'(touch_updated_at) < 'v',
-- so this sees the final row — pass_number, qr_token and expires_at already
-- stamped by 001/010's triggers.
--
-- Normalisation happens here rather than in the app because the CHECK
-- constraints above run AFTER every BEFORE trigger: '   ' is trimmed to '' and
-- then correctly rejected, instead of being stored as whitespace.
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
    new.visitor_name         := trim(new.visitor_name);
    new.material_description := trim(new.material_description);
    new.purpose              := trim(new.purpose);
    new.unit                 := lower(trim(new.unit));
    -- Blank optional fields collapse to NULL so "not given" has one spelling.
    new.visitor_company      := nullif(trim(coalesce(new.visitor_company, '')), '');
    -- Vehicle numbers are compared by eye against a plate at the loading bay,
    -- often at night. Store them one way so two records of the same van match.
    new.vehicle_number       := nullif(upper(trim(coalesce(new.vehicle_number, ''))), '');

    -- Dates are judged against the mall's wall clock, not UTC. site_tz() is
    -- Asia/Kolkata; using UTC here would misjudge everything raised after
    -- 18:30 local by a full day.
    v_today := (now() at time zone gatepass.site_tz())::date;

    if new.expected_return_date is not null then
      if new.expected_return_date < v_today then
        raise exception 'Expected return date % is already in the past. A pass cannot be born overdue.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;

      -- Catches a mistyped year (2260 for 2026), which would otherwise sit in
      -- the awaiting-return list forever and never once show as overdue.
      if new.expected_return_date > v_today + 365 then
        raise exception 'Expected return date % is more than a year away. Check the year.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
    end if;
  end if;

  -- Applies to INSERT and UPDATE. 'cancelled' is why this is a trigger and not
  -- a CHECK constraint — see the header.
  if new.status = 'cancelled' then
    if new.cancel_reason is null or length(trim(new.cancel_reason)) = 0 then
      raise exception 'A voided pass must record why. An unexplained void is indistinguishable from a cover-up.';
    end if;

    -- A pass cannot be both withdrawn by the HOD and verified at the gate. One
    -- of the two records would be false, and there is no way to tell which.
    if new.verified_by is not null or new.verified_at is not null then
      raise exception 'A voided pass cannot also carry a loading-bay verification.';
    end if;

  elsif new.cancel_reason is not null then
    raise exception 'cancel_reason is set but the pass is %, not cancelled.', new.status;
  end if;

  -- Material cannot come back before it went out.
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

comment on function gatepass.validate_pass() is
  'Rules that cannot be CHECK constraints: those needing now(), and those naming '
  'the ''cancelled'' enum label (added in 008 — APPLY_ALL.sql runs 008 and 012 in '
  'one transaction, so a constraint naming it aborts the whole paste). MUST stay '
  'plpgsql for that reason; a language sql body is parse-validated at CREATE time.';

drop trigger if exists validate_pass on gatepass.gate_passes;
create trigger validate_pass
  before insert or update on gatepass.gate_passes
  for each row execute function gatepass.validate_pass();

-- ─── Considered and deliberately NOT added ──────────────────────────────────
-- * A check constraining scan_attempts.outcome to the six known strings. The
--   column is text, so the literal 'cancelled' would be safe there — but
--   sqlInvariants.test.ts greps every CHECK body for that word and cannot tell
--   a text literal from an enum value. Loosening a security test to buy a
--   nice-to-have constraint is the wrong trade.
-- * Blocking an HOD with an overdue RGP from raising anything new. It would
--   stop real work at the loading bay over paperwork, and the overdue list
--   already surfaces it.
-- * Uniqueness on vehicle_number while a pass is open. One van legitimately
--   carries several passes on one trip.
--
-- ─── Self-check ─────────────────────────────────────────────────────────────
-- As an HOD, in order:
--   1. Raise RGP-OUT for 'chiller pump 3'.
--   2. Raise it again              → 23505, gate_passes_one_open_per_material_idx.
--   3. Have a guard match pass 1, then raise it again
--                                  → STILL 23505. This is the case 008 missed.
--   4. Have the guard mark_returned pass 1, then raise it again → succeeds.
--   5. Raise with expected_return_date = yesterday → 'cannot be born overdue'.
--   6. Raise with visitor_name = '   '             → gate_passes_text_not_blank.

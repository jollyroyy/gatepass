-- ============================================================================
-- 074 — the reference number is REAL while the form is still being filled
--
-- Client, 2026-09-01: "make the gate pass reference number visible fully while
-- they are creating the pass in that page."
--
--   before   RGP-IT-####     a shape, with the serial honestly unknown
--   after    RGP-IT-0042     the number this pass will actually carry
--
-- ═══ WHAT THIS COSTS, STATED UP FRONT ═══
--
-- A number is now allocated when the FORM OPENS rather than when the pass is
-- inserted, so a form opened and abandoned burns one and leaves a permanent gap
-- in that department's series. The client was shown this trade and chose it:
-- being able to read, write down and quote the reference before submitting is
-- worth more here than a gapless sequence. `set_pass_number`'s own comment
-- (064) is now partly overtaken — the serial is no longer "honestly unknown
-- until the pass exists", it is knowable because we now make it exist first.
--
-- TWO THINGS KEEP THE GAPS RARE RATHER THAN ROUTINE:
--
--   1. RELEASE. Changing the pass type or the department changes the PREFIX, so
--      the reserved number no longer belongs to the pass being written. The
--      client releases it (`release_pass_number`) before taking the next one,
--      and because the counter is a live `max()` over both tables rather than a
--      stored cursor, releasing the highest number genuinely hands it back —
--      the next reservation for that prefix takes it again. Toggling RGP/NRGP
--      four times therefore burns nothing.
--   2. EXPIRY. A reservation is good for `RESERVATION_HOURS` (12 — longer than
--      a shift, shorter than a weekend). `reserve_pass_number` sweeps expired,
--      unconsumed rows for its own prefix before it counts, so a form left open
--      overnight returns its number to the pool by itself.
--
-- If a reservation HAS expired by the time the form is submitted, nothing
-- breaks and nothing is refused: the trigger simply falls through and allocates
-- a fresh number the ordinary way. The confirmation screen renders the number
-- the RPC returned, never the one the form was holding, so the person is always
-- shown what the pass really carries.
--
-- ═══ THE COUNTER IS ONE RULE OVER TWO TABLES ═══
--
-- `set_pass_number` counted `max(serial)` over `gate_passes` alone. It now
-- takes the greater of that and the same max over `pass_number_reservations`,
-- under the SAME advisory lock on the SAME prefix string that 064/042/010 used.
-- Both readers and both writers therefore serialise against each other, and a
-- reserved-but-unsubmitted number cannot be handed to a second person.
--
-- ═══ THE TRIGGER VALIDATES, NOT THE RPC ═══
--
-- `raise_pass` passes the client's number straight through to the INSERT and
-- makes no decision about it. `set_pass_number` — which is BEFORE INSERT and
-- which nothing can bypass, since no client holds INSERT on `gate_passes`
-- directly — is what checks that the number was really reserved, by THIS
-- caller, for THIS type and department, and is unexpired and unconsumed. Only
-- then is it honoured; otherwise it is discarded and a number is generated.
--
-- That placement is the security property. A crafted `p_pass_number` cannot
-- pre-register a label for a pass nobody held, cannot steal a colleague's
-- reserved number, and cannot collide with an existing one — the same three
-- things 001 wrote the trigger to guarantee in the first place.
--
-- ═══ TWO-SCHEMA RULE ═══
--
-- The new table lives in `gatepass` and references `public.departments` and
-- `public.profiles` by foreign key only, with no cascade and no DDL of any kind
-- on VMS's side.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The reservations
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `pass_number` is the primary key because that IS the identity of the thing
-- being reserved, and a unique constraint on it is what stops the same label
-- being handed out twice even if the advisory lock were somehow bypassed.
--
-- `consumed_at` is kept rather than the row deleted on use: it is the audit
-- answer to "who reserved the number this pass carries", and it also stops a
-- released-and-reused number being double-consumed by a retried insert.
create table if not exists gatepass.pass_number_reservations (
  pass_number   text primary key,
  type          gatepass.pass_type not null,
  department_id uuid not null references public.departments(id),
  reserved_by   uuid not null references public.profiles(id),
  reserved_at   timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);

comment on table gatepass.pass_number_reservations is
  'A pass number handed to a raiser while the form is still open (074), so the '
  'reference can be read in full before submitting. Consumed by '
  'set_pass_number() on insert; released by release_pass_number() or by expiry. '
  'An unconsumed, unreleased row that expires leaves a gap in the series — the '
  'accepted cost of showing a real number up front.';

-- The one index the sweep and the counter both want: every query in this
-- migration is "the live reservations for this prefix", which is a
-- (type, department) scan.
create index if not exists pass_number_reservations_prefix_idx
  on gatepass.pass_number_reservations (type, department_id)
  where consumed_at is null;

-- RLS ON, AND DELIBERATELY NO POLICY. Nothing reads this table over PostgREST:
-- the reserve/release RPCs below are SECURITY DEFINER and return the one string
-- their caller needs. With RLS enabled and no policy, a direct
-- `from('pass_number_reservations')` returns nothing to anybody, which is the
-- correct answer — one person's unsubmitted reference is not another's business,
-- and the table is a counter, not a record.
alter table gatepass.pass_number_reservations enable row level security;

-- No grants either. `authenticated` was granted table privileges wholesale on
-- this schema by 002, so the grant is REVOKED here explicitly rather than
-- merely not given — a table created after that grant does not inherit it, but
-- re-toggling Exposed schemas in the dashboard re-runs `grant all` (see 009),
-- and this revoke is what 009 will need to restate.
revoke all on gatepass.pass_number_reservations from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The next serial, defined once, over both tables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Callers MUST already hold the advisory lock for this prefix. It is not taken
-- here because both callers need it held across more than this read — the
-- reserver holds it through its INSERT, the trigger through the pass's own.
create or replace function gatepass.next_pass_serial(p_prefix text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((
      select max(substring(g.pass_number from '(\d+)$')::integer)
        from gatepass.gate_passes g
       where g.pass_number like p_prefix || '-%'
    ), 0),
    -- Reservations count whether or not they were consumed: a consumed one is
    -- already a pass and would be counted by the arm above anyway, and an
    -- unconsumed one is precisely the number that must not be handed out twice.
    coalesce((
      select max(substring(r.pass_number from '(\d+)$')::integer)
        from gatepass.pass_number_reservations r
       where r.pass_number like p_prefix || '-%'
    ), 0)
  ) + 1;
$$;

comment on function gatepass.next_pass_serial(text) is
  'The next serial for a TYPE-DEPTCODE prefix (074): one more than the highest '
  'already taken by a raised pass OR an outstanding reservation. The caller '
  'must already hold the advisory lock for the prefix.';

-- Called only from the trigger and from reserve_pass_number, both of which are
-- SECURITY DEFINER themselves. No signed-in role needs it, so none gets it —
-- an unused SECURITY DEFINER function is EXECUTE-able over PostgREST by every
-- authenticated user, and this project's rule is that it must not be.
revoke all on function gatepass.next_pass_serial(text) from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Reserving one
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE GUARD IS `raise_pass`'S OWN, restated rather than referenced, because a
-- reservation is the first half of raising and must not be obtainable by
-- somebody who could not go on to submit it. An HOD may reserve for a
-- department they head; the sitting COO or CEO for any real one (069). Anyone
-- else is refused in the same words the submit would use.
create or replace function gatepass.reserve_pass_number(
  p_type          gatepass.pass_type,
  p_department_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix   text;
  v_number   text;
  v_office   text;
  v_any_dept boolean;
begin
  v_office   := gatepass.my_fallback_office();
  v_any_dept := v_office is not null;

  if gatepass.app_role() <> 'hod' and not v_any_dept then
    raise exception 'Only an HOD, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_dept then
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise a pass for a department you head.';
  end if;

  v_prefix := p_type::text || '-' || gatepass.dept_code(p_department_id);

  -- The same lock, on the same string, that set_pass_number takes. Held to the
  -- end of the transaction, so the read and the insert below cannot interleave
  -- with another reserver or with a pass being raised.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('gatepass_pass_number_' || v_prefix)
  );

  -- SWEEP FIRST, so an abandoned form's number is back in the pool before we
  -- count. Scoped to this prefix: there is no reason to touch another
  -- department's rows while holding only this department's lock, and doing so
  -- would deadlock two reservers working on different prefixes.
  delete from gatepass.pass_number_reservations
   where consumed_at is null
     and expires_at <= now()
     and type = p_type
     and department_id = p_department_id;

  v_number := v_prefix || '-' || lpad(gatepass.next_pass_serial(v_prefix)::text, 4, '0');

  insert into gatepass.pass_number_reservations
    (pass_number, type, department_id, reserved_by, expires_at)
  values
    (v_number, p_type, p_department_id, auth.uid(), now() + interval '12 hours');

  return v_number;
end;
$$;

comment on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) is
  'Hands the caller the real pass number their next pass will carry (074), so '
  'the Raise form can show it in full. Same authorisation as raise_pass. Good '
  'for 12 hours; release_pass_number() gives it back.';

revoke all on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) from public;
grant execute on function gatepass.reserve_pass_number(gatepass.pass_type, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Giving one back
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Called when the form's type or department changes, which changes the prefix
-- and so orphans the number already held. Deleting the row is a true release
-- because `next_pass_serial` is a live max rather than a stored cursor: if this
-- was the highest number for its prefix, the next reserver takes it again.
--
-- YOUR OWN, AND ONLY IF UNUSED. Scoping the delete to `reserved_by = auth.uid()`
-- and `consumed_at is null` means this cannot be turned into a way to free a
-- number somebody else is holding, or to detach a number from a raised pass.
-- It is silent about a row it does not find: the client calls this on a
-- best-effort basis while navigating away, and a reservation that already
-- expired is not an error worth surfacing to somebody filling in a form.
create or replace function gatepass.release_pass_number(p_pass_number text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from gatepass.pass_number_reservations
   where pass_number = p_pass_number
     and reserved_by = auth.uid()
     and consumed_at is null;
$$;

comment on function gatepass.release_pass_number(text) is
  'Gives back an unconsumed pass number this caller reserved (074), so changing '
  'the pass type or department does not burn a serial. Silent when there is '
  'nothing to release.';

revoke all on function gatepass.release_pass_number(text) from public;
grant execute on function gatepass.release_pass_number(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The generator honours a reservation, and validates it itself
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reproduced whole from 064 because a plpgsql body cannot be patched in place.
-- The advisory lock, the prefix, the four server-owned columns and the lpad are
-- byte-for-byte 064's; what is new is the block at the top that tries to
-- consume a reservation, and the counter now reading `next_pass_serial`.
--
-- WHY THE VALIDATION IS HERE AND NOT IN `raise_pass`: this trigger is BEFORE
-- INSERT and no client holds INSERT on `gate_passes` (001/007), so it is the
-- one place every pass number in this database has ever been decided. A check
-- in the RPC could be bypassed by any future second caller; a check here cannot
-- be bypassed at all.
create or replace function gatepass.set_pass_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dept    text;
  prefix  text;
  seq_val integer;
  tz      text := gatepass.site_tz();
begin
  -- The ONE derivation. See gatepass.dept_code (064).
  dept   := gatepass.dept_code(new.department_id);
  prefix := new.type::text || '-' || dept;

  -- Serialise number generation for this prefix, and for the reservation table
  -- alongside it. A plain max()+1 lets two concurrent inserts pick the same
  -- value and collide on the unique index.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gatepass_pass_number_' || prefix));

  -- A NUMBER THE CALLER BROUGHT IS HONOURED ONLY IF IT WAS REALLY THEIRS (074).
  -- Every clause is load-bearing: the row must exist, be this caller's, be
  -- unspent, be unexpired, and describe THIS pass's type and department — a
  -- reservation for RGP/IT cannot label an NRGP, or a pass raised for Finance.
  if new.pass_number is not null then
    update gatepass.pass_number_reservations
       set consumed_at = now()
     where pass_number   = new.pass_number
       and reserved_by   = auth.uid()
       and consumed_at   is null
       and expires_at    > now()
       and type          = new.type
       and department_id = new.department_id;

    -- Not theirs, spent, expired or for something else: discard it in silence
    -- and number the pass the ordinary way. Refusing instead would turn a form
    -- left open over lunch into a lost pass, and the confirmation screen shows
    -- whatever number the row really ends up with.
    if not found then
      new.pass_number := null;
    end if;
  end if;

  if new.pass_number is null then
    seq_val := gatepass.next_pass_serial(prefix);
    new.pass_number := prefix || '-' || lpad(seq_val::text, 4, '0');
  end if;

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
  'Assigns pass_number as TYPE-DEPTCODE-NNNN (064; e.g. RGP-IT-0001), honouring '
  'a reservation the caller took from reserve_pass_number() when it is theirs, '
  'unspent, unexpired and for this same type and department (074) — and '
  'generating one otherwise. Counter is per (type, department) over both raised '
  'passes and outstanding reservations, serialised by an advisory lock on the '
  'prefix.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Raising carries the number through
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 071's function verbatim but for two lines: the new trailing parameter, and
-- `pass_number` in the INSERT's column list. The RPC makes NO decision about
-- the value — see section 5 — it only stops discarding it.
--
-- THE OLD SIGNATURE IS DROPPED, not left beside this one. Adding a parameter
-- with a default creates an OVERLOAD, and PostgREST resolving between two
-- `raise_pass` functions by the argument names in the body is exactly the
-- ambiguity CLAUDE.md's drop-and-recreate rule exists to prevent.
drop function if exists gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
);

create function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null,
  p_pass_number          text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_item           jsonb;
  v_line           int := 0;
  v_office         text;
  v_any_department boolean;
begin
  -- Read ONCE: it decides both guards AND what is stamped on the row.
  v_office         := gatepass.my_fallback_office();
  v_any_department := v_office is not null;

  if gatepass.app_role() <> 'hod' and not v_any_department then
    raise exception 'Only an HOD, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_department then
    -- ANY department, but a REAL one. The `gate_passes.department_id` foreign
    -- key would refuse an invented uuid anyway; this refuses it in a sentence a
    -- person can read instead of as a constraint violation.
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise a pass for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  insert into gatepass.gate_passes
    (type, direction, department_id, raised_by, raised_by_office, visitor_name,
     visitor_company, vehicle_number, purpose, expected_return_date, pass_number)
  values
    (p_type, p_direction, p_department_id, auth.uid(), v_office, p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date,
     -- Nothing is trusted about this yet; set_pass_number() decides.
     nullif(trim(coalesce(p_pass_number, '')), ''))
  returning * into v_pass;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    insert into gatepass.gate_pass_items
      (gate_pass_id, line_no, name, description, purpose, quantity, unit,
       serial_no, approx_value, expected_return_date, department_id,
       make_model, invoice_no, remarks)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none (045).
      coalesce(
        nullif(trim(coalesce(v_item ->> 'purpose', '')), ''),
        nullif(trim(coalesce(p_purpose, '')), ''),
        'Material movement'
      ),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id,
      nullif(trim(coalesce(v_item ->> 'make_model', '')), ''),
      nullif(trim(coalesce(v_item ->> 'invoice_no', '')), ''),
      nullif(trim(coalesce(v_item ->> 'remarks', '')), '')
    );
  end loop;

  return v_pass;
end;
$$;

comment on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text
) is
  'Raises a gate pass. An HOD may raise only for a department they head; the '
  'sitting COO or CEO (my_fallback_office(), 071) may raise for any department '
  'and has that office stamped onto the row. p_pass_number carries a number '
  'reserved by reserve_pass_number() (074) and is validated — not trusted — by '
  'set_pass_number(). See migrations 069, 071 and 074.';

revoke all on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text
) from public;
grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text
) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 013 — Multi-line item lists, and partial returns
--
-- WHY: a gate pass carried exactly ONE material line — `material_description`,
-- `quantity`, `unit` on gate_passes itself. That shape cannot express the thing
-- the loading bay actually sees: a contractor wheeling out a trolley with a
-- drill, two ladders and a coil of cable on it. Today that is three separate
-- passes for one physical movement, which means three pass numbers, three
-- printed slips, and a guard reconciling three sheets against one trolley.
--
-- It also made a partial return unrepresentable. `return_status` is a single
-- enum on the pass, so "two of the three ladders came back" had no spelling —
-- the guard's only options were to call the whole pass returned (false) or
-- leave it awaiting_return forever (also false, and it silently poisons the
-- overdue list).
--
-- WHAT: material moves OUT of gate_passes and into gatepass.gate_pass_items,
-- one row per line, each carrying its own returned_qty. `return_status` on the
-- parent becomes a roll-up of its lines rather than an independently-set fact.
--
-- ─── Four things here are load-bearing and non-obvious ──────────────────────
--
-- 1. TRAP 1 (see 008's header) applies to 'partially_returned'. It is added by
--    THIS migration, and APPLY_ALL.sql pastes every migration as ONE
--    transaction, so it may not be referenced anywhere Postgres evaluates at
--    DDL time: no CHECK constraint, no `language sql` body, and — the new one —
--    NO VIEW. A view's query is parsed and analysed at CREATE time, so
--    `where return_status = 'partially_returned'` inside v_gate_passes would
--    abort the entire paste exactly like a CHECK constraint does.
--
--    The escape hatch used throughout below is to compare the column CAST TO
--    TEXT: `return_status::text in ('awaiting_return','partially_returned')`.
--    That is a runtime cast against ordinary text literals — no enum label is
--    resolved at DDL time — so it is safe in a view and in `language sql`.
--    plpgsql bodies remain exempt (stored as text, never analysed at CREATE).
--
-- 2. THE OPEN-MATERIAL RULE MOVES TO THE ITEMS TABLE, and needs denormalised
--    columns to do it. 012's `gate_passes_one_open_per_material_idx` was a
--    partial unique index over (department_id, normalize_material(...)) — both
--    columns on one row. Split across parent and child, `department_id` and
--    "is this pass still open?" now live on the OTHER table, and a unique index
--    cannot join. So gate_pass_items carries `department_id` and `is_open` as
--    trigger-maintained copies. That is duplication, and it is the price of
--    keeping a race-safe constraint: the alternative — a `select ... if exists`
--    check in the RPC — is not race-safe, which is the whole reason 008 chose
--    an index in the first place.
--
-- 3. A PASS AND ITS ITEMS MUST BE WRITTEN IN ONE TRANSACTION, so INSERT on
--    gate_passes is revoked and `gatepass.raise_pass` becomes the only way in.
--    PostgREST runs each request in its own transaction: a client that inserts
--    the pass and then inserts the items is two transactions, and any failure
--    between them leaves a pass with no material on it — a pass number issued
--    against nothing, sitting in the guard's queue. (This is not hypothetical;
--    it is exactly the shape of the code being retired from VMS.) A deferred
--    constraint cannot save this either, because it would fire at the end of
--    the FIRST transaction, before the items exist.
--
--    This tightens the existing architecture rather than bending it: 003 already
--    established that state changes are RPC-only. Creation now joins them.
--
-- 4. `is_open` IS PER-ITEM, not a copy of the parent's status. A line that has
--    fully come back is closed even while its siblings are still out — which is
--    what lets the same department raise a fresh pass for the returned ladder
--    without waiting on the drill.
--
-- Safe against existing data: the one live row is backfilled into a single item
-- line below before its source columns are dropped.
-- ============================================================================

-- ─── 0. The new return state ────────────────────────────────────────────────
-- Ordered after 'awaiting_return' so `order by return_status` reads as a
-- lifecycle. See TRAP 1 above before using this label ANYWHERE below.
--
-- Bare statement, NOT wrapped in `do $$ ... exception ... $$` like the enum
-- creations in 001. An EXCEPTION block opens a subtransaction, and
-- `alter type ... add value` is refused inside one — `if not exists` already
-- makes it idempotent, which is the only thing the handler would have bought.
-- This matches 008's handling of 'cancelled'.
alter type gatepass.return_status add value if not exists 'partially_returned'
  after 'awaiting_return';

-- ─── 1. The item lines ──────────────────────────────────────────────────────
create table if not exists gatepass.gate_pass_items (
  id            uuid primary key default gen_random_uuid(),
  gate_pass_id  uuid not null references gatepass.gate_passes(id) on delete cascade,

  -- Display/print order. The guard reads the slip top to bottom against the
  -- trolley; a set with no stable order makes "line 3" meaningless over radio.
  line_no       int  not null,

  description   text          not null,
  quantity      numeric(12,2) not null,
  unit          text          not null default 'nos',

  -- The asset tag stencilled on the thing. This is what makes an RGP
  -- enforceable: without it, "a drill" came back, not necessarily THE drill.
  serial_no     text,
  -- Indicative worth, for the insurance/write-off conversation after a flag.
  -- Never used for authorisation — an expensive item is not a suspicious one.
  approx_value  numeric(14,2),

  -- How much of this line has physically come back. 0 for an NRGP, which never
  -- owes one; the roll-up in `apply_item_returns` treats NRGP lines as closed.
  returned_qty  numeric(12,2) not null default 0,

  -- ── Denormalised from the parent, maintained by trigger. See note 2 above.
  --    Never write these from application code; the triggers own them.
  department_id uuid    not null references public.departments(id),
  is_open       boolean not null default true,

  created_at    timestamptz not null default now(),

  constraint gate_pass_items_line_no_positive check (line_no > 0),
  constraint gate_pass_items_quantity_positive check (quantity > 0),
  -- Same ceiling as the parent's retired gate_passes_quantity_sane: a typo of
  -- 100000 for 10 should be refused, not warehoused.
  constraint gate_pass_items_quantity_sane    check (quantity <= 1000000),
  constraint gate_pass_items_returned_sane
    check (returned_qty >= 0 and returned_qty <= quantity),
  constraint gate_pass_items_value_sane
    check (approx_value is null or approx_value >= 0),
  -- `not null` is satisfied by '' and '   '. A blank description on a line is a
  -- line the guard cannot check against anything.
  constraint gate_pass_items_text_not_blank
    check (length(trim(description)) > 0 and length(trim(unit)) > 0),
  constraint gate_pass_items_optional_text_not_blank
    check (serial_no is null or length(trim(serial_no)) > 0),

  constraint gate_pass_items_line_unique unique (gate_pass_id, line_no)
);

create index if not exists gate_pass_items_pass_idx
  on gatepass.gate_pass_items (gate_pass_id, line_no);

-- The open-material rule, rehomed. Predicate is the plain boolean column, so no
-- enum label is evaluated at DDL time (TRAP 1 stays satisfied).
create unique index if not exists gate_pass_items_one_open_per_material_idx
  on gatepass.gate_pass_items (department_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_material_idx is
  'One OPEN line per material per department — the successor to '
  'gate_passes_one_open_per_material_idx (012), moved here when material became '
  'a 1:N child. Open = the parent pass is pending, or the parent owes a return '
  'and THIS line has not fully come back. Race-safe by construction; a '
  '`select ... if exists` check in the RPC is not, because two simultaneous '
  'submissions both pass it. Scoped per department because description is free '
  'text and two departments each moving a "trolley" is not a duplicate.';

comment on column gatepass.gate_pass_items.department_id is
  'Denormalised copy of gate_passes.department_id, maintained by the '
  'sync_item_denormals trigger. Exists solely so the partial unique index above '
  'can be expressed — a unique index cannot join to the parent.';

comment on column gatepass.gate_pass_items.is_open is
  'Denormalised "this line is still an outstanding obligation", maintained by '
  'the sync_item_denormals and cascade_pass_open_state triggers. Per-LINE, not '
  'a copy of the parent status: a fully-returned ladder is closed while the '
  'drill on the same pass is still out.';

-- ─── 2. Keeping the denormalised columns honest ─────────────────────────────
-- One definition of "open", used by both triggers.
--
-- TRAP 1, SHARPER THAN DOCUMENTED: "plpgsql bodies are exempt" is only true of
-- CREATE time. A plpgsql body is analysed at FIRST EXECUTION, and section 3
-- below executes this function (via the sync_item_denormals trigger) during the
-- backfill — in the same transaction that added 'partially_returned'. Naming
-- the label directly here therefore still fails, with the same "unsafe use of
-- new value" error, just later. Verified by dry run, not assumed.
--
-- So the ::text comparison is used here too. It is not stylistic: it is the
-- only form that survives both DDL-time analysis and same-transaction
-- execution.
create or replace function gatepass.item_is_open(
  p_status        gatepass.pass_status,
  p_return_status gatepass.return_status,
  p_quantity      numeric,
  p_returned_qty  numeric
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Raised but not yet seen at the loading bay: the material is still spoken for.
  if p_status = 'pending' then
    return true;
  end if;
  -- Out, and owed back — but only the part that has not come back yet.
  if p_return_status::text in ('awaiting_return', 'partially_returned') then
    return p_returned_qty < p_quantity;
  end if;
  -- matched NRGP, flagged, cancelled, fully returned: nothing outstanding.
  return false;
end;
$$;

create or replace function gatepass.sync_item_denormals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  select * into v_pass from gatepass.gate_passes where id = new.gate_pass_id;
  if not found then
    raise exception 'Gate pass % does not exist.', new.gate_pass_id;
  end if;

  new.description := trim(new.description);
  new.unit        := lower(trim(new.unit));
  new.serial_no   := nullif(upper(trim(coalesce(new.serial_no, ''))), '');

  new.department_id := v_pass.department_id;
  new.is_open := gatepass.item_is_open(
    v_pass.status, v_pass.return_status, new.quantity, new.returned_qty
  );
  return new;
end;
$$;

drop trigger if exists sync_item_denormals on gatepass.gate_pass_items;
create trigger sync_item_denormals
  before insert or update on gatepass.gate_pass_items
  for each row execute function gatepass.sync_item_denormals();

-- When the PARENT's state changes, every line's `is_open` has to follow. The
-- RPCs already take `for update` on the parent row, so this cascade is
-- serialised behind that lock and cannot interleave with a second guard.
create or replace function gatepass.cascade_pass_open_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     or new.return_status is distinct from old.return_status then
    update gatepass.gate_pass_items i
       set is_open = gatepass.item_is_open(
             new.status, new.return_status, i.quantity, i.returned_qty
           )
     where i.gate_pass_id = new.id
       and i.is_open is distinct from gatepass.item_is_open(
             new.status, new.return_status, i.quantity, i.returned_qty
           );
  end if;
  return new;
end;
$$;

drop trigger if exists cascade_pass_open_state on gatepass.gate_passes;
create trigger cascade_pass_open_state
  after update on gatepass.gate_passes
  for each row execute function gatepass.cascade_pass_open_state();

-- ─── 3. Backfill, before the source columns go ──────────────────────────────
-- Every existing pass becomes a single-line pass. Ordering the insert by
-- created_at is cosmetic; line_no is 1 for all of them.
insert into gatepass.gate_pass_items
  (gate_pass_id, line_no, description, quantity, unit, department_id, returned_qty)
select p.id,
       1,
       p.material_description,
       p.quantity,
       p.unit,
       p.department_id,
       case when p.return_status = 'returned' then p.quantity else 0 end
  from gatepass.gate_passes p
 where not exists (
         select 1 from gatepass.gate_pass_items i where i.gate_pass_id = p.id
       );

-- ─── 4. Retire the single-material columns ──────────────────────────────────
-- The view must go first: `p.*` fixed its column list at creation, so it holds
-- a dependency on all three columns and would block the drop. It is rebuilt in
-- section 6 (TRAP 2 — a view cannot absorb a changed base table in place).
drop view if exists gatepass.v_gate_passes;

-- 012's index is superseded by gate_pass_items_one_open_per_material_idx above.
-- Dropped rather than left alongside: two overlapping unique rules on the same
-- key means the stale one keeps rejecting inserts the new one was written to
-- allow, naming an index whose stated rule is no longer the rule.
drop index if exists gatepass.gate_passes_one_open_per_material_idx;

alter table gatepass.gate_passes
  drop constraint if exists gate_passes_quantity_check,
  drop constraint if exists gate_passes_quantity_sane;

-- Restated without material_description / unit, which are leaving.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_text_not_blank,
  add  constraint gate_passes_text_not_blank
    check (length(trim(visitor_name)) > 0 and length(trim(purpose)) > 0);

alter table gatepass.gate_passes
  drop column if exists material_description,
  drop column if exists quantity,
  drop column if exists unit;

-- ─── 5. validate_pass, minus the columns it used to normalise ───────────────
-- Unchanged except that material_description/unit normalisation moved to
-- sync_item_denormals, where the data now lives. Restated in full because
-- `create or replace function` has no partial form.
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
    new.visitor_name    := trim(new.visitor_name);
    new.purpose         := trim(new.purpose);
    -- Blank optional fields collapse to NULL so "not given" has one spelling.
    new.visitor_company := nullif(trim(coalesce(new.visitor_company, '')), '');
    -- Vehicle numbers are compared by eye against a plate at the loading bay,
    -- often at night. Store them one way so two records of the same van match.
    new.vehicle_number  := nullif(upper(trim(coalesce(new.vehicle_number, ''))), '');

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
  -- a CHECK constraint — see 012's header.
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

-- ─── 6. The view, rebuilt ───────────────────────────────────────────────────
-- Every list, KPI and CSV reads this, so the item roll-ups are defined HERE,
-- exactly once, alongside is_overdue and is_expired. Recomputing any of them in
-- TypeScript is how a screen ends up disagreeing with match_pass in front of a
-- driver.
--
-- `security_invoker = true` is mandatory: without it the view runs as its OWNER
-- and every HOD reads every department's passes.
create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  -- ── Derived state, each defined exactly once ──
  p.return_status = 'awaiting_return'
    and p.expected_return_date is not null
    and p.expected_return_date < (now() at time zone gatepass.site_tz())::date
                                                                    as is_overdue,
  p.status = 'pending' and p.expires_at < now()                     as is_expired,

  -- Due-date urgency, replacing the binary overdue flag for anything that wants
  -- to warn BEFORE the date passes. 'partially_returned' is matched via ::text
  -- on purpose — see TRAP 1 in this file's header; naming the label directly
  -- here would abort a fresh APPLY_ALL.sql paste.
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

  -- ── Item roll-ups ──
  coalesce(it.item_count, 0)                                        as item_count,
  coalesce(it.total_quantity, 0)                                    as total_quantity,
  coalesce(it.returned_quantity, 0)                                 as returned_quantity,
  -- A one-line summary for lists, search boxes and CSV columns, so the common
  -- case never needs a second query. The detail and print screens read the real
  -- rows from v_gate_pass_items.
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
-- LEFT JOIN on purpose: VMS owns public.departments and can narrow its policies
-- without notice. An inner join would make pass rows silently vanish; a left
-- join degrades to a null name. Visibly wrong beats invisibly wrong.
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. is_overdue, is_expired, due_state and '
  'the item roll-ups are defined here and ONLY here.';

-- The line-level view. Same security_invoker rule; RLS on gate_pass_items
-- (section 7) is what actually scopes it to the caller''s departments.
create or replace view gatepass.v_gate_pass_items
with (security_invoker = true)
as
select
  i.*,
  i.quantity - i.returned_qty as outstanding_qty,
  p.pass_number,
  p.status      as pass_status,
  p.return_status
from gatepass.gate_pass_items i
join gatepass.gate_passes p on p.id = i.gate_pass_id;

-- ─── 7. RLS on the new table ────────────────────────────────────────────────
-- Mirrors gate_passes exactly: security sees everything, an HOD sees their own
-- departments. Items are written ONLY by raise_pass and the return RPCs, so
-- there is no insert/update/delete policy at all — the same RPC-only posture
-- gate_passes has had since 002.
alter table gatepass.gate_pass_items enable row level security;

drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select
  on gatepass.gate_pass_items for select to authenticated
  using (
    gatepass.is_security()
    or department_id in (select gatepass.my_department_ids())
  );

-- SELECT only. No UPDATE grant, ever — returned_qty is the whole audit value of
-- this table, and a client that can set it directly can un-return material.
grant select on gatepass.gate_pass_items to authenticated;
grant select on gatepass.v_gate_pass_items to authenticated;

-- ─── 8. Creation becomes an RPC, and only an RPC ────────────────────────────
-- See note 3 in the header. INSERT is revoked from authenticated and the insert
-- policy dropped, so a pass can no longer exist without its material.
revoke insert on gatepass.gate_passes from authenticated;
drop policy if exists gate_passes_insert on gatepass.gate_passes;

-- SECURITY DEFINER, so it must re-state the authorisation the dropped policy
-- carried — role, ownership, and department membership — explicitly.
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb
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
     vehicle_number, purpose, expected_return_date)
  values
    (p_type, p_direction, p_department_id, auth.uid(), p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
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
      -- Overwritten by sync_item_denormals from the parent; supplied only
      -- because the column is NOT NULL and the trigger runs after the value is
      -- assembled.
      p_department_id
    );
  end loop;

  return v_pass;
end;
$$;

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) to authenticated;

-- ─── 9. Returns, per line ───────────────────────────────────────────────────
-- The shared engine. plpgsql, so it may name 'partially_returned' directly.
create or replace function gatepass.apply_item_returns(
  p_pass_id uuid,
  p_lines   jsonb,      -- [{ "item_id": uuid, "qty": numeric }, ...]
  p_remarks text
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass        gatepass.gate_passes;
  v_line        jsonb;
  v_item        gatepass.gate_pass_items;
  v_qty         numeric;
  v_outstanding numeric;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can record a return.';
  end if;

  -- Lock the parent first: this is the lock the cascade trigger and any second
  -- guard both serialise behind.
  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.return_status not in ('awaiting_return', 'partially_returned') then
    raise exception 'This pass is not awaiting a return.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      continue;   -- "returning nothing on this line" is a normal thing to submit
    end if;

    select * into v_item
      from gatepass.gate_pass_items
     where id = (v_line ->> 'item_id')::uuid
       and gate_pass_id = p_pass_id
       for update;

    if not found then
      raise exception 'Item line % does not belong to this pass.', v_line ->> 'item_id';
    end if;

    v_outstanding := v_item.quantity - v_item.returned_qty;
    if v_qty > v_outstanding then
      raise exception 'Cannot return % of "%": only % of % are still outstanding.',
        v_qty, v_item.description, v_outstanding, v_item.quantity;
    end if;

    update gatepass.gate_pass_items
       set returned_qty = returned_qty + v_qty
     where id = v_item.id;
  end loop;

  -- Roll the lines up into the parent. One query, so the parent can never
  -- disagree with its own children.
  update gatepass.gate_passes p
     set return_status = case
           when not exists (
             select 1 from gatepass.gate_pass_items i
              where i.gate_pass_id = p.id and i.returned_qty < i.quantity
           ) then 'returned'::gatepass.return_status
           else 'partially_returned'::gatepass.return_status
         end,
         actual_return_date = case
           when not exists (
             select 1 from gatepass.gate_pass_items i
              where i.gate_pass_id = p.id and i.returned_qty < i.quantity
           ) then now()
           else null
         end
   where p.id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'returned', auth.uid(), p_remarks);

  return v_pass;
end;
$$;

-- "Everything on this pass came back" — the common case, expressed in terms of
-- the same engine so there is exactly one path that can move returned_qty.
create or replace function gatepass.mark_returned(
  p_pass_id uuid,
  p_remarks text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
begin
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'item_id', i.id,
             'qty',     i.quantity - i.returned_qty
           )) filter (where i.returned_qty < i.quantity),
           '[]'::jsonb
         )
    into v_lines
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p_pass_id;

  return gatepass.apply_item_returns(p_pass_id, v_lines, p_remarks);
end;
$$;

grant execute on function gatepass.apply_item_returns(uuid, jsonb, text) to authenticated;
grant execute on function gatepass.mark_returned(uuid, text)             to authenticated;

-- ─── 10. KPIs, including the partial state ──────────────────────────────────
-- `language sql`, so 'partially_returned' is matched via ::text (TRAP 1).
-- A partially-returned pass is still an outstanding obligation and belongs in
-- the awaiting-return count; a guard who sees it drop out when two of three
-- ladders come back will stop trusting the number.
create or replace function gatepass.kpis(p_department_id uuid default null)
returns table (
  total bigint, pending bigint, matched bigint, flagged bigint,
  awaiting_return bigint, overdue bigint, raised_today bigint
)
language sql
stable
as $$
  select
    count(*)                                                    as total,
    count(*) filter (where status = 'pending')                  as pending,
    count(*) filter (where status = 'matched')                  as matched,
    count(*) filter (where status = 'flagged')                  as flagged,
    count(*) filter (
      where return_status::text in ('awaiting_return', 'partially_returned')
    )                                                           as awaiting_return,
    count(*) filter (where is_overdue)                          as overdue,
    count(*) filter (where created_at >= date_trunc('day', now())) as raised_today
  from gatepass.v_gate_passes
  where p_department_id is null or department_id = p_department_id;
$$;

-- `v_gate_passes` was recreated above (dropped and rebuilt to include the
-- lateral-join columns). The `CREATE OR REPLACE VIEW` does NOT propagate the
-- original grant from migration 002, so it is re-stated here.
grant select on table gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

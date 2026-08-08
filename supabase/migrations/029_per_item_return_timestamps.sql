-- ============================================================================
-- 029 — each returned line records WHEN it came back
--
-- WHY: 013 already gave the guard per-line returns — `apply_item_returns` takes
-- [{item_id, qty}] and rolls the lines up into the parent — but nothing ever
-- called it from the UI, and it recorded no time per line. The only return
-- action a guard could reach was `mark_returned`, which closes every line at
-- once. So a trolley that went out with a drill, two ladders and a coil could
-- only come back all together, and the record showed one timestamp on the
-- parent for a return that physically happened over three days.
--
-- WHAT: gate_pass_items gains `returned_at`, stamped the moment a line becomes
-- FULLY returned. The roll-up in apply_item_returns is unchanged and is what
-- makes "once every item is back the pass closes itself" true — that behaviour
-- already existed and is deliberately not reimplemented anywhere else.
--
-- ─── Three decisions worth stating ──────────────────────────────────────────
--
-- 1. returned_at IS NULLABLE, and stays null until the line is fully back.
--    A `not null default now()` would stamp every line at raise time, so every
--    item still sitting in a contractor's van would claim to have been
--    returned the moment it left. A partially-returned line (2 of 3 ladders)
--    also stays null: it still owes material, and a date on it reads as "this
--    came back" on every screen that renders one. The outstanding quantity is
--    what expresses a partial return; the timestamp expresses closure.
--
-- 2. THE STAMP IS SET IN THE SAME UPDATE THAT MOVES returned_qty. Two
--    statements would leave a window in which a line reads as fully returned
--    with no return time, and any failure between them makes that permanent —
--    an audit row that says material came back but not when.
--
-- 3. coalesce(returned_at, ...) — never overwrite an existing stamp. In
--    practice a full line cannot be updated again (gate_pass_items_returned_sane
--    caps returned_qty at quantity, so the next call would be refused before
--    reaching the update), but the audit value of this column is precisely that
--    it cannot be moved once written. Defend it in the statement rather than
--    relying on a constraint elsewhere continuing to hold.
--
-- NOT granted UPDATE to anyone, exactly as in 013. returned_at is now part of
-- the audit record, and a client that could set it could backdate a return to
-- before the pass was ever verified.
-- ============================================================================

-- ─── 1. The column ──────────────────────────────────────────────────────────
alter table gatepass.gate_pass_items
  add column if not exists returned_at timestamptz;

comment on column gatepass.gate_pass_items.returned_at is
  'When THIS line was fully returned. Null while any quantity is still '
  'outstanding, including a partially-returned line. Written only by '
  'gatepass.apply_item_returns, never by a client, and never overwritten.';

-- Backfill: a line already fully returned belongs to a pass whose parent
-- timestamp is the best evidence available of when it happened. Guessing
-- `now()` would date every historical return to the day this migration ran.
-- Left null where the parent has none — an unknown time must read as unknown.
update gatepass.gate_pass_items i
   set returned_at = p.actual_return_date
  from gatepass.gate_passes p
 where p.id = i.gate_pass_id
   and i.returned_at is null
   and i.returned_qty >= i.quantity
   and p.actual_return_date is not null;

-- ─── 2. apply_item_returns, stamping each line it closes ────────────────────
-- Restated in full: `create or replace function` has no partial form. The only
-- change from 013 is the `returned_at` assignment in the per-line update; the
-- authorisation check, the parent lock, the outstanding-quantity guard and the
-- roll-up are byte-for-byte the earlier behaviour.
--
-- plpgsql, so naming 'partially_returned' directly is safe here (TRAP 1 in
-- 013's header): a plpgsql body is stored as text and is analysed at first
-- execution, and nothing in this migration executes it.
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

    -- returned_qty on the right-hand side is the OLD value, so the comparison
    -- asks "does this movement close the line?" — see decisions 2 and 3 above.
    update gatepass.gate_pass_items
       set returned_qty = returned_qty + v_qty,
           returned_at  = case
             when returned_qty + v_qty >= quantity
               then coalesce(returned_at, pg_catalog.now())
             else returned_at
           end
     where id = v_item.id;
  end loop;

  -- Roll the lines up into the parent. One query, so the parent can never
  -- disagree with its own children. THIS is what closes the whole pass once the
  -- last outstanding line comes back — no client decides it, and a guard who
  -- returns the final item never has to also remember to close the pass.
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
           ) then pg_catalog.now()
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

grant execute on function gatepass.apply_item_returns(uuid, jsonb, text) to authenticated;

-- ─── 3. The line view, rebuilt so returned_at reaches the client ────────────
-- TRAP 2: `select i.*` fixed its column list when the view was created, so it
-- does NOT grow when gate_pass_items does — `create or replace view` fails with
-- "cannot change name of view column". Drop and rebuild, exactly as 019 did.
--
-- security_invoker = true is mandatory: without it the view runs as its OWNER
-- and RLS on gate_pass_items stops scoping an HOD to their own departments.
drop view if exists gatepass.v_gate_pass_items;

create view gatepass.v_gate_pass_items
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

-- A dropped view takes its grants with it. Re-applied in the same transaction,
-- so the view is never left callable by nobody.
grant select on gatepass.v_gate_pass_items to authenticated;

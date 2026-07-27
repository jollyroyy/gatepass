-- ============================================================================
-- 010 — Direction becomes a choice; IGP/OGP retired; HOD may delete a mistake
--
-- TWO CHANGES, both driven by how the gate actually works.
--
-- 1. DIRECTION IS NOW A COLUMN, NOT A PASS TYPE.
--
--    The four types conflated two independent facts:
--
--      IGP  = inward  + non-returnable
--      OGP  = outward + non-returnable
--      RGP  = outward + returnable
--      NRGP = outward + non-returnable      <-- identical to OGP
--
--    So OGP and NRGP meant the same thing, and there was no way to express the
--    real case of INWARD RETURNABLE — a contractor bringing their own equipment
--    in, which must leave again. That is now expressible.
--
--    After this migration:
--      type      = RGP | NRGP        (does it come back?)
--      direction = in  | out         (which way is it going?)
--
--    NRGP is OUTWARD ONLY, enforced by a check constraint, not merely by the UI
--    dropdown. Inbound material that never leaves is a goods receipt, not a gate
--    pass; it belongs to purchasing, and pretending otherwise would make the
--    gate log claim custody of things the gate never controlled.
--
--    IGP and OGP remain in the gatepass.pass_type enum because Postgres cannot
--    drop an enum value. They are made unreachable by a check constraint
--    instead. Do not try to "clean this up" by recreating the type — the column,
--    the view and every index would have to be rebuilt for a cosmetic gain.
--
-- 2. AN HOD MAY DELETE THEIR OWN STILL-PENDING PASS.
--
--    This is a deliberate, user-approved exception to the append-only rule, and
--    it is the ONLY delete permission that exists anywhere in this schema.
--    The trade was made with the consequences on the table:
--      * the pass number is consumed and leaves a permanent gap in the sequence;
--      * a printed slip becomes unscannable, and the guard sees 'not_found'
--        rather than 'cancelled' — no explanation of why;
--      * the record of the mistake is gone, which is precisely what someone
--        covering up a movement would want.
--    Voiding (008's cancel_pass) remains the better path and stays in the UI.
--
--    It is scoped as tightly as RLS allows: only the HOD who raised it, only
--    while status = 'pending', which by construction means nothing has ever been
--    verified against it (every action that writes a verifications row also
--    moves status off 'pending' in the same transaction).
--
--    DELETE is expressed as an RLS POLICY rather than an RPC, unlike the state
--    transitions. That is not an inconsistency: the RPC-only rule exists because
--    RLS cannot say "you may change status but not visitor_name" — a column-level
--    concern. Deletion has no columns to constrain, so a policy states the whole
--    rule precisely.
--
--    Foreign keys already behave correctly and are NOT changed here:
--      verifications.gate_pass_id  ON DELETE CASCADE   (a pending pass has none)
--      scan_attempts.gate_pass_id  ON DELETE SET NULL  (security log survives,
--                                                       only the link is lost)
--
-- TRAP 1 (see 008) does NOT apply to the new enum below. The restriction is on
-- `alter type ... add value`, where the value is added to an already-committed
-- type. `create type` makes the type and all its labels in one catalog entry, so
-- 'in'/'out' are usable immediately — including in a check constraint and a
-- column default, both of which Postgres evaluates at DDL time.
--
-- TRAP 2 (see 008) DOES apply: v_gate_passes selects p.*, whose column list is
-- fixed at creation, so it must be dropped and rebuilt to pick up `direction`.
-- ============================================================================

-- ─── Direction ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'gatepass' and t.typname = 'pass_direction') then
    create type gatepass.pass_direction as enum ('in', 'out');
  end if;
end $$;

-- Defaults to 'out': every pass that existed under the old model was outward
-- except IGP, and the check constraint below forbids IGP from here on.
alter table gatepass.gate_passes
  add column if not exists direction gatepass.pass_direction not null default 'out';

-- ─── Migrate legacy rows ────────────────────────────────────────────────────
-- OGP maps onto the new model exactly: outward + non-returnable is NRGP+out.
-- Silent and safe, because no meaning changes.
update gatepass.gate_passes
   set type = 'NRGP', direction = 'out'
 where type = 'OGP';

-- IGP has NO equivalent, by design — inbound material that never leaves is a
-- goods receipt, not a gate pass. Reinterpreting it would be this migration
-- inventing a fact about custody, so it stops and makes a human decide.
-- Without this the failure is a bare "check constraint is violated by some row",
-- which names neither the rows nor the fix.
do $$
declare
  v_count integer;
  v_list  text;
begin
  select count(*), string_agg(pass_number, ', ' order by pass_number)
    into v_count, v_list
    from gatepass.gate_passes where type = 'IGP';

  if v_count > 0 then
    raise exception using
      errcode = 'check_violation',
      message = format('%s inward pass(es) cannot be migrated: %s', v_count, v_list),
      detail  = 'IGP (inward + non-returnable) has no equivalent: this model treats '
             || 'permanently-inbound material as a goods receipt, not a gate pass.',
      hint    = 'Decide per pass, then re-run. If it is genuinely returnable, set '
             || 'type=RGP and direction=in. If it was a delivery, delete it. '
             || 'Matched/flagged rows are history — copy them out before deleting.';
  end if;
end $$;

-- ─── Retire IGP / OGP, and pin NRGP to outward ──────────────────────────────
-- 'RGP' and 'NRGP' are pre-existing enum labels, so evaluating them here is safe.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_type_is_current;
alter table gatepass.gate_passes
  add constraint gate_passes_type_is_current
  check (type in ('RGP', 'NRGP'));

alter table gatepass.gate_passes
  drop constraint if exists gate_passes_nrgp_is_outward;
alter table gatepass.gate_passes
  add constraint gate_passes_nrgp_is_outward
  check (type <> 'NRGP' or direction = 'out');

comment on column gatepass.gate_passes.direction is
  'Which way the material moves. RGP may be either; NRGP is outward only, '
  'enforced by gate_passes_nrgp_is_outward.';

-- ─── pass_number now carries the direction ──────────────────────────────────
-- RGP-OUT-20260727-0001. A guard reads which way the material should be moving
-- straight off the slip, without cross-checking a screen.
--
-- The sequence is per (type, direction, day) because the advisory lock and the
-- max() scan both key on the whole prefix — separate counters come for free and
-- stay race-safe. Reproduced in full from 008 because a function body cannot be
-- patched in place; only the `prefix :=` line and the qr/expiry block differ.
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
  new.created_at  := now();
  new.updated_at  := now();
  new.qr_token    := gen_random_uuid();
  new.expires_at  := ((date_trunc('day', (now() at time zone tz)) + interval '2 days')
                       at time zone tz) - interval '1 microsecond';

  return new;
end;
$$;

-- direction joins the set of columns an update can never move. Nothing holds
-- UPDATE on gate_passes, so this only guards the security definer RPCs against
-- their own future edits — which is exactly when it would go unnoticed.
create or replace function gatepass.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.pass_number := old.pass_number;
  new.type        := old.type;
  new.direction   := old.direction;
  new.created_at  := old.created_at;
  new.raised_by   := old.raised_by;
  new.qr_token    := old.qr_token;
  new.expires_at  := old.expires_at;
  new.updated_at  := now();
  return new;
end;
$$;

-- ─── HOD delete ─────────────────────────────────────────────────────────────
-- The ONLY delete grant in this schema. tests/security/sqlInvariants.test.ts
-- allows exactly this one and still fails any UPDATE grant.
grant delete on gatepass.gate_passes to authenticated;

drop policy if exists gate_passes_delete on gatepass.gate_passes;
create policy gate_passes_delete
  on gatepass.gate_passes for delete to authenticated
  using (
    status = 'pending'
    and raised_by = (select auth.uid())
    and gatepass.app_role() = 'hod'
  );

comment on policy gate_passes_delete on gatepass.gate_passes is
  'Own + pending + hod only. Security and admin deliberately cannot delete: '
  'a guard who dislikes a pass has flag_pass, and an admin erasing another '
  'department''s paperwork with no trail is the hole this system exists to close.';

-- ─── View rebuild (TRAP 2) ──────────────────────────────────────────────────
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
--   insert ... (type, direction) values ('NRGP', 'in')  -> violates
--                                          gate_passes_nrgp_is_outward
--   insert ... (type) values ('IGP')                    -> violates
--                                          gate_passes_type_is_current
--   as the raising HOD:  delete from gatepass.gate_passes where id = <pending>  -> 1 row
--   as a guard:          same delete                                            -> 0 rows

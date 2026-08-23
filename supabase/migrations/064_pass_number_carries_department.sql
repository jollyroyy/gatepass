-- ============================================================================
-- 064 — the pass number names the DEPARTMENT, not the date, and gets short
--
-- Client, 2026-08-23: "The auto-generated pass ID should not be very long and
-- it should follow this format. The first three or four letters will be the
-- pass, like RGP, as per the pass type, and then a dash. It will give the
-- first three or four letters of the department — if it is raised by IT
-- Department then IT, if finance then FIN — then a short 3-, 4- or 5-digit
-- auto-generated number. Don't keep the numbers too long."
--
--   before   RGP-20260818-0001     (042)     18 characters
--   after    RGP-IT-0001                     11 characters
--
-- The date is dropped from the LABEL only. `created_at` still carries it, the
-- record still shows it, and every screen reads it from there. What a person
-- reading a number off a slip actually needs is what it is and whose it is;
-- the day it was raised is on the same piece of paper an inch away.
--
-- ═══ THIS REVERSES 042's REFUSAL TO RENUMBER, ON PURPOSE ═══
--
-- 042 renamed no existing row and said why: "a pass number is an audit anchor,
-- and rewriting one silently invalidates the paper a guard is holding." That
-- reasoning stands and the client has now asked for the opposite, explicitly
-- and for every earlier pass ("also follow the same for all the passes that
-- were raised earlier"). So this migration DOES renumber all 76 existing rows,
-- and the trade is recorded here rather than left to be rediscovered:
--
--   * A printed slip carrying an old number no longer matches the record.
--     Reprint anything still in circulation.
--   * `docs/backfill/064_pass_number_before.csv` is the only surviving map
--     from a pass id to the number it used to have. Nothing else retains it.
--
-- WHAT MAKES THE RENUMBER SAFE AT ALL: no lookup keys on `pass_number`. A QR
-- scan resolves `qr_token`, every route keys on `id`, and every foreign key in
-- this schema references `gate_passes(id)`. `pass_number` is a LABEL that is
-- searched and displayed — `myPassesList.ts` filters on it, the CSV export
-- prints it — and nothing joins on it. Renumbering therefore changes what
-- people read and nothing the database resolves.
--
-- ═══ ONE DERIVATION, TWO CALLERS ═══
--
-- `gatepass.dept_code(uuid)` is the whole of "what does this department call
-- itself in a pass number". The trigger calls it for a new pass and the
-- backfill calls it for the old ones, so a backfilled IT pass and one raised
-- tomorrow cannot disagree. Two copies of this rule would have drifted.
--
-- ═══ THE COUNTER IS NOW PER (TYPE, DEPARTMENT) ═══
--
-- It was per (type, day). Both are prefix scans under the same advisory lock,
-- so the concurrency story is unchanged — but the counter no longer resets at
-- midnight, which is the point: RGP-IT-0002 is the second RGP that IT has ever
-- raised, and a number that means something is worth more than one that fits a
-- day. Four digits carries 9,999 passes per department per type. The `lpad` is
-- a MINIMUM width, not a maximum: pass 10,000 becomes RGP-IT-10000 rather than
-- colliding.
--
-- Legacy numbers cannot interfere with the counter because the backfill below
-- converts every one of them — after it runs, 'RGP-IT-%' matches exactly the
-- rows the counter means to count. That is why the backfill and the new
-- generator must land in the SAME transaction.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- The department's short code, defined exactly once
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public.departments.code` is the answer whenever there is one — it is what
-- an admin typed and what VMS shows, and inventing a different abbreviation
-- here would put two names for one department in front of the same person.
-- All 15 rows currently have one; the fallbacks exist because `code` is
-- nullable in VMS's schema and this function must never return an empty
-- string, which would generate 'RGP--0001'.
--
--   1. `code`, uppercased, stripped to A-Z0-9, first 5 characters
--   2. failing that, the same treatment of `name`, first 4 characters
--   3. failing that, 'GEN' — a pass whose department was deleted still needs
--      a number, and a readable placeholder beats a malformed label
--
-- STABLE, not IMMUTABLE: it reads a table. It is called once per insert and
-- once per row in the backfill, so the plan cost is irrelevant.
create or replace function gatepass.dept_code(p_department_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- THE LEFT JOIN IS LOAD-BEARING, and a plain `from … where id = $1` is the
  -- bug it replaces. That form returns NO ROW for an unknown id, and a sql
  -- function with no row returns NULL — so `coalesce(…, 'GEN')` never runs and
  -- the prefix becomes `RGP-` || NULL = NULL. A stated fallback that cannot
  -- fire is worse than no fallback. Selecting from a one-row source and
  -- LEFT JOINing the department guarantees exactly one row, so the coalesce
  -- always gets its turn. (Same reason every join to public.* in this schema
  -- is a left join: it degrades to a null column, never to a vanished row.)
  select coalesce(
    nullif(left(regexp_replace(upper(coalesce(d.code, '')), '[^A-Z0-9]', '', 'g'), 5), ''),
    nullif(left(regexp_replace(upper(coalesce(d.name, '')), '[^A-Z0-9]', '', 'g'), 4), ''),
    'GEN'
  )
  from (select 1) as _one
  left join public.departments d on d.id = p_department_id;
$$;

comment on function gatepass.dept_code(uuid) is
  'The department''s short code as it appears in a pass number (064): '
  'public.departments.code uppercased and stripped to A-Z0-9, capped at 5; '
  'falling back to the first 4 such characters of the name, then ''GEN''. '
  'The ONE definition — both set_pass_number() and 064''s backfill call it.';

-- `dept_code` is SECURITY DEFINER because it reads `public.departments`, which
-- belongs to VMS and whose policies this app does not control. It is called
-- only from a trigger and a migration, so no signed-in role needs it and none
-- gets it — an unused SECURITY DEFINER function is EXECUTE-able over PostgREST
-- by every authenticated user, and this project's rule is that it must not be.
revoke all on function gatepass.dept_code(uuid) from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- The generator
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reproduced whole from 042 because a plpgsql body cannot be patched in place.
-- Only the two lines building `prefix` differ; the advisory lock, the prefix
-- scan and the four server-owned columns are byte-for-byte what 042 deployed
-- and what 010 deployed before it.
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
  -- The ONE derivation. See gatepass.dept_code above.
  dept   := gatepass.dept_code(new.department_id);
  prefix := new.type::text || '-' || dept;

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
  'Assigns pass_number as TYPE-DEPTCODE-NNNN (064; e.g. RGP-IT-0001). The date '
  'left the label — gate_passes.created_at still carries it. The department '
  'code comes from gatepass.dept_code(), the same function 064''s backfill '
  'used. Counter is per (type, department), serialised by an advisory lock on '
  'the prefix.';

-- ═══════════════════════════════════════════════════════════════════════════
-- The backfill — every earlier pass, renumbered (client, 2026-08-23)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TRIGGERS ARE OFF FOR THE DURATION, and that is not a shortcut. `gate_passes`
-- carries `touch_updated_at`, which stamps `updated_at := now()` on every
-- update — so a 76-row relabel would rewrite every pass's "last movement" to
-- the moment this migration ran and fire 76 realtime events at every connected
-- browser. `validate_pass`, `block_unapproved_gate_move` and
-- `cascade_pass_open_state` would also all run for a change that touches one
-- text column and no state. `disable trigger user` is scoped to this
-- transaction's table lock and re-enabled below unconditionally.
--
-- ORDER: `created_at` ascending within (type, department), so the oldest IT
-- RGP becomes RGP-IT-0001 and the numbers read in the order the passes were
-- actually raised.
alter table gatepass.gate_passes disable trigger user;

with renumbered as (
  select
    g.id,
    g.type::text || '-' || gatepass.dept_code(g.department_id) || '-' ||
      lpad(
        row_number() over (
          partition by g.type, g.department_id
          order by g.created_at, g.id
        )::text,
        4, '0'
      ) as new_number
  from gatepass.gate_passes g
)
update gatepass.gate_passes g
   set pass_number = r.new_number
  from renumbered r
 where g.id = r.id
   and g.pass_number is distinct from r.new_number;

alter table gatepass.gate_passes enable trigger user;

-- The unique index on pass_number is the proof the backfill did not collide:
-- if two rows had been handed the same label the statement above would already
-- have aborted this transaction. This is the belt to that braces — it fails
-- loudly if a future edit to the window function ever stops partitioning
-- correctly, rather than leaving duplicates for a guard to find at the gate.
do $$
declare
  dupes integer;
  stale integer;
begin
  select count(*) into dupes
    from (select pass_number from gatepass.gate_passes
           group by pass_number having count(*) > 1) d;
  if dupes > 0 then
    raise exception '064 backfill produced % duplicated pass numbers', dupes;
  end if;

  -- Nothing may still carry a date-shaped number: 8 consecutive digits is the
  -- old YYYYMMDD and cannot occur in TYPE-DEPT-NNNN with a 4-digit counter.
  select count(*) into stale
    from gatepass.gate_passes
   where pass_number ~ '\d{8}';
  if stale > 0 then
    raise exception '064 backfill left % rows on the old date-based number', stale;
  end if;
end;
$$;

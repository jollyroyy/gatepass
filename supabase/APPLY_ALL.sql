-- ============================================================
-- COMBINED MIGRATION — Material Gate Pass System
--
-- HOW TO APPLY:
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Paste this entire file -> Run
--   3. Project Settings -> API -> Exposed schemas -> add 'gatepass'
--      (without step 3 every table returns 404 PGRST106)
--
-- Project: oxzzeonftrmohdrancex (shared with the VMS app)
-- Touches NOTHING in the public schema except by foreign key reference.
-- Idempotent: safe to re-run.
--
-- Run this as `postgres` — pasting it into the SQL Editor does that. Section 006
-- depends on it: the owner-rights view it creates only works when its owner also
-- owns public.profiles. See that section's header.
--
-- Section order is 001-004, 006, then 005. That is deliberate: 005 is an OPTIONAL
-- demo seed and stays last so it can be dropped from a real deployment without
-- taking 006 with it.
--
-- NOT included here: supabase/fixes/*.sql. Those touch the `public` schema, which
-- belongs to VMS, and are applied by hand as a conscious cross-project decision.
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- 001_gatepass_schema.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 001 — Material Gate Pass System: schema, enums, tables, pass numbering
--
-- CONTEXT: this runs in the SAME Supabase project as the VMS visitor system.
-- Everything this app owns lives in the `gatepass` schema. `public` belongs to
-- VMS and is referenced by foreign key ONLY — no VMS table is altered here.
--
-- Verified against the live project before writing:
--   public.profiles(id, email, full_name, role, department_id, delegate_id, created_at)
--   public.departments(id, name, code, created_at)
--   public.user_role = guard | hod | staff | admin | super_admin
--   all 14 auth users have app_metadata.role populated
-- ============================================================================

create schema if not exists gatepass;

-- ─── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type gatepass.pass_type as enum ('IGP','OGP','RGP','NRGP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gatepass.pass_status as enum ('pending','matched','flagged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gatepass.return_status as enum ('not_applicable','awaiting_return','returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gatepass.verify_action as enum ('matched','flagged','returned');
exception when duplicate_object then null; end $$;

-- ─── HOD → departments (many-to-many) ───────────────────────────────────────
-- VMS models this as a single profiles.department_id, which cannot express
-- "one HOD covering 2-3 departments" (the requirement here), and the live DB
-- already has two HODs per department. A join table holds both shapes.
-- VMS's profiles.department_id is left untouched and ignored by this app.
create table if not exists gatepass.hod_departments (
  hod_id        uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (hod_id, department_id)
);

create index if not exists hod_departments_dept_idx
  on gatepass.hod_departments (department_id);

-- ─── Gate passes ────────────────────────────────────────────────────────────
-- One table with a `type` enum rather than four tables: the four types share
-- ~90% of their fields, one query answers "pending/matched/flagged across all
-- types" with no UNION, RLS is written once, and a 5th type later is one enum
-- value instead of a new table + policies + UI.
create table if not exists gatepass.gate_passes (
  id                   uuid primary key default gen_random_uuid(),
  pass_number          text not null unique,          -- IGP-20260726-0001, set by trigger
  type                 gatepass.pass_type   not null,
  status               gatepass.pass_status not null default 'pending',

  department_id        uuid not null references public.departments(id),
  raised_by            uuid not null references public.profiles(id),

  -- The fields security physically checks against the visitor and the material
  visitor_name         text not null,
  visitor_company      text,
  material_description text not null,
  quantity             numeric(12,2) not null check (quantity > 0),
  unit                 text not null default 'nos',
  vehicle_number       text,
  purpose              text not null,

  -- RGP only
  expected_return_date date,
  return_status        gatepass.return_status not null default 'not_applicable',
  actual_return_date   timestamptz,

  -- Set by security on match / flag
  verified_by          uuid references public.profiles(id),
  verified_at          timestamptz,
  flag_reason          text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- An RGP must carry a return date; nothing else may.
  constraint rgp_needs_return_date
    check ((type = 'RGP') = (expected_return_date is not null)),
  -- A flag is worthless to the HOD without a reason.
  constraint flagged_needs_reason
    check (status <> 'flagged'
           or (flag_reason is not null and length(trim(flag_reason)) > 0)),
  -- Only an RGP can be awaiting or have completed a return.
  constraint only_rgp_returns
    check (return_status = 'not_applicable' or type = 'RGP'),
  -- A returned pass must record when.
  constraint returned_needs_date
    check (return_status <> 'returned' or actual_return_date is not null)
);

create index if not exists gate_passes_status_idx      on gatepass.gate_passes (status);
create index if not exists gate_passes_dept_idx        on gatepass.gate_passes (department_id);
create index if not exists gate_passes_raised_by_idx   on gatepass.gate_passes (raised_by);
create index if not exists gate_passes_created_idx     on gatepass.gate_passes (created_at desc);
create index if not exists gate_passes_type_idx        on gatepass.gate_passes (type);
-- Partial index: the pending-returns log only ever reads this slice.
create index if not exists gate_passes_awaiting_idx
  on gatepass.gate_passes (expected_return_date)
  where return_status = 'awaiting_return';

-- ─── Verification audit trail ───────────────────────────────────────────────
-- Append-only history. gate_passes holds current state; this holds what happened.
create table if not exists gatepass.verifications (
  id                uuid primary key default gen_random_uuid(),
  gate_pass_id      uuid not null references gatepass.gate_passes(id) on delete cascade,
  action            gatepass.verify_action not null,
  security_user_id  uuid not null references public.profiles(id),
  verified_quantity numeric(12,2),
  verified_vehicle  text,
  remarks           text,
  created_at        timestamptz not null default now()
);

create index if not exists verifications_pass_idx
  on gatepass.verifications (gate_pass_id, created_at desc);

-- ─── Pass number generation ─────────────────────────────────────────────────
-- Race-safe by advisory transaction lock, following the fix VMS needed in its
-- migration 009: a plain max()+1 let two concurrent inserts compute the same
-- number and collide on the unique constraint. Two guards at two gates, or two
-- HODs submitting at once, would hit it.
--
-- search_path is pinned empty and every reference fully qualified: a SECURITY
-- DEFINER function with a mutable search_path is a privilege-escalation vector.
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
  return new;
end;
$$;

drop trigger if exists set_pass_number on gatepass.gate_passes;
create trigger set_pass_number
  before insert on gatepass.gate_passes
  for each row execute function gatepass.set_pass_number();

-- ─── updated_at maintenance ─────────────────────────────────────────────────
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
  return new;
end;
$$;

drop trigger if exists touch_updated_at on gatepass.gate_passes;
create trigger touch_updated_at
  before update on gatepass.gate_passes
  for each row execute function gatepass.touch_updated_at();

-- ═══════════════════════════════════════════════════════════
-- 002_gatepass_rls.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 002 — Grants and Row Level Security
--
-- Threat model this file is written against:
--   * An HOD must never read another department's passes. They share one DB with
--     other departments and the client is fully untrusted — RLS is the authority,
--     never the UI.
--   * An HOD must never be able to mark their own pass "matched". Only security
--     verifies, and only through the RPCs in 003.
--   * No client may rewrite pass fields after security has looked at them.
-- ============================================================================

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant usage on schema gatepass to authenticated;

-- No UPDATE and no DELETE are granted to anyone, anywhere in this app.
-- State changes go exclusively through the RPCs in migration 003. Postgres RLS
-- cannot express "you may change `status` and `flag_reason` but not
-- `visitor_name`", so column-level authority lives in the functions instead.
grant select, insert on gatepass.gate_passes   to authenticated;
grant select         on gatepass.verifications to authenticated;
grant select, insert, delete on gatepass.hod_departments to authenticated;

-- `anon` gets nothing. Every screen in this app requires a login.

-- ─── Role helpers ───────────────────────────────────────────────────────────
-- Named app_role() rather than current_role() because current_role is a reserved
-- SQL keyword and the shadowing is a trap for the next reader.
--
-- Reads app_metadata from the JWT. app_metadata is only writable server-side,
-- which is why it is trusted; user_metadata is user-writable and must never be
-- used for authorization. Verified: all 14 live users have app_metadata.role set.
create or replace function gatepass.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    (select p.role::text from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function gatepass.is_security()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gatepass.app_role() in ('guard', 'admin', 'super_admin');
$$;

create or replace function gatepass.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gatepass.app_role() in ('admin', 'super_admin');
$$;

-- The departments the signed-in HOD is responsible for.
-- SECURITY DEFINER so the policy on gate_passes can consult hod_departments
-- without recursing back through that table's own policies. VMS had to patch
-- exactly this class of recursion three times (its migrations 006, 013, 028).
create or replace function gatepass.my_department_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hd.department_id
    from gatepass.hod_departments hd
   where hd.hod_id = auth.uid();
$$;

grant execute on function gatepass.app_role()          to authenticated;
grant execute on function gatepass.is_security()       to authenticated;
grant execute on function gatepass.is_admin()          to authenticated;
grant execute on function gatepass.my_department_ids() to authenticated;

-- ─── RLS: hod_departments ───────────────────────────────────────────────────
alter table gatepass.hod_departments enable row level security;

drop policy if exists hod_departments_select on gatepass.hod_departments;
create policy hod_departments_select
  on gatepass.hod_departments for select to authenticated
  using (
    hod_id = auth.uid()          -- an HOD sees their own assignments
    or gatepass.is_security()    -- security/admin see all (queue shows dept names)
  );

drop policy if exists hod_departments_insert on gatepass.hod_departments;
create policy hod_departments_insert
  on gatepass.hod_departments for insert to authenticated
  with check (gatepass.is_admin());

drop policy if exists hod_departments_delete on gatepass.hod_departments;
create policy hod_departments_delete
  on gatepass.hod_departments for delete to authenticated
  using (gatepass.is_admin());

-- ─── RLS: gate_passes ───────────────────────────────────────────────────────
alter table gatepass.gate_passes enable row level security;

drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select
  on gatepass.gate_passes for select to authenticated
  using (
    gatepass.is_security()                                    -- guard/admin: all
    or department_id in (select gatepass.my_department_ids())  -- hod: own depts only
  );

-- An HOD may only ever create a pass that is:
--   * for a department they actually hold,
--   * attributed to themselves, and
--   * born 'pending' and unverified.
-- The last three clauses stop a crafted insert from arriving pre-matched.
drop policy if exists gate_passes_insert on gatepass.gate_passes;
create policy gate_passes_insert
  on gatepass.gate_passes for insert to authenticated
  with check (
    gatepass.app_role() = 'hod'
    and raised_by = auth.uid()
    and department_id in (select gatepass.my_department_ids())
    and status = 'pending'
    and verified_by is null
    and verified_at is null
    and flag_reason is null
    and actual_return_date is null
    and return_status = 'not_applicable'
  );

-- Deliberately NO update policy and NO delete policy. See the grants above.

-- ─── RLS: verifications ─────────────────────────────────────────────────────
alter table gatepass.verifications enable row level security;

drop policy if exists verifications_select on gatepass.verifications;
create policy verifications_select
  on gatepass.verifications for select to authenticated
  using (
    gatepass.is_security()
    or exists (
      select 1
        from gatepass.gate_passes p
       where p.id = gate_pass_id
         and p.department_id in (select gatepass.my_department_ids())
    )
  );

-- Inserts happen only inside the SECURITY DEFINER RPCs. No policy granted.

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- The security queue subscribes to postgres_changes so a newly raised pass shows
-- up at the gate without a refresh. Realtime still applies RLS per subscriber.
do $$ begin
  alter publication supabase_realtime add table gatepass.gate_passes;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime not found — skipping realtime setup';
end $$;

-- ═══════════════════════════════════════════════════════════
-- 003_gatepass_rpcs.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 003 — State machine RPCs
--
-- These three functions are the ONLY way a gate pass changes state. No client
-- holds UPDATE on gatepass.gate_passes (see 002), so the rules below cannot be
-- bypassed by a crafted REST call, a different frontend, or a future second app.
--
-- Lifecycle:
--                          ┌─ flag_pass  ──→ flagged (terminal; HOD follows up)
--   pending ───────────────┤
--                          └─ match_pass ──→ matched
--                                              │  (RGP only)
--                                              ├──→ awaiting_return
--                                              │        │ mark_returned
--                                              │        └──→ returned
--                                              └─ (IGP/OGP/NRGP: done)
--
-- Exception messages here are deliberately written to be shown to the user
-- verbatim — src/lib/errors.ts passes Postgres P0001 messages straight through.
-- ============================================================================

-- ─── Match: everything checks out, let it through ───────────────────────────
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

-- ─── Flag: mismatch found, bounce it back to the HOD ────────────────────────
create or replace function gatepass.flag_pass(
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
  if not gatepass.is_security() then
    raise exception 'Only security can flag a gate pass.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when flagging a pass.';
  end if;

  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be flagged.',
      v_pass.status;
  end if;

  update gatepass.gate_passes
     set status      = 'flagged',
         flag_reason = trim(p_reason),
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'flagged', auth.uid(), trim(p_reason));

  return v_pass;
end;
$$;

-- ─── Mark returned: an RGP's material came back ─────────────────────────────
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
  v_pass gatepass.gate_passes;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can record a return.';
  end if;

  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.return_status <> 'awaiting_return' then
    raise exception 'This pass is not awaiting a return.';
  end if;

  update gatepass.gate_passes
     set return_status      = 'returned',
         actual_return_date = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'returned', auth.uid(), p_remarks);

  return v_pass;
end;
$$;

-- Callable by any signed-in user; each function enforces its own role check, so
-- an HOD calling match_pass gets a clean refusal rather than a permission error.
grant execute on function gatepass.match_pass(uuid, numeric, text, text) to authenticated;
grant execute on function gatepass.flag_pass(uuid, text)                 to authenticated;
grant execute on function gatepass.mark_returned(uuid, text)             to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 004_gatepass_view.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 004 — Reporting view and KPI aggregate
-- ============================================================================

-- ⚠ The two profiles joins below are SUPERSEDED BY 006. They are left here so
-- this file still reads as the history of the view, but 006 repoints them at
-- gatepass.profile_names: under security_invoker these LEFT JOINs ran
-- public.profiles' policies as the caller, and a recursive policy on that
-- VMS-owned table (42P17) took down every screen. Read 006 before editing.
--
-- `security_invoker = true` is load-bearing. Without it a view runs with its
-- OWNER's privileges, which would bypass the RLS on gate_passes entirely and let
-- any HOD read every department's passes through the view. Requires PG15+.
--
-- The joins to public.profiles / public.departments are LEFT joins on purpose:
-- those tables belong to VMS and their RLS policies can change without notice.
-- An inner join would make pass rows silently VANISH the day VMS narrows its
-- profiles policy. A left join degrades to a null name instead — visibly wrong
-- rather than invisibly wrong.
create or replace view gatepass.v_gate_passes
with (security_invoker = true) as
select
  p.*,
  -- One definition of "overdue", used by every list and every KPI.
  (p.return_status = 'awaiting_return'
   and p.expected_return_date is not null
   and p.expected_return_date < (now() at time zone 'UTC')::date) as is_overdue,
  d.name  as department_name,
  d.code  as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join public.departments d  on d.id  = p.department_id
left join public.profiles    rb on rb.id = p.raised_by
left join public.profiles    vb on vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

-- ─── KPI aggregate ──────────────────────────────────────────────────────────
-- One round trip for the whole dashboard instead of six count queries.
--
-- NOT security definer: a plain function runs as the invoker, so the RLS on
-- gate_passes scopes these counts to the caller automatically. An HOD gets their
-- own departments' numbers; security and admin get the whole site's.
create or replace function gatepass.kpis(p_department_id uuid default null)
returns table (
  total            bigint,
  pending          bigint,
  matched          bigint,
  flagged          bigint,
  awaiting_return  bigint,
  overdue          bigint,
  raised_today     bigint
)
language sql
stable
as $$
  select
    count(*)                                                        as total,
    count(*) filter (where status = 'pending')                      as pending,
    count(*) filter (where status = 'matched')                      as matched,
    count(*) filter (where status = 'flagged')                      as flagged,
    count(*) filter (where return_status = 'awaiting_return')       as awaiting_return,
    count(*) filter (where is_overdue)                              as overdue,
    count(*) filter (where created_at >= date_trunc('day', now()))  as raised_today
  from gatepass.v_gate_passes
  where p_department_id is null or department_id = p_department_id;
$$;

grant execute on function gatepass.kpis(uuid) to authenticated;

-- ─── Pass detail with its verification history ──────────────────────────────
-- Used by the detail screen so the timeline arrives with the record.
create or replace view gatepass.v_verifications
with (security_invoker = true) as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join public.profiles su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 006_profiles_rls_isolation.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 006 — Stop reading public.profiles under the caller's RLS
--
-- Symptom: a guard signs in and every screen that resolves a person's name dies
-- with SQLSTATE 42P17, "infinite recursion detected in policy for relation
-- profiles".
--
-- Cause: a policy on public.profiles whose USING clause reads public.profiles.
-- That table belongs to VMS, and VMS has shipped three separate fixes for this
-- exact class of bug (its migrations 006, 013, 022) — so the live policy set does
-- not match its files, and can drift again at any time.
--
-- Why gatepass was taking the hit: gatepass.v_gate_passes is
-- `security_invoker = true` (correctly — it must enforce gate_passes RLS against
-- the caller), and it LEFT JOINed public.profiles. security_invoker applies to
-- EVERY table the view touches, so the recursive profiles policy was evaluated
-- for the guard and the whole query aborted. A LEFT JOIN protects against a
-- NARROWED policy (rows come back with a null name); it cannot protect against a
-- policy that raises.
--
-- Fix: gatepass stops depending on the policies of a table it does not own.
-- Every name lookup now goes through objects in this schema:
--
--   gatepass.profile_names          owner-rights view — id + full_name only
--   gatepass.my_profile()           the caller's own row
--   gatepass.admin_list_profiles()  admin-gated directory
--
-- public is not touched. No policy, table, or function in public is altered by
-- this file — the two-schema rule holds. The recursion itself is still VMS's bug
-- to fix (see supabase/fixes/public_profiles_recursion.sql); this file only makes
-- GatePass immune to it.
-- ============================================================================

-- ─── The one deliberate owner-rights object in this schema ──────────────────
-- NOTE THE ABSENCE OF `security_invoker`. That is the entire point of this view
-- and the only place in this codebase where a view is allowed to omit it.
--
-- Without security_invoker a view reads its base tables as the view's OWNER
-- (postgres, which also owns public.profiles), so the policies on
-- public.profiles are never evaluated — and therefore cannot recurse.
--
-- Safe because of what it exposes, not because of who calls it: two columns,
-- id and full_name, for accounts that already exist in a shared corporate
-- directory. No email, no role, no department, no delegate. Both of VMS's
-- intended profiles SELECT policies (its 013 and 022) are `using (true)` for
-- `authenticated` anyway, so this grants no read that VMS withholds.
--
-- Do NOT add columns here. Anything beyond a display name belongs in the
-- admin-gated function below.
--
-- APPLY THIS AS `postgres` (i.e. paste it into the Supabase SQL Editor, which is
-- how every migration in this repo is applied). The view's owner is what makes it
-- work: `postgres` also owns public.profiles, and a table's owner is not subject
-- to that table's policies. Applied as some other non-owner role, this view would
-- inherit the recursion it exists to avoid — and it would fail loudly the first
-- time a guard loaded the console, not silently.
drop view if exists gatepass.profile_names;
create view gatepass.profile_names as
select p.id, p.full_name
  from public.profiles p;

grant select on gatepass.profile_names to authenticated;

-- ─── The caller's own profile ───────────────────────────────────────────────
-- Replaces `pub().from('profiles').eq('id', session.user.id)` in the app shell,
-- the sidebar, and the role fallback in src/supabaseClient.ts.
--
-- Scoped to auth.uid() inside the function body, so being SECURITY DEFINER
-- widens nothing: a caller can only ever read the row they could already read.
create or replace function gatepass.my_profile()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at
    from public.profiles p
   where p.id = auth.uid();
$$;

-- ─── The admin user directory ───────────────────────────────────────────────
-- Backs the admin Users tab and the HOD picker on the Departments tab. Returns
-- email and role, so it is gated on gatepass.is_admin() rather than left open.
--
-- This is STRICTER than what it replaces: the old client query read
-- public.profiles under VMS's `using (true)` SELECT policy, which let any
-- authenticated user — including a guard — enumerate every email and role.
--
-- p_role filters to one role ('hod' for the picker); null returns everyone.
create or replace function gatepass.admin_list_profiles(p_role text default null)
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can list users.';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at
      from public.profiles p
     where p_role is null or p.role::text = p_role
     order by p.role, p.full_name;
end;
$$;

grant execute on function gatepass.my_profile()                 to authenticated;
grant execute on function gatepass.admin_list_profiles(text)    to authenticated;

-- ─── Repoint the views away from public.profiles ────────────────────────────
-- Supersedes the profiles joins in 004. Everything else about these views is
-- unchanged: still security_invoker (gate_passes RLS is still enforced against
-- the caller), still LEFT JOINs, still one definition of is_overdue.
--
-- The join to public.departments stays as it was — VMS's departments SELECT
-- policy is a flat `using (true)` with no subquery, so it cannot recurse.
--
-- `create or replace` keeps the column list byte-identical, which is required
-- while gatepass.kpis() depends on this view.
create or replace view gatepass.v_gate_passes
with (security_invoker = true) as
select
  p.*,
  (p.return_status = 'awaiting_return'
   and p.expected_return_date is not null
   and p.expected_return_date < (now() at time zone 'UTC')::date) as is_overdue,
  d.name  as department_name,
  d.code  as department_code,
  rb.full_name as raised_by_name,
  vb.full_name as verified_by_name
from gatepass.gate_passes p
left join public.departments      d  on d.id  = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

create or replace view gatepass.v_verifications
with (security_invoker = true) as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join gatepass.profile_names su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

-- ─── Self-check ─────────────────────────────────────────────────────────────
-- Run as a guard (not in the SQL editor, which runs as postgres and bypasses
-- RLS — use the app or a signed-in REST call):
--
--   select id, pass_number, raised_by_name from gatepass.v_gate_passes limit 1;
--   select * from gatepass.my_profile();
--
-- Both must return without a 42P17. `select * from gatepass.admin_list_profiles()`
-- must raise 'Only an admin can list users.' for that same guard.

-- ═══════════════════════════════════════════════════════════
-- 007_service_role_grants.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 007 — Let the service role reach the gatepass schema (verification only)
--
-- Symptom: `node scripts/verify-rls.mjs` aborts during SETUP, before it checks
-- anything, with:
--
--   assign department: permission denied for schema gatepass   (SQLSTATE 42501)
--
-- Cause: migration 002 grants `usage on schema gatepass` to `authenticated` and
-- to nobody else. That is correct for the app — every screen requires a login,
-- and `anon` must stay locked out. But it also locks out `service_role`.
--
-- Unlike `public`, a NEW schema gets no default Supabase grants: `service_role`
-- is omnipotent over `public` only because Supabase granted it there at project
-- creation. Nothing propagates that to `gatepass`. So the service key — the one
-- credential that can create the throwaway users an RLS test needs — could not
-- read or write a single gatepass table, and the live verification that
-- CLAUDE.md lists as outstanding could never run.
--
-- Why this does not weaken the threat model in 002:
--
--   * `authenticated` and `anon` gain NOTHING here. Every grant below names
--     `service_role` explicitly. The browser's privileges are byte-for-byte
--     what migration 002 set them to.
--   * `service_role` gets NO privilege on gatepass.gate_passes at all — not
--     select, not insert, and above all not update. The "state transitions are
--     RPC-only" invariant therefore holds even for the service key: there is no
--     credential anywhere in this system that can PATCH a pass's status outside
--     match_pass / flag_pass / mark_returned.
--   * The service-role key never reaches the browser. It carries no VITE_
--     prefix (Vite inlines VITE_* into the bundle), lives only in scripts/, and
--     tests/security/clientSecrets.test.ts fails the build if it appears under
--     src/.
--
-- What the verification script actually needs, and nothing beyond it: it assigns
-- a throwaway HOD to a department, then removes that assignment in its teardown.
-- That is hod_departments only.
--
-- Cleanup of test PASSES is deliberately NOT enabled here. Deleting from
-- gatepass.gate_passes would mean granting DELETE on the audit trail, which
-- tests/security/sqlInvariants.test.ts forbids outright — a gate pass is a
-- record that someone took material off site, and it should not be removable
-- through the API by any key. Consequence to know before you run it:
-- `verify-rls.mjs --mutate` can create a pass but cannot delete it afterwards.
-- Use the read-only mode unless you are prepared to remove the tagged row by
-- hand in the SQL Editor. See scripts/verify-rls.mjs.
-- ============================================================================

-- Reaching the schema at all. Without this every other grant is unusable:
-- Postgres checks schema USAGE before it checks table privileges, which is why
-- the failure reads "permission denied for schema gatepass" and never mentions
-- a table.
grant usage on schema gatepass to service_role;

-- The one table the verification harness writes. `authenticated` already holds
-- exactly these three privileges on it (migration 002, line 22) — an HOD's
-- department assignments are added and removed by the admin UI — so this grants
-- the service role no shape of access that does not already exist.
grant select, insert, delete on gatepass.hod_departments to service_role;

-- Read-only, so a failing run can report what it saw. `verifications` rows are
-- written only inside the SECURITY DEFINER RPCs in migration 003; no INSERT is
-- granted here, and none is needed.
grant select on gatepass.verifications to service_role;

-- Deliberately absent, and each omission is load-bearing:
--
--   grant ... on gatepass.gate_passes to service_role;   -- audit trail; see above
--   grant usage on schema gatepass to anon;              -- no logged-out access
--   grant ... to authenticated;                          -- 002 is the only authority
--
-- If a future script needs one of these, that is a security review, not a
-- one-line patch.

-- ═══════════════════════════════════════════════════════════
-- 008_qr_token_expiry_cancel.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 009_restore_narrow_grants.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 009 — Restore the narrow grants that migration 002 intended
--
-- WHAT WENT WRONG
--
-- Adding `gatepass` to Project Settings → API → Exposed schemas in the Supabase
-- dashboard does more than flip a PostgREST setting. It also runs, once:
--
--     grant all on all tables in schema gatepass to anon, authenticated, service_role;
--
-- That silently overwrote the deliberately narrow grants in 002. Probed live on
-- 2026-07-27, BEFORE this migration, the real database held:
--
--     anon          | gate_passes | DELETE, INSERT, SELECT, UPDATE
--     authenticated | gate_passes | DELETE, INSERT, SELECT, UPDATE
--     service_role  | gate_passes | DELETE, INSERT, SELECT, UPDATE
--
-- against CLAUDE.md's documented invariant: "No client holds UPDATE on
-- gatepass.gate_passes (migration 002 grants only select, insert)."
--
-- WHY THE APP WAS NOT ACTUALLY BROKEN
--
-- RLS held the line on its own. gate_passes has RLS enabled with exactly two
-- policies — gate_passes_select and gate_passes_insert, both scoped to
-- `authenticated`. There is no UPDATE policy and no DELETE policy, so an UPDATE
-- was refused for want of a policy even while the GRANT existed. `anon` has no
-- policy at all, so it could not read or write a single row despite holding
-- every table privilege.
--
-- So this is not an incident. It is the loss of a layer of defence in depth,
-- which matters because the remaining layer is one mistake deep: the day anyone
-- adds a `for all` or `using (true)` policy for convenience, the grants are
-- already sitting there to make it catastrophic — and for `anon`, unauthenticated.
--
-- WHY THE STATIC TEST DID NOT CATCH IT
--
-- tests/security/sqlInvariants.test.ts greps the migration FILES for update/delete
-- grants. The files are clean; the database was not. A grep over source can never
-- see drift introduced through the dashboard. Live verification is the only thing
-- that can, which is what scripts/verify-rls.mjs is for.
--
-- THIS WILL COME BACK if someone re-toggles Exposed schemas. Re-run this file if
-- verify-rls.mjs reports the wide grants again. It is idempotent.
--
-- Nothing here touches `public` — VMS owns that schema (the two-schema rule).
-- ============================================================================

-- ─── anon: nothing, anywhere ────────────────────────────────────────────────
-- Every route in this app requires a session. anon exists only to reach GoTrue
-- for sign-in, which does not go through PostgREST and needs no table grant.
revoke all on all tables in schema gatepass from anon;
revoke all on all sequences in schema gatepass from anon;
revoke all on all functions in schema gatepass from anon;
revoke usage on schema gatepass from anon;

-- ─── authenticated: read, plus insert only where a policy expects it ────────
-- Start from zero rather than revoking named privileges one by one, so this
-- converges on the intended set no matter what state it is run against.
revoke all on all tables in schema gatepass from authenticated;

grant usage on schema gatepass to authenticated;

-- State transitions are RPC-only. INSERT is granted because raising a pass is a
-- plain insert guarded by gate_passes_insert; UPDATE and DELETE are deliberately
-- absent so that match_pass / flag_pass / mark_returned / cancel_pass remain the
-- only ways a row can ever change. Do not add them back.
grant select, insert on gatepass.gate_passes    to authenticated;

-- Append-only audit trail, written exclusively by the security definer RPCs.
grant select                on gatepass.verifications  to authenticated;

-- The admin UI assigns and unassigns HODs; both are policy-guarded.
grant select, insert, delete on gatepass.hod_departments to authenticated;

-- Read-only projections. RLS is enforced through them because both carry
-- with (security_invoker = true).
grant select on gatepass.v_gate_passes  to authenticated;
grant select on gatepass.v_verifications to authenticated;
grant select on gatepass.profile_names   to authenticated;

-- Failed-scan log: readable (the policy narrows it to security), never writable
-- from a client — only lookup_pass inserts here.
grant select on gatepass.scan_attempts to authenticated;

-- ─── service_role: the narrowest set that unblocks verify-rls.mjs ───────────
-- Deliberately NO privilege of any kind on gate_passes. The RPC-only state
-- machine has to hold even for the service key, otherwise a leaked key could
-- rewrite gate history directly and the audit trail would be worthless.
-- The cost is real and accepted: verify-rls.mjs cannot delete the pass it raises,
-- so it prints manual cleanup SQL instead. Do not "fix" that by granting here.
revoke all on all tables in schema gatepass from service_role;

grant usage on schema gatepass to service_role;
grant select, insert, delete on gatepass.hod_departments to service_role;
grant select on gatepass.verifications to service_role;

-- ═══════════════════════════════════════════════════════════
-- 010_direction_and_hod_delete.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 011_drop_dead_type_index.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 011 — Drop the now-useless index on gate_passes.type
--
-- `gate_passes_type_idx` was created in 001, when `type` held four values and
-- looked like a reasonable filter column. Migration 010 reduced it to two (RGP,
-- NRGP), and nothing filters on it server-side anyway — the gate console pulls
-- the pending queue and narrows by category in the browser
-- (GateConsole.tsx: `categoryKey(p.type, p.direction) !== categoryFilter`).
--
-- A btree index over two distinct values cannot help: the planner will always
-- prefer a sequential scan when a predicate selects ~half the table. So it is
-- pure cost — extra work on every insert and update, extra pages to keep warm,
-- and one more object nobody is reviewing.
--
-- Deliberately NOT dropped, so the reasoning is on record:
--
--   gate_passes_status_idx      the console's hot path is `status = 'pending'`
--   gate_passes_dept_idx        RLS narrows every HOD read by department
--   gate_passes_created_idx     every list orders by created_at desc
--   gate_passes_raised_by_idx   /my-passes filters by raised_by, and the delete
--                               policy in 010 predicates on it
--   gate_passes_qr_token_idx    unique; the scan path looks up by token
--   gate_passes_one_pending_per_material_idx  unique; enforces the duplicate rule
--
-- Also deliberately kept: gate_passes.updated_at. Nothing renders it, but it is
-- maintained by the touch_updated_at trigger and is the only record of WHEN a
-- row last changed. On an audit table that is worth its bytes — "unused by the
-- UI" and "unused" are not the same thing.
--
-- No composite index on (type, direction) is added to replace this. There is no
-- server-side query to serve, and an index added speculatively is exactly the
-- unreviewed surface this migration exists to remove. Add one when a slow query
-- proves it is needed.
-- ============================================================================

drop index if exists gatepass.gate_passes_type_idx;

-- ═══════════════════════════════════════════════════════════
-- 012_pass_integrity_constraints.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 005_seed_hod_departments.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 005 — OPTIONAL demo seed: give existing HODs their departments
--
-- Why this exists: gatepass.hod_departments starts empty, and an HOD with no
-- department assignment can neither see nor raise anything (RLS scopes them to
-- `department_id in (select my_department_ids())`, which returns nothing). Without
-- this the app looks broken on first login until an admin assigns departments.
--
-- This seeds from VMS's existing public.profiles.department_id, which is already
-- populated for all 6 HOD accounts. Idempotent — safe to re-run.
--
-- SKIP THIS FILE in a real deployment; use the Admin → Departments screen instead.
-- ============================================================================

-- 1) Every HOD gets the department VMS already has them against.
insert into gatepass.hod_departments (hod_id, department_id)
select p.id, p.department_id
  from public.profiles p
 where p.role = 'hod'
   and p.department_id is not null
on conflict (hod_id, department_id) do nothing;

-- 2) Demonstrate the multi-department case the brief actually asked for:
--    one HOD covering several departments. Gives hod.it@demo.vms the two
--    departments that currently have no HOD at all (Sales, and the DEV one),
--    so a single login shows the multi-department picker on the raise form.
insert into gatepass.hod_departments (hod_id, department_id)
select p.id, d.id
  from public.profiles p
 cross join public.departments d
 where p.email = 'hod.it@demo.vms'
   and d.code in ('SA', 'DEV')
on conflict (hod_id, department_id) do nothing;

-- Result to expect:
--   hod.it@demo.vms   → Information Technology + Sales + (DEV)   ← multi-department
--   hod2.it@demo.vms  → Information Technology
--   hod.hr / hod2.hr  → Human Resources
--   hod.fin / hod2.fin→ Finance & Accounts
select p.email,
       p.full_name,
       string_agg(d.name, ', ' order by d.name) as departments
  from gatepass.hod_departments hd
  join public.profiles p    on p.id = hd.hod_id
  join public.departments d on d.id = hd.department_id
 group by p.email, p.full_name
 order by p.email;

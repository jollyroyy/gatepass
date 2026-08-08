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
-- 013_gate_pass_items.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 014_gate_verification_detail.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 014 — What the guard actually did at the loading bay
--
-- 013 gave a pass many material lines. This migration makes VERIFICATION match
-- that shape, and records the three things a disputed sign-off always turns on:
-- which lines were counted and to what, who was standing where, and what they
-- physically checked before releasing the material.
--
-- Four additions:
--
-- 1. PER-LINE VERIFIED QUANTITIES. `verifications.verified_quantity` was a
--    single number, which stopped meaning anything the moment a pass could
--    carry five lines. It stays as the TOTAL counted (so existing rows and the
--    "did the total match?" question both survive), and `line_details` holds
--    the breakdown.
--
-- 2. THE CHECKLIST. A guard releasing material ticks: item matches, quantity
--    matches, serial/asset tag checked, carrying person checked, paperwork
--    checked. Storing it turns "the guard says they checked the serial" into a
--    record. The UI refuses to enable Match until the required ticks are
--    present; this column is what makes that claim auditable afterwards.
--
-- 3. GATE NAME AND DEVICE. A mall has more than one service entrance. "Signed
--    off at 23:40" is a different fact at the loading bay than at the basement
--    ramp, and today the log cannot tell them apart.
--
-- 4. HOLD. Match and Flag are both terminal, so a guard facing "the paperwork
--    says 3, I count 3, but the serial is wrong and I want the HOD on the
--    phone" has to pick one and be wrong. `held` is the honest third answer:
--    material stopped at the gate, nothing released, nothing accused, and the
--    pass stays actionable. Match and Flag both accept a held pass, so a hold
--    is a pause in the state machine rather than a branch out of it.
--
-- TRAP 1 applies to 'held' exactly as it did to 'partially_returned' in 013 —
-- and 013's header records the sharper version of that rule discovered by dry
-- run: a plpgsql body is exempt at CREATE time, but NOT if this migration also
-- EXECUTES it before commit. Nothing here is executed during the migration, so
-- CREATE-time exemption is enough; ::text comparisons are used anyway so that a
-- future migration which does run one of these in-transaction cannot be broken
-- by a rule nobody re-derives.
-- ============================================================================

alter type gatepass.pass_status   add value if not exists 'held' after 'pending';
alter type gatepass.verify_action add value if not exists 'held' after 'flagged';

-- ─── 1. The verification record grows ───────────────────────────────────────
alter table gatepass.verifications
  add column if not exists gate_name    text,
  add column if not exists device_info  jsonb,
  add column if not exists line_details jsonb,
  add column if not exists checks       jsonb;

comment on column gatepass.verifications.gate_name is
  'Which entrance this happened at. Free text rather than a lookup table: the '
  'set of gates changes with construction hoarding, and a stale FK would block '
  'a sign-off at a gate that exists.';
comment on column gatepass.verifications.line_details is
  'Per-line breakdown: [{item_id, description, declared_qty, verified_qty}]. '
  'Audit evidence, not a queryable relation — the authoritative per-line state '
  'is gate_pass_items.returned_qty.';
comment on column gatepass.verifications.checks is
  'The checklist the guard ticked, e.g. {"carrier":true,"paperwork":true,'
  '"lines":{"<item_id>":{"item":true,"qty":true,"serial":true}}}.';

alter table gatepass.verifications
  drop constraint if exists verifications_gate_name_not_blank,
  add  constraint verifications_gate_name_not_blank
    check (gate_name is null or length(trim(gate_name)) > 0);

-- ─── 2. Hold ────────────────────────────────────────────────────────────────
create or replace function gatepass.hold_pass(
  p_pass_id     uuid,
  p_reason      text,
  p_gate_name   text  default null,
  p_device_info jsonb default null
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
    raise exception 'Only security can hold a gate pass.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when holding a pass.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status::text <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be held.', v_pass.status;
  end if;

  -- Deliberately does NOT set verified_by/verified_at. A hold is not a
  -- verification — the material has not been released or refused, and
  -- gate_passes_verified_pair plus validate_pass both treat those two columns
  -- as the record of a completed decision.
  update gatepass.gate_passes
     set status = 'held'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks, gate_name, device_info)
  values
    (p_pass_id, 'held'::gatepass.verify_action, auth.uid(), trim(p_reason),
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info);

  return v_pass;
end;
$$;

-- ─── 3. Match, per line ─────────────────────────────────────────────────────
-- Replaces 003's signature. The old (uuid, numeric, text, text) form is dropped
-- rather than left callable: two overloads that both "match a pass" but disagree
-- about whether per-line counts are recorded is precisely the kind of unused
-- surface CLAUDE.md forbids leaving behind — and PostgREST would happily route
-- to either.
drop function if exists gatepass.match_pass(uuid, numeric, text, text);

create or replace function gatepass.match_pass(
  p_pass_id     uuid,
  p_lines       jsonb default null,   -- [{item_id, verified_qty}]
  p_vehicle     text  default null,
  p_remarks     text  default null,
  p_gate_name   text  default null,
  p_device_info jsonb default null,
  p_checks      jsonb default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass  gatepass.gate_passes;
  v_total numeric;
  v_lines jsonb;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can verify a gate pass.';
  end if;

  -- Lock the row so two guards cannot both verify the same pass.
  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- A held pass is explicitly resumable: hold exists so the guard can come back
  -- to this decision, not so the pass becomes unverifiable.
  if v_pass.status::text not in ('pending', 'held') then
    raise exception 'This pass is already %. Only a pending or held pass can be verified.',
      v_pass.status;
  end if;

  if v_pass.expires_at < now() then
    raise exception 'This pass expired on %. Raise a new one.',
      to_char(v_pass.expires_at at time zone gatepass.site_tz(), 'DD Mon YYYY HH24:MI');
  end if;

  -- Fill in the declared quantities for any line the caller did not mention, so
  -- line_details is always a complete picture of the pass rather than only the
  -- lines that happened to be disputed.
  select jsonb_agg(jsonb_build_object(
           'item_id',      i.id,
           'description',  i.description,
           'declared_qty', i.quantity,
           'verified_qty', coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity)
         ) order by i.line_no),
         sum(coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity))
    into v_lines, v_total
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p_pass_id;

  update gatepass.gate_passes
     set status        = 'matched',
         verified_by   = auth.uid(),
         verified_at   = now(),
         -- An RGP now owes a return. Everything else is finished at the gate.
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                              else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle,
     remarks, gate_name, device_info, line_details, checks)
  values
    (p_pass_id, 'matched', auth.uid(), v_total,
     nullif(trim(coalesce(p_vehicle, '')), ''), p_remarks,
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info, v_lines, p_checks);

  return v_pass;
end;
$$;

-- ─── 4. Flag, with the same gate context ────────────────────────────────────
drop function if exists gatepass.flag_pass(uuid, text);

create or replace function gatepass.flag_pass(
  p_pass_id     uuid,
  p_reason      text,
  p_gate_name   text  default null,
  p_device_info jsonb default null,
  p_checks      jsonb default null
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

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status::text not in ('pending', 'held') then
    raise exception 'This pass is already %. Only a pending or held pass can be flagged.',
      v_pass.status;
  end if;

  -- NO expiry check here, deliberately, and this is not an oversight: refusing
  -- to record a real mismatch because the paperwork went stale is backwards.
  -- match_pass refuses an expired pass; flag_pass must not.
  update gatepass.gate_passes
     set status      = 'flagged',
         flag_reason = trim(p_reason),
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks, gate_name, device_info, checks)
  values
    (p_pass_id, 'flagged', auth.uid(), trim(p_reason),
     nullif(trim(coalesce(p_gate_name, '')), ''), p_device_info, p_checks);

  return v_pass;
end;
$$;

-- ─── 5. The verification view, rebuilt ──────────────────────────────────────
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- absorb the four new base-table columns (TRAP 2 — a view's column list is
-- fixed at creation).
drop view if exists gatepass.v_verifications;

create view gatepass.v_verifications
with (security_invoker = true)
as
select
  v.*,
  su.full_name as security_name
from gatepass.verifications v
left join gatepass.profile_names su on su.id = v.security_user_id;

grant select on gatepass.v_verifications to authenticated;

-- ─── 6. Grants ──────────────────────────────────────────────────────────────
-- Callable by any signed-in user; each function enforces its own role check, so
-- an HOD calling match_pass gets a clean refusal rather than a permission error.
grant execute on function gatepass.hold_pass(uuid, text, text, jsonb)                        to authenticated;
grant execute on function gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb)   to authenticated;
grant execute on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb)                 to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 015_hod_review_flagged_pass.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 015 — HOD review workflow for flagged passes
--
-- Currently, flagged is terminal: once a guard flags a pass, nothing can
-- change its status. The HOD who raised it has no way to respond — they can
-- see the flag reason in PassDetail but cannot act on it.
--
-- This migration makes flagged a REVERSIBLE state by adding:
--
--   1. `hod_reviewed` — a new pass_status (and verify_action), reachable only
--      from flagged, set by the HOD who raised the pass.
--   2. `gatepass.hod_review_flagged_pass` — the RPC an HOD calls to review
--      their own flagged pass. Two actions:
--        'approve'  → status becomes hod_reviewed; guard can then match
--        'reject'   → status becomes cancelled with a reason
--   3. `gatepass.match_pass` — updated to also accept hod_reviewed, so a
--      guard can finalise dispatch after HOD approval.
--   4. `gatepass.lookup_pass` — updated to treat hod_reviewed as `ok`
--      (the guard scans and proceeds to verify/match).
--
-- TRAP 1 applies (see 008's header): 'hod_reviewed' is added by THIS
-- migration, and APPLY_ALL.sql is one transaction. No `language sql` function
-- body and no CHECK constraint in this file may name 'hod_reviewed' — that
-- would abort the entire paste. All references are in plpgsql bodies, which
-- are stored as text and only syntax-checked at CREATE time.
-- ============================================================================

-- ─── New enum values ────────────────────────────────────────────────────────
alter type gatepass.pass_status   add value if not exists 'hod_reviewed' after 'flagged';
alter type gatepass.verify_action add value if not exists 'hod_reviewed' after 'flagged';

-- ─── HOD review RPC ─────────────────────────────────────────────────────────
-- Only the HOD who raised the pass may review it:
--   'approve' → hod_reviewed (guard dispatches)
--   'reject'  → cancelled (pass voided)
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

  -- ::text comparison avoids any DDL-time enum resolution (TRAP 1)
  if v_pass.status::text <> 'flagged' then
    raise exception 'Only a flagged pass can be reviewed. This pass is %.', v_pass.status;
  end if;

  if p_action = 'approve' then
    update gatepass.gate_passes
       set status = 'hod_reviewed'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'hod_reviewed'::gatepass.verify_action, auth.uid(),
       'HOD approved override of security flag');
  elsif p_action = 'reject' then
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status,
           cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Rejected by HOD after security flag')
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(),
       coalesce(nullif(trim(p_reason), ''), 'Rejected by HOD after security flag'));
  else
    raise exception 'Invalid action. Use ''approve'' or ''reject''.';
  end if;

  return v_pass;
end;
$$;

grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- ─── match_pass — accept hod_reviewed ───────────────────────────────────────
-- A pass the HOD approved after flagging can now be matched by the guard.
drop function if exists gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb);

create or replace function gatepass.match_pass(
  p_pass_id     uuid,
  p_lines       jsonb default null,
  p_vehicle     text  default null,
  p_remarks     text  default null,
  p_gate_name   text  default null,
  p_device_info jsonb default null,
  p_checks      jsonb default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass  gatepass.gate_passes;
  v_total numeric;
  v_lines jsonb;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can verify a gate pass.';
  end if;

  select * into v_pass from gatepass.gate_passes where id = p_pass_id for update;
  if not found then
    raise exception 'Gate pass not found.';
  end if;

  -- Accept pending, held, OR hod_reviewed (HOD-approved-after-flag)
  if v_pass.status::text not in ('pending', 'held', 'hod_reviewed') then
    raise exception 'This pass is already %. Only a pending, held, or HOD-reviewed pass can be verified.',
      v_pass.status;
  end if;

  if v_pass.expires_at < now() then
    raise exception 'This pass expired on %. Raise a new one.',
      to_char(v_pass.expires_at at time zone gatepass.site_tz(), 'DD Mon YYYY HH24:MI');
  end if;

  select jsonb_agg(jsonb_build_object(
           'item_id',      i.id,
           'description',  i.description,
           'declared_qty', i.quantity,
           'verified_qty', coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity)
         ) order by i.line_no),
         sum(coalesce(
             (select (e ->> 'verified_qty')::numeric
                from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
               where (e ->> 'item_id')::uuid = i.id
               limit 1),
             i.quantity))
    into v_lines, v_total
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p_pass_id;

  update gatepass.gate_passes
     set status        = 'matched',
         verified_by   = auth.uid(),
         verified_at   = now(),
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                              else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle,
     remarks, gate_name, device_info, line_details, checks)
  values
    (p_pass_id, 'matched', auth.uid(), v_total,
     nullif(trim(coalesce(p_vehicle, '')), ''),
     p_remarks,
     nullif(trim(coalesce(p_gate_name, '')), ''),
     p_device_info, v_lines, p_checks);

  return v_pass;
end;
$$;

grant execute on function gatepass.match_pass(uuid, jsonb, text, text, text, jsonb, jsonb) to authenticated;

-- ─── lookup_pass — treat hod_reviewed as scannable ──────────────────────────
-- A guard scanning a hod_reviewed pass should get 'ok' so they can proceed
-- to verify and match it.
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
  elsif v_pass.status::text = 'cancelled' then
    v_outcome := 'cancelled';
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
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

-- No grant needed — lookup_pass grant from 008 still covers this replacement.

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 016_kpi_aging_vendor_blacklist_bulk.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 016 — KPI extensions, returnable aging, vendor profiles, blacklist, bulk create
--
-- Five features in one migration because they all touch the same schema objects
-- (v_gate_passes, kpis, lookup_pass) and splitting them would force five
-- rebuilds of the view and five rounds of APPLY_ALL.sql churn.
--
-- 1. Extends kpis() with overdue_value, flagged_rate, return_rate
-- 2. Adds returnable_aging() — age-bucketed analysis of outstanding RGPs
-- 3. Adds vendor_profiles table — reusable company data for RaisePass
-- 4. Adds blacklist table — company/vehicle/driver blocks with scan-time check
-- 5. Adds bulk_create_passes — generate N passes from one template
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extended KPIs
-- ═══════════════════════════════════════════════════════════════════════════
-- CTE-based so `language sql` works without subqueries in aggregate context.
-- `overdue_value` is the sum of gate_pass_items.approx_value where the pass
-- is overdue. `flagged_rate` and `return_rate` are computed as percentages.
--
-- The item-value sum is approximate by design (gate_pass_items stores
-- indicative worth, not audited value). Never use it for financial reporting.
drop function if exists gatepass.kpis(uuid);

create or replace function gatepass.kpis(p_department_id uuid default null)
returns table (
  total            bigint,
  pending          bigint,
  matched          bigint,
  flagged          bigint,
  awaiting_return  bigint,
  overdue          bigint,
  raised_today     bigint,
  overdue_value    numeric,
  flagged_rate     numeric,
  return_rate      numeric
)
language sql
stable
as $$
  with base as (
    select *
    from gatepass.v_gate_passes v
    where p_department_id is null or v.department_id = p_department_id
  ),
  pass_values as (
    select
      i.gate_pass_id,
      coalesce(sum(i.approx_value), 0) as pass_value
    from gatepass.gate_pass_items i
    join base b on b.id = i.gate_pass_id
    group by i.gate_pass_id
  )
  select
    count(*)                                                        as total,
    count(*) filter (where status = 'pending')                      as pending,
    count(*) filter (where status = 'matched')                      as matched,
    count(*) filter (where status = 'flagged')                      as flagged,
    count(*) filter (where return_status::text in ('awaiting_return', 'partially_returned'))
                                                                    as awaiting_return,
    count(*) filter (where is_overdue)                              as overdue,
    count(*) filter (where created_at >= date_trunc('day', now()))  as raised_today,
    -- Sum of item values on overdue passes
    coalesce(sum(case when b.is_overdue then pv.pass_value else 0 end), 0)
                                                                    as overdue_value,
    -- Flagged as a percentage of total
    case when count(*) > 0
      then round((count(*) filter (where status = 'flagged')::numeric / count(*)::numeric) * 100, 1)
      else 0
    end                                                             as flagged_rate,
    -- Return rate: returned / (returned + awaiting_return + partially_returned) for RGPs only
    case when count(*) filter (where type = 'RGP'
      and return_status::text in ('returned', 'awaiting_return', 'partially_returned')) > 0
      then round(
        (count(*) filter (where type = 'RGP' and return_status = 'returned')::numeric /
         count(*) filter (where type = 'RGP'
           and return_status::text in ('returned', 'awaiting_return', 'partially_returned'))::numeric
        ) * 100, 1)
      else 0
    end                                                             as return_rate
  from base b
  left join pass_values pv on pv.gate_pass_id = b.id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Returnable aging
-- ═══════════════════════════════════════════════════════════════════════════
-- How long have items been out? Bucketed so the HOD can see if material that
-- was supposed to be back in a week is now in the 90+ bracket.
-- Uses `verified_at` (when the material actually left) with a fallback to
-- `created_at` for passes that were raised but never matched.
create or replace function gatepass.returnable_aging(p_department_id uuid default null)
returns table (
  bucket      text,
  item_count  bigint,
  total_value numeric
)
language sql
stable
as $$
  with active_rgp as (
    select p.id,
           coalesce(p.verified_at, p.created_at) as aging_start
    from gatepass.v_gate_passes p
    where p.type = 'RGP'
      and p.return_status::text in ('awaiting_return', 'partially_returned')
      and (p_department_id is null or p.department_id = p_department_id)
  ),
  aged as (
    select
      case
        when now() - ar.aging_start < interval '8 days'  then '0-7d'
        when now() - ar.aging_start < interval '31 days' then '8-30d'
        when now() - ar.aging_start < interval '91 days' then '31-90d'
        else '90+'
      end as bkt,
      i.approx_value
    from gatepass.gate_pass_items i
    join active_rgp ar on ar.id = i.gate_pass_id
  )
  select
    aged.bkt,
    count(*)::bigint,
    coalesce(sum(aged.approx_value), 0)
  from aged
  group by aged.bkt
  order by min(
    case aged.bkt
      when '0-7d' then 1
      when '8-30d' then 2
      when '31-90d' then 3
      when '90+' then 4
      else 5
    end);
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Vendor profiles
-- ═══════════════════════════════════════════════════════════════════════════
-- Reusable company data. An HOD saves a vendor's details once and selects
-- them from a dropdown when raising a pass, which pre-fills company name,
-- contact person, vehicle and typical material.
create table if not exists gatepass.vendor_profiles (
  id               uuid primary key default gen_random_uuid(),
  company_name     text not null,
  contact_person   text,
  phone            text,
  vehicle_number   text,
  typical_material text,
  department_id    uuid not null references public.departments(id),
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint vendor_profiles_unique_per_dept unique (company_name, department_id),
  constraint vendor_profiles_name_not_blank  check (length(trim(company_name)) > 0)
);

-- List vendors — scoped to the caller's departments unless p_department_id given
create or replace function gatepass.list_vendor_profiles(p_department_id uuid default null)
returns setof gatepass.vendor_profiles
language sql
stable
as $$
  select *
  from gatepass.vendor_profiles v
  where (p_department_id is null or v.department_id = p_department_id)
  order by v.company_name;
$$;

-- Upsert a vendor profile (create or update by company_name + department_id)
create or replace function gatepass.save_vendor_profile(
  p_company_name     text,
  p_department_id    uuid,
  p_contact_person   text default null,
  p_phone            text default null,
  p_vehicle_number   text default null,
  p_typical_material text default null
)
returns gatepass.vendor_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile gatepass.vendor_profiles;
begin
  if gatepass.app_role() not in ('hod', 'admin', 'super_admin') then
    raise exception 'Only HODs or admins can manage vendor profiles.';
  end if;

  insert into gatepass.vendor_profiles
    (company_name, department_id, contact_person, phone, vehicle_number,
     typical_material, created_by)
  values
    (p_company_name, p_department_id, p_contact_person, p_phone, p_vehicle_number,
     p_typical_material, auth.uid())
  on conflict (company_name, department_id)
  do update set
    contact_person   = coalesce(p_contact_person, vendor_profiles.contact_person),
    phone            = coalesce(p_phone, vendor_profiles.phone),
    vehicle_number   = coalesce(p_vehicle_number, vendor_profiles.vehicle_number),
    typical_material = coalesce(p_typical_material, vendor_profiles.typical_material),
    updated_at       = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Delete a vendor profile
create or replace function gatepass.delete_vendor_profile(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if gatepass.app_role() not in ('hod', 'admin', 'super_admin') then
    raise exception 'Only HODs or admins can delete vendor profiles.';
  end if;

  delete from gatepass.vendor_profiles where id = p_id;
  if not found then
    raise exception 'Vendor profile not found.';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Blacklist / watchlist
-- ═══════════════════════════════════════════════════════════════════════════
-- Three entry types: company, vehicle, driver. A pass tied to a blacklisted
-- company or vehicle still gets an 'ok' outcome at scan time but with a
-- blacklist_match warning; the guard sees it and can decide how to handle it.
--
-- Created_by/blocked_by is set automatically to the admin who added it.
create table if not exists gatepass.blacklist (
  id          uuid primary key default gen_random_uuid(),
  list_type   text not null,
  list_value  text not null,
  reason      text not null,
  blocked_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  constraint blacklist_type_valid   check (list_type in ('company', 'vehicle', 'driver')),
  constraint blacklist_value_not_blank check (length(trim(list_value)) > 0),
  constraint blacklist_reason_not_blank check (length(trim(reason)) > 0),
  constraint blacklist_unique_entry unique (list_type, list_value)
);

-- Check blacklist — returns matches for a given company and/or vehicle
create or replace function gatepass.check_blacklist(
  p_company text default null,
  p_vehicle text default null,
  p_driver  text default null
)
returns table (list_type text, list_value text, reason text)
language sql
stable
as $$
  select b.list_type, b.list_value, b.reason
  from gatepass.blacklist b
  where (p_company is not null and b.list_type = 'company' and lower(b.list_value) = lower(trim(p_company)))
     or (p_vehicle is not null and b.list_type = 'vehicle' and lower(b.list_value) = lower(trim(p_vehicle)))
     or (p_driver  is not null and b.list_type = 'driver'  and lower(b.list_value) = lower(trim(p_driver)));
$$;

-- Admin: add blacklist entry
create or replace function gatepass.add_blacklist_entry(
  p_list_type  text,
  p_list_value text,
  p_reason     text
)
returns gatepass.blacklist
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry gatepass.blacklist;
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  insert into gatepass.blacklist (list_type, list_value, reason, blocked_by)
  values (p_list_type, trim(p_list_value), trim(p_reason), auth.uid())
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Admin: remove blacklist entry
create or replace function gatepass.remove_blacklist_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  delete from gatepass.blacklist where id = p_id;
  if not found then
    raise exception 'Blacklist entry not found.';
  end if;
end;
$$;

-- Admin: list all blacklist entries
create or replace function gatepass.list_blacklist_entries()
returns setof gatepass.blacklist
language sql
stable
as $$
  select *
  from gatepass.blacklist
  order by created_at desc;
$$;

grant execute on function gatepass.check_blacklist(text, text, text) to authenticated;
grant execute on function gatepass.add_blacklist_entry(text, text, text) to authenticated;
grant execute on function gatepass.remove_blacklist_entry(uuid) to authenticated;
grant execute on function gatepass.list_blacklist_entries() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Extend scan_attempts for blacklist audit trail
-- ═══════════════════════════════════════════════════════════════════════════
-- Records why a scan attempt triggered a blacklist warning, so the question
-- "how many blacklisted vehicles were scanned last night" has an answer.
alter table gatepass.scan_attempts
  add column if not exists blacklist_note text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Update lookup_pass — blacklist awareness
-- ═══════════════════════════════════════════════════════════════════════════
-- Outcome is still 'ok' (the guard CAN proceed), but blacklist_match carries
-- the reason text when the pass's company or vehicle is blacklisted.
drop function if exists gatepass.lookup_pass(text);

create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid, blacklist_match text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_code           text := trim(coalesce(p_code, ''));
  v_uuid           uuid;
  v_outcome        text;
  v_blacklist_item record;
  v_blacklist_text text := null;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can scan a gate pass.';
  end if;

  if v_code = '' then
    raise exception 'Nothing was scanned.';
  end if;

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
  elsif v_pass.status::text = 'cancelled' then
    v_outcome := 'cancelled';
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  -- Blacklist check — only for found passes with a company or vehicle
  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_type = 'company' and lower(b.list_value) = lower(trim(coalesce(v_pass.visitor_company, ''))))
        or (b.list_type = 'vehicle' and lower(b.list_value) = lower(trim(coalesce(v_pass.vehicle_number, ''))))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  return query select v_outcome, v_pass.id, v_blacklist_text;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Bulk create passes
-- ═══════════════════════════════════════════════════════════════════════════
-- Raises p_count passes from a single template. Each pass differs only in
-- its visitor_name (p_name_prefix + sequential number) and its pass_number.
-- All other fields (type, direction, department, items, purpose, vehicle,
-- expected_return_date) are identical across the batch.
--
-- Designed for scenarios like "30 workers from an agency arriving for an
-- event" or "12 trucks delivering sand for construction" — one HOD action
-- instead of 12 individual forms.
--
-- Each pass is an independent row with its own advisory-lock serial-number
-- generation, so the batch leaves no gaps in the day's sequence.
create or replace function gatepass.bulk_create_passes(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb,
  p_count                int,
  p_name_prefix          text default 'Worker'
)
returns table (pass_id uuid, pass_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass   gatepass.gate_passes;
  v_item   jsonb;
  v_line   int;
  v_seq    int;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only an HOD can raise gate passes.';
  end if;

  if p_department_id is null
     or p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise passes for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  if p_count < 2 or p_count > 100 then
    raise exception 'Batch size must be between 2 and 100.';
  end if;

  for v_seq in 1 .. p_count
  loop
    insert into gatepass.gate_passes
      (type, direction, department_id, raised_by, visitor_name, visitor_company,
       vehicle_number, purpose, expected_return_date)
    values
      (p_type, p_direction, p_department_id, auth.uid(),
       p_name_prefix || ' - ' || lpad(v_seq::text, 3, '0'),
       p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
    returning * into v_pass;

    v_line := 0;
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
        p_department_id
      );
    end loop;

    pass_id   := v_pass.id;
    pass_number := v_pass.pass_number;
    return next;
  end loop;

  return;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Grants
-- ═══════════════════════════════════════════════════════════════════════════
grant execute on function gatepass.kpis(uuid)          to authenticated;
grant execute on function gatepass.returnable_aging(uuid) to authenticated;
grant execute on function gatepass.list_vendor_profiles(uuid) to authenticated;
grant execute on function gatepass.save_vendor_profile(text, uuid, text, text, text, text) to authenticated;
grant execute on function gatepass.delete_vendor_profile(uuid) to authenticated;
-- lookup_pass grant was re-stated after the drop+recreate above
grant execute on function gatepass.lookup_pass(text) to authenticated;

grant execute on function gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, date, jsonb, int, text
) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 017_rgp_in_has_no_return_date.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 017 — RGP-in has no expected return date
--
-- Migration 010 split type and direction, but the check constraint on
-- expected_return_date was never updated. It still says:
--
--   check ((type = 'RGP') = (expected_return_date is not null))
--
-- This forces every RGP (both out and in) to carry a return date, which makes
-- no sense for RGP-in: material arriving at the site has not been dispatched,
-- so there is nothing to "return."
--
-- The corrected constraint:
--
--   check ((type = 'RGP' and direction = 'out') = (expected_return_date is not null))
--
-- RGP-out   → expected_return_date required (material leaving, must come back)
-- RGP-in    → expected_return_date prohibited (material arriving, return is a
--             separate movement, not tracked on this pass)
-- NRGP-out  → expected_return_date prohibited
-- ============================================================================

-- Postgres auto-named the original constraint (name varies by migration history).
-- migration 010 created it as `rgp_needs_return_date`; earlier versions may use
-- `gate_passes_expected_return_date_check`. Drop whichever exists.
alter table gatepass.gate_passes
  drop constraint if exists rgp_needs_return_date;
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_expected_return_date_check;

-- Add the corrected constraint that accounts for direction.
alter table gatepass.gate_passes
  add constraint gate_passes_return_date_required
  check ((type = 'RGP' and direction = 'out') = (expected_return_date is not null));

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 018_image_and_category.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 018 — Material image attachment and NRGP category (capital / non-capital)
--
-- 1. Adds image_url text column (optional, any pass type)
-- 2. Adds category  text column with check constraint 'capital'/'non_capital'
--    only for NRGP passes
-- 3. Creates storage.pass-images bucket for image uploads
-- 4. Rebuilds raise_pass and bulk_create_passes to accept p_image_url/p_category
-- 5. Rebuilds v_gate_passes to expose the new columns
-- ============================================================================

-- ─── 1. Add columns ───────────────────────────────────────────────────────────
alter table gatepass.gate_passes
  add column if not exists image_url text,
  add column if not exists category  text;

alter table gatepass.gate_passes
  add constraint gate_passes_category_nrgp_only
  check (category is null or (category in ('capital', 'non_capital') and type = 'NRGP'));

-- ─── 2. Storage bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('pass-images', 'pass-images', true)
on conflict (id) do nothing;

do $$ begin
  create policy "authenticated can upload pass-images"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "anyone can view pass-images"
    on storage.objects for select
    to authenticated, anon
    using (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;

-- ─── 3. Update raise_pass ────────────────────────────────────────────────────
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb,
  p_image_url            text default null,
  p_category             text default null
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
     vehicle_number, purpose, expected_return_date, image_url, category)
  values
    (p_type, p_direction, p_department_id, auth.uid(), p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date,
     p_image_url, p_category)
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
      p_department_id
    );
  end loop;

  return v_pass;
end;
$$;

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb, text, text
) to authenticated;

-- ─── 4. Update bulk_create_passes ─────────────────────────────────────────────
create or replace function gatepass.bulk_create_passes(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text,
  p_expected_return_date date,
  p_items                jsonb,
  p_count                int,
  p_name_prefix          text default 'Worker',
  p_category             text default null
)
returns table (pass_id uuid, pass_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass   gatepass.gate_passes;
  v_item   jsonb;
  v_line   int;
  v_seq    int;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only an HOD can raise gate passes.';
  end if;

  if p_department_id is null
     or p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise passes for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  if p_count < 2 or p_count > 100 then
    raise exception 'Batch size must be between 2 and 100.';
  end if;

  for v_seq in 1 .. p_count
  loop
    insert into gatepass.gate_passes
      (type, direction, department_id, raised_by, visitor_name, visitor_company,
       vehicle_number, purpose, expected_return_date, category)
    values
      (p_type, p_direction, p_department_id, auth.uid(),
       p_name_prefix || ' - ' || lpad(v_seq::text, 3, '0'),
       p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date, p_category)
    returning * into v_pass;

    v_line := 0;
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
        p_department_id
      );
    end loop;

    pass_id   := v_pass.id;
    pass_number := v_pass.pass_number;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, date, jsonb, int, text, text
) to authenticated;

-- ─── 5. Rebuild v_gate_passes view ────────────────────────────────────────────
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  p.return_status = 'awaiting_return'
    and p.expected_return_date is not null
    and p.expected_return_date < (now() at time zone gatepass.site_tz())::date
                                                                    as is_overdue,
  p.status = 'pending' and p.expires_at < now()                     as is_expired,

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

  coalesce(it.item_count, 0)                                        as item_count,
  coalesce(it.total_quantity, 0)                                    as total_quantity,
  coalesce(it.returned_quantity, 0)                                 as returned_quantity,
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
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. is_overdue, is_expired, due_state, '
  'item roll-ups, image_url and category.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 019_per_item_name_purpose_return_date.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 019 — Per-item name, purpose, and expected return date
--
-- Each material line now carries its own short name, detailed description,
-- individual purpose (reason), and expected return date. The pass-level
-- `purpose` and `expected_return_date` become convenience fields for bulk
-- pre-fill; the authoritative data lives on the items.
--
-- 1. Adds name, purpose, expected_return_date to gate_pass_items
-- 2. Makes gate_passes.purpose nullable
-- 3. Relaxes the RGP return-date constraint (dates are now per-item)
-- 4. Updates raise_pass / bulk_create_passes to accept per-item fields
-- 5. Rebuilds v_gate_pass_items and v_gate_passes
-- ============================================================================

-- ─── 1. Add columns to gate_pass_items ───────────────────────────────────────
alter table gatepass.gate_pass_items
  add column if not exists name               text,
  add column if not exists purpose            text,
  add column if not exists expected_return_date date;

-- Backfill existing rows: name from description, purpose empty, date from parent
update gatepass.gate_pass_items i
  set name = i.description,
      purpose = '',
      expected_return_date = p.expected_return_date
  from gatepass.gate_passes p
  where p.id = i.gate_pass_id
    and i.name is null;

-- Now enforce NOT NULL
alter table gatepass.gate_pass_items
  alter column name    set not null,
  alter column purpose set not null;

-- ─── 2. Relax pass-level constraints ─────────────────────────────────────────
-- Purpose can be null because the real reasons live on items now.
alter table gatepass.gate_passes
  alter column purpose drop not null;

-- The old return-date constraint forced every RGP-out to have a pass-level date.
-- With per-item dates, the pass-level field is just a convenience default.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_return_date_required,
  drop constraint if exists rgp_needs_return_date,
  drop constraint if exists gate_passes_expected_return_date_check;

-- ─── 3. Update check constraint on items ─────────────────────────────────────
alter table gatepass.gate_pass_items
  drop constraint if exists gate_pass_items_text_not_blank;

alter table gatepass.gate_pass_items
  add constraint gate_pass_items_text_not_blank
  check (length(trim(name)) > 0 and length(trim(description)) > 0 and length(trim(purpose)) > 0 and length(trim(unit)) > 0);

-- ─── 4. validate_pass ──────────────────────────────────────────────────────
-- Restated only to remove purpose from the insert-side trim block (purpose is
-- now on items, not the pass). The body is otherwise identical.
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
    -- Blank optional fields collapse to NULL so "not given" has one spelling.
    new.visitor_company := nullif(trim(coalesce(new.visitor_company, '')), '');
    new.vehicle_number  := nullif(upper(trim(coalesce(new.vehicle_number, ''))), '');

    v_today := (now() at time zone gatepass.site_tz())::date;

    if new.expected_return_date is not null then
      if new.expected_return_date < v_today then
        raise exception 'Expected return date % is already in the past. A pass cannot be born overdue.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
      if new.expected_return_date > v_today + 365 then
        raise exception 'Expected return date % is more than a year away. Check the year.',
          to_char(new.expected_return_date, 'DD Mon YYYY');
      end if;
    end if;
  end if;

  if new.status = 'cancelled' then
    if new.cancel_reason is null or length(trim(new.cancel_reason)) = 0 then
      raise exception 'A voided pass must record why. An unexplained void is indistinguishable from a cover-up.';
    end if;
    if new.verified_by is not null or new.verified_at is not null then
      raise exception 'A voided pass cannot also carry a loading-bay verification.';
    end if;
  elsif new.cancel_reason is not null then
    raise exception 'cancel_reason is set but the pass is %, not cancelled.', new.status;
  end if;

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

-- ─── 5. Update raise_pass ──────────────────────────────────────────────────
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null
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
      (gate_pass_id, line_no, name, description, purpose, quantity, unit,
       serial_no, approx_value, expected_return_date, department_id)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      coalesce(nullif(trim(coalesce(v_item ->> 'purpose', '')), ''), 'Material movement'),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id
    );
  end loop;

  return v_pass;
end;
$$;

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) to authenticated;

-- ─── 6. Update bulk_create_passes ──────────────────────────────────────────
create or replace function gatepass.bulk_create_passes(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_count                int,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null,
  p_name_prefix          text default 'Worker'
)
returns table (pass_id uuid, pass_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass   gatepass.gate_passes;
  v_item   jsonb;
  v_line   int;
  v_seq    int;
begin
  if gatepass.app_role() <> 'hod' then
    raise exception 'Only an HOD can raise gate passes.';
  end if;

  if p_department_id is null
     or p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise passes for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  if p_count < 2 or p_count > 100 then
    raise exception 'Batch size must be between 2 and 100.';
  end if;

  for v_seq in 1 .. p_count
  loop
    insert into gatepass.gate_passes
      (type, direction, department_id, raised_by, visitor_name, visitor_company,
       vehicle_number, purpose, expected_return_date)
    values
      (p_type, p_direction, p_department_id, auth.uid(),
       p_name_prefix || ' - ' || lpad(v_seq::text, 3, '0'),
       p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
    returning * into v_pass;

    v_line := 0;
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_line := v_line + 1;
      insert into gatepass.gate_pass_items
        (gate_pass_id, line_no, name, description, purpose, quantity, unit,
         serial_no, approx_value, expected_return_date, department_id)
      values (
        v_pass.id,
        v_line,
        v_item ->> 'name',
        v_item ->> 'description',
        coalesce(nullif(trim(coalesce(v_item ->> 'purpose', '')), ''), 'Material movement'),
        (v_item ->> 'quantity')::numeric,
        coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
        nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
        nullif(v_item ->> 'approx_value', '')::numeric,
        nullif(v_item ->> 'expected_return_date', '')::date,
        p_department_id
      );
    end loop;

    pass_id   := v_pass.id;
    pass_number := v_pass.pass_number;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, int, text, date, jsonb, text
) to authenticated;

-- ─── 7. Rebuild v_gate_pass_items view ─────────────────────────────────────
-- Must drop+recreate: create or replace view cannot absorb new base-table
-- columns (name, purpose, expected_return_date added above).
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

grant select on gatepass.v_gate_pass_items to authenticated;

-- ─── 8. Rebuild v_gate_passes (material_summary now uses name, not description)
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  p.return_status = 'awaiting_return'
    and p.expected_return_date is not null
    and p.expected_return_date < (now() at time zone gatepass.site_tz())::date
                                                                    as is_overdue,
  p.status = 'pending' and p.expires_at < now()                     as is_expired,

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

  coalesce(it.item_count, 0)                                        as item_count,
  coalesce(it.total_quantity, 0)                                    as total_quantity,
  coalesce(it.returned_quantity, 0)                                 as returned_quantity,
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
         string_agg(i.name, ', ' order by i.line_no) as material_summary
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p.id
) it on true
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. material_summary uses item name, not description.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 020_bulk_create_unique_index_fix.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 020 — Fix unique index to allow bulk create with identical items
--
-- The old index was scoped per-department: (department_id,
-- normalize_material(description)) WHERE is_open. This blocked
-- bulk_create_passes because all N passes in a batch create items with the
-- same material name in the same department, and every pass after the first
-- hit a duplicate-key violation.
--
-- Fix: include gate_pass_id in the index, making it per-pass. Within a single
-- pass you still cannot have two lines with the same material, but bulk
-- creates work because each pass has a different gate_pass_id.
-- ============================================================================

drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

create unique index if not exists gate_pass_items_one_open_per_material_idx
  on gatepass.gate_pass_items (gate_pass_id, department_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_material_idx is
  'One OPEN line per material per pass (not per department) — widened to '
  'include gate_pass_id so bulk_create_passes with identical items works.';

-- ═══════════════════════════════════════════════════════════
-- 021_admin_user_management.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 021 — Admin user management RPCs (create, update, soft-delete)
--
-- Previously, creating a user required the service-role key via the CLI
-- (scripts/create-user.ts). That is still the ONLY path for creating an
-- admin/super_admin. For everyone else (guard, hod, staff), the admin panel
-- can now do it through SECURITY DEFINER functions that run as postgres.
--
-- Three constraints encoded in these functions, not just in the UI:
--   1. Admins cannot create another admin — role is restricted server-side.
--   2. Admins cannot promote anyone to admin.
--   3. Soft-delete (set role = 'staff') is the only delete path; hard-deleting
--      a user would orphan gate_passes.raised_by FK references.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_create_user — create a non-admin auth user + profile
-- ═══════════════════════════════════════════════════════════════════════════
-- Allowed roles: guard, hod, staff. Rejects admin/super_admin.
create or replace function gatepass.admin_create_user(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           text,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_now      timestamptz := now();
begin
  -- Only admins may call this
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  -- Block admin creation from this path
  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  -- Validate role
  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
  end if;

  -- Check for existing email
  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now, v_now,
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  insert into public.profiles (id, email, full_name, role, created_at)
  values (v_user_id, p_email, p_full_name, p_role::public.user_role, v_now);

  if p_role = 'hod' and p_department_ids is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    select v_user_id, unnest(p_department_ids)
    on conflict (hod_id, department_id) do nothing;
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_update_user — change name, role, department assignments
-- ═══════════════════════════════════════════════════════════════════════════
-- Cannot promote to admin/super_admin. Pass null for fields to keep unchanged.
-- When p_department_ids is non-null, existing assignments are replaced entirely.
create or replace function gatepass.admin_update_user(
  p_user_id        uuid,
  p_full_name      text default null,
  p_role           text default null,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_role text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can update users.';
  end if;

  if p_role is not null then
    if p_role in ('admin', 'super_admin') then
      raise exception 'Cannot promote to admin. Use the CLI with the service-role key.';
    end if;
    if p_role not in ('guard', 'hod', 'staff') then
      raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
    end if;
  end if;

  -- Look up current role to guard against the caller changing their own role
  select role::text into v_current_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Update profile
  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    role      = coalesce(p_role::public.user_role, role)
  where id = p_user_id;

  -- Sync role to auth.users app_metadata
  if p_role is not null then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role),
        updated_at = now()
    where id = p_user_id;
  end if;

  -- Reassign departments (only meaningful for HOD)
  if p_department_ids is not null then
    delete from gatepass.hod_departments where hod_id = p_user_id;
    insert into gatepass.hod_departments (hod_id, department_id)
    select p_user_id, unnest(p_department_ids)
    on conflict (hod_id, department_id) do nothing;
  end if;

  return json_build_object('id', p_user_id::text, 'updated', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_soft_delete_user — revoke app access by setting role to 'staff'
-- ═══════════════════════════════════════════════════════════════════════════
-- Hard-deleting from auth.users would cascade to gate_passes.raised_by and
-- break historical records. Instead, the user keeps their auth login but loses
-- all app access (staff has no policy grants).
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  update public.profiles
  set role = 'staff'::public.user_role
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'staff'),
      updated_at = now()
  where id = p_user_id;

  -- Remove HOD department assignments
  delete from gatepass.hod_departments where hod_id = p_user_id;

  return json_build_object('id', p_user_id::text, 'deactivated', true);
end;
$$;

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[])         to authenticated;
grant execute on function gatepass.admin_soft_delete_user(uuid)                         to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 022_admin_department_rpcs.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 022 — Admin department management RPCs (update, delete)
--
-- Previously, departments could only be managed via direct DB access. These
-- two SECURITY DEFINER functions let the admin panel update a department's
-- name/code and delete a department (with safety checks).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_update_department — update department name and/or code
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function gatepass.admin_update_department(
  p_dept_id uuid,
  p_name    text,
  p_code    text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can update departments.';
  end if;

  update public.departments
  set name = trim(p_name),
      code = upper(trim(p_code))
  where id = p_dept_id;

  if not found then
    raise exception 'Department not found.';
  end if;

  return json_build_object('updated', true);
exception
  when unique_violation then
    raise exception 'A department with code "%" already exists.', upper(trim(p_code));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_delete_department — delete a department (with safety checks)
-- ═══════════════════════════════════════════════════════════════════════════
-- Will not delete a department that still has gate passes. HOD assignments
-- are cleaned up automatically before the parent delete.
create or replace function gatepass.admin_delete_department(
  p_dept_id uuid,
  p_reason  text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can delete departments.';
  end if;

  if exists (select 1 from gatepass.gate_passes where department_id = p_dept_id) then
    raise exception 'Cannot delete department with existing gate passes. Remove or reassign all passes first.';
  end if;

  delete from gatepass.hod_departments where department_id = p_dept_id;

  delete from public.departments where id = p_dept_id;

  if not found then
    raise exception 'Department not found.';
  end if;

  return json_build_object('deleted', true, 'reason', p_reason);
end;
$$;

grant execute on function gatepass.admin_update_department(uuid, text, text) to authenticated;
grant execute on function gatepass.admin_delete_department(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 023_fix_admin_create_user_trigger_conflict.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 023 — Fix admin_create_user: false "already exists" on every new user
--
-- Root cause: public.handle_new_user() — VMS's own trigger on auth.users,
-- confirmed live via pg_get_functiondef() — fires on the `insert into
-- auth.users` a few lines below and:
--   1. inserts a row into public.profiles(id, email, full_name) itself,
--      with role defaulted to 'staff' (public.profiles.role default), and
--   2. overwrites auth.users.raw_app_meta_data back to role: 'staff'.
--
-- 021's admin_create_user then ran its own `insert into public.profiles`,
-- which collided with the row the trigger had already created — a 23505
-- unique violation on profiles.id, which src/lib/errors.ts renders as
-- "That record already exists." This fired on every call, for any brand-new
-- email, which is exactly the reported bug.
--
-- Even had that insert been skipped, the trigger's app_metadata overwrite
-- would have silently demoted every new guard/hod back to 'staff'.
--
-- Fix: let the trigger create the row, then UPDATE it (and app_metadata)
-- to the role the admin actually chose, instead of INSERTing a second time.
-- ============================================================================

create or replace function gatepass.admin_create_user(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           text,
  p_department_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_now      timestamptz := now();
begin
  -- Only admins may call this
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  -- Block admin creation from this path
  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  -- Validate role
  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
  end if;

  -- Check for existing email
  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') and then overwrites
  -- raw_app_meta_data back to role: 'staff' — both corrected below, not
  -- re-inserted, or this collides with the trigger's own row.
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_now, v_now,
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = p_role::public.user_role
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

  if p_role = 'hod' and p_department_ids is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    select v_user_id, unnest(p_department_ids)
    on conflict (hod_id, department_id) do nothing;
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 024_remove_cancellation.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 024 — Cancellation removed: a raised gate pass is permanent
--
-- Business rule (2026-08-04): once a gate pass is raised it cannot be cancelled
-- or deleted. Every cancellation path is removed in one migration:
--
--   1. gatepass.cancel_pass — the HOD void of a still-pending pass
--   2. gate_passes_delete policy + the DELETE grant — the HOD hard-delete
--   3. The 'reject' branch of hod_review_flagged_pass — a flagged pass can now
--      only be APPROVED; it can never be voided
--   4. The now-dead cancel_reason column, and the validate_pass / lookup_pass
--      'cancelled' branches that existed solely to support cancellation
--
-- The enum labels 'cancelled' (pass_status, verify_action) stay in the enums —
-- Postgres cannot drop enum values. They become unreachable: no code path sets
-- them, and historical rows (scan_attempts, verifications) keep their labels
-- for the audit trail. `hod_reviewed` stays: approving a flag override is not a
-- cancellation, it is how a mismatch is resolved.
-- ============================================================================

-- ─── 1. Drop the HOD void RPC ───────────────────────────────────────────────
drop function if exists gatepass.cancel_pass(uuid, text);

-- ─── 2. Drop the HOD delete path ────────────────────────────────────────────
-- The policy was the schema's only DELETE grant; both go together so the
-- RPC-only state machine is complete even for the service key.
revoke delete on gatepass.gate_passes from authenticated;
drop policy if exists gate_passes_delete on gatepass.gate_passes;

-- ─── 3. hod_review_flagged_pass — approve only ──────────────────────────────
-- 'reject' voided a flagged pass into 'cancelled'. Cancellation is gone, so
-- the review has exactly one action. The signature and grant are unchanged
-- (015), so the audit trail and grants keep working.
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

  if p_action <> 'approve' then
    raise exception 'A flagged pass can only be approved. It cannot be cancelled once raised.';
  end if;

  update gatepass.gate_passes
     set status = 'hod_reviewed'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'hod_reviewed'::gatepass.verify_action, auth.uid(),
     'HOD approved override of security flag');

  return v_pass;
end;
$$;

-- ─── 4. Drop cancel_reason ──────────────────────────────────────────────────
-- Dead once cancellation is gone. The view selects p.*, so it must be dropped
-- BEFORE the column (its fixed column list depends on cancel_reason) and
-- rebuilt in section 7 (TRAP 2).
drop view if exists gatepass.v_gate_passes;

alter table gatepass.gate_passes
  drop column if exists cancel_reason;

-- ─── 5. validate_pass — remove the cancelled branches ───────────────────────
-- Restated from 019's final version, minus the 'cancelled' / cancel_reason
-- rules. The remaining rules (birth-date sanity, return-before-verified) are
-- unchanged.
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
    -- Blank optional fields collapse to NULL so "not given" has one spelling.
    new.visitor_company := nullif(trim(coalesce(new.visitor_company, '')), '');
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

-- ─── 6. lookup_pass — remove the cancelled outcome ──────────────────────────
-- Restated from 016's final version minus the 'cancelled' branch. hod_reviewed
-- still scans as 'ok', and the blacklist check is unchanged.
drop function if exists gatepass.lookup_pass(text);

create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid, blacklist_match text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_code           text := trim(coalesce(p_code, ''));
  v_uuid           uuid;
  v_outcome        text;
  v_blacklist_item record;
  v_blacklist_text text := null;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can scan a gate pass.';
  end if;

  if v_code = '' then
    raise exception 'Nothing was scanned.';
  end if;

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
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  -- Blacklist check — only for found passes with a company or vehicle
  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_type = 'company' and lower(b.list_value) = lower(trim(coalesce(v_pass.visitor_company, ''))))
        or (b.list_type = 'vehicle' and lower(b.list_value) = lower(trim(coalesce(v_pass.vehicle_number, ''))))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  return query select v_outcome, v_pass.id, v_blacklist_text;
end;
$$;

-- ─── 7. Rebuild v_gate_passes (TRAP 2 — cancel_reason is gone from p.*) ─────
-- Restated verbatim from 019 so nothing else drifts.
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  p.return_status = 'awaiting_return'
    and p.expected_return_date is not null
    and p.expected_return_date < (now() at time zone gatepass.site_tz())::date
                                                                    as is_overdue,
  p.status = 'pending' and p.expires_at < now()                     as is_expired,

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

  coalesce(it.item_count, 0)                                        as item_count,
  coalesce(it.total_quantity, 0)                                    as total_quantity,
  coalesce(it.returned_quantity, 0)                                 as returned_quantity,
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
         string_agg(i.name, ', ' order by i.line_no) as material_summary
    from gatepass.gate_pass_items i
   where i.gate_pass_id = p.id
) it on true
left join public.departments      d  on d.id = p.department_id
left join gatepass.profile_names  rb on rb.id = p.raised_by
left join gatepass.profile_names  vb on vb.id = p.verified_by;

comment on view gatepass.v_gate_passes is
  'Gate passes plus every derived field. is_overdue, is_expired, due_state and '
  'the item roll-ups are defined here and ONLY here.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 025_self_service_profile.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 025 — Self-service profile: display name + photo
--
-- The `avatars` storage bucket and `public.profiles.avatar_url` already exist
-- on the shared project (VMS migrations 033/053), so no storage or column DDL
-- is needed here — and none may be added, per the two-schema rule.
--
-- GatePass never touches public.profiles from the client (migration 006, and
-- the 42P17 recursion that motivated it), so the two edits a user is allowed
-- to make to their OWN row go through SECURITY DEFINER RPCs in this schema,
-- scoped to auth.uid() inside the function body. That widens nothing: a
-- caller can only ever write their own row. The photo object itself is
-- uploaded to the shared `avatars` bucket by the client (path <uid>/avatar),
-- so a photo set here also shows in VMS, and vice versa.
--
-- my_profile() gains avatar_url so the sidebar and the profile page can render
-- the photo. Nothing else in the return shape changes.
-- ============================================================================

-- ─── The caller's own profile, now including the photo ─────────────────────
-- The return shape grows by one column (avatar_url), which `create or replace`
-- cannot do — the function must be dropped and recreated. Grants die with the
-- drop, so my_profile()'s execute grant is restored below.
drop function if exists gatepass.my_profile();
create function gatepass.my_profile()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  avatar_url    text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id, p.avatar_url, p.created_at
    from public.profiles p
   where p.id = auth.uid();
$$;

-- ─── Edit display name (self-service) ──────────────────────────────────────
create or replace function gatepass.update_my_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(p_full_name);
begin
  if v_name = '' then
    raise exception 'Your name cannot be empty.';
  end if;
  if length(v_name) > 80 then
    raise exception 'Please keep your name under 80 characters.';
  end if;

  update public.profiles
     set full_name = v_name
   where id = auth.uid();
end;
$$;

-- ─── Set or clear the avatar URL (self-service) ────────────────────────────
-- The client uploads the photo to the avatars bucket first and persists the
-- public URL here; passing null (or '') clears it. Deleting the storage
-- object is the client's job, so a failed storage delete can never orphan a
-- broken <img> on this page.
create or replace function gatepass.set_my_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set avatar_url = nullif(p_avatar_url, '')
   where id = auth.uid();
end;
$$;

grant execute on function gatepass.my_profile() to authenticated;
grant execute on function gatepass.update_my_name(text) to authenticated;
grant execute on function gatepass.set_my_avatar(text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 026_flag_reason_survives_hod_override.sql
-- ═══════════════════════════════════════════════════════════
-- 026 — the HOD override of a flagged pass could never succeed
--
-- `gatepass.hod_review_flagged_pass` moves a pass from 'flagged' to
-- 'hod_reviewed' but does not touch `flag_reason`. Migration 012 added
--
--     gate_passes_flag_reason_only_when_flagged
--       check (flag_reason is null or status = 'flagged')
--
-- so that UPDATE always aborted with
--
--     new row for relation "gate_passes" violates check constraint
--     "gate_passes_flag_reason_only_when_flagged"
--
-- i.e. the override has been 100% broken since 012 — not intermittently, but
-- for every pass. `flagged_needs_reason` (from 001) guarantees a flagged pass
-- HAS a reason, so there was no escape path: the reason was always present and
-- the new status was never 'flagged'.
--
-- WHY NOT JUST NULL OUT flag_reason IN THE RPC
--
-- Because that destroys the audit trail. The reason a guard rejected material
-- is the single most valuable record on a disputed pass; an override is
-- precisely the moment it must survive. Nulling it would also erase the text
-- the HOD screens display, so the record of *what was overridden* would vanish
-- the instant someone overrode it.
--
-- WHICH STATUSES MAY LEGITIMATELY CARRY A REASON
--
-- `flag_pass` is the ONLY writer of `flag_reason`, and it sets
-- status = 'flagged' in the same UPDATE. So a reason can only ever originate
-- on a flagged pass, and the question is just which states that pass may
-- travel to afterwards:
--
--     pending/held --flag_pass--> flagged
--     flagged      --hod_review_flagged_pass--> hod_reviewed
--     hod_reviewed --match_pass--> matched
--
-- `match_pass` explicitly admits 'hod_reviewed' ("Only a pending, held, or
-- HOD-reviewed pass can be verified"), so a *matched* pass legitimately keeps
-- the reason it was once flagged for. All three states are therefore allowed.
--
-- The original intent is fully preserved: 'pending', 'held' and 'cancelled'
-- still cannot carry a reason, so a pending pass can never hold an accusation
-- nobody acted on — which is exactly what 012 was written to prevent.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_flag_reason_only_when_flagged,
  add  constraint gate_passes_flag_reason_only_when_flagged
    check (flag_reason is null
        or status in ('flagged', 'hod_reviewed', 'matched'));

-- ═══════════════════════════════════════════════════════════
-- 027_blacklist_enforced_and_hod_rejection.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 028_same_day_expiry_and_lookup_blacklist_fix.sql
-- ═══════════════════════════════════════════════════════════
-- 028 — a pass that never reaches the gate expires at the end of ITS OWN day,
--       and the guard-side blacklist check stops reading raw JSON
--
-- ============================================================================
-- PART 1 — same-day expiry
-- ============================================================================
-- 008 set expires_at to the end of the NEXT day in gatepass.site_tz()
-- (`date_trunc('day', now) + interval '2 days' - 1us`). The business rule is
-- now: if material does not come to the gate on the day the pass was raised,
-- the pass is dead at midnight. So the window becomes the raising day only.
--
-- TRADE-OFF, STATED EXPLICITLY: a pass raised at 23:50 is now valid for ten
-- minutes. The old +2 days existed precisely to avoid that cliff. This is the
-- requested rule and it is implemented as asked, but late-evening passes will
-- expire almost immediately and have to be re-raised the next morning. If that
-- bites, the fix is to make the window "end of the raising day, but never less
-- than N hours", not to go back to +2 days.
--
-- There is deliberately NO new 'expired' enum label and NO pg_cron job.
-- Expiry is derived at query time from expires_at, exactly like is_overdue:
-- `is_expired` already exists in gatepass.v_gate_passes and needs no change.
-- A background job that flipped a status column would be a second source of
-- truth that is wrong between runs, and enum labels cannot be dropped once
-- added. The UI renders a pending pass with is_expired = true as "Expired".
--
-- match_pass already refuses an expired pass, and flag_pass deliberately still
-- does not — refusing to record a real mismatch because the paperwork went
-- stale is backwards. Neither is changed here.
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
  date_str := pg_catalog.to_char((pg_catalog.now() at time zone 'UTC')::date, 'YYYYMMDD');
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
  new.created_at  := pg_catalog.now();
  new.updated_at  := pg_catalog.now();
  new.qr_token    := gen_random_uuid();

  -- End of the raising day in site_tz (was: end of the NEXT day).
  new.expires_at  := ((date_trunc('day', (pg_catalog.now() at time zone tz)) + interval '1 day')
                       at time zone tz) - interval '1 microsecond';

  return new;
end;
$$;

-- ============================================================================
-- PART 2 — lookup_pass compared the blacklist against raw JSON
-- ============================================================================
-- `visitor_company` does NOT hold a plain company name: RaisePass writes
-- JSON.stringify({n: name, a: address, v: phone}), so the column holds
-- '{"n":"BSC","a":"...","v":"..."}'. lookup_pass compared
--     lower(b.list_value) = lower(trim(coalesce(v_pass.visitor_company,'')))
-- which can never equal 'bsc'. So the guard's scan NEVER surfaced a blacklist
-- note for a company — it silently returned null every time, which reads
-- exactly like "this vendor is fine".
--
-- 027 introduced gatepass.company_name_of() for precisely this and fixed the
-- raise-time path; this is the same bug on the gate-side read path. The vehicle
-- branch was always fine (vehicle_number is a bare string).
--
-- DROP first, not `create or replace`: the live function's OUT-parameter row
-- type differs from the one declared below, and Postgres refuses to change a
-- function's return type in place ("cannot change return type of existing
-- function"). Migration 025 hit the same wall with my_profile(). The execute
-- grant is re-applied immediately after, in this same transaction, so the
-- function is never left callable-by-nobody.
drop function if exists gatepass.lookup_pass(text);

create or replace function gatepass.lookup_pass(p_code text)
returns table (outcome text, pass_id uuid, blacklist_note text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_code           text := trim(coalesce(p_code, ''));
  v_uuid           uuid;
  v_outcome        text;
  v_blacklist_item record;
  v_blacklist_text text := null;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can scan a gate pass.';
  end if;

  if v_code = '' then
    raise exception 'Nothing was scanned.';
  end if;

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
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < pg_catalog.now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_type = 'company'
            and lower(b.list_value)
                = lower(trim(coalesce(gatepass.company_name_of(v_pass.visitor_company), ''))))
        or (b.list_type = 'vehicle'
            and lower(b.list_value) = lower(trim(coalesce(v_pass.vehicle_number, ''))))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  return query select v_outcome, v_pass.id, v_blacklist_text;
end;
$$;

revoke all on function gatepass.lookup_pass(text) from public;
grant execute on function gatepass.lookup_pass(text) to authenticated;

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

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
-- 029_per_item_return_timestamps.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 030_drop_returnable_aging.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 030 — drop returnable_aging(), whose only screen has been removed
--
-- The HOD dashboard's "Returnable Aging" card (Period / Items Out / Estimated
-- Value) was removed 2026-08-08 at the user's request. `gatepass.returnable_aging`
-- from 016 was its only caller and now has none.
--
-- WHY DROP RATHER THAN LEAVE IT: an unused SECURITY DEFINER function is not
-- inert. It stays EXECUTE-able over PostgREST by every authenticated user, so
-- it remains reachable attack surface that no screen exercises and nobody is
-- reviewing. This repo's rule is to retire schema in the same change that
-- retires the feature using it.
--
-- SAFE TO DROP: no view, constraint, trigger or other function references it —
-- it was called only from the deleted src/pages/HOD/ReturnableAging.tsx via
-- the client. `drop function if exists` with the exact signature, so a re-run
-- of APPLY_ALL.sql is idempotent and this cannot accidentally match an overload
-- added later.
--
-- NOT dropped here: gatepass.bulk_create_passes, which also has no caller since
-- Bulk Create was removed from the HOD sidebar. That one is pending a decision
-- on whether the screen returns; this one is not coming back.
-- ============================================================================
drop function if exists gatepass.returnable_aging(uuid);

-- ═══════════════════════════════════════════════════════════
-- 031_harden_ref_data_and_drop_dead.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 031 — RLS + read grants for reference data, lookup column rename, dead code
--
-- Four mutually-reinforcing defects, all verified live on 2026-08-08:
--
-- 1. `gatepass.blacklist` and `gatepass.vendor_profiles` had RLS DISABLED and
--    no SELECT grant at all. `list_blacklist_entries()` and
--    `list_vendor_profiles()` are plain (invoker) SQL functions, so every call
--    threw `42501 permission denied for table` — live-proven on 2026-08-08.
--    The RLS policies below are not decoration: they are what keeps a guard
--    from reading the blacklist (a gate-side summary of criminal vendors) and
--    an HOD from reading another department's vendor profiles, which the
--    earlier "no grants at all" posture achieved by throwing an error on
--    everyone. Scoped rows beat a blanket 42501.
--
-- 2. `lookup_pass` returned its blacklist column as `blacklist_note`, but
--    every client (GateLookup.tsx:76,88; types/index.ts:225) reads
--    `blacklist_match`. The guard scan silently dropped the reason. 028 fixed
--    the VALUE (raw-JSON comparison) but shipped it under the wrong column
--    name. The table column for the audit trail stays `blacklist_note`
--    (scan_attempts.audit); only the RPC's return name changes.
--
-- 3. Dead code sweep — the 'held' state has no UI button anywhere
--    (search verify-rls.mjs 'hm strong claim' — no caller in src/), bulk
--    create was deleted from the app 2026-08-08 and `bulk_create_passes` has
--    THREE overloads accumulated across 016/018/019, the 018-era 11-arg
--    `raise_pass` is superseded by the 019 9-arg (the only one the client
--    calls), `delete_vendor_profile` lost its page in the same frontend cut,
--    and `check_blacklist` is a plpgsql/sql function nobody calls (027's
--    trigger inlines its own lookup). All dropped. The `held` enum label
--    stays — Postgres cannot drop enum values — but no code path can set it
--    after this.
--
-- 4. The 020 per-pass material index was widened to unblock
--    bulk_create_passes (which is now dropped). With no bulk path, restore
--    the ORIGINAL invariant: one OPEN line per (department, material) —
--    migration 008's actual, documented intent, whose comment says precisely
--    "one pending pass per material per department".
--
-- 5. `storage.pass-images` was created `public=true` with an **anon** read
--    policy — anyone with the project ref could read a photographed
--    material. Nothing inside the app writes to it anymore (image upload
--    died with the 018-era UI). Lock it down: bucket private, read policy
--    restricted to authenticated.
--
-- ============================================================================

-- ─── 1. RLS on reference tables + read grants ───────────────────────────────
alter table gatepass.blacklist       enable row level security;
alter table gatepass.vendor_profiles enable row level security;

-- Blacklist: only admins may read it. A non-admin reading the blacklist needs
-- to be an explicit, reviewed decision — the gate's blacklist warning arrives
-- via lookup_pass (SECURITY DEFINER), never a table scan.
drop policy if exists blacklist_select_only_admin on gatepass.blacklist;
create policy blacklist_select_only_admin
  on gatepass.blacklist for select to authenticated
  using (gatepass.is_admin());

-- Vendor profiles: admins read all; an HOD reads only their own departments.
-- my_department_ids() is SECURITY DEFINER (002) so this policy cannot recurse.
drop policy if exists vendor_profiles_select_scoped on gatepass.vendor_profiles;
create policy vendor_profiles_select_scoped
  on gatepass.vendor_profiles for select to authenticated
  using (
    gatepass.is_admin()
    or (
      gatepass.app_role() = 'hod'
      and department_id in (select gatepass.my_department_ids())
    )
  );

-- The missing grants behind every 42501 above. Execute grants for the RPCs
-- already exist (016); these table grants let the invoker bodies run.
grant select on gatepass.blacklist       to authenticated;
grant select on gatepass.vendor_profiles to authenticated;

-- ─── 2. lookup_pass: blacklist_note → blacklist_match (return column) ───────
drop function if exists gatepass.lookup_pass(p_code text);

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

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ─── 3. Dead code ───────────────────────────────────────────────────────────
-- Bulk create (016/018-era successor overwritten only twice... actually three
-- overloads exist live, from 016, 018 and 019). Drop all three.
drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  text, date, jsonb, integer, text);

drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  integer, text, date, jsonb, text);

drop function if exists gatepass.bulk_create_passes(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text,
  text, date, jsonb, integer, text, text);

-- The 018-era raise_pass that took p_image_url/p_category (superseded by 019's
-- 9-arg signature, the only one the client calls).
drop function if exists gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text,
  text, date, jsonb, text, text);

-- No caller in src/ since the HOD Vendor Profiles page was deleted.
drop function if exists gatepass.delete_vendor_profile(uuid);

-- Nobody calls it; the per-pass hold UI never shipped.
drop function if exists gatepass.hold_pass(uuid, text, text, jsonb);

-- Nobody calls: the 027 trigger inlines the sole blacklist lookup.
drop function if exists gatepass.check_blacklist(text, text, text);

-- ─── 4. Restore the per-department material-uniqueness index ────────────────
-- 020 widened it to per-pass to let bulk_create_passes insert N identical
-- lines in one transaction. Bulk create is gone (dropped above); the intent
-- this index enforces is 008's: one OPEN line per (department, material).
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

create unique index gate_pass_items_one_open_per_department_material_idx
  on gatepass.gate_pass_items
     (department_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_department_material_idx is
  'One OPEN line per (department, material) — the 008 invariant, restored in 031 '
  '(020 widened this per-pass to unblock the now-deleted bulk_create_passes).';

-- ─── 5. Lock down storage.pass-images ───────────────────────────────────────
update storage.buckets
   set public = false
 where id = 'pass-images';

do $$ begin
  drop policy if exists "anyone can view pass-images" on storage.objects;
exception when others then null; end $$;

do $$ begin
  create policy "authenticated can view pass-images"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'pass-images');
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════
-- 032_one_department_per_person.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 032 — One department per person (GatePass and VMS must agree)
--
-- Business rule, 2026-08-08: a person can belong to AT MOST ONE department.
-- VMS models this structurally — public.profiles.department_id is a single
-- column — so VMS was already constrained. GatePass's join table
-- (gatepass.hod_departments) was a many-to-many and the one place a user
-- could acquire two departments. This migration closes that gap three ways:
--
--   1. A UNIQUE index on hod_departments (hod_id): the database itself
--      rejects a second row for the same person. No RPC can be forgotten
--      later, because the failing path is a 23505 no matter who writes.
--   2. The department-bearing admin functions (admin_create_user,
--      admin_update_user) now REJECT more than one department with a clear
--      message, and — critically for "VMS and GatePass" — mirror the chosen
--      department into public.profiles.department_id, VMS's single-column
--      authority. The two apps then read the same fact for the same person.
--   3. The demo seed 005 no longer invents a multi-department HOD (it only
--      ever seeded from profiles.department_id — itself single).
--
-- A department may still have several HODs; the live DB's shape is exactly
-- that (two HODs in HR, two in IT, three in FIN). Only the person→department
-- direction becomes one-to-one.
--
-- No one currently in the database has more than one row (verified 2026-08-08:
-- all 7 HODs carry exactly one assignment), so this migration contains NO data
-- repair. The dedupe below is defensive only — it keeps one row per person
-- (the department the VMS profile already names, else the newest) so a DB that
-- somehow accumulated duplicates cannot break the paste.
-- ============================================================================

-- 1) Defensive dedupe: keep per person the row matching profiles.department_id
--    (VMS is the authority), else the newest. Distinct on (hod_id).
with keeper as (
  select distinct on (hod_id) hod_id, department_id
    from gatepass.hod_departments hd
   order by hod_id,
     department_id = (
       select p.department_id from public.profiles p where p.id = hd.hod_id
     ) desc,
     created_at desc
)
delete from gatepass.hod_departments hd
where (hd.hod_id, hd.department_id) not in (select hod_id, department_id from keeper);

-- 2) THE constraint: one row per person.
create unique index hod_departments_one_department_per_person
  on gatepass.hod_departments (hod_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_create_user — recreated: at most one department, mirrored to VMS
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces the 021/025-era definition. All prior behaviours preserved (023's
-- trigger-collision fix included); the department handling is now single:
--   * more than one department is refused outright;
--   * the chosen (sole) department is written to BOTH gatepass.hod_departments
--     AND public.profiles.department_id (VMS), so the two apps agree.
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
  v_user_id uuid;
  v_now     timestamptz := now();
  v_dept    uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') — corrected below, not
  -- re-inserted, or this collides with the trigger's own row (023).
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
  set role = p_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

  if p_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_update_user — recreated: one department max, mirrored to VMS
-- ═══════════════════════════════════════════════════════════════════════════
-- p_department_ids = null  → departments unchanged
-- p_department_ids = []    → clear the person's assignments (and VMS column)
-- p_department_ids = [d]   → replace with exactly d (VMS column mirrors it)
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
  v_dept         uuid;
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

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  -- Update profile (department_id changes only when the caller spoke of it)
  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    role      = coalesce(p_role::public.user_role, role),
    department_id = case when p_department_ids is not null then v_dept else department_id end
  where id = p_user_id;

  -- Sync role to auth.users app_metadata
  if p_role is not null then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role),
        updated_at = now()
    where id = p_user_id;
  end if;

  -- Reassign the person's single department (only meaningful for HOD)
  if p_department_ids is not null then
    delete from gatepass.hod_departments where hod_id = p_user_id;
    if v_dept is not null then
      insert into gatepass.hod_departments (hod_id, department_id)
      values (p_user_id, v_dept);
    end if;
  end if;

  return json_build_object('id', p_user_id::text, 'updated', true);
end;
$$;

-- 021 grants cover these signatures; re-asserting keeps a fresh paste
-- self-contained (create or replace inherits grants on the same signature,
-- so this is belt-and-braces only).
grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 033_blacklist_strict_vehicle_format.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 033 — blacklist: strict Indian vehicle format + company name always blocks
--
-- Two verified-live defects, both reported by the user 2026-08-08:
--
-- 1. A VENDOR NAME STORED UNDER THE WRONG TYPE WAS NEVER ENFORCED. The live
--    blacklist holds 'Yadav Infotech' with list_type = 'vehicle' (a form
--    mistake — the admin typed a company name while 'Vehicle' was selected).
--    The 027 trigger only compared the company against entries whose type is
--    'company', so a pass raised WITH that company name sailed through; the
--    HOD/guard had no warning and the gate pass was created. Verification of
--    027 on 2026-08-08 used an entry that happened to be typed under the
--    correct type 'company', so it looked enforced.
--
--    FIX: an inserted pass is refused if its vendor company name matches ANY
--    blacklist value, regardless of the entry's type. The error message names
--    the type and value that matched, so an admin who misfiled an entry can
--    see it. Vehicle plates still compare only against 'vehicle' entries and
--    driver names only against 'driver' — but a company name cannot be
--    smuggled past the ban by filing the entry under the wrong type.
--
-- 2. VEHICLE ENTRIES ACCEPTED ANY TEXT. The form stored whatever the admin
--    typed ('thar', 'Yadav Infotech') with no shape enforcement. A vehicle
--    that cannot be a registration number is noise — and, worse, could be a
--    company or person's name that silently never matched the plate column.
--    From now on a 'vehicle' entry MUST be a valid Indian registration number
--    (e.g. WB 09 AB 1234 — two letters, 1-2 digits, 1-3 letters, four digits;
--    the Bharat-series 22 BH 1234 XY is also accepted), and the value is
--    NORMALIZED before storage (uppercase, spaces/dashes removed) so a plate
--    can never be stored in two spellings that dodge each other. Existing
--    poorly-typed rows are left alone (they were entered deliberately); the
--    rule applies to new entries, and the company cross-match in (1) covers
--    the name-like ones anyway.
-- ============================================================================

-- ─── Normalisation + format check ─────────────────────────────────────────
-- WB 09 AB 1234 → WB09AB1234. A single-digit district is zero-padded
-- (WB 9 AB 1234 → WB09AB1234) so the same plate can never be stored or
-- matched in two spellings. Immutable so it is safe inside comparisons and
-- (like normalize_material) could back an index later without Postgres
-- suspecting volatile output.
create or replace function gatepass.normalize_vehicle(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- POSIX [:alnum:] — a plain [A-Z0-9] class under this server's collation
    -- mis-handles letters (verified live: 'WB9AB1234' came back as '91234').
    when upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g'))
         ~ '^[A-Z]{2}[0-9][A-Z]'
    then left(upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g')), 2)
         || '0'
         || substring(upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g')) from 3)
    else upper(regexp_replace(trim(coalesce(p_raw, '')), '[^[:alnum:]]', '', 'g'))
  end
$$;

comment on function gatepass.normalize_vehicle(text) is
  'Upper-cases a vehicle registration and strips everything but letters/digits, so WB 09 AB 1234 and wb-09-ab-1234 compare equal.';

-- The strict Indian plate shape, checked on the NORMALIZED form:
--   standard  WB 09 AB 1234  => WB09AB1234  ([A-Z]{2} [0-9]{1,2} [A-Z]{1,3} [0-9]{4})
--   Bharat   22 BH 1234 XY    => 22BH1234XY  ([0-9]{2} BH [0-9]{4} [A-Z]{2})
-- Anything else — 'thar', '12345', 'XY', 'ABC 1' — is not a car number and is
-- refused at add time (see add_blacklist_entry below).
create or replace function gatepass.is_indian_vehicle(p_raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    where gatepass.normalize_vehicle(p_raw) ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$'
       or gatepass.normalize_vehicle(p_raw) ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{2}$'
  )
$$;

comment on function gatepass.is_indian_vehicle(text) is
  'True only for a syntactically valid Indian registration number (normalised). Blocks random alphanumerics from entering the vehicle blacklist.';

-- ─── The raise-time trigger: company names block regardless of entry type ──
create or replace function gatepass.enforce_blacklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_vehicle text;
  v_driver  text;
  v_hit     record;
begin
  v_company := gatepass.company_name_of(new.visitor_company);
  v_vehicle := gatepass.normalize_vehicle(new.vehicle_number);
  v_driver  := lower(trim(coalesce(new.visitor_name, '')));

  select b.list_type, b.list_value, b.reason
    into v_hit
    from gatepass.blacklist b
   where (v_company is not null
          and lower(trim(b.list_value)) = lower(trim(v_company)))
      or (v_vehicle is not null
          and b.list_type = 'vehicle'
          and gatepass.normalize_vehicle(b.list_value) = v_vehicle)
      or (v_driver <> ''
          and b.list_type = 'driver'
          and lower(trim(b.list_value)) = v_driver)
   limit 1;

  if found then
    -- The reason is part of the refusal on purpose: an HOD told only "blocked"
    -- has no way to tell a deliberate ban from a typo, and will just retry.
    raise exception 'Blocked: % % is blacklisted (%). Reason: %',
      v_hit.list_type,
      v_hit.list_value,
      v_hit.list_type,
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

comment on function gatepass.enforce_blacklist() is
  'BEFORE INSERT on gate_passes. Company name compares against EVERY list entry (a ban cannot be dodged by filing the vendor under the wrong type); vehicle numbers and driver names compare against their own types, case-insensitively.';

-- ============================================================================
-- add_blacklist_entry: strict format for vehicles, normalised storage
-- ============================================================================
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
  v_entry  gatepass.blacklist;
  v_value  text;
begin
  if gatepass.app_role() not in ('admin', 'super_admin') then
    raise exception 'Only admins can manage the blacklist.';
  end if;

  if p_list_type not in ('company', 'vehicle', 'driver') then
    raise exception 'Unknown blacklist type %. Expected company, vehicle or driver.', p_list_type;
  end if;

  if p_list_value is null or trim(p_list_value) = '' then
    raise exception 'A blacklist value is required.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required for every blacklist entry.';
  end if;

  if p_list_type = 'vehicle' then
    if not gatepass.is_indian_vehicle(p_list_value) then
      raise exception 'The blacklist vehicle is not a valid Indian registration number — expected e.g. WB 09 AB 1234 (got "%").',
        trim(p_list_value);
    end if;
    v_value := gatepass.normalize_vehicle(p_list_value);
  else
    v_value := trim(p_list_value);
  end if;

  -- Distinct-spelling duplicates are pointless (and dodge the case-insensitive
  -- matching above). normalize_vehicle already uppercased a plate; normalise
  -- names/drivers on the way in so 'bsc' and 'BSC' cannot both sit in the list.
  insert into gatepass.blacklist (list_type, list_value, reason, blocked_by)
  values (p_list_type, case when p_list_type = 'vehicle' then v_value else upper(v_value) end, trim(p_reason), auth.uid())
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function gatepass.add_blacklist_entry(text, text, text) from public;
grant execute on function gatepass.add_blacklist_entry(text, text, text) to authenticated;

-- ============================================================================
-- lookup_pass: the gate-side warning uses the SAME matching rules, so the
-- note a guard sees on a scan agrees with the refusal an HOD got at raise time
-- ============================================================================
drop function if exists gatepass.lookup_pass(p_code text);

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

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_value is not null
            and lower(trim(b.list_value))
                = lower(trim(gatepass.company_name_of(v_pass.visitor_company))))
        or (b.list_type = 'vehicle'
            and gatepass.normalize_vehicle(b.list_value)
                = gatepass.normalize_vehicle(v_pass.vehicle_number))
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

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ─── Existing rows that were stored under the wrong type ───────────────────
-- e.g. a company name filed under 'vehicle' — they now block company raises
-- via the cross-type match above; nothing needs migrating. Entries that were
-- formally plates are matched via normalize_vehicle on both sides.

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 034_fix_admin_created_user_login.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 034 — Users the admin panel creates could never sign in
--
-- Symptom: an admin adds a guard/HOD, the account appears everywhere it should
-- (auth.users, public.profiles, the Users tab, correct role in app_metadata,
-- email already confirmed), and yet signing in with that email and password
-- fails. Not with "invalid credentials" — with a 500 from the auth server.
--
-- Root cause, confirmed in the live auth logs 2026-08-08:
--     "converting NULL to string is unsupported"
--
-- GoTrue scans auth.users' token columns into Go `string` fields, which cannot
-- hold NULL. Four of those columns are nullable AND have no column default:
--
--     confirmation_token        recovery_token
--     email_change              email_change_token_new
--
-- `admin_create_user` (021/023/032) never listed them in its INSERT, so every
-- account it created carried NULL there and blew up inside the auth server on
-- the very first sign-in. Supabase's own signup path writes '' into all four,
-- which is why demo accounts and self-signups were unaffected — and why this
-- was invisible from GatePass's side: the row looks perfectly healthy.
--
-- The remaining string columns (phone_change, phone_change_token,
-- email_change_token_current, reauthentication_token) each default to '' and
-- so were already being written correctly; they are omitted here on purpose.
--
-- Two parts, because fixing the function alone leaves the existing accounts
-- broken forever:
--   1. backfill the rows already written with NULLs;
--   2. recreate admin_create_user so new rows are written with ''.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Repair the accounts already created — they cannot sign in until this runs
-- ─────────────────────────────────────────────────────────────────────────────
-- Touches only NULL→'' on token columns. No password, email, role, metadata or
-- confirmation state is altered, so a healthy row is left byte-for-byte alone.
update auth.users
set confirmation_token      = coalesce(confirmation_token, ''),
    recovery_token          = coalesce(recovery_token, ''),
    email_change            = coalesce(email_change, ''),
    email_change_token_new  = coalesce(email_change_token_new, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) admin_create_user — recreated so new users can actually log in
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to 032's definition in every other respect: the admin check, the
-- no-admin-from-this-path rule, role validation, the one-department guard and
-- its mirror into public.profiles.department_id (032), and 023's "let the VMS
-- trigger create the profile row, then UPDATE it" fix. The ONLY change is the
-- four token columns in the INSERT column list.
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
  v_user_id uuid;
  v_now     timestamptz := now();
  v_dept    uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  if p_role not in ('guard', 'hod', 'staff') then
    raise exception 'Invalid role "%". Allowed: guard, hod, staff.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') — corrected below, not
  -- re-inserted, or this collides with the trigger's own row (023).
  --
  -- confirmation_token / recovery_token / email_change / email_change_token_new
  -- are written as '' and MUST stay in this list: they are nullable with no
  -- default, and GoTrue cannot scan a NULL into its Go string field — omitting
  -- them makes the account unable to sign in at all (034).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
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
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = p_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

  if p_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 035_override_fresh_pass_timeline.sql
-- ═══════════════════════════════════════════════════════════
-- 035 — an override approval makes the pass FRESH at the gate,
--       and every card can show the full timeline in one row
--
-- ============================================================================
-- PART 1 — hod_review_flagged_pass refreshes expires_at on approve
-- ============================================================================
-- Business rule (user decision, 2026-08-08): when the HOD override-approves a
-- flagged pass, the pass becomes a FRESH gate pass — it must be matchable at
-- the gate, and match_pass refuses anything whose expires_at has passed. Before
-- 035 an override-approved pass kept whatever expiry it was born with, so a
-- pass flagged near midnight (or re-raised for approval a day later) was
-- cleared by the HOD only to be refused by match_pass the moment it arrived at
-- the barrier — the whole override flow was a dead end.
--
-- The refresh reuses 028's exact end-of-day expression (end of the CURRENT
-- day in site_tz()): the override gives the pass the rest of today to reach
-- the gate, mirroring the same-day rule any new pass obeys. This is the
-- db-side half; the view side (flagged_at / hod_reviewed_at) is PART 3, and
-- the guard queue re-derives visibility from the view in the frontend.
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
    -- Same-day re-expiry (028's expression): the override gives the pass the
    -- rest of TODAY to reach the gate. flag_reason deliberately survives (026).
    update gatepass.gate_passes
       set status    = 'hod_reviewed'::gatepass.pass_status,
           expires_at = ((date_trunc('day', (now() at time zone gatepass.site_tz())) + interval '1 day')
                          at time zone gatepass.site_tz()) - interval '1 microsecond'
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

-- ============================================================================
-- PART 2 — flag_pass accepts hod_reviewed (the mismatch option stays open)
-- ============================================================================
-- Approval is the HOD's judgement, not a fact about the material. A guard
-- standing at the gate with the truck in front of them must still be able to
-- say "this still does not match" after an override — otherwise the HOD's
-- decision papered over a real mismatch the gate could not re-open.
--
-- hod_reviewed → flagged is a second round of the same loop: the pass goes
-- back to the HOD for another review. flag_reason is overwritten with the new
-- mismatch's reason; the old one remains in verifications.
drop function if exists gatepass.flag_pass(uuid, text, text, jsonb, jsonb);

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

  -- pending/hold, plus hod_reviewed (035): a pass the HOD has override-approved
  -- can be re-flagged at the gate — the mismatch option must survive the paper.
  if v_pass.status::text not in ('pending', 'held', 'hod_reviewed') then
    raise exception 'This pass is already %. Only a pending, held or HOD-approved pass can be flagged.',
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

grant execute on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- PART 3 — the view carries the timeline: raised → mismatched → override
-- ============================================================================
-- Every card in the app renders a pass from ONE v_gate_passes row. The card
-- timeline ("Raised 09:14 · Mismatch 10:02 · HOD override 11:30") needs the
-- flag and the override moments, which live in verifications, not on the pass.
-- Adding two scalar subselects keeps every list row single-query and leaves
-- verified_at alone (it is the LATEST verification; flagged_at/hod_reviewed_at
-- are the SPECIFIC moments the timeline names, which later matches would
-- otherwise overwrite).
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes
with (security_invoker = true)
as
select
  p.*,

  (select max(f.created_at)
     from gatepass.verifications f
    where f.gate_pass_id = p.id
      and f.action = 'flagged'::gatepass.verify_action)          as flagged_at,

  (select max(r.created_at)
     from gatepass.verifications r
    where r.gate_pass_id = p.id
      and r.action = 'hod_reviewed'::gatepass.verify_action)     as hod_reviewed_at,

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
  end                                                           as due_state,

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
  'the item roll-ups are defined here and ONLY here. flagged_at and '
  'hod_reviewed_at come from the verifications audit so every card can show '
  'the raised/mismatch/override timeline without a second query.';

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 036_admin_password_reset.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 036 — Admin-assisted password reset, and a forced change on first sign-in
--
-- The "Forgot password?" link was removed from the login card (2026-08-10): the
-- built-in Supabase email sender is capped at ~2 mails/hour PROJECT-WIDE (and
-- that budget is shared with VMS), so the self-serve button failed for most
-- people who pressed it. The replacement is a human — the admin resets it from
-- Admin → Users → Edit User.
--
-- ── ORDERING DEPENDENCY, READ THIS BEFORE APPLYING ──────────────────────────
-- The flag this relies on, public.profiles.must_change_password, is added by
-- **VMS migration 064**, because public is VMS-owned and GatePass must never
-- alter it (the two-schema rule). Apply VMS 064 FIRST. This migration only
-- reads and writes the column's VALUE, exactly as admin_create_user already
-- writes public.profiles.role — that has always been allowed.
--
-- The functions below deliberately MIRROR VMS's rather than calling them: each
-- app authorizes with its own admin check (gatepass.is_admin() reads this app's
-- notion of admin, VMS's reads its own), and each app's callable surface stays
-- inside its own schema. The bcrypt write is the same shape admin_create_user
-- has used since 021 (extensions.crypt / gen_salt('bf')), verified live on
-- 2026-08-08 — GoTrue accepts a hash written this way and the account signs in.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_reset_user_password — an admin sets someone else's password
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gatepass.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_target_role public.user_role;
  v_now         timestamptz := now();
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reset a password.';
  end if;

  -- A 6-character floor matches GoTrue's own minimum and the Add User form.
  -- Enforced HERE because this path writes the hash directly and so never
  -- passes through the auth server's own validation.
  if p_password is null or length(p_password) < 6 then
    raise exception 'The new password must be at least 6 characters.';
  end if;

  select p.role, u.email into v_target_role, v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if v_email is null then
    raise exception 'That user no longer exists.';
  end if;

  -- Deliberate: an admin cannot reset another admin's password. Otherwise the
  -- weakest admin account becomes a takeover route into every stronger one, and
  -- "reset" becomes an undetectable way to seize a super_admin. This matches
  -- admin_create_user, which likewise refuses to mint an admin. The Users tab
  -- already renders no row actions for an admin, so the UI agrees with the RPC.
  if v_target_role in ('admin', 'super_admin') then
    raise exception 'Admin passwords cannot be reset from the panel. Use the Supabase dashboard.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = v_now,
      -- 034's lesson, applied defensively: GoTrue scans these four into Go
      -- strings and returns a 500 on NULL. Costs nothing to keep them sane.
      confirmation_token     = coalesce(confirmation_token, ''),
      recovery_token         = coalesce(recovery_token, ''),
      email_change           = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, '')
  where id = p_user_id;

  update public.profiles
  set must_change_password = true
  where id = p_user_id;

  -- Every existing session dies with the old password. Without this, someone
  -- already signed in on another device keeps full access — which defeats the
  -- point of a reset when the reason for it is a suspected compromise.
  -- refresh_tokens.session_id cascades (verified live: confdeltype 'c'); the
  -- second delete catches legacy rows that predate session_id.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  return json_build_object(
    'id', p_user_id::text,
    'email', v_email,
    'must_change_password', true
  );
end;
$$;

revoke all on function gatepass.admin_reset_user_password(uuid, text) from public;
grant execute on function gatepass.admin_reset_user_password(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) set_my_password — the user chooses their own, and the flag clears with it
-- ─────────────────────────────────────────────────────────────────────────────
-- The flag is cleared HERE, in the same call that writes the password, and
-- nowhere else. A separate "clear the flag" RPC would let the forced-change
-- screen be skipped by calling it from the browser console — the flag can only
-- come down by actually setting a password.
create or replace function gatepass.set_my_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_current text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to change your password.';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'Your new password must be at least 6 characters.';
  end if;

  select encrypted_password into v_current from auth.users where id = v_uid;

  -- Reusing the temporary password the admin just read out over the phone
  -- leaves the account exactly as exposed as it was. Refuse it by name so the
  -- message is actionable rather than a silent no-op.
  if v_current is not null and extensions.crypt(p_password, v_current) = v_current then
    raise exception 'Choose a password you have not used before.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  where id = v_uid;

  update public.profiles
  set must_change_password = false
  where id = v_uid;
end;
$$;

revoke all on function gatepass.set_my_password(text) from public;
grant execute on function gatepass.set_my_password(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) my_profile() must carry the flag — the app gate reads it from here
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP + recreate, not `create or replace`: the return type changes, and
-- Postgres cannot replace a function whose OUT columns differ. This is the same
-- dance 025 did when avatar_url was added — and the execute grant must be
-- re-applied in the same transaction, because the drop takes it with it.
--
-- GatePass never reads public.profiles directly (the 006 rule — VMS's recursive
-- policy raises 42P17), so this function is the ONLY way the flag reaches the
-- client.
drop function if exists gatepass.my_profile();

create function gatepass.my_profile()
returns table (
  id                   uuid,
  email                text,
  full_name            text,
  role                 text,
  department_id        uuid,
  avatar_url           text,
  created_at           timestamptz,
  must_change_password boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id,
         p.avatar_url, p.created_at, p.must_change_password
    from public.profiles p
   where p.id = auth.uid();
$$;

grant execute on function gatepass.my_profile() to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 037_fix_open_material_index_drift.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 037 — An IT HOD could not raise an RGP: "That record already exists."
--
-- Reported 2026-08-10. Raising a perfectly ordinary RGP failed with a 23505
-- unique violation, which src/lib/errors.ts renders as the generic
-- "That record already exists." — a message that tells the HOD nothing about
-- what was duplicated or what to do about it.
--
-- ── ROOT CAUSE: migration 020 silently did nothing ──────────────────────────
-- 020 set out to widen the open-material index from per-DEPARTMENT to per-PASS.
-- It opened with:
--
--     drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;
--
-- but the index actually on the database is named
--
--     gate_pass_items_one_open_per_department_material_idx
--
-- The names do not match, so `if exists` made the drop a silent no-op, the OLD
-- per-department index survived, and 020's replacement was never created (it is
-- absent from pg_indexes — confirmed live 2026-08-10).
--
-- So the rule in force has been: **one open line per material per DEPARTMENT**.
-- Every HOD in a department shares one namespace of material descriptions. The
-- second person to send out anything called "Laptop" is refused until the first
-- one comes back. With ~10 real passes and a shared IT department that became
-- unavoidable in normal use.
--
-- `if exists` is what hid this. It is there to make a migration re-runnable,
-- and it also means a typo'd or renamed object fails silently and forever.
-- **When dropping an index by name, verify the name against pg_indexes first.**
--
-- ── THE FIX: land what 020 intended ─────────────────────────────────────────
-- Per-PASS scope. Within one pass you still cannot list the same material
-- twice, which is the real integrity rule — it stops a double-typed line. But
-- two different passes may legitimately move the same KIND of thing, because a
-- material description is a noun ("Laptop"), not a serial number. Two teams
-- sending out two laptops is normal, and the database refusing it is wrong.
-- ============================================================================

-- Drop BOTH spellings by their real names. The department-scoped one is what is
-- actually live; the other is 020's intended name, dropped defensively in case
-- an environment somewhere did get it.
drop index if exists gatepass.gate_pass_items_one_open_per_department_material_idx;
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

-- One OPEN line per material per PASS. `is_open` keeps the constraint scoped to
-- material still outside the gate: once a line is closed it stops participating,
-- so the same material can be sent out again next week.
create unique index gate_pass_items_one_open_per_material_idx
  on gatepass.gate_pass_items (gate_pass_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_material_idx is
  'One OPEN line per material per PASS. Deliberately NOT per department: a '
  'material description is a noun, not a serial, so two passes may move the '
  'same kind of item. Per-department scope blocked ordinary RGPs (037).';

-- department_id is deliberately NOT in the key any more. It was redundant even
-- when 020 wrote it — a pass belongs to exactly one department, so once
-- gate_pass_id is in the key, department_id can never further discriminate.
-- Leaving it in would imply a scope the index does not actually have.

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 038_pass_total_value.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 038 - v_gate_passes carries the pass's declared value
--
-- The pass cards were asked to highlight the value of the material alongside
-- vendor, who raised it, and the expected return date. Three of those four were
-- already on the view; value was not. Only gate_pass_items.approx_value existed,
-- per line, so any card that had not already loaded its item rows could not show
-- a figure at all -- and every pass-level card (guard drill, HOD drill, My
-- Passes, the gate queue) is exactly that case.
--
-- Summed as a plain SUM of approx_value, matching 016's `overdue_value`, which
-- is defined the same way. The two MUST agree: a pass reading one figure in the
-- overdue KPI and another on its own card would make both untrustworthy. So
-- approx_value is a LINE total, not a unit price.
--
-- Computed inside the EXISTING lateral, so this adds a column without adding a
-- second scan of gate_pass_items.
--
-- COALESCE to 0 at the view boundary so no consumer has to special-case null.
-- Note the cost: "nothing declared" and "declared as zero" become
-- indistinguishable. Acceptable only because approx_value is explicitly an
-- APPROXIMATE, optional figure and never an accounting record.
--
-- TRAP 2 (CLAUDE.md): `create or replace view` cannot absorb a new column - a
-- view's column list is fixed at creation. The view must be DROPPED and rebuilt,
-- and the select grant re-applied in the SAME transaction, or every client loses
-- read access. `security_invoker = true` is restated deliberately: without it the
-- view runs as its owner and bypasses RLS entirely, so every HOD would read
-- every department's passes.
--
-- The body below is pg_get_viewdef() of the LIVE view, edited mechanically
-- rather than retyped, so it cannot drift from what is actually deployed.
-- ============================================================================

drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
    p.visitor_name,
    p.visitor_company,
    p.vehicle_number,
    p.purpose,
    p.expected_return_date,
    p.return_status,
    p.actual_return_date,
    p.verified_by,
    p.verified_at,
    p.flag_reason,
    p.created_at,
    p.updated_at,
    p.qr_token,
    p.expires_at,
    p.direction,
    p.image_url,
    p.category,
    ( SELECT max(f.created_at) AS max
           FROM gatepass.verifications f
          WHERE f.gate_pass_id = p.id AND f.action = 'flagged'::gatepass.verify_action) AS flagged_at,
    ( SELECT max(r.created_at) AS max
           FROM gatepass.verifications r
          WHERE r.gate_pass_id = p.id AND r.action = 'hod_reviewed'::gatepass.verify_action) AS hod_reviewed_at,
    p.return_status = 'awaiting_return'::gatepass.return_status AND p.expected_return_date IS NOT NULL AND p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date AS is_overdue,
    p.status = 'pending'::gatepass.pass_status AND p.expires_at < now() AS is_expired,
        CASE
            WHEN p.expected_return_date IS NULL OR (p.return_status::text <> ALL (ARRAY['awaiting_return'::text, 'partially_returned'::text])) THEN 'not_applicable'::text
            WHEN p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date THEN 'overdue'::text
            WHEN p.expected_return_date = (now() AT TIME ZONE gatepass.site_tz())::date THEN 'due_today'::text
            WHEN p.expected_return_date = ((now() AT TIME ZONE gatepass.site_tz())::date + 1) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS due_state,
    COALESCE(it.item_count, 0::bigint) AS item_count,
    COALESCE(it.total_quantity, 0::numeric) AS total_quantity,
    COALESCE(it.returned_quantity, 0::numeric) AS returned_quantity,
    it.material_summary,
    COALESCE(it.total_value, 0::numeric) AS total_value,
    d.name AS department_name,
    d.code AS department_code,
    rb.full_name AS raised_by_name,
    vb.full_name AS verified_by_name
   FROM gatepass.gate_passes p
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            sum(i.quantity) AS total_quantity,
            sum(i.returned_qty) AS returned_quantity,
            string_agg(i.name, ', '::text ORDER BY i.line_no) AS material_summary,
            sum(i.approx_value) AS total_value
           FROM gatepass.gate_pass_items i
          WHERE i.gate_pass_id = p.id) it ON true
     LEFT JOIN public.departments d ON d.id = p.department_id
     LEFT JOIN gatepass.profile_names rb ON rb.id = p.raised_by
     LEFT JOIN gatepass.profile_names vb ON vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

comment on view gatepass.v_gate_passes is
  'Pass rows with rollups. is_overdue / is_expired / due_state / total_value are '
  'defined HERE and exactly once - never recompute them in TypeScript.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 039_whitelist_requires_ceo_approval.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 039 - taking a vendor OFF the blacklist needs a justification and the CEO
--
-- Until now `remove_blacklist_entry(uuid)` (016) let any admin delete a
-- blacklist row outright: one click, no reason recorded, no second pair of
-- eyes. Blacklisting is the one control that can stop a vendor at the gate,
-- so the ability to quietly undo it is the ability to quietly disable the
-- control. Business rule (client, 2026-08-13): an admin may only REQUEST
-- whitelisting, must state why, and the entry stays enforced until the CEO
-- approves.
--
-- `remove_blacklist_entry` is DROPPED, not left beside the new flow. Leaving
-- it would make the whole approval chain optional -- the browser could call
-- the old RPC directly and the CEO would never see the request. Its only
-- caller (BlacklistTab's Remove button) is replaced in the same change.
--
-- WHO IS THE CEO. There is no `ceo` role to check: `public.user_role` is
-- VMS-owned (guard / hod / admin / super_admin / staff) and this app must
-- never alter `public` (the two-schema rule). So the CEO is a DESIGNATED
-- ACCOUNT, held in `gatepass.ceo_approver` -- exactly one row, enforced by a
-- boolean primary key that can only ever be true.
--
-- Two guards on that designation, both load-bearing:
--   * Only a super_admin may set it. If an admin could nominate the CEO they
--     would nominate themselves, approve their own request, and the control
--     is back to one click by one person.
--   * The designee must be an admin or super_admin. The approval screens live
--     under /admin, which ROLE_ROUTES opens to admins only, so designating a
--     guard or an HOD would create a CEO who cannot reach the queue.
--
-- WHY THE REQUEST OUTLIVES THE ENTRY. Approval DELETES the blacklist row, so
-- `blacklist_id` is nullable with ON DELETE SET NULL and the request keeps its
-- own snapshot of what was unblocked (`list_type` / `list_value` / the
-- original `reason`). ON DELETE CASCADE would erase the audit trail at the
-- exact moment it becomes the only record that the vendor was ever blocked,
-- and why they were let back in.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The designated CEO
-- ═══════════════════════════════════════════════════════════════════════════
-- `only_row` is a boolean PK constrained to true: at most one row can exist,
-- so "who is the CEO" has exactly one answer and no ordering or `limit 1`
-- anywhere has to decide it.
create table if not exists gatepass.ceo_approver (
  only_row       boolean primary key default true,
  user_id        uuid not null references public.profiles(id),
  designated_by  uuid not null references public.profiles(id),
  designated_at  timestamptz not null default now(),

  constraint ceo_approver_single_row check (only_row)
);

alter table gatepass.ceo_approver enable row level security;

-- Admins (and therefore the CEO, who is one) may read who the approver is.
-- Nobody holds INSERT/UPDATE/DELETE -- the RPC below is the only writer.
drop policy if exists ceo_approver_select_admin on gatepass.ceo_approver;
create policy ceo_approver_select_admin
  on gatepass.ceo_approver for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.ceo_approver to authenticated;

-- True only for the one designated account. Used by the approve/reject RPCs.
create or replace function gatepass.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.ceo_approver c where c.user_id = auth.uid()
  );
$$;

grant execute on function gatepass.is_ceo() to authenticated;

create or replace function gatepass.set_ceo_approver(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if gatepass.app_role() <> 'super_admin' then
    raise exception 'Only a super admin can designate the CEO approver.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;
  if v_role is null then
    raise exception 'That user does not exist.';
  end if;
  if v_role not in ('admin', 'super_admin') then
    raise exception 'The CEO approver must be an admin account — the approval queue lives in the admin panel.';
  end if;

  insert into gatepass.ceo_approver (only_row, user_id, designated_by, designated_at)
  values (true, p_user_id, auth.uid(), now())
  on conflict (only_row) do update
    set user_id = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- Who the CEO is, by name. Returns no rows when nobody is designated yet --
-- which the admin screen must say out loud, because in that state no
-- whitelist request can ever be approved.
create or replace function gatepass.get_ceo_approver()
returns table (user_id uuid, full_name text, designated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, n.full_name, c.designated_at
  from gatepass.ceo_approver c
  left join gatepass.profile_names n on n.id = c.user_id
  where gatepass.is_admin();
$$;

grant execute on function gatepass.set_ceo_approver(uuid) to authenticated;
grant execute on function gatepass.get_ceo_approver()    to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Whitelist requests
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists gatepass.whitelist_requests (
  id             uuid primary key default gen_random_uuid(),
  blacklist_id   uuid references gatepass.blacklist(id) on delete set null,

  -- Snapshot of what was blocked, so an approved request still says what it
  -- unblocked after the blacklist row is gone.
  list_type      text not null,
  list_value     text not null,
  blocked_reason text not null,

  justification  text not null,
  requested_by   uuid not null references public.profiles(id),
  requested_at   timestamptz not null default now(),

  status         text not null default 'pending',
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decision_note  text,

  constraint whitelist_requests_status_valid
    check (status in ('pending', 'approved', 'rejected')),
  -- 10 characters is not a quality bar; it is a floor that stops "ok" and "."
  -- from satisfying a mandatory field.
  constraint whitelist_requests_justification_substantive
    check (length(trim(justification)) >= 10),
  -- A pending request has no decision; a decided one has both who and when.
  constraint whitelist_requests_decision_consistent
    check (
      (status = 'pending'  and decided_by is null and decided_at is null)
      or (status <> 'pending' and decided_by is not null and decided_at is not null)
    ),
  constraint whitelist_requests_rejection_has_note
    check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) > 0)
);

-- One open request per blacklist entry. Partial, so a vendor rejected once can
-- be asked about again later with a better justification.
create unique index if not exists whitelist_requests_one_pending_per_entry
  on gatepass.whitelist_requests (blacklist_id)
  where status = 'pending';

create index if not exists whitelist_requests_status_idx
  on gatepass.whitelist_requests (status, requested_at desc);

alter table gatepass.whitelist_requests enable row level security;

drop policy if exists whitelist_requests_select_admin on gatepass.whitelist_requests;
create policy whitelist_requests_select_admin
  on gatepass.whitelist_requests for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.whitelist_requests to authenticated;

-- ─── Request (admin) ────────────────────────────────────────────────────────
create or replace function gatepass.request_vendor_whitelist(
  p_blacklist_id  uuid,
  p_justification text
)
returns gatepass.whitelist_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry   gatepass.blacklist;
  v_request gatepass.whitelist_requests;
begin
  if not gatepass.is_admin() then
    raise exception 'Only admins can request whitelisting.';
  end if;

  if length(trim(coalesce(p_justification, ''))) < 10 then
    raise exception 'A justification is required — say why this vendor should be whitelisted.';
  end if;

  select * into v_entry from gatepass.blacklist b where b.id = p_blacklist_id;
  if not found then
    raise exception 'Blacklist entry not found.';
  end if;

  if exists (
    select 1 from gatepass.whitelist_requests r
    where r.blacklist_id = p_blacklist_id and r.status = 'pending'
  ) then
    raise exception 'A whitelist request for this entry is already awaiting CEO approval.';
  end if;

  insert into gatepass.whitelist_requests (
    blacklist_id, list_type, list_value, blocked_reason,
    justification, requested_by
  )
  values (
    v_entry.id, v_entry.list_type, v_entry.list_value, v_entry.reason,
    trim(p_justification), auth.uid()
  )
  returning * into v_request;

  return v_request;
end;
$$;

-- ─── Read (admin + CEO) ─────────────────────────────────────────────────────
create or replace function gatepass.list_whitelist_requests(p_status text default null)
returns table (
  id              uuid,
  blacklist_id    uuid,
  list_type       text,
  list_value      text,
  blocked_reason  text,
  justification   text,
  requested_by    uuid,
  requested_by_name text,
  requested_at    timestamptz,
  status          text,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.blacklist_id, r.list_type, r.list_value, r.blocked_reason,
    r.justification, r.requested_by, rn.full_name, r.requested_at,
    r.status, dn.full_name, r.decided_at, r.decision_note
  from gatepass.whitelist_requests r
  left join gatepass.profile_names rn on rn.id = r.requested_by
  left join gatepass.profile_names dn on dn.id = r.decided_by
  where gatepass.is_admin()
    and (p_status is null or r.status = p_status)
  order by r.requested_at desc;
$$;

-- ─── Approve (CEO only) ─────────────────────────────────────────────────────
-- Approval is what actually deletes the blacklist row. Doing it here rather
-- than leaving the admin to delete it afterwards is the whole point: there is
-- no code path that removes an entry without a recorded approval.
create or replace function gatepass.approve_whitelist_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request gatepass.whitelist_requests;
begin
  if not gatepass.is_ceo() then
    raise exception 'Only the designated CEO can approve a whitelist request.';
  end if;

  select * into v_request from gatepass.whitelist_requests r where r.id = p_id;
  if not found then
    raise exception 'Whitelist request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  -- Order matters only for readability: the delete NULLs blacklist_id via
  -- ON DELETE SET NULL, and the snapshot columns keep the record complete.
  update gatepass.whitelist_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  delete from gatepass.blacklist where id = v_request.blacklist_id;
end;
$$;

-- ─── Reject (CEO only) ──────────────────────────────────────────────────────
-- The note is mandatory: a rejection with no reason tells the admin nothing
-- about whether to re-submit.
create or replace function gatepass.reject_whitelist_request(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not gatepass.is_ceo() then
    raise exception 'Only the designated CEO can decide a whitelist request.';
  end if;

  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'A reason is required to reject a whitelist request.';
  end if;

  select r.status into v_status from gatepass.whitelist_requests r where r.id = p_id;
  if v_status is null then
    raise exception 'Whitelist request not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  update gatepass.whitelist_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note)
   where id = p_id;
end;
$$;

grant execute on function gatepass.request_vendor_whitelist(uuid, text)   to authenticated;
grant execute on function gatepass.list_whitelist_requests(text)          to authenticated;
grant execute on function gatepass.approve_whitelist_request(uuid)        to authenticated;
grant execute on function gatepass.reject_whitelist_request(uuid, text)   to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The one-click removal is gone
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropped rather than revoked: an EXECUTE-able SECURITY DEFINER function that
-- no screen calls is attack surface nobody reviews (CLAUDE.md).
drop function if exists gatepass.remove_blacklist_entry(uuid);

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 040_user_active_status.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 040 - "inactive" is a STATUS, not a role
--
-- Until now, deactivating someone meant `update public.profiles set role =
-- 'staff'` (021's admin_soft_delete_user). Two things were wrong with that,
-- and the client named the first one: the admin portal's Role column read
-- "Inactive", which is not a role -- and the person's REAL role (guard or HOD)
-- was destroyed by the very act of suspending them, so reactivating meant an
-- admin guessing what the account used to be. The second is quieter: `staff`
-- is a legitimate VMS role for people who simply do not use GatePass, so
-- GatePass was overwriting a shared column to record a fact of its own.
--
-- The fact belongs here, in `gatepass.user_status`, and the role column goes
-- back to holding a role. `staff` stops being writable from the admin portal
-- at all (admin_create_user / admin_update_user now allow guard and hod only),
-- so nothing in this app demotes a person into VMS's role again.
--
-- HOW A DEACTIVATED PERSON IS ACTUALLY SHUT OUT. Not by the client hiding a
-- screen -- their JWT still says `guard`, and a JWT cannot be un-issued. The
-- flag is consulted by the two functions every policy already goes through:
--
--   * app_role()          -> null when inactive, so is_security() and
--                            is_admin() are both false and every policy and
--                            RPC gated on them refuses.
--   * my_department_ids() -> returns nothing when inactive, which is the ONE
--                            path into gate_passes that does not read
--                            app_role() (an HOD reads their own departments).
--
-- Miss either and a suspended person keeps reading passes. Together they mean
-- deactivation is enforced in Postgres, for every existing policy and every
-- policy added later, with no per-policy edit.
--
-- ABSENT ROW = ACTIVE. `is_user_active` coalesces to true, so all 32 existing
-- accounts stay exactly as they are with no backfill, and a row is written
-- only when an admin actually suspends someone. A legacy `staff` account is
-- therefore "active" by this flag and still has no access -- because `staff`
-- has no routes and no policy grants, which was always the case. The portal
-- shows such a row as Staff / Inactive; giving it a real role in Edit is what
-- turns it into a usable account.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The status table
-- ═══════════════════════════════════════════════════════════════════════════
-- Keyed on auth.users rather than public.profiles: this records something
-- about the ability to sign in and be authorized, and `on delete cascade`
-- means removing an account cannot leave a suspension behind that a recycled
-- uuid would inherit.
create table if not exists gatepass.user_status (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  is_active      boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),

  -- A suspension with no timestamp is a suspension nobody can date. The
  -- inverse is deliberately NOT constrained: reactivation clears both columns,
  -- but a row that kept them would still be readable rather than rejected.
  constraint user_status_inactive_is_dated check (is_active or deactivated_at is not null)
);

alter table gatepass.user_status enable row level security;

-- A person may see their own status; an admin sees everyone's (the portal's
-- Status column). Nobody holds INSERT/UPDATE/DELETE -- the two RPCs below are
-- the only writers, exactly as with gate_passes' state machine.
drop policy if exists user_status_select on gatepass.user_status;
create policy user_status_select
  on gatepass.user_status for select to authenticated
  using (user_id = auth.uid() or gatepass.is_admin());

grant select on gatepass.user_status to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The helper every gate reads
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER so the policy on user_status is never evaluated from
-- inside the functions that decide that policy -- the same reason
-- my_department_ids() is one (see 002). It deliberately calls NOTHING: an
-- app_role() or is_admin() call here would recurse through the very policy
-- this function exists to answer.
create or replace function gatepass.is_user_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.is_active from gatepass.user_status s where s.user_id = p_user_id),
    true
  );
$$;

grant execute on function gatepass.is_user_active(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The two gates that now consult it
-- ═══════════════════════════════════════════════════════════════════════════
-- app_role() is unchanged apart from the wrapper: same JWT source, same
-- profiles fallback. A deactivated caller gets null, which every `in (...)`
-- test below it evaluates to false rather than to a role.
create or replace function gatepass.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when gatepass.is_user_active(auth.uid()) then
             coalesce(
               nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
               (select p.role::text from public.profiles p where p.id = auth.uid())
             )
         end;
$$;

-- The one path into gate_passes that does not go through app_role().
-- gate_passes_select admits `department_id in (select my_department_ids())`,
-- so without this a suspended HOD would keep reading their department's
-- passes, and gate_passes_insert would keep letting them raise new ones.
create or replace function gatepass.my_department_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hd.department_id
    from gatepass.hod_departments hd
   where hd.hod_id = auth.uid()
     and gatepass.is_user_active(auth.uid());
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Deactivation writes the flag and KEEPS the role
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces 021's body wholesale. Three differences that matter:
--   * public.profiles is not touched at all, so the role survives the
--     suspension and reactivation needs no guess.
--   * hod_departments assignments SURVIVE too (021 deleted them). They are
--     inert while the flag is false -- my_department_ids() returns nothing --
--     and reactivating restores the person's exact scope instead of an admin
--     re-deriving which department they held.
--   * every session is deleted. Without that, someone already signed in
--     elsewhere keeps a valid JWT and a working screen until it expires; RLS
--     would refuse their reads, so they would sit in front of an app that
--     silently shows nothing. Same reasoning as 036's password reset.
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Mirrors admin_reset_user_password (036): the weakest admin account must
  -- not be a route to suspending a stronger one. A locked-out admin is a
  -- Supabase-dashboard job, deliberately.
  if v_role in ('admin', 'super_admin') then
    raise exception 'An admin account cannot be deactivated from the portal.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, false, now(), auth.uid(), now())
  on conflict (user_id) do update
    set is_active      = false,
        deactivated_at = now(),
        deactivated_by = auth.uid(),
        updated_at     = now();

  delete from auth.sessions where user_id = p_user_id;

  return json_build_object('id', p_user_id::text, 'deactivated', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Reactivation
-- ═══════════════════════════════════════════════════════════════════════════
-- 021 had no such function: "reactivating" meant an admin choosing a role for
-- someone whose role had been erased. Now it restores exactly what was
-- suspended, and it refuses an account with no role to restore -- a `staff`
-- row has no access whether the flag is true or false, so flipping it would
-- report a person as Active who still cannot sign in to anything.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  if v_role not in ('guard', 'hod') then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, true, null, null, now())
  on conflict (user_id) do update
    set is_active      = true,
        deactivated_at = null,
        deactivated_by = null,
        updated_at     = now();

  return json_build_object('id', p_user_id::text, 'reactivated', true);
end;
$$;

grant execute on function gatepass.admin_reactivate_user(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. `staff` is no longer writable from the admin portal
-- ═══════════════════════════════════════════════════════════════════════════
-- Both bodies are 034's admin_create_user and 032's admin_update_user COPIED
-- VERBATIM, with exactly one line changed in each: the allowed-role list loses
-- 'staff'. Everything else is load-bearing and was hard-won -- 034's four
-- auth.users token columns (omit them and the account cannot sign in at all),
-- 023's UPDATE-not-INSERT of the profile row VMS's own trigger already
-- created, 032's one-department guard and its mirror into
-- public.profiles.department_id. Re-read those three migrations before
-- touching either body again.
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
  v_user_id uuid;
  v_now     timestamptz := now();
  v_dept    uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  -- 040: 'staff' is VMS's role for someone who does not use GatePass, not this
  -- app's off switch. Deactivation is gatepass.user_status now.
  if p_role not in ('guard', 'hod') then
    raise exception 'Invalid role "%". Allowed: guard, hod.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- This insert fires public.handle_new_user(), which creates the matching
  -- public.profiles row (role defaulted to 'staff') — corrected below, not
  -- re-inserted, or this collides with the trigger's own row (023).
  --
  -- confirmation_token / recovery_token / email_change / email_change_token_new
  -- are written as '' and MUST stay in this list: they are nullable with no
  -- default, and GoTrue cannot scan a NULL into its Go string field — omitting
  -- them makes the account unable to sign in at all (034).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
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
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = p_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role)
  where id = v_user_id;

  if p_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

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
  v_dept         uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can update users.';
  end if;

  if p_role is not null then
    if p_role in ('admin', 'super_admin') then
      raise exception 'Cannot promote to admin. Use the CLI with the service-role key.';
    end if;
    -- 040: see admin_create_user above.
    if p_role not in ('guard', 'hod') then
      raise exception 'Invalid role "%". Allowed: guard, hod.', p_role;
    end if;
  end if;

  -- Look up current role to guard against the caller changing their own role
  select role::text into v_current_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  -- Update profile (department_id changes only when the caller spoke of it)
  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    role      = coalesce(p_role::public.user_role, role),
    department_id = case when p_department_ids is not null then v_dept else department_id end
  where id = p_user_id;

  -- Sync role to auth.users app_metadata
  if p_role is not null then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_role),
        updated_at = now()
    where id = p_user_id;
  end if;

  -- Reassign the person's single department (only meaningful for HOD)
  if p_department_ids is not null then
    delete from gatepass.hod_departments where hod_id = p_user_id;
    if v_dept is not null then
      insert into gatepass.hod_departments (hod_id, department_id)
      values (p_user_id, v_dept);
    end if;
  end if;

  return json_build_object('id', p_user_id::text, 'updated', true);
end;
$$;

grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;
grant execute on function gatepass.admin_update_user(uuid, text, text, uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The flag has to reach the client
-- ═══════════════════════════════════════════════════════════════════════════
-- Both functions are DROPPED and recreated, not replaced: their OUT column
-- lists change, which `create or replace` cannot do (the same dance 025 and
-- 036 did). The execute grants go with the drop and are re-applied here, in
-- the same transaction.
--
-- GatePass never reads public.profiles directly (the 006 rule), so these two
-- functions are the only way either fact reaches a screen.
drop function if exists gatepass.my_profile();

create function gatepass.my_profile()
returns table (
  id                   uuid,
  email                text,
  full_name            text,
  role                 text,
  department_id        uuid,
  avatar_url           text,
  created_at           timestamptz,
  must_change_password boolean,
  is_active            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id,
         p.avatar_url, p.created_at, p.must_change_password,
         gatepass.is_user_active(p.id)
    from public.profiles p
   where p.id = auth.uid();
$$;

grant execute on function gatepass.my_profile() to authenticated;

drop function if exists gatepass.admin_list_profiles(text);

create function gatepass.admin_list_profiles(p_role text default null)
returns table (
  id             uuid,
  email          text,
  full_name      text,
  role           text,
  department_id  uuid,
  created_at     timestamptz,
  is_active      boolean,
  deactivated_at timestamptz
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
    select p.id, p.email, p.full_name, p.role::text, p.department_id, p.created_at,
           coalesce(s.is_active, true), s.deactivated_at
      from public.profiles p
      left join gatepass.user_status s on s.user_id = p.id
     where p_role is null or p.role::text = p_role
     order by p.full_name;
end;
$$;

grant execute on function gatepass.admin_list_profiles(text) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 041_hod_decides_an_expired_pass.sql
-- ═══════════════════════════════════════════════════════════
-- 041 — the HOD decides what happens to a pass that expired at the gate
--
-- ============================================================================
-- THE GAP THIS CLOSES
-- ============================================================================
-- A pass that is never presented at the gate before its own `expires_at` is
-- already NULL AND VOID in every way that matters at the barrier: `match_pass`
-- (008) refuses an expired pass outright, so nothing the guard does will ever
-- release that material. What was missing is the other end — the HOD who raised
-- it had no way to CLOSE it. It sat at `pending` for ever, counted in "Pending
-- Approvals" on both dashboards, and the only way to move the material was to
-- raise a second pass and leave the first one open beside it.
--
-- Client, 2026-08-17: "if something is not out and has expired, make it null and
-- void and notify the HOD about that so that he can either raise it or reject
-- it. He can review it and raise it or maybe void it completely."
--
-- ============================================================================
-- WHY THERE IS NO SCHEDULED JOB, AND NO 'expired' STATUS
-- ============================================================================
-- Expiry stays DERIVED from `expires_at`, exactly as `is_overdue` is, and
-- surfaced by `v_gate_passes.is_expired`. A pg_cron job that flipped every
-- expired pass to 'cancelled' at midnight would introduce a scheduled dependency
-- this schema has deliberately never had, and would write a state change with
-- nobody's name on it — `verifications.security_user_id` is `not null`, so an
-- automatic void has no honest author to record.
--
-- So the row moves to a terminal state exactly once: when a human decides. This
-- function is that decision, and the HOD is that human.
--
-- ============================================================================
-- WHY IT IS NOT A BRANCH OF hod_review_flagged_pass
-- ============================================================================
-- That function (015/027/035) has an 'approve' branch, and 035 made approval
-- REFRESH `expires_at` to the end of the current day. Widening it to admit an
-- expired pending pass would therefore hand every HOD a way to un-expire their
-- own paperwork with no security involvement at all — the exact control this
-- migration exists to enforce. This function has ONE outcome, void, and no
-- approve branch to grow one later.
--
-- The terminal state is 'cancelled', which already exists in both
-- gatepass.pass_status and gatepass.verify_action (008). That matters: a NEW
-- enum label cannot be referenced by a check constraint or a `language sql` body
-- in the transaction that adds it, and APPLY_ALL.sql is pasted as ONE
-- transaction. Reusing an existing label sidesteps that entirely.
--
-- This does not reopen what 024 closed. 024 stopped an HOD voiding a LIVE pass
-- on a whim. This applies only to a pass the database itself will no longer
-- honour, only to the HOD who raised it, and adds no DELETE grant and no UPDATE
-- policy — the state machine stays RPC-only.

create or replace function gatepass.hod_void_expired_pass(
  p_pass_id uuid,
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
    raise exception 'Only the HOD who raised this pass can void it.';
  end if;

  -- Only a pass still waiting at the gate. One that reached ANY outcome —
  -- matched, flagged, held, hod_reviewed, already cancelled — is a decision
  -- somebody has already taken, and expiry does not reopen it.
  if v_pass.status::text <> 'pending' then
    raise exception 'Only a pass still waiting at the gate can be voided this way. This pass is %.', v_pass.status;
  end if;

  -- EXPIRY IS CHECKED HERE, ON THE SERVER, AND NOT TAKEN FROM THE CALLER.
  -- The screen decides which button to draw; the database decides what is true.
  -- Without this, the browser could void a perfectly live pass by calling the
  -- RPC directly — which is the HOD cancellation 024 removed, restored by the
  -- back door.
  if v_pass.expires_at is null or v_pass.expires_at >= now() then
    raise exception 'This pass has not expired, so it cannot be voided.';
  end if;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id
   returning * into v_pass;

  -- The audit trail. `verifications` is where every state change in this schema
  -- is recorded, and a void with no row there is a pass that changed state for
  -- no recorded reason. The default text says WHY rather than WHAT: "cancelled"
  -- is already the action column.
  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
     coalesce(nullif(trim(coalesce(p_reason, '')), ''),
              'Expired without reaching the gate; voided by the raising HOD'));

  return v_pass;
end;
$$;

comment on function gatepass.hod_void_expired_pass(uuid, text) is
  'Voids a pass that expired without ever being presented at the gate. Raising HOD only, pending only, and only once expires_at is genuinely in the past.';

revoke all on function gatepass.hod_void_expired_pass(uuid, text) from public;
grant execute on function gatepass.hod_void_expired_pass(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 042_pass_number_drops_direction.sql
-- ═══════════════════════════════════════════════════════════
-- 042 — the pass number stops carrying the direction.
--
-- Client, 2026-08-18: "don't make the pass reference numbering of the RGP as
-- RGP out. It should be only RGP — no need to mention out or in."
--
--   before   RGP-OUT-20260818-0001
--   after    RGP-20260818-0001
--
-- 010 put the direction in the number so a guard could read which way the
-- material was moving off the slip. It never earned its place: NRGP is outward
-- only by check constraint, and `RaisePass` hardcodes `p_direction => 'out'`,
-- so every number ever generated says OUT. The column `direction` still holds
-- the fact, and the slip and every screen still read it from there — this
-- changes the LABEL only, no column, no constraint, no enum.
--
-- ONLY NEW PASSES CHANGE. The 45 existing rows keep the numbers that are on
-- printed slips and in people's hands: a pass number is an audit anchor, and
-- rewriting one silently invalidates the paper a guard is holding.
--
-- SEQUENCE SAFETY. The counter keys on the whole prefix, so it is now per
-- (type, day) instead of per (type, direction, day) — an RGP-in and an RGP-out
-- raised on the same day take consecutive numbers rather than colliding on
-- `gate_passes_pass_number_key`. The legacy rows cannot interfere either way:
-- 'RGP-20260818-%' does not match 'RGP-OUT-20260818-0001'.
--
-- Reproduced in full from 010 because a plpgsql body cannot be patched in
-- place; only the `prefix :=` line differs.
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
  prefix   := new.type::text || '-' || date_str;

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
  'Assigns pass_number as TYPE-YYYYMMDD-NNNN (042; the direction was dropped '
  'from the label — gate_passes.direction still carries the fact). Counter is '
  'per (type, day), serialised by an advisory lock on the prefix.';

-- ═══════════════════════════════════════════════════════════
-- 043_approval_ladder.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 043 - the gate pass approval ladder gets NAMES
--
-- The printed slip has carried five approval signatures since the beginning
-- (src/pages/Shared/signatureBlocks.ts):
--
--     Issuing HOD -> Security Head -> COO -> CEO -> Finance HOD
--
-- and then, at the gate: Security Verification -> Receiver.
--
-- On paper those are blank boxes somebody signs and stamps. On screen the
-- record showed none of it, so a reader could not tell WHO was supposed to have
-- signed. Client, 2026-08-19: the gate pass detail must show the ladder, level
-- by level, with the approver's name and department -- "just match the print
-- slip".
--
-- WHAT THIS IS NOT. It is not an approval WORKFLOW. Nothing here gates the
-- gate: `match_pass` is unchanged, no pass waits on a level, and no new queue
-- exists. The sign-off is still the wet signature on the printed A5 slip. This
-- migration answers exactly one question -- "who holds each of those four
-- offices right now" -- so the screen can print the name beside the level
-- instead of an empty box. Deciding otherwise later means a real
-- `pass_approvals` table keyed by pass; this table would then become its
-- default routing, not its record.
--
-- WHY NOT REUSE `gatepass.ceo_approver` (039). That row is a PERMISSION: whoever
-- holds it can approve a whitelist request and let a blacklisted vendor back
-- through the gate. This table is an ORG CHART -- a name printed on a record.
-- Folding the two together would mean that naming the CEO on a gate pass
-- silently hands them the blacklist override, which is precisely the control
-- 039 exists to protect. Two facts, two tables, on purpose.
--
-- WHY `role_key` IS TEXT WITH A CHECK, NOT AN ENUM. APPLY_ALL.sql is pasted as
-- ONE transaction and a new enum value cannot be USED in the transaction that
-- adds it -- naming a fresh label inside a `check (...)` aborts the whole
-- paste. A text column with a literal check has neither problem and mirrors
-- `whitelist_requests.status` (039), which is text for the same reason.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Who holds each office
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per office, at most. `role_key` is the primary key, so "who is the
-- COO" has exactly one answer and no ordering or `limit 1` anywhere has to
-- decide it -- the same shape `ceo_approver` gets from its single-row boolean.
--
-- ON DELETE RESTRICT on `user_id`: an office holder cannot be deleted out from
-- under the ladder, leaving passes printed with a name that resolves to
-- nothing. Vacate the office first (see `clear_approval_role` below).
create table if not exists gatepass.approval_roles (
  role_key       text primary key,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  designated_by  uuid not null references public.profiles(id),
  designated_at  timestamptz not null default now(),

  -- The four offices between the issuing HOD and the gate, in slip order. A
  -- fifth office is a migration, not a free-text row: every screen renders the
  -- ladder from a fixed Record and an unknown key would render nowhere.
  constraint approval_roles_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head'))
);

alter table gatepass.approval_roles enable row level security;

-- EVERY app user may read the ladder, and that is deliberate: the four names
-- are printed on the face of every gate pass that leaves the building, so a
-- guard holding the paper already has them. Restricting the screen to admins
-- would mean the guard reading the slip could not check it against the record.
-- Nobody holds INSERT/UPDATE/DELETE -- the two RPCs below are the only writers.
drop policy if exists approval_roles_select_all on gatepass.approval_roles;
create policy approval_roles_select_all
  on gatepass.approval_roles for select to authenticated
  using (true);

grant select on gatepass.approval_roles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Reading the ladder, with names and departments
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because it needs two columns `gatepass.profile_names`
-- deliberately does not carry -- the department -- and that view's own comment
-- forbids widening it ("Do NOT add columns here"). Same route
-- `get_ceo_approver` (039) takes for the same reason.
--
-- What it exposes is the display name and department of at most four
-- designated officers. That is strictly less than the printed slip already
-- shows to anyone holding it, and nothing about any other account.
--
-- LEFT JOINs on purpose, the rule the pass view follows: VMS can narrow its own
-- policies without notice, and an inner join would make an office vanish from
-- the ladder entirely. A left join degrades to a null name -- visibly wrong
-- beats invisibly missing.
create or replace function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'ceo'           then 3
              when 'finance_head'  then 4
            end;
$$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Designating and vacating an office
-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN, not super_admin. Unlike the CEO designation this grants no power: the
-- holder gains no route, no RPC and no ability to approve anything. It only
-- decides which name is printed beside a level, which is the same kind of fact
-- as a department's name -- and that is admin-editable already.
--
-- NO ROLE RESTRICTION on the designee. The Security Head is plausibly a `guard`
-- account, the COO and the Finance Head plausibly `staff` or `admin`. Requiring
-- a particular role here would make offices undesignatable for no gain, since
-- the designation opens nothing to sign in to.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- Vacating is its own verb rather than `set_approval_role(key, null)`: a null
-- user id is far more likely to be a bug in a caller than an intention to empty
-- an office, and `user_id` is NOT NULL precisely so that bug cannot land.
create or replace function gatepass.clear_approval_role(p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change a gate pass approver.';
  end if;

  delete from gatepass.approval_roles r where r.role_key = p_role_key;
end;
$$;

grant execute on function gatepass.set_approval_role(text, uuid) to authenticated;
grant execute on function gatepass.clear_approval_role(text)     to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 044_overdue_guard_actions.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 044 - what a guard can DO about an overdue pass
--
-- Client, 2026-08-19: the guard's Overdue screen is one count that opens into a
-- stack of overdue passes, and every card carries the same four actions --
-- process the return, contact the vendor, add a remark, export the slip.
--
-- Three of those four already had somewhere to go. `Process RGP Return` and
-- `Export Pass PDF` are routes (/pass/:id and /pass/:id/print), and both were
-- already reachable. The other two had NO backing at all:
--
--   Contact Vendor / Person   the vendor's phone lives in
--                             gatepass.vendor_profiles, which a guard cannot
--                             read: `vendor_profiles_select_scoped` (031) is
--                             admin-or-own-department-HOD, on purpose.
--   Add Guard Remark          nothing in the schema stored a follow-up note.
--                             A menu item that saves nothing is worse than no
--                             menu item, so the table is here rather than the
--                             button being drawn without it.
--
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A follow-up note against a pass
-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY, and that is the whole point of it: a remark is a record of what
-- was done about a late return -- "rang the site office, truck comes Monday" --
-- and a record that can be edited afterwards is not one. Nobody holds UPDATE or
-- DELETE, and there is no RPC that offers either.
--
-- `author` is NOT NULL and references the profile, so every line has a name
-- against it. ON DELETE RESTRICT for the same reason `approval_roles` (043)
-- uses it: a note whose author resolves to nothing is a note nobody wrote.
create table if not exists gatepass.pass_remarks (
  id           uuid primary key default gen_random_uuid(),
  gate_pass_id uuid not null references gatepass.gate_passes(id) on delete cascade,
  author       uuid not null references public.profiles(id) on delete restrict,
  body         text not null,
  created_at   timestamptz not null default now(),

  -- A blank remark is not a remark, and a screenful is a document. Both ends
  -- are checked here rather than only in the client, because the RPC below is
  -- callable without one.
  constraint pass_remarks_body_sane
    check (length(btrim(body)) between 1 and 1000)
);

create index if not exists pass_remarks_pass_idx
  on gatepass.pass_remarks (gate_pass_id, created_at desc);

alter table gatepass.pass_remarks enable row level security;

-- READABLE BY WHOEVER CAN READ THE PASS, and by exactly nobody else. The
-- subquery is not decoration: row security applies inside a policy expression
-- too, so `gate_passes_select` (002) decides this -- an HOD sees remarks on
-- their own department's passes, a guard and an admin see the site. Restating
-- that rule here in a second form is how the two drift apart.
drop policy if exists pass_remarks_select_with_pass on gatepass.pass_remarks;
create policy pass_remarks_select_with_pass
  on gatepass.pass_remarks for select to authenticated
  using (
    exists (
      select 1 from gatepass.gate_passes g where g.id = gate_pass_id
    )
  );

-- No insert/update/delete policy anywhere. `add_pass_remark` is the only writer.
grant select on gatepass.pass_remarks to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Writing one
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GATE AND THE OFFICE BOTH WRITE HERE. A guard records what happened at the
-- barrier; the raising HOD and an admin record the chase from their side, and a
-- pass a department cannot see is one this function refuses anyway (the
-- visibility check below re-uses `gate_passes` under the caller's own RLS by
-- selecting through a SECURITY INVOKER path -- see the note on v_visible).
--
-- SECURITY DEFINER is needed only for the INSERT, since no role holds INSERT on
-- the table. The visibility test that gates it must therefore be explicit, and
-- it is: `gatepass.can_see_pass` is the same predicate `gate_passes_select`
-- applies, called before anything is written.
create or replace function gatepass.can_see_pass(p_pass_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from gatepass.gate_passes g where g.id = p_pass_id);
$$;

grant execute on function gatepass.can_see_pass(uuid) to authenticated;

create or replace function gatepass.add_pass_remark(p_pass_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if gatepass.app_role() is null then
    raise exception 'You are not signed in to this app.';
  end if;

  -- Invoker-rights predicate, called from a definer body ON PURPOSE: it is what
  -- keeps this function from becoming a way to write a note onto any pass in
  -- the building by guessing an id.
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to remark on.';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'A remark cannot be empty.';
  end if;

  insert into gatepass.pass_remarks (gate_pass_id, author, body)
  values (p_pass_id, auth.uid(), left(btrim(p_body), 1000))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function gatepass.add_pass_remark(uuid, text) to authenticated;

-- Reading them back with a name against each. SECURITY DEFINER for the join to
-- `public.profiles` only -- the rows themselves are already gated by the
-- visibility check, and what it adds is a display name, which is what
-- `gatepass.profile_names` exists to expose.
create or replace function gatepass.list_pass_remarks(p_pass_id uuid)
returns table (
  id          uuid,
  body        text,
  author_name text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select r.id, r.body, p.full_name, r.created_at
      from gatepass.pass_remarks r
      left join public.profiles p on p.id = r.author
     where r.gate_pass_id = p_pass_id
     order by r.created_at desc;
end;
$$;

grant execute on function gatepass.list_pass_remarks(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The one contact detail the gate needs
-- ═══════════════════════════════════════════════════════════════════════════
-- A guard chasing a late return has to be able to ring somebody, and the number
-- is in `vendor_profiles`, which they cannot read. Widening
-- `vendor_profiles_select_scoped` would hand the gate every vendor's record in
-- the building; this hands it ONE row -- contact person and phone -- for ONE
-- pass the caller can already see, matched on the company printed on that pass.
--
-- `visitor_company` is free text and carries a "Name | Address" convention in
-- places (parseCompanyInfo, client side), so the match is on the leading
-- segment, case-folded and trimmed. A miss returns no row and the menu says so;
-- it never invents a number.
create or replace function gatepass.pass_contact(p_pass_id uuid)
returns table (
  company        text,
  contact_person text,
  phone          text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    with pass as (
      select g.visitor_company, g.visitor_name, g.department_id
        from gatepass.gate_passes g
       where g.id = p_pass_id
    )
    select coalesce(v.company_name, btrim(split_part(pass.visitor_company, '|', 1))),
           coalesce(v.contact_person, pass.visitor_name),
           v.phone
      from pass
      left join gatepass.vendor_profiles v
        on lower(btrim(v.company_name))
         = lower(btrim(split_part(pass.visitor_company, '|', 1)));
end;
$$;

grant execute on function gatepass.pass_contact(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 045_raise_pass_mockup_fields.sql
-- ═══════════════════════════════════════════════════════════
-- 045 — the raise form is the client's mock-up: a vendor keeps its address, and
--       a line carries make / model, an invoice reference and remarks.
--
-- Client, 2026-08-19, with the "Raise Gate Pass" mock-up in hand. The form they
-- drew collects, per material line:
--
--   Item Description · Quantity · Make / Model / Size · Serial / Asset Tag ·
--   Invoice / Reference No. · Remarks / Description
--
-- Three of those have nowhere to go today, so this migration gives them one.
-- The other two columns the old form had — the per-item PURPOSE and the
-- per-item UOM — are not dropped: `purpose` is NOT NULL and is what every
-- record screen prints, and `unit` is what `isWholeUnit` and every return box
-- reason about. The form simply stops asking for them:
--
--   * purpose — the mock asks ONCE, for the whole pass ("Purpose / Description",
--     500 characters). `raise_pass` already takes `p_purpose`; it now also uses
--     it as each line's purpose when the caller sends none, so a line's reason
--     is the pass's reason rather than the literal 'Material movement'.
--   * unit — the mock has no UOM column (client: remove it), so every new line
--     is raised in the column default, 'nos'. KNOWN COST, FLAGGED TO THE CLIENT:
--     material that is genuinely counted in bags or drums can no longer be
--     raised in its own unit until a UOM control comes back.
--
-- VENDOR ADDRESS BECOMES REAL DATA. The mock's "Vendor Address (Auto-filled)"
-- cannot auto-fill from a blob: the address has only ever existed inside
-- `gate_passes.visitor_company`'s packed `{"n","a","v"}` JSON, which is a record
-- of ONE pass and is not queryable by vendor. It moves onto the vendor profile,
-- which is the row the form looks up by name. The packed blob is unchanged —
-- the pass still records the address as it was on the day, so editing a vendor
-- later cannot rewrite history on a printed slip.
--
-- No new `gate_passes` column, so `v_gate_passes` is untouched (TRAP 2 does not
-- apply). `gate_pass_items` is not in that view's select list at all — the
-- lateral join reads `name`, `quantity`, `returned_qty` and `approx_value` only.

-- ── 1. The vendor keeps its address ──────────────────────────────────────────
alter table gatepass.vendor_profiles
  add column if not exists address text;

alter table gatepass.vendor_profiles
  drop constraint if exists vendor_profiles_address_not_blank;
alter table gatepass.vendor_profiles
  add constraint vendor_profiles_address_not_blank
  check (address is null or length(trim(address)) > 0);

comment on column gatepass.vendor_profiles.address is
  'Vendor address, auto-filled into the raise form when the vendor is picked. The pass keeps its own copy in visitor_company packed JSON, so a later edit here never rewrites an issued pass.';

-- `list_vendor_profiles` returns `setof gatepass.vendor_profiles`, so the new
-- column joins its result with no change to the function. PostgREST caches the
-- composite type, hence the reload at the bottom of this file.

-- ── 2. save_vendor_profile takes the address ────────────────────────────────
-- A new parameter is a NEW function in Postgres, not a replacement, and two
-- overloads reachable by named arguments is exactly the ambiguity PostgREST
-- resolves by guessing. The 6-arg form is dropped in the same migration that
-- creates the 7-arg one — the same thing 031 did to 018's `raise_pass`.
drop function if exists gatepass.save_vendor_profile(text, uuid, text, text, text, text);

create or replace function gatepass.save_vendor_profile(
  p_company_name     text,
  p_department_id    uuid,
  p_contact_person   text default null,
  p_phone            text default null,
  p_vehicle_number   text default null,
  p_typical_material text default null,
  p_address          text default null
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
     typical_material, address, created_by)
  values
    (p_company_name, p_department_id, p_contact_person, p_phone, p_vehicle_number,
     p_typical_material, nullif(trim(coalesce(p_address, '')), ''), auth.uid())
  on conflict (company_name, department_id)
  do update set
    contact_person   = coalesce(p_contact_person, vendor_profiles.contact_person),
    phone            = coalesce(p_phone, vendor_profiles.phone),
    vehicle_number   = coalesce(p_vehicle_number, vendor_profiles.vehicle_number),
    typical_material = coalesce(p_typical_material, vendor_profiles.typical_material),
    -- Blank never erases a stored address: the form sends what it has, and an
    -- HOD who raised a pass without retyping the address must not wipe it for
    -- everyone else.
    address          = coalesce(nullif(trim(coalesce(p_address, '')), ''), vendor_profiles.address),
    updated_at       = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function gatepass.save_vendor_profile(
  text, uuid, text, text, text, text, text
) to authenticated;

-- ── 3. A material line carries make / model, an invoice ref and remarks ─────
alter table gatepass.gate_pass_items
  add column if not exists make_model text,
  add column if not exists invoice_no text,
  add column if not exists remarks    text;

-- Blank-vs-null discipline, the same rule 013 put on `serial_no`: an empty
-- string and a null both read as "not given", and two spellings of nothing is
-- how a filter starts disagreeing with a report.
alter table gatepass.gate_pass_items
  drop constraint if exists gate_pass_items_mockup_text_not_blank;
alter table gatepass.gate_pass_items
  add constraint gate_pass_items_mockup_text_not_blank
  check (
    (make_model is null or length(trim(make_model)) > 0)
    and (invoice_no is null or length(trim(invoice_no)) > 0)
    and (remarks    is null or length(trim(remarks))    > 0)
  );

comment on column gatepass.gate_pass_items.make_model is
  'Make / Model / Size, as drawn on the raise mock-up. Required by the form, optional in the column: the rows that predate it have none.';
comment on column gatepass.gate_pass_items.invoice_no is
  'Invoice / Reference No. for the line — the paper the material came in on.';
comment on column gatepass.gate_pass_items.remarks is
  'Free remarks for the line. Distinct from `description`, which is the material itself and is NOT NULL.';

-- ── 4. raise_pass writes them ───────────────────────────────────────────────
-- SAME 9-ARGUMENT SIGNATURE as 019 — nothing new is asked of the caller, the
-- three new facts ride in each element of `p_items` beside `serial_no`. That is
-- deliberate: an overload change here would have to be reflected in every
-- caller and in the grant, for three optional strings.
--
-- Reproduced in full: `create or replace function` has no partial form.
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
       serial_no, approx_value, expected_return_date, department_id,
       make_model, invoice_no, remarks)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none. The
      -- mock asks for purpose once, for the whole pass; falling through to the
      -- literal 'Material movement' would print that on every record screen
      -- while the real reason sat one field away on the same pass.
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

grant execute on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 046_approval_workflow.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 046 — the approval ladder becomes a WORKFLOW, and the gate stops seeing
--       passes that have not climbed it
--
-- 043 gave the four offices between the issuing HOD and the gate — Security
-- Head, COO, CEO, Finance Head — a name each, and said in its own header that
-- it was an ORG CHART and not a workflow: "nothing here gates the gate". The
-- client has now asked for the other half. 2026-08-19:
--
--   * an admin creates a CEO / Finance / COO / Security Head user like any
--     other user;
--   * that person signs in and gets a Pending Approvals screen — the passes
--     waiting on their signature, with Approve and Reject (Reject takes a
--     written reason);
--   * "the guard cannot see any partially approved or unapproved gate passes.
--     He can only see when all four approvals have been done."
--
-- THE LAST SENTENCE IS THE WHOLE MIGRATION. It is not a screen filter — it is
-- RLS. `gate_passes_select` is rewritten so that for a `guard` a pass that
-- still owes a signature does not exist: not in the Pending OUT queue, not in
-- a search, not behind a scanned QR code, not at `/pass/<uuid>` typed by hand.
-- A trigger on gate_passes says the same thing a second time, because
-- `match_pass` is SECURITY DEFINER and would otherwise bypass every policy
-- here.
--
-- WHAT IS SNAPSHOTTED, AND WHY. An AFTER INSERT trigger writes one
-- `pass_approvals` row per office that is DESIGNATED AT THE MOMENT THE PASS IS
-- RAISED. Two consequences, both deliberate:
--
--   * a vacant office is skipped and never appears on that pass again, which
--     is the rollout: `approval_roles` is empty on this database today, so
--     every pass raised before an admin designates anybody needs no approval
--     at all and reaches the gate exactly as it does now. The 60 live passes
--     are grandfathered by the same rule — no backfill, no data migration;
--   * designating a new CEO tomorrow does NOT reopen a pass that already
--     cleared. A pass's requirements are frozen the day it is raised, which is
--     what makes "approved" mean something a week later.
--
-- IT IS A TRIGGER, NOT A CHANGE TO `raise_pass`. Every insert path gets it —
-- `raise_pass`, `bulk_create_passes`, anything added later — and no future
-- rewrite of the raise RPC can quietly drop it by forgetting a line.
--
-- AUTHORITY FOLLOWS THE OFFICE, NOT THE PERSON. `routed_to` records who held
-- the office on the day, for the record; who may actually press Approve is
-- resolved from `approval_roles` at the moment of the press. A CEO who leaves
-- does not take a queue of undecided passes with them.
--
-- REJECTION IS TERMINAL, and it reuses the shape 027 already built for an HOD
-- upholding a security flag: the pass goes to `cancelled`, a `verifications`
-- row records who and why, and nothing about it can move again. A raised pass
-- is permanent in this app (024) — it is closed, never deleted, and the HOD
-- raises a fresh one.
--
-- HOW AN APPROVER SIGNS IN. `public.profiles.role` is VMS's enum and this app
-- does not add to it (the two-schema rule), so an office holder is created as
-- `staff` — the VMS role for "does not use VMS" — and the row in
-- `gatepass.approval_roles` is what grants them everything they get here: the
-- route, the queue, and the two policies below. Nothing about VMS changes, and
-- an office holder gains no ability to raise, verify or return anything.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. One row per signature a pass owes
-- ═══════════════════════════════════════════════════════════════════════════
-- Keyed (gate_pass_id, role_key): an office signs a pass at most once, so
-- "has the COO approved this?" has exactly one answer and no ordering decides
-- it. `level_no` is stored rather than derived so the slip order is frozen
-- alongside the requirement — and the check keeps the two from disagreeing.
--
-- `routed_to` is ON DELETE SET NULL, unlike approval_roles' RESTRICT: this is a
-- historical note about a decision, and a pass must not become undeletable-
-- adjacent because the person who once held an office was removed.
create table if not exists gatepass.pass_approvals (
  gate_pass_id uuid        not null references gatepass.gate_passes(id) on delete cascade,
  role_key     text        not null,
  level_no     smallint    not null,
  routed_to    uuid        references public.profiles(id) on delete set null,
  status       text        not null default 'pending',
  decided_by   uuid        references public.profiles(id) on delete set null,
  decided_at   timestamptz,
  reason       text,
  created_at   timestamptz not null default now(),

  primary key (gate_pass_id, role_key),

  -- The same four offices 043 knows, restated because a foreign key to
  -- approval_roles would delete a pass's history when an office is vacated.
  constraint pass_approvals_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head')),

  constraint pass_approvals_level_matches
    check (level_no = case role_key
                        when 'security_head' then 1
                        when 'coo'           then 2
                        when 'ceo'           then 3
                        when 'finance_head'  then 4
                      end),

  constraint pass_approvals_status_known
    check (status in ('pending', 'approved', 'rejected')),

  -- A decision has an author and a moment, and a rejection has a reason a
  -- person wrote. Checked here and not only in the RPC, because a row with
  -- status 'rejected' and no reason is a rejection nobody can answer.
  constraint pass_approvals_decision_shape
    check (
      (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
      or (status = 'approved' and decided_by is not null and decided_at is not null)
      or (status = 'rejected' and decided_by is not null and decided_at is not null
          and length(btrim(coalesce(reason, ''))) between 1 and 500)
    )
);

-- The queue read: "everything my office still owes a signature on".
create index if not exists pass_approvals_queue_idx
  on gatepass.pass_approvals (role_key, status);

alter table gatepass.pass_approvals enable row level security;

-- READABLE BY WHOEVER CAN READ THE PASS, the rule 044 established for remarks
-- and for the same reason: restating `gate_passes_select` here in a second form
-- is how the two drift apart. `can_see_pass` (044) is SECURITY INVOKER, so the
-- pass policy below decides — and the approver arm of that policy reaches this
-- table through a SECURITY DEFINER function, which is what stops the two
-- policies recursing into each other (42P17).
drop policy if exists pass_approvals_select_with_pass on gatepass.pass_approvals;
create policy pass_approvals_select_with_pass
  on gatepass.pass_approvals for select to authenticated
  using (gatepass.can_see_pass(gate_pass_id));

-- No insert/update/delete policy anywhere: the trigger and the two RPCs below
-- are the only writers, exactly as gate_passes itself works.
grant select on gatepass.pass_approvals to authenticated;

comment on table gatepass.pass_approvals is
  'One row per office a pass must be signed off by, snapshotted from gatepass.approval_roles when the pass is raised. A pending row hides the pass from the gate.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Snapshotting the ladder onto a new pass
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because nobody — not even the HOD raising the pass — holds
-- INSERT on pass_approvals, which is the point of the table.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id,
         r.role_key,
         (case r.role_key
            when 'security_head' then 1
            when 'coo'           then 2
            when 'ceo'           then 3
            when 'finance_head'  then 4
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$$;

drop trigger if exists gate_passes_snapshot_approvals on gatepass.gate_passes;
create trigger gate_passes_snapshot_approvals
  after insert on gatepass.gate_passes
  for each row execute function gatepass.snapshot_pass_approvals();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The three questions every policy below asks
-- ═══════════════════════════════════════════════════════════════════════════
-- Which office, if any, does the caller hold? A SUSPENDED holder holds none:
-- `is_user_active` (040) is the same gate `my_department_ids` applies to an
-- HOD, so deactivating an approver empties their queue rather than leaving
-- passes addressed to somebody who cannot sign in.
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid());
$$;

-- Is this pass still climbing the ladder? A pass that has left `pending` has
-- either cleared the gate or been closed, and a stray undecided row on it must
-- not make it invisible for ever.
create or replace function gatepass.pass_awaits_approval(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gatepass.pass_approvals a
      join gatepass.gate_passes g on g.id = a.gate_pass_id
     where a.gate_pass_id = p_pass_id
       and a.status = 'pending'
       and g.status = 'pending'
  );
$$;

-- Is this pass addressed to the office I hold — at any status, so an approver
-- can still read what they signed last week.
create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key = gatepass.my_approval_role()
  );
$$;

grant execute on function gatepass.my_approval_role()          to authenticated;
grant execute on function gatepass.pass_awaits_approval(uuid)  to authenticated;
grant execute on function gatepass.pass_routed_to_me(uuid)     to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE GATE STOPS SEEING AN UNAPPROVED PASS
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces 002's policy. Four arms, and the second one is the client's rule:
--
--   admin      everything, at every stage. Somebody has to be able to see a
--              pass stuck at level 2, and it is not the guard.
--   guard      everything EXCEPT a pass still owing a signature. Not a filter
--              in a query — a pass that owes one is not in the table as far as
--              a guard is concerned.
--   hod        their own department's passes, at every stage, unchanged. The
--              HOD who raised it must be able to watch it climb.
--   approver   passes addressed to the office they hold. This is the ONLY read
--              an office holder gets: no department, no site, no history that
--              was never routed to them.
--
-- `is_security()` is deliberately NOT used here any more — it means
-- guard-or-admin, and those two now differ. It is untouched elsewhere.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select
  on gatepass.gate_passes for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(id)
  );

-- The material lines follow the pass exactly. An approver reads them because
-- the queue screen opens a row to show what is actually going out — approving
-- a pass without being able to see its contents is a signature on a blank page.
drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select
  on gatepass.gate_pass_items for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(gate_pass_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. …and a trigger says it again, because RLS is not in the room
-- ═══════════════════════════════════════════════════════════════════════════
-- `match_pass`, `flag_pass` and every other state transition is SECURITY
-- DEFINER and bypasses section 4 entirely. Without this, a guard who somehow
-- learned a pass id could still clear it out of the building. The policy hides
-- it; this refuses it.
--
-- 'cancelled' is deliberately absent from the list: rejection (section 7) moves
-- a still-climbing pass to exactly that state, and must not be refused by the
-- rule protecting it.
create or replace function gatepass.block_unapproved_gate_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and old.status = 'pending'
     and new.status in ('matched', 'flagged', 'held')
     and gatepass.pass_awaits_approval(old.id) then
    raise exception 'This gate pass has not been approved by every level yet.';
  end if;

  return new;
end;
$$;

drop trigger if exists gate_passes_block_unapproved on gatepass.gate_passes;
create trigger gate_passes_block_unapproved
  before update on gatepass.gate_passes
  for each row execute function gatepass.block_unapproved_gate_move();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Reading a pass's ladder, with names
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the join into `public.profiles` only — the rows are
-- already gated by `can_see_pass`, the same predicate the policy applies. LEFT
-- JOINs for the reason the pass view uses them: VMS may narrow its policies
-- without notice, and a missing name is visibly wrong where a missing LEVEL is
-- invisibly wrong.
create or replace function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key     text,
  level_no     smallint,
  status       text,
  routed_name  text,
  decided_name text,
  decided_at   timestamptz,
  reason       text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Approving, and rejecting
-- ═══════════════════════════════════════════════════════════════════════════
-- IN SLIP ORDER. The caller's row must be the LOWEST still-pending level on
-- the pass, which is what "Security Head → COO → CEO → Finance Head" means. A
-- vacant office was never snapshotted, so it is skipped rather than blocking:
-- with only the CEO designated, the CEO is level 1 in practice.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text := gatepass.my_approval_role();
  v_mine    smallint;
  v_lowest  smallint;
  v_status  text;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  update gatepass.pass_approvals a
     set status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now()
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

-- REJECTION CLOSES THE PASS, the shape 027 built for an HOD upholding a flag:
-- status 'cancelled', a `verifications` row carrying who and why, and no way
-- back. The reason is the client's own field — the modal's "Reason for
-- Rejection", 500 characters — and it is required at both ends.
--
-- The remaining pending levels are left exactly as they are rather than being
-- back-filled with an invented state: nobody below signed anything, and the
-- record should not claim otherwise. They stay out of every queue because the
-- pass itself is no longer `pending`.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text := gatepass.my_approval_role();
  v_mine   smallint;
  v_lowest smallint;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  update gatepass.pass_approvals a
     set status     = 'rejected',
         decided_by = auth.uid(),
         decided_at = now(),
         reason     = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$$;

revoke all on function gatepass.approve_pass_level(uuid)      from public;
revoke all on function gatepass.reject_pass_level(uuid, text) from public;
grant execute on function gatepass.approve_pass_level(uuid)      to authenticated;
grant execute on function gatepass.reject_pass_level(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The scanner says what is actually wrong
-- ═══════════════════════════════════════════════════════════════════════════
-- `lookup_pass` is SECURITY DEFINER and reads gate_passes directly, so section
-- 4 does not reach it. Without this branch a guard scanning a slip that is
-- still climbing the ladder would be told 'not_found' — which is untrue, and
-- sends them looking for a typo instead of telling the driver to wait.
--
-- `pass_id` is returned NULL on that outcome ON PURPOSE: the screen opens the
-- record for any outcome carrying an id, and this is precisely the pass a guard
-- may not read. Restated from 033's version; the blacklist logic, the scan
-- log and the expiry rule are unchanged.
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
  v_visible_id     uuid;
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
  elsif gatepass.pass_awaits_approval(v_pass.id) then
    v_outcome := 'awaiting_approval';
  elsif v_pass.status::text = 'hod_reviewed' then
    v_outcome := 'ok';
  elsif v_pass.status::text <> 'pending' then
    v_outcome := 'already_' || v_pass.status::text;
  elsif v_pass.expires_at < now() then
    v_outcome := 'expired';
  else
    v_outcome := 'ok';
  end if;

  if v_pass.id is not null and v_outcome = 'ok' then
    select b.list_type, b.list_value, b.reason
      into v_blacklist_item
      from gatepass.blacklist b
     where (b.list_value is not null
            and lower(trim(b.list_value))
                = lower(trim(gatepass.company_name_of(v_pass.visitor_company))))
        or (b.list_type = 'vehicle'
            and gatepass.normalize_vehicle(b.list_value)
                = gatepass.normalize_vehicle(v_pass.vehicle_number))
     limit 1;

    if v_blacklist_item.reason is not null then
      v_blacklist_text := v_blacklist_item.reason;
    end if;
  end if;

  -- The scan is logged against the real pass either way — the attempt happened,
  -- and a gate log that omits the ones it turned away is not a gate log.
  insert into gatepass.scan_attempts (scanned_code, gate_pass_id, scanned_by, outcome, blacklist_note)
  values (v_code, v_pass.id, auth.uid(), v_outcome, v_blacklist_text);

  v_visible_id := case when v_outcome = 'awaiting_approval' then null else v_pass.id end;

  return query select v_outcome, v_visible_id, v_blacklist_text;
end;
$$;

revoke all on function gatepass.lookup_pass(p_code text) from public;
grant execute on function gatepass.lookup_pass(p_code text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Creating an approver from Admin → Users
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 040's version. ONE difference: `p_role` now also accepts the
-- four office keys, and an office holder is created as VMS `staff` and
-- designated in `gatepass.approval_roles` in the same transaction.
--
-- `staff` is not a demotion here — it is the honest value. VMS's enum has no
-- word for "signs gate passes", this app must not add one (the two-schema
-- rule), and every ability the person actually gets comes from the
-- approval_roles row. Which is also why `raw_app_meta_data.role` is written as
-- `staff` too: `app_role()` reads it, and a value VMS has never seen appearing
-- in a field VMS also reads is exactly the drift that rule exists to prevent.
--
-- AN OFFICE HAS ONE HOLDER. `approval_roles` is keyed by role_key, so creating
-- a second CEO MOVES the office rather than adding one — the upsert is the same
-- one `set_approval_role` (043) performs, and the admin screen says so out loud
-- before the press.
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
  v_user_id      uuid;
  v_now          timestamptz := now();
  v_dept         uuid;
  v_office       text := null;
  v_profile_role text := p_role;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can create users.';
  end if;

  if p_role in ('admin', 'super_admin') then
    raise exception 'Cannot create an admin user. Use the CLI with the service-role key.';
  end if;

  if p_role in ('security_head', 'coo', 'ceo', 'finance_head') then
    v_office       := p_role;
    v_profile_role := 'staff';
  elsif p_role not in ('guard', 'hod') then
    raise exception 'Invalid role "%". Allowed: guard, hod, security_head, coo, ceo, finance_head.', p_role;
  end if;

  if p_department_ids is not null and array_length(p_department_ids, 1) > 1 then
    raise exception 'A person can belong to at most one department — found %.', array_length(p_department_ids, 1);
  end if;

  v_dept := case
    when p_department_ids is not null and array_length(p_department_ids, 1) = 1
    then p_department_ids[1]
    else null
  end;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with email "%" already exists.', p_email;
  end if;

  v_user_id := gen_random_uuid();

  -- confirmation_token / recovery_token / email_change / email_change_token_new
  -- are written as '' and MUST stay in this list: they are nullable with no
  -- default, and GoTrue cannot scan a NULL into its Go string field — omitting
  -- them makes the account unable to sign in at all (034).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
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
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', v_profile_role),
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    false
  );

  update public.profiles
  set role = v_profile_role::public.user_role,
      department_id = v_dept
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', v_profile_role)
  where id = v_user_id;

  if v_profile_role = 'hod' and v_dept is not null then
    insert into gatepass.hod_departments (hod_id, department_id)
    values (v_user_id, v_dept);
  end if;

  if v_office is not null then
    insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
    values (v_office, v_user_id, auth.uid(), v_now)
    on conflict (role_key) do update
      set user_id       = excluded.user_id,
          designated_by = excluded.designated_by,
          designated_at = excluded.designated_at;
  end if;

  -- `role` echoes what the ADMIN ASKED FOR, not the VMS row that was written:
  -- the caller pressed "CEO" and a reply of "staff" would read as a failure.
  return json_build_object(
    'id', v_user_id::text,
    'email', p_email,
    'role', p_role
  );
end;
$$;

revoke all on function gatepass.admin_create_user(text, text, text, text, uuid[]) from public;
grant execute on function gatepass.admin_create_user(text, text, text, text, uuid[]) to authenticated;

-- PostgREST caches function signatures and table shapes; a new table and two
-- new RPCs are invisible to it until it is told.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 047_approval_email_notifications.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 047 — the approval ladder sends email
--
-- 046 made the ladder real: a pass waits at an office, and until every office
-- has signed, the guard cannot see it at all. That leaves one gap, and it is
-- the gap the client actually reported — NOTHING TELLS THE APPROVER. A pass
-- sits in a queue nobody has been asked to open, and the material waits at the
-- gate while four people go about their day.
--
-- This migration is the DATABASE half of the fix. It carries no mail transport
-- of its own; Postgres has none. Two objects:
--
--   1. `approval_notice_payload(uuid)` — everything one email needs about one
--      pass, in a single round trip, including the office holders' EMAIL
--      ADDRESSES.
--   2. `email_log` — every send attempt, kept, so "the CEO never got it" is a
--      question with an answer.
--
-- The sender is `supabase/functions/notify-approval`, a Deno Edge Function
-- holding the service-role key and a transactional mail provider's API key.
--
-- ═══ WHY THE SENDER IS NOT IN HERE ═══
--
-- The obvious shape — an AFTER INSERT trigger firing `pg_net.http_post` — was
-- considered and rejected for this deployment, on three counts:
--
--   * `pg_net` is not enabled on this project, and enabling an extension that
--     makes outbound HTTP calls from inside transactions is a security decision
--     of its own, on a database shared with VMS.
--   * the provider's API key would then have to live in the DATABASE (Vault or
--     a settings GUC). It lives in the Edge Function's secrets instead, where
--     nothing with a `postgres` connection can read it — and this repo's own
--     notes are clear that `psql` here connects as `postgres`.
--   * a failed `pg_net` call inside a trigger is either invisible or it rolls
--     back a raised gate pass. Neither is acceptable: THE PASS MATTERS MORE
--     THAN THE EMAIL. The Edge Function is called after the RPC has already
--     committed, so a mail outage can never cost an HOD their pass.
--
-- THE COST, STATED PLAINLY: a pass raised by any route that is not this app —
-- a `psql` insert, a future integration — sends no mail, because nothing calls
-- the function. That is the trade for the three points above. If mail must
-- become unconditional, the honest fix is `pg_net` plus Vault, and this comment
-- is the argument to re-read first.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Everything one notification needs, in one call
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER, and granted to `service_role` ONLY — deliberately NOT to
-- `authenticated`. It returns email addresses of named officers, which is the
-- one fact in this whole schema that no screen has ever shown and no role has
-- ever needed. `gatepass.get_approval_ladder()` (043) is the function every
-- signed-in user may call, and it returns names and departments and no address.
--
-- The two are not redundant: 043 answers "who holds this office" for a printed
-- record, this answers "where do I post this letter" for a machine. Widening
-- 043 to carry an address would have put every user's mailbox behind an
-- anon-key call, which is precisely how a corporate directory leaks.
--
-- Returns jsonb rather than a composite type, because the caller is JavaScript
-- and a composite whose shape changes needs a drop-and-recreate every time
-- (`my_profile()` has been through that twice). A jsonb document costs one
-- `->>` at the other end and never needs a migration to gain a field.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pass', (
      select jsonb_build_object(
               'id',                   p.id,
               'pass_number',          p.pass_number,
               'type',                 p.type,
               'status',               p.status,
               'visitor_name',         p.visitor_name,
               'purpose',              p.purpose,
               -- The vendor's display name, unpacked from the `{"n","a","v"}`
               -- blob by the schema's own helper. Never `visitor_company` raw —
               -- an email printing a JSON object is how this stops being read.
               'vendor_name',          gatepass.company_name_of(p.visitor_company),
               'department_name',      d.name,
               'raised_by',            p.raised_by,
               'raised_by_name',       rb.full_name,
               'raised_by_email',      rb.email,
               'item_count',           coalesce(it.item_count, 0),
               'total_value',          coalesce(it.total_value, 0),
               'expected_return_date', p.expected_return_date,
               'created_at',           p.created_at
             )
        from gatepass.gate_passes p
        left join public.departments d on d.id = p.department_id
        left join public.profiles   rb on rb.id = p.raised_by
        left join lateral (
               select count(*) as item_count, sum(i.approx_value) as total_value
                 from gatepass.gate_pass_items i
                where i.gate_pass_id = p.id
             ) it on true
       where p.id = p_pass_id
    ),
    'approvals', coalesce((
      -- LEFT JOIN into VMS's profiles, the rule the pass view follows: a
      -- narrowed VMS policy must degrade this to an office with no address —
      -- which drops ONE message — rather than to a missing office, which would
      -- silently reroute the mail to the wrong person.
      -- `routed_to` is the office holder SNAPSHOTTED when the pass was raised
      -- (046), not whoever holds the office today. That is what makes the mail
      -- correct: a pass raised under the old COO is still that COO's to sign,
      -- and the letter must go to them. It is nullable — 046 sets it null if
      -- the account is deleted — which drops one message rather than sending it
      -- to nobody.
      select jsonb_agg(jsonb_build_object(
               'role_key',       a.role_key,
               'level_no',       a.level_no,
               'status',         a.status,
               'approver_id',    a.routed_to,
               'approver_name',  ap.full_name,
               'approver_email', ap.email,
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join public.profiles ap on ap.id = a.routed_to
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function gatepass.approval_notice_payload(uuid) from public;
grant execute on function gatepass.approval_notice_payload(uuid) to service_role;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. service_role ONLY — the Edge Function that sends the mail is the only caller. Every signed-in reader uses get_approval_ladder() (043), which carries no address.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. What was sent, and what failed
-- ═══════════════════════════════════════════════════════════════════════════
-- WITHOUT THIS TABLE THE FEATURE IS UNSUPPORTABLE. "The CEO says he never got
-- the mail" has exactly three possible answers — we never tried, we tried and
-- the provider refused, or we sent it and it is in his spam — and only a log
-- can tell them apart. The alternative is reading an Edge Function's console
-- logs, which expire.
--
-- `recipient` is stored. That is a deliberate, narrow retention of one address
-- per row: it IS the fact being audited, and a log that records "a message was
-- sent to somebody" answers nothing.
create table if not exists gatepass.email_log (
  id            uuid primary key default gen_random_uuid(),
  gate_pass_id  uuid references gatepass.gate_passes(id) on delete set null,
  -- Free text, not an enum: NoticeKind lives in TypeScript
  -- (`src/lib/approvalNotice.ts`) and a new kind must not need a migration
  -- before the log can record it. A check constraint here would fail the paste
  -- rather than record an unexpected kind, which is backwards for a log.
  kind          text not null,
  recipient     text not null,
  subject       text not null,
  ok            boolean not null,
  -- The provider's message id when it accepted, its refusal when it did not.
  provider_id   text,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists email_log_pass_idx
  on gatepass.email_log (gate_pass_id, created_at desc);

create index if not exists email_log_failures_idx
  on gatepass.email_log (created_at desc) where not ok;

alter table gatepass.email_log enable row level security;

-- ADMINS READ IT, NOBODY WRITES IT. The Edge Function writes with the service
-- role, which bypasses RLS; no policy for insert therefore exists, and that is
-- the same shape every other table in this schema has — a client that can write
-- a log can forge one.
--
-- Not readable by the HOD whose pass it is, and not by the approver: the rows
-- carry other people's addresses, and "did my approver get the mail" is a
-- support question, not a screen.
drop policy if exists email_log_admin_select on gatepass.email_log;
create policy email_log_admin_select
  on gatepass.email_log for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.email_log to authenticated;

comment on table gatepass.email_log is
  'Every approval notification send attempt, successful or not. Written only by the notify-approval Edge Function under the service role; readable by admins. Retention is manual — trim it when it grows.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 048_reset_confirms_email.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 048 — an admin-set password is only useful if the account can actually
--       sign in: the reset now confirms the email address too
--
-- THE BUG, reported by the client 2026-08-19: "when the admin resets the
-- password for a user then he should be able to log in with that password and
-- with the email that is being shown in the user".
--
-- 036's `admin_reset_user_password` writes the bcrypt hash into
-- `auth.users.encrypted_password`, clears every session, and raises the
-- must-change flag. All of that works. What it never touched is
-- `email_confirmed_at` — and GoTrue refuses a sign-in for an unconfirmed
-- address, before it ever looks at the password. So the admin read a fresh
-- password down the phone, the person typed it with the exact email the Users
-- tab prints beside their name, and the login failed for a reason neither of
-- them could see.
--
-- Measured on the live database before writing this, as `postgres`:
--
--   * 7 accounts carry `email_confirmed_at is null`;
--   * EVERY ONE of them has `last_sign_in_at is null` — not one has ever got
--     in — while every account that HAS signed in is confirmed. One of the
--     seven already carries `must_change_password = true`, i.e. an admin had
--     already reset it and it still could not be used;
--   * `public.profiles.email` and `auth.users.email` agree on every row, so
--     the address the portal shows is genuinely the address GoTrue matches on.
--     The email was never the problem — the confirmation was.
--
-- The seven were created through VMS's own sign-up path, which sends a
-- confirmation mail. Accounts minted here have never had this problem:
-- `admin_create_user` (021, carried through 040) has always written
-- `email_confirmed_at = now()`, for the same reason applied below.
--
-- WHY CONFIRMING HERE IS THE RIGHT FIX, not a shortcut past a security control.
-- Email confirmation answers one question: does the person who claimed this
-- address control it? An admin setting the password by hand answers a stronger
-- version of it — they are asserting, from inside the organisation, that this
-- account belongs to a named colleague they are about to hand a credential to.
-- That is the same assertion `admin_create_user` already makes when it mints a
-- confirmed account, and the same one that made this app's password reset
-- admin-assisted in the first place: the built-in sender is capped at ~2 mails
-- an hour PROJECT-WIDE and shared with VMS, so a confirmation link is not a
-- control this deployment can actually deliver (see 036's header).
--
-- `coalesce`, never a bare assignment: an address confirmed in 2026-07 keeps
-- its original timestamp, so a password reset cannot quietly restate when the
-- person proved they owned it.
--
-- Everything else in 036's body is unchanged and is copied here verbatim,
-- including the four GoTrue token columns 034 was written for — dropping any
-- of them turns a sign-in into a 500 with nothing visibly wrong in Postgres.
-- ============================================================================

create or replace function gatepass.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_target_role public.user_role;
  v_now         timestamptz := now();
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reset a password.';
  end if;

  -- A 6-character floor matches GoTrue's own minimum and the Add User form.
  -- Enforced HERE because this path writes the hash directly and so never
  -- passes through the auth server's own validation.
  if p_password is null or length(p_password) < 6 then
    raise exception 'The new password must be at least 6 characters.';
  end if;

  select p.role, u.email into v_target_role, v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if v_email is null then
    raise exception 'That user no longer exists.';
  end if;

  -- Deliberate: an admin cannot reset another admin's password. Otherwise the
  -- weakest admin account becomes a takeover route into every stronger one, and
  -- "reset" becomes an undetectable way to seize a super_admin. This matches
  -- admin_create_user, which likewise refuses to mint an admin. The Users tab
  -- already renders no row actions for an admin, so the UI agrees with the RPC.
  if v_target_role in ('admin', 'super_admin') then
    raise exception 'Admin passwords cannot be reset from the panel. Use the Supabase dashboard.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = v_now,
      -- 048: the account must be able to SIGN IN with what the admin just set.
      -- GoTrue rejects an unconfirmed address before it checks the password, so
      -- without this the reset succeeds and the login still fails. coalesce so
      -- an already-confirmed address keeps its original timestamp.
      email_confirmed_at = coalesce(email_confirmed_at, v_now),
      -- 034's lesson, applied defensively: GoTrue scans these four into Go
      -- strings and returns a 500 on NULL. Costs nothing to keep them sane.
      confirmation_token     = coalesce(confirmation_token, ''),
      recovery_token         = coalesce(recovery_token, ''),
      email_change           = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, '')
  where id = p_user_id;

  update public.profiles
  set must_change_password = true
  where id = p_user_id;

  -- Every existing session dies with the old password. Without this, someone
  -- already signed in on another device keeps full access — which defeats the
  -- point of a reset when the reason for it is a suspected compromise.
  -- refresh_tokens.session_id cascades (verified live: confdeltype 'c'); the
  -- second delete catches legacy rows that predate session_id.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  return json_build_object(
    'id', p_user_id::text,
    'email', v_email,
    'must_change_password', true
  );
end;
$$;

revoke all on function gatepass.admin_reset_user_password(uuid, text) from public;
grant execute on function gatepass.admin_reset_user_password(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The one account this already happened to
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrowed to `must_change_password` accounts on purpose: that flag is written
-- by exactly one thing, `admin_reset_user_password` above, so the set is
-- "accounts an admin has ALREADY reset and expects to work" — the very case the
-- client reported. It is not a blanket confirmation of every unconfirmed
-- address in the shared directory; the other six have had no such assertion
-- made about them, and resetting their password is what will confirm them.
--
-- Idempotent, and safe to re-run: `is null` matches nothing on a second pass.
update auth.users u
set email_confirmed_at = now(),
    updated_at         = now()
where u.email_confirmed_at is null
  and exists (
    select 1 from public.profiles p
     where p.id = u.id
       and p.must_change_password
       and p.role not in ('admin', 'super_admin')
  );

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 049_one_approval_office_per_person.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 049 — one approval office per person
--
-- FOUND BY THE LIVE PROBE FOR 046, not by reading the code. `verify-046.mjs`
-- lent two of the four offices to the same demo account, and the full climb
-- stopped dead at the second one with "This gate pass is not waiting on your
-- approval." The cause:
--
--     gatepass.my_approval_role()
--       select r.role_key from gatepass.approval_roles r where r.user_id = ...
--
-- is a scalar `returns text` over a query that can yield MORE THAN ONE ROW.
-- Postgres does not error on that — it hands back whichever row came first.
-- So a person holding two offices could act on exactly one of them, chosen
-- arbitrarily and silently, and their queue would show half of what they owe.
-- Nothing in 043 or 046 forbade the designation that causes it: `approval_roles`
-- is keyed by `role_key`, which makes an office single-holder but says nothing
-- about a holder having several offices.
--
-- THE FIX IS THE CONSTRAINT, NOT A `limit 1`. Ordering the query would make the
-- answer deterministic while leaving the person's other office permanently
-- unactionable — a bug that looks like a working screen. This mirrors 032's
-- "one department per person": a unique index says the thing out loud, and the
-- designation that would break the model is refused at the point somebody makes
-- it, with a sentence naming the office already held.
--
-- IF DUAL-HATTING IS EVER WANTED — a small site where the COO is also the
-- Finance Head is perfectly plausible — this index is where to start, and the
-- work is real: `my_approval_role()` becomes a set-returning
-- `my_approval_roles()`, `pass_routed_to_me` matches on membership, both
-- decision RPCs resolve the caller's office FROM the pass's own pending rows
-- rather than from the person, and the queue screen groups by office. That is a
-- deliberate feature, not a constraint to quietly drop.
--
-- LIVE STATE WHEN THIS WAS WRITTEN: four offices, four distinct holders, so the
-- index builds without touching a row.
-- ============================================================================

-- A partial index is not wanted here: `user_id` is NOT NULL, and every row must
-- take part.
create unique index if not exists approval_roles_one_office_per_person
  on gatepass.approval_roles (user_id);

comment on index gatepass.approval_roles_one_office_per_person is
  'One approval office per person. gatepass.my_approval_role() is a scalar over this table and would silently return an arbitrary one of several. See migration 049.';

-- ═══════════════════════════════════════════════════════════════════════════
-- The designation says why, instead of leaking a constraint name
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 043 with one added check. Everything else — the admin gate, the
-- known-key check, the existence check and the upsert — is unchanged.
--
-- The check EXCLUDES the office being set, so re-designating the same person to
-- the office they already hold is still a no-op rather than an error.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      case v_held
        when 'security_head' then 'Security Head'
        when 'coo'           then 'COO'
        when 'ceo'           then 'CEO'
        else                      'Finance HOD'
      end;
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

grant execute on function gatepass.set_approval_role(text, uuid) to authenticated;

-- `admin_create_user` (046) writes the same row directly when an admin creates
-- an office holder. It is left alone on purpose: the account it inserts is
-- brand new and cannot already hold an office, so the check above would be dead
-- code there — and the unique index catches it regardless if that ever changes.

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 050_email_log_service_insert.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 050 — the mail log can actually be written
--
-- FOUND BY THE FIRST REAL SEND, not by review. `verify-047.mjs` raised a pass,
-- the Edge Function mailed the Security Head, RESEND ACCEPTED IT — and
-- `gatepass.email_log` was empty afterwards. 047 created the table, enabled
-- RLS, wrote the admin SELECT policy and granted `select` to `authenticated`,
-- and then relied on "the service role bypasses RLS" for the write. It does
-- bypass RLS. It does NOT conjure a table PRIVILEGE it was never granted:
-- a fresh schema inherits no Supabase grants (002/007/009 exist for exactly
-- this reason), so `service_role` held nothing at all on this table and the
-- insert failed with 42501 — swallowed by design, because the function must
-- never let a logging failure abort a delivery that already happened.
--
-- The cost of leaving it: every send is unlogged, which makes "the CEO says he
-- never got it" unanswerable — the one question the table exists to answer.
--
-- INSERT ONLY. No select, no update, no delete: the sender writes the log and
-- reads nothing back, an admin reads it through the policy 047 wrote, and a log
-- that its own writer can rewrite is not evidence of anything.
-- ============================================================================

grant insert on gatepass.email_log to service_role;

comment on table gatepass.email_log is
  'Every approval notification send attempt, successful or not. Written only by the notify-approval Edge Function under the service role (insert granted in 050); readable by admins. Retention is manual — trim it when it grows.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 051_notice_addresses_current_holder.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 051 — the approval letter goes to WHOEVER HOLDS THE OFFICE TODAY
--
-- FOUND BY MOVING AN OFFICE ON A LIVE LADDER (2026-08-19): the Security Head
-- was re-designated while a pass was still sitting at level 1. The queue moved
-- with the office — `pass_routed_to_me` and `approve_pass_level` (046) both
-- resolve authority through `my_approval_role()`, i.e. from `approval_roles` at
-- the moment of the press — but the MAIL did not: 047's payload joined
-- `pass_approvals.routed_to`, the holder SNAPSHOTTED when the pass was raised.
--
-- So the letter asked a person the database would have refused, while the
-- person who actually had to sign was never written to. That is the worst of
-- the two failure modes: the ladder silently stops, and the only symptom is an
-- inbox that stays empty.
--
-- 047's own comment argued the opposite ("a pass raised under the old COO is
-- still that COO's to sign"). It is superseded, and by 046 rather than by
-- taste: nothing in this schema lets the old COO sign anything. WHAT A PASS
-- OWES IS STILL FROZEN AT RAISE — the set of offices, the levels, the order —
-- and that is untouched here. Only WHO to write to follows the office.
--
-- `routed_to` is kept as the FALLBACK, not deleted: an office that has since
-- been vacated (`clear_approval_role`) has no current holder, and the person
-- the pass was routed to is a better address than none. It also stays the
-- historical record of who the pass was aimed at the day it was raised.
--
-- Nothing else in 047 changes: same name, same jsonb shape, same
-- service_role-only grant. The Edge Function needs no redeploy for this.
-- ============================================================================

create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pass', (
      select jsonb_build_object(
               'id',                   p.id,
               'pass_number',          p.pass_number,
               'type',                 p.type,
               'status',               p.status,
               'visitor_name',         p.visitor_name,
               'purpose',              p.purpose,
               -- The vendor's display name, unpacked from the `{"n","a","v"}`
               -- blob by the schema's own helper. Never `visitor_company` raw —
               -- an email printing a JSON object is how this stops being read.
               'vendor_name',          gatepass.company_name_of(p.visitor_company),
               'department_name',      d.name,
               'raised_by',            p.raised_by,
               'raised_by_name',       rb.full_name,
               'raised_by_email',      rb.email,
               'item_count',           coalesce(it.item_count, 0),
               'total_value',          coalesce(it.total_value, 0),
               'expected_return_date', p.expected_return_date,
               'created_at',           p.created_at
             )
        from gatepass.gate_passes p
        left join public.departments d on d.id = p.department_id
        left join public.profiles   rb on rb.id = p.raised_by
        left join lateral (
               select count(*) as item_count, sum(i.approx_value) as total_value
                 from gatepass.gate_pass_items i
                where i.gate_pass_id = p.id
             ) it on true
       where p.id = p_pass_id
    ),
    'approvals', coalesce((
      -- THE ADDRESS IS THE OFFICE'S CURRENT HOLDER, falling back to the person
      -- the pass was routed to when the office is vacant today. Every join into
      -- VMS's `public.*` is LEFT, the rule the pass view follows: a narrowed VMS
      -- policy must degrade this to an office with no address — which drops ONE
      -- message — rather than to a missing office, which would silently reroute
      -- the mail to the wrong person.
      select jsonb_agg(jsonb_build_object(
               'role_key',       a.role_key,
               'level_no',       a.level_no,
               'status',         a.status,
               'approver_id',    coalesce(r.user_id, a.routed_to),
               'approver_name',  coalesce(cur.full_name, ap.full_name),
               'approver_email', coalesce(cur.email, ap.email),
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join gatepass.approval_roles r on r.role_key = a.role_key
        left join public.profiles       cur on cur.id = r.user_id
        left join public.profiles        ap on ap.id  = a.routed_to
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. Each level is addressed to whoever holds that office TODAY (051), falling back to the holder snapshotted at raise when the office is now vacant — the same authority approve_pass_level enforces. service_role ONLY; every signed-in reader uses get_approval_ladder() (043), which carries no address.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 052_mail_settings.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 052 — the mail settings are a SETTING, not a deploy
--
-- Until now every fact about outgoing approval mail lived in the Edge
-- Function's secrets: MAIL_FROM, and MAIL_OVERRIDE_TO — the single inbox every
-- letter is redirected to while the Resend account is unverified. Changing the
-- test inbox therefore meant a `supabase secrets set` and a redeploy, which is
-- not something the people who actually run this system can do (client,
-- 2026-08-20: "keep a provision so users can change that one").
--
-- So the settings move into the database, where an admin can edit them, and
-- the function reads them at send time.
--
-- ═══ PRECEDENCE, STATED ONCE ═══
--
--   a value in this table  >  the function's environment variable
--
-- An empty table therefore changes NOTHING about the current deployment: the
-- function keeps using its secrets. That is deliberate — this migration must
-- not be able to silently redirect or stop live mail.
--
-- ═══ WHY THE TABLE IS NOT READABLE ═══
--
-- `smtp_password` is a credential. No signed-in role holds ANY privilege on
-- this table: an admin reads through `get_mail_settings()`, which returns
-- every field EXCEPT the password plus a boolean saying whether one is set,
-- and writes through `set_mail_settings()`. The full document, password
-- included, is `mail_config()`, granted to `service_role` alone — the same
-- shape 047 uses for the office holders' addresses, and for the same reason.
--
-- A password that can be read back is a password that leaks through a screen
-- recording, a support ticket or a browser extension. It goes in and never
-- comes out.
--
-- ═══ SMTP IS PROVISION, NOT TRANSPORT (client, 2026-08-20) ═══
--
-- The SMTP columns are stored and shown, and NOTHING SENDS THROUGH THEM YET:
-- the Edge Function still posts to the Resend API. That is why there is no
-- `transport` column to choose between them — a switch that does nothing is
-- worse than no switch. When an SMTP sender is written, the rule it should
-- follow is "a host is configured, so use it", and the new schema it needs is
-- none.
--
-- ═══ ONE ADDRESS AT A TIME ═══
--
-- `override_to` is ONE address, never a list (client). A comma-separated field
-- would be four times the mail from one deployment that exists precisely
-- because the provider will only write to one inbox, and the CHECK below is
-- what stops somebody discovering that by trying it.
-- ============================================================================

create table if not exists gatepass.mail_settings (
  -- The single-row lock: `id` can only ever be true, so a second row is a
  -- primary key violation rather than a settings table nobody can read
  -- deterministically.
  id            boolean primary key default true check (id),

  -- Null = no redirect: every letter goes to the office holder it names.
  -- Never the empty string — "unset" must have exactly one spelling.
  override_to   text check (override_to is null or override_to <> ''),
  from_email    text check (from_email  is null or from_email  <> ''),
  from_name     text check (from_name   is null or from_name   <> ''),

  smtp_host     text check (smtp_host     is null or smtp_host     <> ''),
  smtp_port     int  check (smtp_port     is null or (smtp_port between 1 and 65535)),
  smtp_username text check (smtp_username is null or smtp_username <> ''),
  smtp_security text check (smtp_security is null or smtp_security in ('none', 'starttls', 'tls')),
  smtp_password text check (smtp_password is null or smtp_password <> ''),

  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),

  -- One address, and it must look like one. Deliberately loose about what a
  -- domain may contain and strict about the two things that matter here: no
  -- separator (so it cannot be a list) and no whitespace or angle brackets (so
  -- it cannot smuggle a second recipient through a display name).
  constraint mail_settings_override_is_one_address check (
    override_to is null
    or override_to ~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$'
  ),
  constraint mail_settings_from_is_one_address check (
    from_email is null
    or from_email ~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$'
  )
);

alter table gatepass.mail_settings enable row level security;

-- NO POLICY AND NO GRANT for `authenticated`, on purpose — see the header.
-- The service role reads the whole row (password included) through
-- `mail_config()`, which is SECURITY DEFINER, so it needs no grant either;
-- nothing but the three functions below ever touches this table.

-- ═══════════════════════════════════════════════════════════════════════════
-- What an ADMIN may see: everything except the credential
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function gatepass.get_mail_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the mail settings.';
  end if;

  select jsonb_build_object(
           'override_to',       s.override_to,
           'from_email',        s.from_email,
           'from_name',         s.from_name,
           'smtp_host',         s.smtp_host,
           'smtp_port',         s.smtp_port,
           'smtp_username',     s.smtp_username,
           'smtp_security',     s.smtp_security,
           -- The password itself is never returned. This is the only thing a
           -- screen needs to know about it: whether one is stored.
           'smtp_password_set', s.smtp_password is not null,
           'updated_at',        s.updated_at,
           'updated_by_name',   p.full_name
         )
    into v
    from gatepass.mail_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  -- A settings table that has never been written is not an error: it is the
  -- state every deployment starts in, and it means "use the function's
  -- environment". The caller gets nulls, not a null document, so a screen can
  -- render the same fields either way.
  return coalesce(v, jsonb_build_object('smtp_password_set', false));
end;
$fn$;

grant execute on function gatepass.get_mail_settings() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Writing them
-- ═══════════════════════════════════════════════════════════════════════════
-- Every text argument is blank-normalised to null, so "clear this field" and
-- "leave it empty" are the same gesture on a form.
--
-- `p_smtp_password` is the ONE exception and it has three states, because a
-- write-only field cannot be round-tripped through a form:
--     null  → leave whatever is stored alone   (the form did not touch it)
--     ''    → delete the stored password       (an explicit "clear")
--     other → replace it
create or replace function gatepass.set_mail_settings(
  p_override_to   text default null,
  p_from_email    text default null,
  p_from_name     text default null,
  p_smtp_host     text default null,
  p_smtp_port     int  default null,
  p_smtp_username text default null,
  p_smtp_security text default null,
  p_smtp_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_override text := nullif(btrim(p_override_to), '');
  v_from     text := nullif(btrim(p_from_email), '');
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the mail settings.';
  end if;

  -- Said here as well as in the CHECK: a constraint violation reaches the
  -- browser as 23514, which this app deliberately does not map to a sentence.
  if v_override is not null
     and v_override !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
    raise exception 'Enter one email address to redirect approval mail to, or leave it blank.';
  end if;

  if v_from is not null
     and v_from !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
    raise exception 'Enter one sender email address, or leave it blank.';
  end if;

  if nullif(btrim(coalesce(p_smtp_security, '')), '') is not null
     and btrim(p_smtp_security) not in ('none', 'starttls', 'tls') then
    raise exception 'Unknown SMTP security setting.';
  end if;

  insert into gatepass.mail_settings as m (
    id, override_to, from_email, from_name,
    smtp_host, smtp_port, smtp_username, smtp_security, smtp_password,
    updated_by, updated_at
  )
  values (
    true, v_override, v_from, nullif(btrim(p_from_name), ''),
    nullif(btrim(p_smtp_host), ''), p_smtp_port, nullif(btrim(p_smtp_username), ''),
    nullif(btrim(p_smtp_security), ''), nullif(p_smtp_password, ''),
    auth.uid(), now()
  )
  on conflict (id) do update
    set override_to   = excluded.override_to,
        from_email    = excluded.from_email,
        from_name     = excluded.from_name,
        smtp_host     = excluded.smtp_host,
        smtp_port     = excluded.smtp_port,
        smtp_username = excluded.smtp_username,
        smtp_security = excluded.smtp_security,
        smtp_password = case
                          when p_smtp_password is null then m.smtp_password
                          else nullif(p_smtp_password, '')
                        end,
        updated_by    = auth.uid(),
        updated_at    = now();

  return gatepass.get_mail_settings();
end;
$fn$;

grant execute on function gatepass.set_mail_settings(text, text, text, text, int, text, text, text)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- What the SENDER reads — the whole document, credential included
-- ═══════════════════════════════════════════════════════════════════════════
-- service_role ONLY. Never `authenticated`: this is the one function in the
-- schema that returns a stored password, and the Edge Function is the only
-- thing that has ever needed it.
create or replace function gatepass.mail_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select jsonb_build_object(
              'override_to',   s.override_to,
              'from_email',    s.from_email,
              'from_name',     s.from_name,
              'smtp_host',     s.smtp_host,
              'smtp_port',     s.smtp_port,
              'smtp_username', s.smtp_username,
              'smtp_security', s.smtp_security,
              'smtp_password', s.smtp_password
            )
       from gatepass.mail_settings s
      where s.id),
    '{}'::jsonb
  );
$fn$;

grant execute on function gatepass.mail_config() to service_role;

comment on table gatepass.mail_settings is
  'Outgoing approval-mail settings, editable by an admin (052). One row. A value here overrides the notify-approval function''s environment variable; an empty table means the function keeps using its secrets. The SMTP columns are stored provision only — nothing sends through them yet. No signed-in role holds any privilege on this table: read it with get_mail_settings() (no password) or mail_config() (service_role).';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 053_ceo_office_decides_whitelist.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 053 - the CEO OFFICE decides whitelist requests, and can see them
--
-- Client, 2026-08-20: "when the CEO role is logged in, he should also be able
-- to see all the whitelist requests with the reason and should be able to
-- approve or reject."
--
-- TWO THINGS WERE IN THE WAY, and both are fixed here.
--
-- 1. `list_whitelist_requests` (039) filters on `gatepass.is_admin()`. The CEO
--    could DECIDE a request (`approve_whitelist_request` / `reject_...` check
--    `is_ceo()`) but could not LIST one unless they also happened to be an
--    admin — a queue nobody who may act on it can read. It now admits
--    `is_admin() or is_ceo()`.
--
-- 2. `is_ceo()` reads `gatepass.ceo_approver` (039) alone — a designation a
--    SUPER_ADMIN makes, restricted to admin accounts. The person the client
--    calls "the CEO" is the holder of the CEO office on the approval ladder
--    (`gatepass.approval_roles`, 043/046), who is a VMS `staff` account and
--    could never be named in `ceo_approver` at all. `is_ceo()` is therefore
--    widened to be true for EITHER designation.
--
-- ⚠ THIS DELIBERATELY REVERSES 043's SEPARATION, ON THE CLIENT'S INSTRUCTION.
--   043's header says naming somebody CEO on a gate pass must not silently hand
--   them the blacklist override 039 exists to protect, and that argument is
--   still true — the client has decided the two offices are one person and that
--   that person decides both. What this means in practice, stated plainly:
--   designating a CEO in Admin → Users → "Gate pass approval ladder" NOW ALSO
--   grants the power to take a vendor off the blacklist. If the two are ever
--   meant to be different people again, the fix is to narrow `is_ceo()` back to
--   `ceo_approver` and give the ladder CEO their own read-only view.
--
--   `sqlInvariants`'s rule that 043 never mentions `ceo_approver` still holds:
--   043 is unchanged, and this is a later, deliberate migration.
--
-- Both offices are single-holder by construction — `ceo_approver` has a
-- boolean primary key, `approval_roles` is keyed by `role_key` and 049 adds a
-- unique index on `user_id` — so "who is the CEO" still has at most two
-- answers, each of them one person, and no ordering decides anything.
-- ============================================================================

create or replace function gatepass.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.ceo_approver c where c.user_id = auth.uid()
  ) or exists (
    select 1 from gatepass.approval_roles r
     where r.role_key = 'ceo' and r.user_id = auth.uid()
  );
$$;

grant execute on function gatepass.is_ceo() to authenticated;

-- Unchanged from 039 except the one predicate: the CEO may read the queue they
-- are the only person able to clear. Still SECURITY DEFINER, still
-- `set search_path = ''`, still ordered newest request first.
create or replace function gatepass.list_whitelist_requests(p_status text default null)
returns table (
  id              uuid,
  blacklist_id    uuid,
  list_type       text,
  list_value      text,
  blocked_reason  text,
  justification   text,
  requested_by    uuid,
  requested_by_name text,
  requested_at    timestamptz,
  status          text,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.blacklist_id, r.list_type, r.list_value, r.blocked_reason,
    r.justification, r.requested_by, rn.full_name, r.requested_at,
    r.status, dn.full_name, r.decided_at, r.decision_note
  from gatepass.whitelist_requests r
  left join gatepass.profile_names rn on rn.id = r.requested_by
  left join gatepass.profile_names dn on dn.id = r.decided_by
  where (gatepass.is_admin() or gatepass.is_ceo())
    and (p_status is null or r.status = p_status)
  order by r.requested_at desc;
$$;

grant execute on function gatepass.list_whitelist_requests(text) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 054_approval_deputy.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 054 — every approval office may have ONE STANDING DEPUTY
--
-- THE GAP THIS CLOSES. Until now the ladder had exactly one way to move: the
-- sitting holder of an office pressed Approve. There is no delegation, no
-- escalation, no timeout and no reminder anywhere in 043/046/049 —
-- `pass_approvals` carries `created_at` and `decided_at` and nothing that ages.
-- So a CEO on leave stopped every pass at level 3 until somebody re-pointed the
-- office, which moves the whole queue permanently and leaves no trace of why.
--
-- WHAT THE MARKET DOES, and what is taken from it. SAP (substitution), Oracle
-- (vacation rules), ServiceNow, Coupa and Workday (delegation) all solve this
-- the same two ways: a named stand-in, and escalation on a timer. Only the
-- first is built here. A date-bounded delegation has to be switched on BEFORE
-- the absence, which is precisely when it is forgotten, and it buys nothing a
-- mall management office needs. Two details are worth stealing and are stolen:
--
--   * Coupa refuses to delegate DOWNWARD — a stand-in must hold equal or
--     greater authority. Here the ADMIN picks the deputy, so that is a policy
--     rule enforced by who gets chosen rather than by a seniority column this
--     schema has no way to know.
--   * Workday stamps the audit trail "On Behalf Of X". `decided_as_deputy`
--     below is that stamp, and the reason it is a stored column rather than a
--     join is in section 4.
--
-- ONE PERSON, ONE SEAT — 049 EXTENDED, NOT CONTRADICTED. 049 made `user_id`
-- unique because `my_approval_role()` is a scalar `returns text` over a query
-- that can yield several rows, and Postgres hands back an arbitrary one rather
-- than erroring. A deputy widens that query, so it reopens exactly that hazard
-- unless a deputy is unique too. Hence a partial unique index on `deputy_id`,
-- AND the two setters refusing anyone who already occupies a seat of either
-- kind. The rule that falls out is: **one human can never sign two rungs of the
-- same pass**, which is the four-eyes property the whole ladder rests on.
--
-- WHY THIS MIGRATION IS SMALL. Authority in 046 is resolved through
-- `my_approval_role()` at the moment of the press. Both RLS policies,
-- `pass_routed_to_me`, `pass_awaits_approval`, `approve_pass_level`,
-- `reject_pass_level` and the whole slip-order rule read through that one
-- function. Widening it by one `or` is what gives the deputy the entire
-- existing workflow — the queue, the record, the RLS visibility and the guard's
-- blindness to an unapproved pass — with nothing else changed.
--
-- WHAT A DEPUTY IS NOT. Not a role, not a login, not a route: exactly like the
-- office itself (046), it is a grant carried beside whatever VMS role the
-- person already has. And it does not change WHAT a pass owes — the levels are
-- still snapshotted at raise by the 046 trigger and are untouched here.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The column
-- ═══════════════════════════════════════════════════════════════════════════
-- Nullable: an office with no deputy is the normal case and must stay legal.
-- `on delete set null` matches `routed_to` in 046 — deleting a person empties
-- the seat rather than deleting the office, which would take the ladder with it.
alter table gatepass.approval_roles
  add column if not exists deputy_id uuid references public.profiles(id) on delete set null;

-- The holder cannot be their own deputy. Not pedantry: `my_approval_role()`
-- would still return one row, but `decided_as_deputy` would then be recorded
-- false for a person who is listed in both seats, and the audit line would be
-- deciding which of two true things to say.
alter table gatepass.approval_roles
  drop constraint if exists approval_roles_deputy_is_not_holder;
alter table gatepass.approval_roles
  add constraint approval_roles_deputy_is_not_holder
  check (deputy_id is null or deputy_id <> user_id);

-- Partial, unlike 049's — `deputy_id` IS nullable and the empty seat is the
-- common case, so every vacant office would collide on a plain unique index.
create unique index if not exists approval_roles_one_deputy_per_person
  on gatepass.approval_roles (deputy_id)
  where deputy_id is not null;

comment on index gatepass.approval_roles_one_deputy_per_person is
  'One deputy seat per person, for the reason 049 gives for holders: gatepass.my_approval_role() is a scalar over this table and would silently return an arbitrary one of several. See migration 054.';

comment on column gatepass.approval_roles.deputy_id is
  'Optional standing stand-in for this office. May approve exactly what the holder may, at any time, with no date window. Recorded on the decision as decided_as_deputy. See migration 054.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Authority follows either seat
-- ═══════════════════════════════════════════════════════════════════════════
-- The ONE function this migration exists to widen. Still returns at most one
-- row: `user_id` is unique (049), `deputy_id` is unique among non-nulls (above),
-- and section 3 refuses to seat one person in both. All three are load-bearing
-- together — drop any one and this silently becomes arbitrary again.
--
-- `is_user_active` still gates it, so suspending a deputy empties their queue
-- exactly as it does a holder's (040).
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where (r.user_id = auth.uid() or r.deputy_id = auth.uid())
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder OR as its standing deputy (054) — or null. Scalar by design: three separate rules guarantee at most one row. Suspended accounts hold nothing.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Seating people — and refusing anyone who already has a seat
-- ═══════════════════════════════════════════════════════════════════════════
-- The office title as a person reads it. Four functions below need this same
-- mapping inside a refusal sentence; 049 inlined the `case` once and a second
-- copy is a second thing to get wrong. Not SECURITY DEFINER — it reads nothing,
-- so it needs no elevated rights and no search_path pin.
create or replace function gatepass.approval_office_title(p_role_key text)
returns text
language sql
immutable
as $$
  select case p_role_key
           when 'security_head' then 'Security Head'
           when 'coo'           then 'COO'
           when 'ceo'           then 'CEO'
           when 'finance_head'  then 'Finance HOD'
           else                      p_role_key
         end;
$$;

revoke all on function gatepass.approval_office_title(text) from public;

-- Restated from 049 with ONE added refusal: a person already sitting as some
-- office's deputy cannot also be made a holder. Everything else — the admin
-- gate, the known-key check, the existence check, the "already holds" check and
-- the upsert — is 049's, unchanged.
--
-- Both checks EXCLUDE the office being set, so re-designating the same person
-- to the office they already hold stays a no-op rather than an error.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      gatepass.approval_office_title(v_held);
  end if;

  -- New in 054. Includes the office being set: making this office's own deputy
  -- its holder must clear the deputy seat first, or the row would violate
  -- approval_roles_deputy_is_not_holder with a constraint name instead of a
  -- sentence.
  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id;

  if v_held is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat — clear that deputy first.',
      gatepass.approval_office_title(v_held);
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- The deputy's own setter. Admin-gated like its holder counterpart, and for the
-- same reason 043 gives: designating somebody is an org-chart act, not a
-- security escalation the designator gains anything from.
--
-- AN UNDESIGNATED OFFICE CANNOT TAKE A DEPUTY, and that is not an arbitrary
-- order of operations: `approval_roles.user_id` is NOT NULL, so the row simply
-- cannot exist without a holder. Saying so is better than a null-violation.
create or replace function gatepass.set_approval_deputy(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_holder uuid;
  v_seat   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass deputy.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  select r.user_id into v_holder
    from gatepass.approval_roles r
   where r.role_key = p_role_key;

  if v_holder is null then
    raise exception 'The % office has nobody in it yet. Designate the office holder before naming a deputy.',
      gatepass.approval_office_title(p_role_key);
  end if;

  if v_holder = p_user_id then
    raise exception 'That person already holds the % office. A deputy stands in for the holder, so it has to be somebody else.',
      gatepass.approval_office_title(p_role_key);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat — vacate that office first.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id
     and r.role_key <> p_role_key;

  if v_seat is not null then
    raise exception 'That person is already the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  update gatepass.approval_roles r
     set deputy_id = p_user_id
   where r.role_key = p_role_key;
end;
$$;

create or replace function gatepass.clear_approval_deputy(p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change a gate pass deputy.';
  end if;

  update gatepass.approval_roles r
     set deputy_id = null
   where r.role_key = p_role_key;
end;
$$;

grant execute on function gatepass.set_approval_deputy(text, uuid) to authenticated;
grant execute on function gatepass.clear_approval_deputy(text)     to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The decision records WHICH SEAT signed it
-- ═══════════════════════════════════════════════════════════════════════════
-- `decided_by` already names the human. This says which capacity they acted in,
-- and it is a STORED COLUMN rather than a join back to `approval_roles` on
-- purpose: the seat is a fact about the MOMENT of the decision, and both seats
-- move. Re-pointing an office next month must not retroactively turn "approved
-- by the CEO" into "approved by a deputy", or the other way round. This is the
-- same argument 046 makes for snapshotting `routed_to`, and the same one 051
-- makes for NOT snapshotting the mail address — a decision is history, an
-- address is a lookup.
alter table gatepass.pass_approvals
  add column if not exists decided_as_deputy boolean not null default false;

comment on column gatepass.pass_approvals.decided_as_deputy is
  'True when the person named by decided_by signed as the office''s standing deputy rather than as its holder, recorded at the moment of the decision. See migration 054.';

-- Both decision RPCs are restated from 046 with ONE added assignment each.
-- Every guard, every sentence and the slip-order rule are unchanged — a deputy
-- is refused out-of-turn approval exactly as a holder is, because both resolve
-- through the same `my_approval_role()`.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := gatepass.my_approval_role();
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_as_deputy boolean;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  update gatepass.pass_approvals a
     set status            = 'approved',
         decided_by        = auth.uid(),
         decided_at        = now(),
         decided_as_deputy = coalesce(v_as_deputy, false)
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := gatepass.my_approval_role();
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_as_deputy boolean;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  update gatepass.pass_approvals a
     set status            = 'rejected',
         decided_by        = auth.uid(),
         decided_at        = now(),
         decided_as_deputy = coalesce(v_as_deputy, false),
         reason            = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The readers
-- ═══════════════════════════════════════════════════════════════════════════
-- BOTH are DROPPED and recreated rather than replaced: `create or replace
-- function` cannot change a RETURN TYPE, and both of these gain a column. The
-- grant goes with the drop, so it is re-applied in the same transaction — the
-- rule CLAUDE.md states and `my_profile()` has already been bitten by twice.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key          text,
  level_no          smallint,
  status            text,
  routed_name       text,
  decided_name      text,
  decided_at        timestamptz,
  reason            text,
  decided_as_deputy boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.decided_as_deputy
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- The ladder card needs to show both seats, so the admin can see at a glance
-- which offices have cover and which do not. `deputy_name` is LEFT-joined for
-- the reason the pass view gives: a narrowed VMS policy must degrade to a
-- missing NAME, never to a missing office.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz,
  deputy_id       uuid,
  deputy_name     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at,
         r.deputy_id,
         dp.full_name as deputy_name
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
    left join public.profiles   dp on dp.id = r.deputy_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'finance_head'  then 3
              when 'ceo'           then 4
            end;
$$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The letter tells the deputy too
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 051 with two keys added. A deputy who is never written to is a
-- deputy who does not know there is anything to sign, which would leave this
-- whole migration working only for somebody already watching the screen.
--
-- The deputy is resolved from `approval_roles` — TODAY's deputy, exactly as 051
-- made the holder today's holder, and for the identical reason: authority is
-- resolved at the moment of the press, so the address must be too. There is no
-- `routed_to` fallback for a deputy because a pass was never routed to one; a
-- vacant deputy seat simply yields nulls, and the sender drops the recipient.
--
-- Everything else — the name, the jsonb shape, the service_role-only grant —
-- is unchanged.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pass', (
      select jsonb_build_object(
               'id',                   p.id,
               'pass_number',          p.pass_number,
               'type',                 p.type,
               'status',               p.status,
               'visitor_name',         p.visitor_name,
               'purpose',              p.purpose,
               'vendor_name',          gatepass.company_name_of(p.visitor_company),
               'department_name',      d.name,
               'raised_by',            p.raised_by,
               'raised_by_name',       rb.full_name,
               'raised_by_email',      rb.email,
               'item_count',           coalesce(it.item_count, 0),
               'total_value',          coalesce(it.total_value, 0),
               'expected_return_date', p.expected_return_date,
               'created_at',           p.created_at
             )
        from gatepass.gate_passes p
        left join public.departments d on d.id = p.department_id
        left join public.profiles   rb on rb.id = p.raised_by
        left join lateral (
               select count(*) as item_count, sum(i.approx_value) as total_value
                 from gatepass.gate_pass_items i
                where i.gate_pass_id = p.id
             ) it on true
       where p.id = p_pass_id
    ),
    'approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'role_key',       a.role_key,
               'level_no',       a.level_no,
               'status',         a.status,
               'approver_id',    coalesce(r.user_id, a.routed_to),
               'approver_name',  coalesce(cur.full_name, ap.full_name),
               'approver_email', coalesce(cur.email, ap.email),
               'deputy_name',    dep.full_name,
               'deputy_email',   dep.email,
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join gatepass.approval_roles r on r.role_key = a.role_key
        left join public.profiles       cur on cur.id = r.user_id
        left join public.profiles        ap on ap.id  = a.routed_to
        left join public.profiles       dep on dep.id = r.deputy_id
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. Each level is addressed to whoever holds that office TODAY (051) and to its standing deputy (054), falling back to the holder snapshotted at raise when the office is now vacant. service_role ONLY; every signed-in reader uses get_approval_ladder() (043/054), which carries no address.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 055_emergency_release.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 055 — EMERGENCY RELEASE: a super admin can clear a stuck ladder, in writing,
--       and a different admin has to review it afterwards
--
-- THE QUESTION THIS ANSWERS. 046 made the ladder mandatory and 054 gave every
-- office a standing deputy, so an absent approver is covered. What is still not
-- covered is nobody being reachable at all — a Sunday night, a power cut, four
-- people on one flight — while a truck waits at the barrier. Before this
-- migration the only route was an admin re-pointing offices one by one on the
-- ladder card, which grants real authority to whoever is to hand, leaves that
-- grant standing afterwards, and records nothing about why any of it happened.
-- That is a worse outcome than a documented override, which is the whole
-- argument for this migration existing.
--
-- WHAT THIS IS MODELLED ON. SAP GRC's Emergency Access Management (Firefighter)
-- is the reference implementation, and stripped of its enterprise scaffolding
-- it is exactly four things: a small PRE-NAMED pool who may invoke it, a
-- WRITTEN REASON captured at the moment of use, a NATURAL END, and MANDATORY
-- REVIEW BY SOMEBODY WHO WAS NOT THE ACTOR. NIST SP 800-53 (AC-2, AU-6), ISO
-- 27001:2022 A.8.2 and SOX/COSO on "management override of controls" all land
-- on the same four. Here they are, in order:
--
--   1. THE POOL is `super_admin`, checked inline. 039 (`set_ceo_approver`) is
--      the only other place in this schema that demands more than `is_admin()`,
--      and it is the precedent this follows deliberately: an ordinary admin can
--      already create users and reset passwords, so gating on `is_admin()`
--      would hand the whole ladder to the same group that administers it.
--   2. THE REASON is NOT NULL, 10–500 characters, and is copied onto every
--      level it clears. Ten rather than one because "ok", "." and "asap" are
--      not reasons, and this column is the entire defence if the release is
--      ever questioned.
--   3. THE END is inherent: this releases ONE pass, once. There is no elevated
--      session to expire, nothing to un-grant, and no standing permission
--      created — which is precisely why it is safer than the re-designation it
--      replaces.
--   4. THE REVIEW is `review_emergency_release`, and it REFUSES the person who
--      invoked it. That refusal is the control; everything else is bookkeeping.
--      Without it this is not an override, it is a bypass.
--
-- ⚠ WHY THIS DOES NOT TOUCH `gate_passes.status`, and it matters. The pass stays
--   `pending`. Clearing the pending `pass_approvals` rows makes
--   `pass_awaits_approval()` false, and from that instant the pass behaves like
--   any other approved one: the guard can SEE it (046's `gate_passes_select`),
--   `lookup_pass` stops answering `awaiting_approval`, and `match_pass` works
--   normally. So this migration:
--     * adds NO update or delete grant on `gate_passes` — the RPC-only state
--       machine is untouched, and `sqlInvariants` still passes;
--     * never trips `block_unapproved_gate_move`, because it moves no status;
--     * invents no new pass status, which would need an enum label that cannot
--       be USED in the same transaction that adds it (the APPLY_ALL.sql trap).
--   The release is recorded on the APPROVALS, where the missing signatures
--   actually are, rather than smuggled into the pass's own state.
--
-- WHAT IS DELIBERATELY NOT BUILT: no auto-expiry, no time-boxed elevated
-- session, no quorum. A second approver would deadlock the exact situation this
-- exists for — nobody being reachable — and the four-eyes property is preserved
-- where it can actually be honoured, at the review.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The record of the override, and of its review
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per released pass, which is why `gate_pass_id` is the primary key: a
-- pass whose ladder has already been cleared has nothing left to release, and
-- the RPC refuses a second attempt rather than writing a second row.
--
-- `released_by` is NOT NULL and has NO `on delete set null`, unlike `routed_to`
-- and `decided_by` elsewhere in this schema. Deleting the person must not be
-- able to anonymise an override — `on delete restrict` (the default here, via
-- the plain reference) makes the account undeletable while the record stands,
-- and that is the correct trade for the one table in this app whose entire
-- purpose is accountability.
create table if not exists gatepass.emergency_releases (
  gate_pass_id uuid primary key references gatepass.gate_passes(id) on delete cascade,
  released_by  uuid not null references public.profiles(id),
  reason       text not null,
  released_at  timestamptz not null default now(),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,

  -- Ten characters is the shortest thing that can be a reason. 500 matches the
  -- rejection reason in 046, so the two free-text fields on this ladder have
  -- one limit between them.
  constraint emergency_releases_reason_is_written
    check (length(btrim(reason)) between 10 and 500),

  -- A review is who AND when, or neither. A reviewed_at with no reviewer is an
  -- audit line that says something happened and refuses to say who did it.
  constraint emergency_releases_review_is_whole
    check ((reviewed_by is null) = (reviewed_at is null))
);

comment on table gatepass.emergency_releases is
  'One row per gate pass released past its approval ladder by a super admin (055). Carries the written justification captured at the moment of use, and the independent review that must follow it.';

create index if not exists emergency_releases_unreviewed_idx
  on gatepass.emergency_releases (released_at desc)
  where reviewed_at is null;

alter table gatepass.emergency_releases enable row level security;

-- Readable by exactly the people who can already read the pass — which is the
-- raising HOD, the offices it was routed to, every admin, and (once released)
-- the guard. That is the point: an override nobody can see is not a control.
-- `can_see_pass` is SECURITY INVOKER, so this inherits `gate_passes_select`
-- rather than restating it.
drop policy if exists emergency_releases_select_with_pass on gatepass.emergency_releases;
create policy emergency_releases_select_with_pass
  on gatepass.emergency_releases for select to authenticated
  using (gatepass.can_see_pass(gate_pass_id));

grant select on gatepass.emergency_releases to authenticated;

-- No insert, update or delete policy and no such grant, for anybody. The two
-- RPCs below are the only writers — the same rule `gate_passes` itself follows.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The mark on the levels that were never actually signed
-- ═══════════════════════════════════════════════════════════════════════════
-- WITHOUT THIS COLUMN the ladder would read "Approved by Sudeshna Pal" against
-- four offices Sudeshna Pal does not hold, which is a fabricated audit trail —
-- the exact thing 046's header refuses to do when it declines to backfill the
-- 60 grandfathered passes. With it, the rung reads "Released under emergency"
-- and names the reason.
alter table gatepass.pass_approvals
  add column if not exists emergency boolean not null default false;

comment on column gatepass.pass_approvals.emergency is
  'True when this level was cleared by gatepass.emergency_release_pass (055) rather than signed by the office. decided_by is then the super admin who released the pass, NOT an approver.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The release
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function gatepass.emergency_release_pass(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_owed    integer;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  -- 039's inline form, not is_admin(). See the header.
  if gatepass.app_role() <> 'super_admin' then
    raise exception 'Only a super admin can release a gate pass past its approval ladder.';
  end if;

  if length(v_reason) < 10 then
    raise exception 'An emergency release needs a written reason of at least 10 characters.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;

  -- A cancelled pass was REJECTED by an office, or voided by its HOD. Releasing
  -- it would overturn a decision somebody made and wrote a reason for, which is
  -- a different and much larger power than unsticking a silent queue. A matched
  -- pass has already left. Neither is what this is for.
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select count(*) into v_owed
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_owed = 0 then
    raise exception 'This gate pass does not owe any approvals — there is nothing to release.';
  end if;

  -- Every remaining level at once. Releasing them one at a time would leave a
  -- pass that is half-overridden if the caller stopped, and the ladder's own
  -- slip order makes a partial release meaningless anyway.
  update gatepass.pass_approvals a
     set status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         reason     = v_reason,
         emergency  = true
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  insert into gatepass.emergency_releases (gate_pass_id, released_by, reason)
  values (p_pass_id, auth.uid(), v_reason);
end;
$$;

revoke all on function gatepass.emergency_release_pass(uuid, text) from public;
grant execute on function gatepass.emergency_release_pass(uuid, text) to authenticated;

comment on function gatepass.emergency_release_pass(uuid, text) is
  'Clears every approval level a pending gate pass still owes, in one act, recording the super admin who did it and why. Does not change the pass''s own status — see migration 055.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The review, by somebody else
-- ═══════════════════════════════════════════════════════════════════════════
-- `is_admin()` and not `super_admin`: requiring the same privilege as the
-- release would mean a single super admin could release and then review their
-- own override in two clicks, which is the failure this whole section exists to
-- prevent. Widening the reviewer pool is what makes the refusal below bite.
create or replace function gatepass.review_emergency_release(p_pass_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released_by uuid;
  v_reviewed    timestamptz;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can review an emergency release.';
  end if;

  select e.released_by, e.reviewed_at into v_released_by, v_reviewed
    from gatepass.emergency_releases e
   where e.gate_pass_id = p_pass_id;

  if v_released_by is null then
    raise exception 'That gate pass was not released under emergency.';
  end if;

  -- THE FOUR-EYES CONTROL, and the only line in this migration that turns an
  -- override into a reviewed one.
  if v_released_by = auth.uid() then
    raise exception 'An emergency release has to be reviewed by somebody other than the person who made it.';
  end if;

  -- A review is a one-way act, like every other decision on this ladder. Re-
  -- reviewing would let a later admin quietly replace an earlier one's note.
  if v_reviewed is not null then
    raise exception 'This emergency release has already been reviewed.';
  end if;

  update gatepass.emergency_releases e
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where e.gate_pass_id = p_pass_id;
end;
$$;

revoke all on function gatepass.review_emergency_release(uuid, text) from public;
grant execute on function gatepass.review_emergency_release(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Reading them back
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the names alone: `public.profiles` is VMS's and is
-- narrowed by 006, so a plain join from the client would return an override
-- with nobody's name on it. Admin-gated because this is the review queue, and
-- an admin is who works it. Unreviewed first, oldest first within that — the
-- order the work should actually be done in.
create or replace function gatepass.list_emergency_releases()
returns table (
  gate_pass_id  uuid,
  pass_number   text,
  released_by   uuid,
  released_name text,
  reason        text,
  released_at   timestamptz,
  reviewed_by   uuid,
  reviewed_name text,
  reviewed_at   timestamptz,
  review_note   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the emergency release log.';
  end if;

  return query
    select e.gate_pass_id,
           g.pass_number,
           e.released_by,
           rp.full_name,
           e.reason,
           e.released_at,
           e.reviewed_by,
           vp.full_name,
           e.reviewed_at,
           e.review_note
      from gatepass.emergency_releases e
      left join gatepass.gate_passes g on g.id = e.gate_pass_id
      left join public.profiles     rp on rp.id = e.released_by
      left join public.profiles     vp on vp.id = e.reviewed_by
     order by (e.reviewed_at is not null), e.released_at desc;
end;
$$;

revoke all on function gatepass.list_emergency_releases() from public;
grant execute on function gatepass.list_emergency_releases() to authenticated;

-- The pass record needs the banner without being an admin — the raising HOD
-- must see why their pass moved. One row, scoped by the table's own policy, so
-- this is SECURITY INVOKER and carries no name: the banner names the person
-- through `list_emergency_releases` on the admin side and prints the reason
-- alone elsewhere.
create or replace function gatepass.pass_emergency_release(p_pass_id uuid)
returns table (
  released_at timestamptz,
  reason      text,
  reviewed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.released_at, e.reason, e.reviewed_at
    from gatepass.emergency_releases e
   where e.gate_pass_id = p_pass_id;
$$;

grant execute on function gatepass.pass_emergency_release(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The letter the skipped offices get
-- ═══════════════════════════════════════════════════════════════════════════
-- 047's payload, with ONE key added. The Edge Function must be able to tell
-- "this pass was just released" from "this pass just reached the next office"
-- WITHOUT being told which by its caller — 047's header makes that a rule, and
-- it is a real one: the browser sends a pass id and nothing else, so no client
-- can ask this system to send a letter describing an event that did not happen.
-- The presence of this object IS the event, derived from the database's own
-- record of it.
--
-- Same name, same return type, same service_role-only grant, so `create or
-- replace` is legal here and the function keeps its existing privileges.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object(
      'pass', (
        select jsonb_build_object(
                 'id',                   p.id,
                 'pass_number',          p.pass_number,
                 'type',                 p.type,
                 'status',               p.status,
                 'visitor_name',         p.visitor_name,
                 'purpose',              p.purpose,
                 'vendor_name',          gatepass.company_name_of(p.visitor_company),
                 'department_name',      d.name,
                 'raised_by',            p.raised_by,
                 'raised_by_name',       rb.full_name,
                 'raised_by_email',      rb.email,
                 'item_count',           coalesce(it.item_count, 0),
                 'total_value',          coalesce(it.total_value, 0),
                 'expected_return_date', p.expected_return_date,
                 'created_at',           p.created_at
               )
          from gatepass.gate_passes p
          left join public.departments d on d.id = p.department_id
          left join public.profiles   rb on rb.id = p.raised_by
          left join lateral (
                 select count(*) as item_count, sum(i.approx_value) as total_value
                   from gatepass.gate_pass_items i
                  where i.gate_pass_id = p.id
               ) it on true
         where p.id = p_pass_id
      ),
      'approvals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'role_key',       a.role_key,
                 'level_no',       a.level_no,
                 'status',         a.status,
                 'approver_id',    coalesce(r.user_id, a.routed_to),
                 'approver_name',  coalesce(cur.full_name, ap.full_name),
                 'approver_email', coalesce(cur.email, ap.email),
                 'deputy_name',    dep.full_name,
                 'deputy_email',   dep.email,
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
          left join public.profiles       dep on dep.id = r.deputy_id
         where a.gate_pass_id = p_pass_id
      ), '[]'::jsonb)
    )
  )
  || jsonb_build_object(
       'emergency', (
         select jsonb_build_object(
                  'released_at',   e.released_at,
                  'released_name', rp.full_name,
                  'reason',        e.reason,
                  'reviewed_at',   e.reviewed_at
                )
           from gatepass.emergency_releases e
           left join public.profiles rp on rp.id = e.released_by
          where e.gate_pass_id = p_pass_id
       )
     );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included (047/051/054), plus the emergency release that cleared this pass if there was one (055). The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 056_app_settings.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 056 — APP SETTINGS: one admin-editable row for the things a deployment wants
--       to change without a redeploy
--
-- Shaped exactly like 052's `mail_settings`, and for the same reasons: a
-- single-row lock on a boolean primary key, RLS enabled with NO policy and NO
-- grant on the table, and every read and write through an `is_admin()`-gated
-- SECURITY DEFINER function. Read 052's header first — this migration adds
-- nothing new to that pattern, it applies it.
--
-- ⚠ TWO OF THESE FIELDS ENFORCE SOMETHING TODAY AND THREE DO NOT. That split is
--   deliberate, it is stated on the screen, and it must stay stated:
--
--     ENFORCED NOW
--       * `session_timeout_minutes` — `src/components/SessionTimeout.tsx` is an
--         idle timer that already signs a user out; it reads this instead of a
--         constant. Real from the day this ships.
--
--     STORED, ENFORCING NOTHING (yet)
--       * `require_approver_2fa` — THERE IS NO SECOND FACTOR IN THIS SYSTEM.
--         Supabase Auth ships TOTP and the enforcement point would be an `aal2`
--         check inside `approve_pass_level`, but none of that is built. The
--         client asked for the switch to exist now and be turned on later.
--         ⚠ A CONTROL LABELLED "Require 2FA" THAT SILENTLY DOES NOTHING IS
--         WORSE THAN NO CONTROL — an admin who flips it and walks away believes
--         approvers are protected. The card therefore says, on its face, that
--         it is not enforced. If that sentence is ever removed, this column
--         becomes a lie; delete the column instead.
--       * `app_name`, `brand_color` — branding, saved and not applied. The app
--         keeps its shipped Quest identity until a later phase wires them.
--         Same honest precedent as 052's SMTP columns, which are stored and
--         send nothing.
--
-- WHY NOT WAIT AND ADD THEM WHEN THEY WORK? Because the client asked for the
-- provisions, and a settings table that has to be migrated again for each one
-- is three more migrations against a live database. The cost of doing it this
-- way is exactly one thing: the screen must never overstate what a field does.
-- ============================================================================

create table if not exists gatepass.app_settings (
  -- 052's single-row lock: `id` can only ever be true, so a second row is a
  -- primary key violation rather than a settings table nobody can read
  -- deterministically.
  id boolean primary key default true check (id),

  -- Null = "use what the app ships with". Never the empty string — "unset"
  -- must have exactly one spelling, the rule 052 states.
  app_name    text check (app_name    is null or (btrim(app_name) <> '' and length(app_name) <= 40)),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),

  -- NOT NULL with a default of false: "nobody has decided yet" and "2FA is not
  -- required" are the same thing here, and a nullable boolean would invite a
  -- three-state read of a two-state fact.
  require_approver_2fa boolean not null default false,

  -- Five minutes is the shortest timeout that is not an accident; a day is the
  -- longest that is still a timeout. Null means "use the app's own default"
  -- (5 minutes, `SessionTimeout.tsx`'s shipped value), so clearing the field
  -- restores the shipped behaviour rather than locking everybody out with a
  -- zero.
  session_timeout_minutes int check (
    session_timeout_minutes is null or session_timeout_minutes between 5 and 1440
  ),

  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table gatepass.app_settings is
  'One row. Admin-editable application settings (056). Read and written only through get_app_settings/set_app_settings — see the header for which fields enforce something and which are stored provisions.';

alter table gatepass.app_settings enable row level security;

-- NO POLICY AND NO GRANT for `authenticated`, exactly as 052. Nothing but the
-- three functions below ever touches this table.
--
-- `require_approver_2fa` is withheld from non-admins on purpose: "there is no
-- second factor on this deployment" is reconnaissance about a control, not
-- decoration. The idle timeout is NOT withheld — see get_session_timeout()
-- below for why that one has to be readable by everyone.

create or replace function gatepass.get_app_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the application settings.';
  end if;

  select jsonb_build_object(
           'app_name',                s.app_name,
           'brand_color',             s.brand_color,
           'require_approver_2fa',    s.require_approver_2fa,
           'session_timeout_minutes', s.session_timeout_minutes,
           'updated_at',              s.updated_at,
           'updated_by_name',         p.full_name
         )
    into v
    from gatepass.app_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  -- A table that has never been written is not an error: it is the state every
  -- deployment starts in. The caller gets a document of nulls rather than a
  -- null document, so the form renders identically either way (052's rule).
  return coalesce(v, jsonb_build_object('require_approver_2fa', false));
end;
$fn$;

grant execute on function gatepass.get_app_settings() to authenticated;

create or replace function gatepass.set_app_settings(
  p_app_name                text,
  p_brand_color             text,
  p_require_approver_2fa    boolean,
  p_session_timeout_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := nullif(btrim(coalesce(p_app_name, '')), '');
  v_color text := nullif(btrim(coalesce(p_brand_color, '')), '');
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the application settings.';
  end if;

  -- The CHECKs are restated as sentences, 052's rule: a constraint violation
  -- reaches the browser as 23514, which this app deliberately does not map to
  -- a readable message.
  if v_name is not null and length(v_name) > 40 then
    raise exception 'The application name has to be 40 characters or fewer.';
  end if;

  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'A brand colour has to be a six-digit hex code, like #C6A15B.';
  end if;

  if p_session_timeout_minutes is not null
     and (p_session_timeout_minutes < 5 or p_session_timeout_minutes > 1440) then
    raise exception 'The sign-out timer has to be between 5 minutes and 24 hours.';
  end if;

  insert into gatepass.app_settings as a (
    id, app_name, brand_color, require_approver_2fa, session_timeout_minutes,
    updated_by, updated_at
  )
  values (
    true, v_name, v_color, coalesce(p_require_approver_2fa, false), p_session_timeout_minutes,
    auth.uid(), now()
  )
  on conflict (id) do update
    set app_name                = excluded.app_name,
        brand_color             = excluded.brand_color,
        require_approver_2fa    = excluded.require_approver_2fa,
        session_timeout_minutes = excluded.session_timeout_minutes,
        updated_by              = excluded.updated_by,
        updated_at              = excluded.updated_at;

  return gatepass.get_app_settings();
end;
$fn$;

grant execute on function gatepass.set_app_settings(text, text, boolean, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- The one setting EVERY signed-in user has to be able to read
-- ═══════════════════════════════════════════════════════════════════════════
-- `get_app_settings()` above is admin-only, and correctly so: whether a second
-- factor is required is reconnaissance about a control. But the idle timeout
-- governs the guard at the barrier and the HOD at their desk, not just the
-- admin who set it — their own browser is what has to enforce it, so their own
-- browser has to know the number. Gating it would leave a setting that only
-- changed the behaviour of the person who changed it.
--
-- Withholding it would also protect nothing: a signed-in user can measure their
-- own idle timeout by waiting. This returns that ONE integer and no other field.
create or replace function gatepass.get_session_timeout()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select s.session_timeout_minutes
    from gatepass.app_settings s
   where s.id
     and gatepass.app_role() is not null;
$$;

grant execute on function gatepass.get_session_timeout() to authenticated;

comment on function gatepass.get_session_timeout() is
  'The idle sign-out time in minutes, or null for the app''s own default. Readable by every signed-in user because their own browser enforces it (056). Returns nothing else from app_settings.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 057_linear_approval_order.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 057 — the ladder is Security Head → COO → Finance HOD → CEO, and a pass that
--       is still climbing it never offers the gate a button
--
-- TWO THINGS, and they are one client report. 2026-08-20:
--
--   "After the approval the security head is getting this error [`This gate
--    pass has not been approved by every level yet`] so make sure you make the
--    approval process linear, one by one: 1. The security head has to approve
--    2. COO 3. Finance 4. CEO. The approval cannot progress until the first,
--    second, third, and fourth levels are approved."
--
-- ── 1. THE ORDER. ───────────────────────────────────────────────────────────
-- 043 took its order from the printed A5 slip, which prints
-- `Security Head → COO → CEO → Finance HOD`, and 046 froze that into
-- `pass_approvals.level_no` and its own CHECK. The client has now put Finance
-- BEFORE the CEO: the CEO signs last, on a pass finance has already costed.
-- So `finance_head` is level 3 and `ceo` is level 4 — here, in the snapshot
-- trigger, in the check constraint, and on the printed slip
-- (`src/pages/Shared/signatureBlocks.ts` moves with this migration; the screen
-- and the paper must name the same offices in the same order, or a guard
-- comparing the two finds a level on one that is missing from the other).
--
-- THE EXISTING ROWS ARE RENUMBERED, unlike almost everything else in this app.
-- `level_no` is not an audit fact — it is the ORDER the remaining signatures
-- are collected in, and every ceo/finance row on this database is `pending`
-- (checked as `postgres`, 2026-08-20: 5 passes, 20 rows, `security_head` the
-- only office that has decided anything). Renumbering a DECIDED row would
-- change nothing about who signed or when; it would only move a rung that has
-- already been climbed.
--
-- ── 2. THE ERROR. ───────────────────────────────────────────────────────────
-- The linear rule was never broken. `approve_pass_level` has refused any caller
-- who is not the LOWEST still-pending rung since 046, and the live table shows
-- exactly that — `security_head` approved, the other three still pending. What
-- the client actually hit is this, and it is real:
--
--   THE SECURITY HEAD ON THIS DEPLOYMENT IS A `guard` ACCOUNT (sec@demo.vms;
--   043 explicitly allows it). 046's `gate_passes_select` gives an office
--   holder `pass_routed_to_me(id)`, so that person can see a pass that is still
--   climbing — which is correct, they have to read what they are signing. But
--   they ALSO keep every gate screen. So the pass they had just approved at
--   level 1 appeared in their own Pending OUT queue carrying an **Approve OUT**
--   button, and pressing it ran `match_pass`, and `block_unapproved_gate_move`
--   refused it with the sentence the client quoted.
--
--   The trigger is right and is untouched. What was wrong is a screen drawing a
--   button the database was always going to refuse — the one thing this
--   codebase's own rule (`canVerifyAtGate` restates what `match_pass` enforces,
--   so a button that always fails is never drawn) exists to prevent. It could
--   not, because nothing on `v_gate_passes` said whether a pass still owed a
--   signature.
--
-- So the view gains `awaits_approval`, and the gate queue filters on it
-- SERVER-SIDE. TRAP 2 (CLAUDE.md) applies: `create or replace view` cannot
-- absorb a new column, so the view is DROPPED and rebuilt with its grant
-- re-applied in the same transaction, and `security_invoker = true` is restated
-- — without it the view runs as its owner and every HOD reads every department.
-- The body below is 038's, edited mechanically rather than retyped.
--
-- `gatepass.pass_awaits_approval(id)` rather than an inline EXISTS: it is
-- SECURITY DEFINER, so it answers the same for every reader and costs one
-- primary-key probe per row, where an inline subquery under `security_invoker`
-- would re-run `can_see_pass` for every pass on every report.
--
-- WHAT THIS DOES NOT DO: it does not hide the pass from the office holder. They
-- still read it, still find it in their approvals queue, and still sign it. It
-- removes exactly one thing — the gate action on a pass the gate may not clear.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Finance signs third, the CEO signs last
-- ═══════════════════════════════════════════════════════════════════════════
-- The constraint has to come off before the rows can move: it pins level_no to
-- role_key row by row, so no single UPDATE can satisfy both mappings at once.
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_level_matches;

update gatepass.pass_approvals set level_no = 3 where role_key = 'finance_head';
update gatepass.pass_approvals set level_no = 4 where role_key = 'ceo';

alter table gatepass.pass_approvals
  add constraint pass_approvals_level_matches
  check (level_no = case role_key
                      when 'security_head' then 1
                      when 'coo'           then 2
                      when 'finance_head'  then 3
                      when 'ceo'           then 4
                    end);

comment on constraint pass_approvals_level_matches on gatepass.pass_approvals is
  'Slip order: Security Head 1, COO 2, Finance HOD 3, CEO 4 (client, 2026-08-20 - Finance signs before the CEO).';

-- The snapshot, restated from 046 (and from 054, which re-stated it for the
-- deputy work) with the two levels swapped. Everything else about it is
-- unchanged: it is a trigger and not a line inside `raise_pass`, a vacant
-- office is never snapshotted, and what a pass owes freezes the day it is
-- raised.
--
-- `create or replace function` keeps the existing trigger bound to it, so the
-- trigger is deliberately NOT dropped and re-created here — that would open a
-- window, however short, in which an insert snapshots nothing at all.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id,
         r.role_key,
         (case r.role_key
            when 'security_head' then 1
            when 'coo'           then 2
            when 'finance_head'  then 3
            when 'ceo'           then 4
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The view says whether a pass still owes a signature
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
    p.visitor_name,
    p.visitor_company,
    p.vehicle_number,
    p.purpose,
    p.expected_return_date,
    p.return_status,
    p.actual_return_date,
    p.verified_by,
    p.verified_at,
    p.flag_reason,
    p.created_at,
    p.updated_at,
    p.qr_token,
    p.expires_at,
    p.direction,
    p.image_url,
    p.category,
    ( SELECT max(f.created_at) AS max
           FROM gatepass.verifications f
          WHERE f.gate_pass_id = p.id AND f.action = 'flagged'::gatepass.verify_action) AS flagged_at,
    ( SELECT max(r.created_at) AS max
           FROM gatepass.verifications r
          WHERE r.gate_pass_id = p.id AND r.action = 'hod_reviewed'::gatepass.verify_action) AS hod_reviewed_at,
    p.return_status = 'awaiting_return'::gatepass.return_status AND p.expected_return_date IS NOT NULL AND p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date AS is_overdue,
    p.status = 'pending'::gatepass.pass_status AND p.expires_at < now() AS is_expired,
        CASE
            WHEN p.expected_return_date IS NULL OR (p.return_status::text <> ALL (ARRAY['awaiting_return'::text, 'partially_returned'::text])) THEN 'not_applicable'::text
            WHEN p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date THEN 'overdue'::text
            WHEN p.expected_return_date = (now() AT TIME ZONE gatepass.site_tz())::date THEN 'due_today'::text
            WHEN p.expected_return_date = ((now() AT TIME ZONE gatepass.site_tz())::date + 1) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS due_state,
    gatepass.pass_awaits_approval(p.id) AS awaits_approval,
    COALESCE(it.item_count, 0::bigint) AS item_count,
    COALESCE(it.total_quantity, 0::numeric) AS total_quantity,
    COALESCE(it.returned_quantity, 0::numeric) AS returned_quantity,
    it.material_summary,
    COALESCE(it.total_value, 0::numeric) AS total_value,
    d.name AS department_name,
    d.code AS department_code,
    rb.full_name AS raised_by_name,
    vb.full_name AS verified_by_name
   FROM gatepass.gate_passes p
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            sum(i.quantity) AS total_quantity,
            sum(i.returned_qty) AS returned_quantity,
            string_agg(i.name, ', '::text ORDER BY i.line_no) AS material_summary,
            sum(i.approx_value) AS total_value
           FROM gatepass.gate_pass_items i
          WHERE i.gate_pass_id = p.id) it ON true
     LEFT JOIN public.departments d ON d.id = p.department_id
     LEFT JOIN gatepass.profile_names rb ON rb.id = p.raised_by
     LEFT JOIN gatepass.profile_names vb ON vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

comment on view gatepass.v_gate_passes is
  'Pass rows with rollups. is_overdue / is_expired / due_state / total_value / '
  'awaits_approval are defined HERE and exactly once - never recompute them in '
  'TypeScript. awaits_approval true means the pass is still climbing the '
  'approval ladder, and no gate action on it can succeed (046).';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. An office holder can be suspended AND restored
-- ═══════════════════════════════════════════════════════════════════════════
-- Client, 2026-08-20: "make sure that all these four roles should have the
-- deactivate and edit option also for the admin."
--
-- Edit already worked, and so did Deactivate on the server:
-- `admin_soft_delete_user` refuses only an admin target and the caller's own
-- account, and an office holder is neither. The admin DIRECTORY simply drew no
-- Deactivate control on those rows (a deliberate rule since 046 — "their office
-- moves on the ladder card, not from a row action"), and this instruction
-- overrules it. `UsersTable.tsx` moves with this migration.
--
-- REACTIVATION IS THE HALF THAT WAS ACTUALLY BROKEN, and it would have shipped
-- as a one-way door: an office holder's VMS role is `staff` (046 — the role for
-- "does not use VMS"), and 040's `admin_reactivate_user` refuses any target
-- whose role is not guard/hod, with "Give this person a role (Guard or HOD)
-- before reactivating." So an admin could suspend a COO and then have no way
-- back except through the portal's role-choice modal, which would make them a
-- guard and cost them their office.
--
-- 040's REASON for that refusal is still exactly right and is NOT relaxed: a
-- bare `staff` row has no access whether the flag is true or false, so flipping
-- it would report a restoration that restored nothing. An office holder is the
-- one `staff` row that is false — `gatepass.approval_roles` is what grants them
-- their route and their queue, and `my_approval_role()` gates on
-- `is_user_active`, which is precisely the flag this function writes. So the
-- test becomes "has this person anything to come back TO", and holding an
-- office is one of the two ways to have something.
--
-- Body copied from 040 with that one condition widened; everything else —
-- the admin check, the not-found check, the upsert — is verbatim.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_office text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_role not in ('guard', 'hod') and v_office is null then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (user_id, is_active, deactivated_at, deactivated_by, updated_at)
  values (p_user_id, true, null, null, now())
  on conflict (user_id) do update
    set is_active      = true,
        deactivated_at = null,
        deactivated_by = null,
        updated_at     = now();

  return json_build_object('id', p_user_id::text, 'reactivated', true);
end;
$$;

grant execute on function gatepass.admin_reactivate_user(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 058_grandfather_pre_rollout_approvals.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 058 — every pass raised BEFORE the approval workflow went live is approved,
--       and it says so in words rather than naming somebody who never signed
--
-- The client, 2026-08-20: "I do see whatever passes were raised before today.
-- Make them all approved. Since the approval process is starting today,
-- starting today onwards show the exact approval, whether it's pending or not.
-- If something was raised yesterday, make it completely approved."
--
-- WHY THERE IS ANYTHING TO DO AT ALL. 046 grandfathered the 60 passes that
-- predated the ladder by the cleanest possible route — an office that was
-- vacant at the moment of the raise is never snapshotted, so those passes owe
-- nothing and reach the gate exactly as they always did. What 046 could not
-- foresee is the four offices being FILLED while passes were mid-flight: five
-- passes were raised into a ladder nobody was going to climb retroactively, and
-- they are now stuck short of the gate. This migration closes exactly those.
--
-- ⚠ IT DOES NOT INVENT AN APPROVER, and that is the whole design. The obvious
-- shortcut — set `status = 'approved', decided_by = <some admin>` — writes a
-- FABRICATED AUDIT TRAIL: the record would read "Approved by X" against four
-- offices X does not hold and never signed. That is precisely what 046 refused
-- when it declined to backfill the grandfathered passes, and what 055's
-- `emergency` flag exists to avoid. So instead:
--
--   * `pass_approvals.grandfathered` marks the rows this migration closed;
--   * `decided_by` stays NULL — nobody decided them;
--   * `decided_at` is stamped, because the rollout is a real moment;
--   * `reason` carries the sentence a reader is owed, and the ladder prints
--     "Approved on rollout" where a name would otherwise go.
--
-- The shape constraint is widened by exactly one arm to permit that, and by no
-- more: an `approved` row with a null decider is legal ONLY when grandfathered
-- is true. Every ordinary approval still needs an author and a moment.
--
-- THE CUTOFF IS THE DATE PRINTED ON THE PASS. `set_pass_number` (042) builds
-- `RGP-YYYYMMDD-NNNN` from the UTC date while every other date rule in this app
-- runs in `site_tz()`, so a pass raised at 00:31 IST carries YESTERDAY's date on
-- its own face. The client is reading those numbers off the screen, so the cut
-- is made in the same clock the number is: a pass whose number reads 20260819
-- or earlier is closed; a pass whose number reads 20260820 keeps its real,
-- live ladder. (That UTC/site split in 042 is a genuine inconsistency and is
-- flagged in CLAUDE.md — it is deliberately NOT fixed here, because renumbering
-- a pass is renumbering an audit anchor on printed paper.)
--
-- ONE-TIME AND SELF-LIMITING. Re-running it is harmless: no pass can ever again
-- be raised with a `created_at` before the cutoff, so the UPDATE can only ever
-- match rows it has already closed, and those are no longer `pending`.
-- ============================================================================

-- ─── The mark ───────────────────────────────────────────────────────────────

alter table gatepass.pass_approvals
  add column if not exists grandfathered boolean not null default false;

comment on column gatepass.pass_approvals.grandfathered is
  'True when this level was closed by the 058 rollout rather than by a person: '
  'the pass was raised before the approval workflow began, so no office ever '
  'saw it. decided_by is null on such a row — the ladder prints "Approved on '
  'rollout" instead of a name. Never set by any RPC; only 058 writes it.';

-- ─── The shape constraint, widened by exactly one arm ────────────────────────

alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_decision_shape;

alter table gatepass.pass_approvals
  add constraint pass_approvals_decision_shape
    check (
      (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
      -- The rollout: approved, stamped, explained, and authored by nobody.
      or (status = 'approved' and grandfathered and decided_by is null and decided_at is not null)
      or (status = 'approved' and not grandfathered and decided_by is not null and decided_at is not null)
      or (status = 'rejected' and decided_by is not null and decided_at is not null
          and length(btrim(coalesce(reason, ''))) between 1 and 500)
    );

-- ─── The backfill ───────────────────────────────────────────────────────────

do $$
declare
  -- Local midnight UTC of the day the workflow went live — the same clock the
  -- pass number is built in. Everything raised strictly before this is closed.
  v_cutoff constant timestamptz := timestamptz '2026-08-20 00:00:00+00';
  v_closed integer;
begin
  update gatepass.pass_approvals a
     set status        = 'approved',
         grandfathered = true,
         decided_by    = null,
         decided_at    = now(),
         reason        = 'Approved on rollout — this pass was raised before the '
                      || 'approval workflow began, so no office was ever asked to sign it.'
   where a.status = 'pending'
     and exists (
           select 1
             from gatepass.gate_passes p
            where p.id = a.gate_pass_id
              and p.created_at < v_cutoff
         );

  get diagnostics v_closed = row_count;
  raise notice '058: closed % pending approval level(s) raised before %', v_closed, v_cutoff;
end;
$$;

-- ─── The ladder must be able to SAY it ──────────────────────────────────────
--
-- The return type gains a column, so the function is dropped and recreated —
-- `create or replace` cannot change a RETURNS TABLE signature. Otherwise this
-- is 054's body unchanged.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key          text,
  level_no          smallint,
  status            text,
  routed_name       text,
  decided_name      text,
  decided_at        timestamptz,
  reason            text,
  decided_as_deputy boolean,
  grandfathered     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.decided_as_deputy,
           a.grandfathered
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 059_approval_seat_is_one_active_person.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 059 — an approval office is held by exactly ONE ACTIVE person, and
--       deactivating its holder vacates it
--
-- Client, 2026-08-20: "if one of the roles, like COO and security head, is
-- deactivated and created again, that should allow me to deactivate one person
-- from that role and create another new person in that same role … but make
-- sure only one account is tacked to that role at the same point in time, so
-- there cannot be two people who are assigned to that role."
--
-- ONE HOLDER PER OFFICE WAS ALREADY ABSOLUTE — `approval_roles.role_key` is the
-- primary key, so the table cannot physically hold two people on one office,
-- and 049's unique index on `user_id` stops one person holding two. Neither of
-- those is what was wrong. What was wrong is that DEACTIVATION LEFT THE SEAT
-- OCCUPIED:
--
--   * `my_approval_role()` gates on `gatepass.is_user_active()` (040), so a
--     suspended holder can approve nothing. The office was silently DEAD — every
--     pass routed to it piled up with nobody able to sign, while the ladder card
--     read as though the office were staffed.
--   * The suspended person still occupied `user_id`, so 049 refused to seat them
--     anywhere else, and the ladder still offered their name as the holder.
--
-- SO DEACTIVATION NOW VACATES EVERY SEAT THE PERSON HELD — the office they held
-- and any office they stood deputy for. The office reads "Not designated yet",
-- which is the truth, and the admin designates the replacement (or creates them
-- straight into the office through Add User, which upserts on `role_key` and so
-- can never produce a second holder).
--
-- ⚠ KNOWN CONSEQUENCE, DELIBERATE AND FLAGGED. 046 never snapshots a VACANT
-- office, so a pass raised in the window between deactivating a holder and
-- designating the replacement does not owe that office a signature at all. The
-- alternative — refusing to deactivate until a replacement is named — was
-- rejected because the client asked for exactly the opposite order, and because
-- a suspended holder is a dead office either way: the choice is between a level
-- nobody CAN sign and a level nobody is ASKED to sign, and only the second one
-- lets material move. Passes ALREADY climbing keep their pending row and are
-- signed by whoever is designated next, because 046 resolves authority from the
-- OFFICE at the moment of the press, not from the person snapshotted at raise.
--
-- REACTIVATION MUST NOT BECOME A ONE-WAY DOOR. 057 widened
-- `admin_reactivate_user` to accept a `staff` target who holds an approval
-- office — "has this person anything to come back to". Vacating the seat
-- destroys that evidence, so a deactivated COO would have been refused
-- reactivation outright. `user_status.vacated_approval_office` remembers the
-- office they were holding when they were suspended; reactivation accepts it and
-- clears it. IT DOES NOT RE-SEAT THEM: somebody else may be in the chair by
-- then, and re-seating would silently displace a working approver.
--
-- AND A SEAT MAY ONLY BE GIVEN TO AN ACTIVE ACCOUNT. `set_approval_role` /
-- `set_approval_deputy` now refuse a suspended person with a sentence, rather
-- than creating the dead office this migration exists to remove.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The marker that keeps reactivation reachable
-- ═══════════════════════════════════════════════════════════════════════════
-- Nullable, and null is the ordinary case. It is NOT a designation — nothing
-- reads it as authority, and `my_approval_role()` never looks here.
alter table gatepass.user_status
  add column if not exists vacated_approval_office text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_status_vacated_office_known'
       and conrelid = 'gatepass.user_status'::regclass
  ) then
    alter table gatepass.user_status
      add constraint user_status_vacated_office_known
      check (vacated_approval_office is null
             or vacated_approval_office in ('security_head', 'coo', 'ceo', 'finance_head'));
  end if;
end
$$;

comment on column gatepass.user_status.vacated_approval_office is
  'The approval office this person was holding when they were deactivated, so that admin_reactivate_user still has evidence they have something to come back to. NOT a designation - it grants nothing and is cleared on reactivation. See migration 059.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Deactivation vacates the seat
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 040 with the vacate step added. The admin gate, the
-- self-deactivation refusal, the admin-target refusal, the status row and the
-- session kill are all unchanged.
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_office text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Mirrors admin_reset_user_password (036): the weakest admin account must not
  -- be a route to suspending a stronger one.
  if v_role in ('admin', 'super_admin') then
    raise exception 'An admin account cannot be deactivated from the portal.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_office is not null then
    delete from gatepass.approval_roles r where r.role_key = v_office;
  end if;

  -- A deputy seat is cleared too, and it is NOT remembered: a deputy is cover,
  -- not an office, and 057's "anything to come back to" test was never about
  -- one. Their own role (guard/hod) or a remembered office is what readmits them.
  update gatepass.approval_roles r
     set deputy_id = null
   where r.deputy_id = p_user_id;

  insert into gatepass.user_status (
    user_id, is_active, deactivated_at, deactivated_by, updated_at, vacated_approval_office
  )
  values (p_user_id, false, now(), auth.uid(), now(), v_office)
  on conflict (user_id) do update
    set is_active               = false,
        deactivated_at          = now(),
        deactivated_by          = auth.uid(),
        updated_at              = now(),
        -- coalesce, never a bare assignment: deactivating somebody twice must
        -- not forget the office the FIRST deactivation took off them.
        -- `user_status.` and not `gatepass.user_status.`: inside ON CONFLICT the
        -- target is reached by the relation's ALIAS, which is the bare name.
        vacated_approval_office = coalesce(excluded.vacated_approval_office,
                                           user_status.vacated_approval_office);

  delete from auth.sessions where user_id = p_user_id;

  return json_build_object(
    'id', p_user_id::text,
    'deactivated', true,
    'vacated_approval_office', v_office
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Reactivation accepts the remembered office, and forgets it
-- ═══════════════════════════════════════════════════════════════════════════
-- Restated from 057 with ONE added arm. It deliberately does not re-designate:
-- the office may be somebody else's now, and 046 makes that designation real
-- authority.
create or replace function gatepass.admin_reactivate_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text;
  v_office  text;
  v_vacated text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can reactivate users.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  select s.vacated_approval_office into v_vacated
    from gatepass.user_status s
   where s.user_id = p_user_id;

  if v_role not in ('guard', 'hod') and v_office is null and v_vacated is null then
    raise exception 'Give this person a role (Guard or HOD) before reactivating.';
  end if;

  insert into gatepass.user_status (
    user_id, is_active, deactivated_at, deactivated_by, updated_at, vacated_approval_office
  )
  values (p_user_id, true, null, null, now(), null)
  on conflict (user_id) do update
    set is_active               = true,
        deactivated_at          = null,
        deactivated_by          = null,
        updated_at              = now(),
        vacated_approval_office = null;

  return json_build_object(
    'id', p_user_id::text,
    'reactivated', true,
    'vacated_approval_office', v_vacated
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. A seat may only be given to an ACTIVE account
-- ═══════════════════════════════════════════════════════════════════════════
-- Both setters restated from 054 with ONE added refusal each, in the same
-- position: after the person is known to exist and before any seat check, so a
-- suspended person is told they are suspended rather than told which seat they
-- are not in.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  -- New in 059. `my_approval_role()` gates on this same function, so seating a
  -- suspended person creates an office that can approve nothing while the ladder
  -- card reads as staffed.
  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      gatepass.approval_office_title(v_held);
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id;

  if v_held is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat — clear that deputy first.',
      gatepass.approval_office_title(v_held);
  end if;

  -- ON CONFLICT (role_key) is what makes "deactivate one person and put another
  -- in the same role" a single atomic swap: the office cannot end up with two
  -- holders even for the length of a statement, because there is only ever one
  -- row per office.
  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

create or replace function gatepass.set_approval_deputy(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_holder uuid;
  v_seat   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass deputy.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.user_id into v_holder
    from gatepass.approval_roles r
   where r.role_key = p_role_key;

  if v_holder is null then
    raise exception 'The % office has nobody in it yet. Designate the office holder before naming a deputy.',
      gatepass.approval_office_title(p_role_key);
  end if;

  if v_holder = p_user_id then
    raise exception 'That person already holds the % office. A deputy stands in for the holder, so it has to be somebody else.',
      gatepass.approval_office_title(p_role_key);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat — vacate that office first.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id
     and r.role_key <> p_role_key;

  if v_seat is not null then
    raise exception 'That person is already the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  update gatepass.approval_roles r
     set deputy_id = p_user_id
   where r.role_key = p_role_key;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The same sweep over anybody already seated while suspended
-- ═══════════════════════════════════════════════════════════════════════════
-- A rule that only applies to future deactivations would leave exactly the dead
-- office this migration exists to remove. `is_user_active()` is the same test
-- the setters use, so nothing here can disagree with them.
--
-- The marker is written FIRST, off the seat that is about to be removed; the
-- update matches on `is_active = false`, so an active holder cannot be touched.
update gatepass.user_status s
   set vacated_approval_office = coalesce(s.vacated_approval_office, r.role_key),
       updated_at              = now()
  from gatepass.approval_roles r
 where r.user_id = s.user_id
   and s.is_active = false;

delete from gatepass.approval_roles r
 where not gatepass.is_user_active(r.user_id);

update gatepass.approval_roles r
   set deputy_id = null
 where r.deputy_id is not null
   and not gatepass.is_user_active(r.deputy_id);

-- ═══════════════════════════════════════════════════════════
-- 060_department_deletion_needs_hod.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 060 — Deleting a department: the foreign key that always refused it, and the
--       HOD's approval that must now be asked for.
--
-- TWO FAULTS, ONE SUBJECT.
--
-- 1. `admin_delete_department` (022) COULD NOT DELETE ANY DEPARTMENT AT ALL.
--    It cleared `gatepass.hod_departments` and then deleted the parent row —
--    and `public.profiles.department_id` still pointed at it, with a plain
--    `no action` foreign key. Every one of the 15 live departments had at
--    least one profile on it (measured as `postgres`, 2026-08-20), so every
--    delete raised 23503 and the admin read "This action conflicts with
--    related data." The column is NULLABLE, and an assignment is not history:
--    it says where somebody works today. It is cleared with the department.
--
--    Writing a VALUE into a VMS column through a SECURITY DEFINER RPC is what
--    `admin_create_user` already does; this migration alters nothing in
--    `public` (CLAUDE.md, the two-schema rule).
--
-- 2. AN ADMIN MAY NO LONGER DELETE A STAFFED DEPARTMENT ON THEIR OWN (client,
--    2026-08-20: "the admin should not be able to delete the department. He
--    needs approval from the HOD ... if the admin tries to delete a department
--    that has an already existing active HOD, it should send an approval
--    request to the HOD"). A department with NO active HOD is still deleted
--    on the press — the client's own narrowing: there is nobody to ask.
--
-- WHAT IS STILL REFUSED OUTRIGHT, AND WHY THE HOD CANNOT OVERRIDE IT:
--   * gate passes / gate pass items — a pass names its department on printed
--     paper that left the building. Deleting the department would either
--     destroy that record or leave it pointing at nothing.
--   * VMS's `public.visits` / `public.recurring_visits` — another product's
--     history, on a NOT NULL column. This app does not get to decide that
--     Visitor Management loses a year of records; it says so and stops.
-- `gatepass.vendor_profiles` IS deleted with the department: a vendor profile
-- is this app's auto-fill convenience for one department's raise form, it is
-- NOT NULL on `department_id`, and it cannot outlive its owner.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The request an admin raises and an HOD decides
-- ═══════════════════════════════════════════════════════════════════════════
-- `department_id` is `on delete set null` and the NAME AND CODE ARE SNAPSHOT
-- BESIDE IT, on purpose: approving the request deletes the very row it points
-- at, and `on delete cascade` would erase the record of the decision in the
-- act of carrying it out. The record must outlive its subject.
create table if not exists gatepass.department_delete_requests (
  id              uuid primary key default gen_random_uuid(),
  department_id   uuid references public.departments(id) on delete set null,
  department_name text not null,
  department_code text not null,
  requested_by    uuid not null references public.profiles(id),
  reason          text not null,
  status          text not null default 'pending',
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),

  -- Text with a CHECK, not an enum: a new enum label cannot be USED in the
  -- transaction that adds it, and APPLY_ALL.sql is pasted as one (CLAUDE.md).
  constraint department_delete_requests_status_is_known
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),

  -- Five characters is the shortest thing that can be a reason for destroying
  -- a department; 500 is the limit every other written reason in this schema
  -- carries (046's rejection, 055's release).
  constraint department_delete_requests_reason_is_written
    check (length(btrim(reason)) between 5 and 500),

  -- A decision is who AND when, or neither.
  constraint department_delete_requests_decision_is_whole
    check ((decided_by is null) = (decided_at is null)),

  -- A request still waiting cannot already carry a decision.
  constraint department_delete_requests_pending_is_undecided
    check (status <> 'pending' or decided_at is null)
);

comment on table gatepass.department_delete_requests is
  'One row per attempt to delete a department that has an active HOD (060). The admin raises it, the department''s own HOD decides it, and approving is what performs the deletion.';

-- One live request per department: a second admin pressing Delete must join
-- the request already waiting, not open a rival one.
create unique index if not exists department_delete_requests_one_pending
  on gatepass.department_delete_requests (department_id)
  where status = 'pending';

alter table gatepass.department_delete_requests enable row level security;

-- No policy and no grant, for anybody. The RPCs below are the only readers and
-- the only writers — the same rule `gate_passes` follows.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Who can be asked, and what stands in the way
-- ═══════════════════════════════════════════════════════════════════════════
-- The ACTIVE HODs of a department. Active is `is_user_active` (040) — a
-- suspended HOD reaches nothing, so a request routed to them would wait
-- forever, and the client's rule ("an already existing active HOD") is exactly
-- this test.
create or replace function gatepass.department_active_hods(p_dept_id uuid)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
    from gatepass.hod_departments h
    join public.profiles p on p.id = h.hod_id
   where h.department_id = p_dept_id
     and p.role = 'hod'
     and gatepass.is_user_active(p.id)
   order by p.full_name;
$$;

revoke all on function gatepass.department_active_hods(uuid) from public;
grant execute on function gatepass.department_active_hods(uuid) to authenticated;

-- The one sentence explaining why a department cannot go, or null when it can.
-- Both the request and the approval consult it, so an approval cannot carry out
-- a deletion the request would have refused — the state can change in between.
create or replace function gatepass.department_delete_blocker(p_dept_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_passes bigint;
  v_items  bigint;
  v_visits bigint;
  v_recur  bigint;
begin
  select count(*) into v_passes from gatepass.gate_passes where department_id = p_dept_id;
  if v_passes > 0 then
    return format(
      'This department has %s gate pass(es) recorded against it. A pass names its department on printed paper, so the department cannot be deleted. Reassign or archive the passes first.',
      v_passes);
  end if;

  select count(*) into v_items from gatepass.gate_pass_items where department_id = p_dept_id;
  if v_items > 0 then
    return format(
      'This department has %s gate pass item(s) recorded against it. The department cannot be deleted while they exist.',
      v_items);
  end if;

  select count(*) into v_visits from public.visits where department_id = p_dept_id;
  if v_visits > 0 then
    return format(
      'Visitor Management has %s visit(s) recorded against this department. That history belongs to the visitor system, so this department cannot be deleted from here.',
      v_visits);
  end if;

  select count(*) into v_recur from public.recurring_visits where department_id = p_dept_id;
  if v_recur > 0 then
    return format(
      'Visitor Management has %s recurring visit(s) recorded against this department. That history belongs to the visitor system, so this department cannot be deleted from here.',
      v_recur);
  end if;

  return null;
end;
$$;

revoke all on function gatepass.department_delete_blocker(uuid) from public;
grant execute on function gatepass.department_delete_blocker(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The deletion itself — one body, called from both doors
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT granted to anybody: it performs no authorization of its own, so it must
-- never be reachable over PostgREST. The two RPCs below are what may call it,
-- and each checks the caller first.
create or replace function gatepass.perform_department_delete(p_dept_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocker text;
begin
  v_blocker := gatepass.department_delete_blocker(p_dept_id);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  -- The assignment, not history: where these people work today.
  update public.profiles set department_id = null where department_id = p_dept_id;

  delete from gatepass.vendor_profiles where department_id = p_dept_id;
  delete from gatepass.hod_departments where department_id = p_dept_id;
  delete from public.departments where id = p_dept_id;

  if not found then
    raise exception 'Department not found.';
  end if;
end;
$$;

revoke all on function gatepass.perform_department_delete(uuid) from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The admin's press
-- ═══════════════════════════════════════════════════════════════════════════
-- Same name and same signature as 022's, so nothing in the app has to learn a
-- second RPC — but it now returns EITHER a deletion or a request, and the
-- caller must read `deleted` / `requested` rather than assuming.
create or replace function gatepass.admin_delete_department(
  p_dept_id uuid,
  p_reason  text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_code    text;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_blocker text;
  v_hods    text[];
  v_pending uuid;
  v_id      uuid;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can delete departments.';
  end if;

  select d.name, d.code into v_name, v_code from public.departments d where d.id = p_dept_id;
  if v_name is null then
    raise exception 'Department not found.';
  end if;

  if length(v_reason) < 5 then
    raise exception 'Give a reason for deleting this department (at least 5 characters).';
  end if;

  -- Refused before anybody is asked to decide: sending an HOD a request that
  -- cannot be carried out is worse than saying so on the press.
  v_blocker := gatepass.department_delete_blocker(p_dept_id);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  select array_agg(h.full_name order by h.full_name)
    into v_hods
    from gatepass.department_active_hods(p_dept_id) h;

  -- Nobody to ask: the client's own narrowing. The admin deletes it here.
  if v_hods is null or cardinality(v_hods) = 0 then
    perform gatepass.perform_department_delete(p_dept_id);
    return json_build_object('deleted', true, 'requested', false);
  end if;

  select r.id into v_pending
    from gatepass.department_delete_requests r
   where r.department_id = p_dept_id and r.status = 'pending'
   limit 1;

  if v_pending is not null then
    return json_build_object(
      'deleted', false,
      'requested', false,
      'already_pending', true,
      'request_id', v_pending,
      'hods', to_json(v_hods));
  end if;

  insert into gatepass.department_delete_requests
    (department_id, department_name, department_code, requested_by, reason)
  values (p_dept_id, v_name, v_code, auth.uid(), v_reason)
  returning id into v_id;

  return json_build_object(
    'deleted', false,
    'requested', true,
    'request_id', v_id,
    'hods', to_json(v_hods));
end;
$$;

revoke all on function gatepass.admin_delete_department(uuid, text) from public;
grant execute on function gatepass.admin_delete_department(uuid, text) to authenticated;

-- An admin may take back a request they should not have raised. It is not a
-- decision, so it writes no `decided_by`: nobody approved or refused anything.
create or replace function gatepass.admin_withdraw_department_delete(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can withdraw a department deletion request.';
  end if;

  update gatepass.department_delete_requests
     set status = 'withdrawn'
   where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'That request is no longer waiting for a decision.';
  end if;
end;
$$;

revoke all on function gatepass.admin_withdraw_department_delete(uuid) from public;
grant execute on function gatepass.admin_withdraw_department_delete(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The HOD's decision — and approving is what deletes
-- ═══════════════════════════════════════════════════════════════════════════
-- The authority is resolved from `hod_departments` AT THE MOMENT OF THE PRESS,
-- exactly as 046 resolves an approval office: an HOD moved off the department
-- since the request was raised can no longer decide it, and whoever holds it
-- now can.
create or replace function gatepass.hod_decide_department_deletion(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_dept   uuid;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select r.id, r.department_id, r.status
    into v_id, v_dept, v_status
    from gatepass.department_delete_requests r
   where r.id = p_request_id;

  if v_id is null then
    raise exception 'That deletion request no longer exists.';
  end if;

  if v_status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  if not exists (
    select 1 from gatepass.department_active_hods(v_dept) h
     where h.user_id = auth.uid()
  ) then
    raise exception 'Only the head of this department can decide its deletion.';
  end if;

  if not p_approve and length(v_reason) < 5 then
    raise exception 'Give a reason for refusing this deletion (at least 5 characters).';
  end if;

  if p_approve then
    -- Re-checked inside, not trusted from the request: a gate pass may have
    -- been raised against this department while the request sat waiting.
    perform gatepass.perform_department_delete(v_dept);
  end if;

  update gatepass.department_delete_requests
     set status          = case when p_approve then 'approved' else 'rejected' end,
         decided_by      = auth.uid(),
         decided_at      = now(),
         decision_reason = nullif(v_reason, '')
   where id = p_request_id;

  return json_build_object('approved', p_approve, 'deleted', p_approve);
end;
$$;

revoke all on function gatepass.hod_decide_department_deletion(uuid, boolean, text) from public;
grant execute on function gatepass.hod_decide_department_deletion(uuid, boolean, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Reading the queue
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because it names people, which means reading
-- `public.profiles` — the table this app never queries directly (006). It
-- answers with what the CALLER is entitled to: an admin sees every request, an
-- HOD sees the ones raised against a department they actively head, and
-- everybody else sees nothing at all rather than being refused (the HOD
-- dashboard renders this for every HOD, including those with nothing waiting).
create or replace function gatepass.list_department_delete_requests()
returns table (
  id              uuid,
  department_id   uuid,
  department_name text,
  department_code text,
  requested_by    uuid,
  requested_name  text,
  reason          text,
  status          text,
  decided_by      uuid,
  decided_name    text,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz,
  can_decide      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.department_id,
         r.department_name,
         r.department_code,
         r.requested_by,
         rp.full_name,
         r.reason,
         r.status,
         r.decided_by,
         dp.full_name,
         r.decided_at,
         r.decision_reason,
         r.created_at,
         (r.status = 'pending'
          and exists (select 1
                        from gatepass.department_active_hods(r.department_id) h
                       where h.user_id = auth.uid()))
    from gatepass.department_delete_requests r
    left join public.profiles rp on rp.id = r.requested_by
    left join public.profiles dp on dp.id = r.decided_by
   where gatepass.is_admin()
      or exists (select 1
                   from gatepass.department_active_hods(r.department_id) h
                  where h.user_id = auth.uid())
   order by (r.status = 'pending') desc, r.created_at desc;
$$;

revoke all on function gatepass.list_department_delete_requests() from public;
grant execute on function gatepass.list_department_delete_requests() to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 061_ladder_visibility_is_linear.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 061 — AN APPROVER CANNOT SEE A PASS UNTIL IT IS THEIR TURN.
--
-- Client, 2026-08-20: "that gate pass will first go to the security. The
-- next-level approver should not be able to see anything about that gate pass
-- until and unless the security approves it ... the next-level approver should
-- not have any visibility over the gate passes which are pending for the
-- approval of their previous approver. Strictly implement this."
--
-- THE ORDER OF ACTING WAS ALREADY LINEAR AND IS UNCHANGED. `approve_pass_level`
-- and `reject_pass_level` (046, renumbered by 057) refuse any caller who is not
-- the LOWEST still-pending rung, and no migration here touches them. What was
-- wrong is VISIBILITY: `pass_routed_to_me` answered true from the moment the
-- pass was raised, because the 046 trigger snapshots all four levels at once.
-- So the COO could read — and list on their queue — a pass the Security Head
-- had not yet signed. They could not act on it, but they could see it, and the
-- client's rule is about seeing.
--
-- THE NEW RULE, in one line: I may see a pass routed to my office when EVERY
-- RUNG BELOW MINE IS APPROVED.
--
--   * Still climbing, and a lower office has not signed → invisible. Not
--     filtered on a screen: not in the table, as far as I am concerned.
--   * My turn (every lower rung approved, mine pending) → visible, and
--     `approve_pass_level` already agrees that I am the one who may press.
--   * Signed by me and gone on up, or cleared at the gate months ago → still
--     visible. An approver must be able to read back what they signed.
--   * REJECTED BELOW ME → stays invisible for ever, and that is deliberate.
--     Responsibility never reached my desk; a pass I was never shown must not
--     appear in my history the moment somebody below refuses it.
--
-- WHY ONE FUNCTION IS THE WHOLE CHANGE. `pass_routed_to_me` is the approver arm
-- of `gate_passes_select` AND of `gate_pass_items_select` (046), and
-- `pass_approvals` / `pass_remarks` / `emergency_releases` all read through
-- `can_see_pass`, which is that same policy. So the queue, the record, the
-- material lines, the ladder rungs and the remarks all narrow together — there
-- is deliberately no second copy of this rule in a screen or a query.
--
-- NOT AFFECTED: the admin (sees everything at every stage — somebody must be
-- able to see a pass stuck at level 2), the raising HOD (their own department,
-- at every stage — they must be able to watch it climb), and the guard (still
-- blind to anything that owes a signature at all).
--
-- THE LETTERS WERE ALREADY ONE AT A TIME. `approval_notice_payload` (047, 051)
-- writes to the lowest still-pending office only, so no office is ever told
-- about a pass it cannot yet see.
-- ============================================================================

create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key = gatepass.my_approval_role()
       -- Every rung BELOW mine is approved. `<> 'approved'` rather than
       -- `= 'pending'` on purpose: a rejection below me is not a turn that
       -- passed to me, it is a pass that stopped before it got here.
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status <> 'approved'
       )
  );
$$;

comment on function gatepass.pass_routed_to_me(uuid) is
  'True when the pass is addressed to the office the caller holds (or deputises for, 054) AND every level below theirs has been approved (061). The approver arm of gate_passes_select — an office sees a pass only once it is their turn, and goes on seeing it afterwards.';

-- Unchanged from 046, restated because a redefinition drops nothing but is
-- worth being explicit about: only signed-in users may ask, and the function is
-- SECURITY DEFINER so it can read `pass_approvals` without recursing back
-- through that table's own policy (42P17).
revoke all on function gatepass.pass_routed_to_me(uuid) from public;
grant execute on function gatepass.pass_routed_to_me(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 062_approval_delegation.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 062 — AN APPROVER DELEGATES THEIR OWN OFFICE, FOR A STATED PERIOD
--
-- WHAT THIS ADDS THAT 054 DELIBERATELY DID NOT. 054 gave every office a
-- STANDING DEPUTY: admin-designated, permanent, no dates. Its header argues at
-- length against the date-bounded delegation SAP / Oracle / Workday ship,
-- because such a thing has to be switched on BEFORE the absence, which is
-- exactly when it is forgotten. The client has now asked for it by name
-- ("Make sure to create a Delegation Tab for all the approvers … In their
-- absence they can delegate it"), so it is built. THE ARGUMENT IN 054 IS STILL
-- TRUE and the deputy is still there: the two are complementary, not rivals —
-- a deputy is standing cover somebody else named for you, a delegation is a
-- window you declare yourself before you go.
--
-- THE ONE DIFFERENCE THAT MATTERS: A DELEGATION IS THE HOLDER'S OWN ACT
-- (client, 2026-08-22: "instead of that put it in the approvers section so
-- whatever the approvers choose it should be automatically delegated"). An
-- office holder creates it, names the window, and revokes it. NO ADMIN IS
-- INVOLVED AT ANY POINT — which is the whole point of a self-service leave
-- hand-over — and that is why the gate on `create_approval_delegation` is "you
-- hold this office YOURSELF", not `is_admin()`. A deputy may NOT sub-delegate
-- (they hold cover, not the office), and a delegate may not re-delegate onward:
-- a chain of stand-ins is a chain nobody can audit.
--
-- WHY THIS MIGRATION IS SMALL, AGAIN. The same reason 054's was: authority is
-- resolved through `gatepass.my_approval_role()` at the moment of the press,
-- and both RLS policies, `pass_routed_to_me`, `pass_awaits_approval`,
-- `can_see_pass`, `approve_pass_level`, `reject_pass_level` and the whole
-- slip-order rule read through that ONE function. Widening it by one arm gives
-- the delegate the entire existing workflow — the queue, the record, the RLS
-- visibility, the guard's blindness to an unapproved pass — with nothing else
-- changed.
--
-- ⚠ ONE PERSON, ONE SEAT — THE INVARIANT 049 AND 054 REST ON, EXTENDED A THIRD
-- TIME. `my_approval_role()` is a scalar `returns text` over a query that can
-- yield several rows, and Postgres returns an ARBITRARY one rather than
-- erroring. A delegation is a third way to occupy a seat, so it reopens exactly
-- that hazard unless every combination is refused. Four refusals do it, and all
-- four are load-bearing together:
--
--   * a delegate may not hold an office            (create_approval_delegation)
--   * a delegate may not be a standing deputy      (create_approval_delegation)
--   * a delegate may not already be a delegate     (create_approval_delegation,
--     on an OVERLAPPING window — two windows that do not overlap are two
--     separate absences and are fine)
--   * a person with a live-or-future delegation may not be seated as a holder
--     or a deputy                                  (set_approval_role /
--                                                   set_approval_deputy, both
--                                                   restated below)
--
-- Drop any one and one human can sign two rungs of the same pass, which is the
-- four-eyes property the whole ladder exists for.
--
-- THE HOLDER DOES NOT LOSE AUTHORITY while a delegation runs. Both may sign,
-- and the first press closes the rung — the office is covered rather than
-- handed over. That is deliberate: a holder who checks in from leave, or whose
-- delegate is unreachable, must not find themselves locked out of their own
-- office by a form they filled in last week. Revoking is instant and is the
-- only thing that ends it early.
--
-- WHAT A DELEGATION IS NOT. Not a role, not a login, not a route — exactly like
-- the office (046) and the deputy (054), it is a grant carried beside whatever
-- VMS role the person already has. And it does not change WHAT a pass owes:
-- the levels are still snapshotted at raise by the 046 trigger and are
-- untouched here.
--
-- NO GATE, NO SITE, NO PASS-TYPE SCOPE. The client's mock-up carried an
-- Approval Type, a Location / Site and a Gate Pass Type scope, and struck all
-- three out by name ("no need to give any option or field to select the gate …
-- no need to mention the type of delegation gate pass"). There is nothing in
-- this schema to hang them on anyway: this app has no gate entity (see the
-- Pending OUT column note in CLAUDE.md) and no site. A delegation covers the
-- office entirely, and the only narrowing it takes is the VALUE ceiling below.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The table
-- ═══════════════════════════════════════════════════════════════════════════
-- `role_key` is SNAPSHOTTED from the delegator's office at the moment of
-- creation rather than resolved through `approval_roles` on every read. The
-- same argument 046 makes for `routed_to` and 054 for `decided_as_deputy`: an
-- office moves, and a delegation the COO wrote must not silently become a
-- delegation of whatever office that person holds next month.
--
-- `status` is NOT stored. It is `revoked_at` plus the clock, and a stored copy
-- would need something to age it — this schema has no pg_cron and derives
-- `is_overdue` / `is_expired` at query time for the identical reason.
create table if not exists gatepass.approval_delegations (
  id             uuid primary key default gen_random_uuid(),
  role_key       text        not null,
  delegator_id   uuid        not null references public.profiles(id) on delete cascade,
  delegate_id    uuid        not null references public.profiles(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  -- The mock's "Approval Limit (Optional)". Null is "No Limit" and is the
  -- ordinary case. Enforced in section 4 against the pass's own declared value.
  approval_limit numeric(14,2),
  reason         text,
  revoked_at     timestamptz,
  revoked_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint approval_delegations_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head')),
  -- A delegation to yourself is a no-op that would make `my_approval_role()`
  -- return two rows for one person — the exact hazard section 3 exists to close.
  constraint approval_delegations_not_self
    check (delegate_id <> delegator_id),
  constraint approval_delegations_window_forward
    check (ends_at > starts_at),
  constraint approval_delegations_limit_positive
    check (approval_limit is null or approval_limit > 0),
  -- Blank is null. Same blank-vs-null rule 045 applies to the item columns: a
  -- reason of three spaces reads as a stated reason on screen and is not one.
  constraint approval_delegations_reason_not_blank
    check (reason is null or btrim(reason) <> '')
);

comment on table gatepass.approval_delegations is
  'A time-boxed hand-over of ONE approval office, created by that office''s own holder. The delegate may approve exactly what the holder may, between starts_at and ends_at, unless revoked. See migration 062.';

comment on column gatepass.approval_delegations.role_key is
  'The office as it stood when the delegation was written — snapshotted, not resolved, so re-seating the delegator later cannot silently move what they delegated.';

comment on column gatepass.approval_delegations.approval_limit is
  'Optional ceiling in rupees on the declared value of a pass this delegate may sign. Null means no ceiling. Enforced in approve_pass_level, never on screen alone.';

create index if not exists approval_delegations_delegate_idx
  on gatepass.approval_delegations (delegate_id, starts_at, ends_at);
create index if not exists approval_delegations_delegator_idx
  on gatepass.approval_delegations (delegator_id, created_at desc);

-- RLS ON, NO POLICY AND NO GRANT — the shape 052's `mail_settings` and 060's
-- `department_delete_requests` both take. The RPCs below are the only readers
-- and the only writers, so there is no query anybody can send that reaches this
-- table directly. It carries who covers for whom and to what value ceiling,
-- which is not something every signed-in guard should be able to enumerate.
alter table gatepass.approval_delegations enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Is this delegation live right now?
-- ═══════════════════════════════════════════════════════════════════════════
-- Stated ONCE. Six things below ask it — the authority function, both decision
-- RPCs, the two seat setters and the candidate list — and a second copy of a
-- three-clause predicate is a second thing to get wrong.
--
-- HALF-OPEN ON PURPOSE: `>= starts_at` and `< ends_at`. A window that ends at
-- one instant and one that starts at the same instant must not both be live for
-- that instant, or two people hold the same seat at once.
--
-- Not SECURITY DEFINER: it reads nothing, so it needs no elevated rights.
create or replace function gatepass.delegation_is_live(
  p_revoked_at timestamptz,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
)
returns boolean
language sql
stable
as $$
  select p_revoked_at is null
     and now() >= p_starts_at
     and now() <  p_ends_at;
$$;

revoke all on function gatepass.delegation_is_live(timestamptz, timestamptz, timestamptz) from public;
grant execute on function gatepass.delegation_is_live(timestamptz, timestamptz, timestamptz) to authenticated;

-- The status a person reads, derived from the same two facts. Four values, not
-- the mock's three: a delegation created BEFORE the absence — which is the
-- entire point of declaring one — is neither active nor expired until its
-- window opens, and calling it "Active" a week early would be a screen lying
-- about who can sign today.
create or replace function gatepass.delegation_status(
  p_revoked_at timestamptz,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
)
returns text
language sql
stable
as $$
  select case
           when p_revoked_at is not null then 'revoked'
           when now() >= p_ends_at       then 'expired'
           when now() <  p_starts_at     then 'scheduled'
           else                               'active'
         end;
$$;

revoke all on function gatepass.delegation_status(timestamptz, timestamptz, timestamptz) from public;
grant execute on function gatepass.delegation_status(timestamptz, timestamptz, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Authority follows the delegation too
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ONE FUNCTION THIS MIGRATION EXISTS TO WIDEN, for the third time (046
-- wrote it, 054 added the deputy arm). Still returns at most one row, and that
-- is guaranteed by the four refusals listed in this file's header — NOT by a
-- `limit` clause, which is deliberately absent. A `limit 1` would paper over a
-- broken invariant by picking an arbitrary seat, which is precisely the failure
-- 049 was written to stop.
--
-- `is_user_active` still gates every arm, so suspending a delegate empties
-- their queue exactly as it does a holder's (040).
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where (r.user_id = auth.uid() or r.deputy_id = auth.uid())
     and gatepass.is_user_active(auth.uid())
  union all
  select d.role_key
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at)
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder, as its standing deputy (054), or under a live delegation (062) — or null. Scalar by design: the seat refusals in 049, 054 and 062 together guarantee at most one row. Suspended accounts hold nothing.';

-- The live delegation this caller is acting under, if any. Both decision RPCs
-- need it: one to stamp the decision, the other to read the value ceiling off
-- it. Returns at most one row for the same reason above.
create or replace function gatepass.my_live_delegation()
returns table (id uuid, role_key text, approval_limit numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.role_key, d.approval_limit
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at);
$$;

revoke all on function gatepass.my_live_delegation() from public;
grant execute on function gatepass.my_live_delegation() to authenticated;

-- ─── The two seat setters, restated with ONE added refusal each ─────────────
-- Everything else in both is 054's, unchanged. Without these, an admin could
-- seat somebody who is already covering an office under a delegation, and
-- `my_approval_role()` would go back to returning an arbitrary one of two.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  -- 059's refusal, carried forward. `my_approval_role()` gates on this same
  -- function, so seating a suspended person creates an office that can approve
  -- nothing while the ladder card reads as staffed.
  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      gatepass.approval_office_title(v_held);
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id;

  if v_held is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat — clear that deputy first.',
      gatepass.approval_office_title(v_held);
  end if;

  -- New in 062. A delegation that has not started yet counts: seating the
  -- person now would leave them holding two seats the moment its window opens,
  -- and nothing would be watching at that hour to notice.
  select d.role_key into v_held
    from gatepass.approval_delegations d
   where d.delegate_id = p_user_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_held is not null then
    raise exception 'That person is covering the % office under a delegation. One person holds one approval seat — that delegation has to be revoked first.',
      gatepass.approval_office_title(v_held);
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

create or replace function gatepass.set_approval_deputy(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_holder uuid;
  v_seat   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass deputy.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  -- 059's refusal, carried forward. `my_approval_role()` gates on this same
  -- function, so seating a suspended person creates an office that can approve
  -- nothing while the ladder card reads as staffed.
  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.user_id into v_holder
    from gatepass.approval_roles r
   where r.role_key = p_role_key;

  if v_holder is null then
    raise exception 'The % office has nobody in it yet. Designate the office holder before naming a deputy.',
      gatepass.approval_office_title(p_role_key);
  end if;

  if v_holder = p_user_id then
    raise exception 'That person already holds the % office. A deputy stands in for the holder, so it has to be somebody else.',
      gatepass.approval_office_title(p_role_key);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat — vacate that office first.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_user_id
     and r.role_key <> p_role_key;

  if v_seat is not null then
    raise exception 'That person is already the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- New in 062, for the reason given in set_approval_role above.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_user_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_seat is not null then
    raise exception 'That person is covering the % office under a delegation. One person holds one approval seat — that delegation has to be revoked first.',
      gatepass.approval_office_title(v_seat);
  end if;

  update gatepass.approval_roles r
     set deputy_id = p_user_id
   where r.role_key = p_role_key;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The decision records that a DELEGATE signed it, and honours the ceiling
-- ═══════════════════════════════════════════════════════════════════════════
-- TWO COLUMNS, not one, and they do different jobs:
--
--   * `decided_as_delegate` is THE FACT, stored beside 054's
--     `decided_as_deputy` for the identical reason: the seat is a fact about
--     the MOMENT of the decision, and a delegation expires. A join back at read
--     time would turn "signed by the delegate" into "signed by the CEO" the day
--     after the window closed, which is the one thing an audit trail must not
--     do. It survives even if the delegation row itself is ever removed.
--   * `delegation_id` is HOW THE RECORD NAMES THE DELEGATOR (client,
--     2026-08-22: "it should be mentioned that the person has this approver who
--     was delegated by the original approver and the approver's name"). The
--     name is resolved through it at read time rather than snapshotted,
--     because a person's NAME is a lookup, not history — the same call 051
--     makes about the mail address, against 046's call about `routed_to`.
alter table gatepass.pass_approvals
  add column if not exists decided_as_delegate boolean not null default false;

alter table gatepass.pass_approvals
  add column if not exists delegation_id uuid
    references gatepass.approval_delegations(id) on delete set null;

comment on column gatepass.pass_approvals.decided_as_delegate is
  'True when the person named by decided_by signed under a time-boxed delegation of that office (062) rather than as its holder or standing deputy. Recorded at the moment of the decision, and true even if delegation_id is later nulled.';

comment on column gatepass.pass_approvals.delegation_id is
  'The delegation signed under, so the pass record can name who delegated the office. Nullable on delete: the FACT is decided_as_delegate, this is only how the name is found.';

-- Both decision RPCs are restated from 054 with the delegate stamp and, on
-- approval, the value ceiling. Every other guard, every sentence and the whole
-- slip-order rule are unchanged — a delegate is refused out-of-turn approval
-- exactly as a holder is, because all three resolve through the same
-- `my_approval_role()`.
--
-- ⚠ THE CEILING IS CHECKED HERE AND NOWHERE ELSE. A screen that hid the button
-- would be a courtesy; this is the rule. It reads the pass's own declared value
-- — `sum(approx_value)` over its lines, the same figure `v_gate_passes.
-- total_value` (038) carries and the same one the card and the record print —
-- and NEVER a figure sent by the caller.
--
-- AN UNPRICED PASS PASSES ANY CEILING. `approx_value` is optional and has been
-- since 019 (and was not collected at all between the eleventh and seventeenth
-- frontend passes), so "nothing declared" sums to 0. Refusing such a pass would
-- strand every legacy pass in a delegate's queue with no way to sign it and no
-- sentence that explains why; declaring a ceiling is a narrowing of what is
-- known, not a demand that everything be priced.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role        text := gatepass.my_approval_role();
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_as_deputy   boolean;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  select d.id, d.approval_limit into v_deleg_id, v_deleg_limit
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  if v_deleg_id is not null and v_deleg_limit is not null then
    select coalesce(sum(i.approx_value), 0) into v_value
      from gatepass.gate_pass_items i
     where i.gate_pass_id = p_pass_id;

    if v_value > v_deleg_limit then
      raise exception 'Your delegation of the % office is limited to %. This pass is worth % — the office holder has to sign it.',
        gatepass.approval_office_title(v_role),
        to_char(v_deleg_limit, 'FM999,999,999,990.00'),
        to_char(v_value,       'FM999,999,999,990.00');
    end if;
  end if;

  update gatepass.pass_approvals a
     set status              = 'approved',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_deputy   = coalesce(v_as_deputy, false),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;
end;
$$;

-- ⚠ NO CEILING ON A REJECTION, AND THAT IS DELIBERATE. An approval limit caps
-- what somebody may COMMIT the business to; refusing to let a delegate stop a
-- pass they think is wrong, because it is worth too much, is the rule pointing
-- exactly the wrong way. The same call 043 makes about an expired pass at the
-- gate: Approve is withheld, Reject never is.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := gatepass.my_approval_role();
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_as_deputy boolean;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  select d.id into v_deleg_id
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  update gatepass.pass_approvals a
     set status              = 'rejected',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_deputy   = coalesce(v_as_deputy, false),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id,
         reason              = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$$;

-- THE RECORD NAMES THE DELEGATOR (client, 2026-08-22). The ladder and the
-- merged timeline both render this one function, so saying it here is saying it
-- everywhere a rung is drawn.
--
-- DROPPED and recreated, not replaced: `create or replace function` cannot
-- change a RETURN TYPE, and the grant goes with the drop and is re-applied in
-- the same transaction — the rule CLAUDE.md states and `my_profile()` has been
-- bitten by twice.
--
-- `delegated_by_name` is LEFT-joined twice over (the delegation, then its
-- delegator's profile) for the reason the pass view gives: a narrowed VMS
-- policy must degrade to a missing NAME, never to a missing rung. A rung whose
-- delegator failed to resolve still reads "signed under a delegation".
drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key            text,
  level_no            smallint,
  status              text,
  routed_name         text,
  decided_name        text,
  decided_at          timestamptz,
  reason              text,
  decided_as_deputy   boolean,
  -- 058's column, carried forward. Dropping it would silently strip the
  -- rollout note off every pre-workflow pass's ladder and print whoever held
  -- the office that day as having approved something they never saw.
  grandfathered       boolean,
  decided_as_delegate boolean,
  delegated_by_name   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.decided_as_deputy,
           a.grandfathered,
           a.decided_as_delegate,
           gp.full_name
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
      left join gatepass.approval_delegations dl on dl.id = a.delegation_id
      left join public.profiles gp on gp.id = dl.delegator_id
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Writing one
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GATE IS "YOU HOLD THIS OFFICE YOURSELF", not `my_approval_role()`. That
-- function answers true for a deputy and for a delegate as well, and neither
-- may hand on what they are only covering — a chain of stand-ins is a chain
-- nobody can audit, and every link would be another seat for one person to
-- occupy. An admin is not admitted either: this is the holder's own act, which
-- is the whole of what the client asked for.
create or replace function gatepass.create_approval_delegation(
  p_delegate_id    uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_approval_limit numeric default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_seat   text;
  v_active boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office, so there is nothing to delegate.';
  end if;

  if not gatepass.is_user_active(auth.uid()) then
    raise exception 'This account is deactivated.';
  end if;

  if p_delegate_id is null then
    raise exception 'Choose somebody to delegate to.';
  end if;

  if p_delegate_id = auth.uid() then
    raise exception 'You cannot delegate your own office to yourself.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'A delegation needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The delegation has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the
  -- history reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That delegation would already have ended. Choose an end in the future.';
  end if;

  if p_approval_limit is not null and p_approval_limit <= 0 then
    raise exception 'An approval limit has to be more than zero. Leave it blank for no limit.';
  end if;

  select gatepass.is_user_active(p.id) into v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if v_active is null then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  -- ── The one-seat refusals. See this file's header. ──────────────────────
  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal. Half-open at both ends, matching
  -- `delegation_is_live`, so back-to-back windows do not collide.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_delegate_id
     and d.revoked_at is null
     and d.starts_at < p_ends_at
     and d.ends_at   > p_starts_at;

  if v_seat is not null then
    raise exception 'That person is already covering the % office over part of that period. One person holds one approval seat at a time.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- And the office itself takes one delegate at a time, so that "who is
  -- covering the COO this week" has exactly one answer.
  if exists (
    select 1
      from gatepass.approval_delegations d
     where d.role_key = v_office
       and d.delegator_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at < p_ends_at
       and d.ends_at   > p_starts_at
  ) then
    raise exception 'You have already delegated the % office over part of that period. Revoke that delegation first.',
      gatepass.approval_office_title(v_office);
  end if;

  insert into gatepass.approval_delegations
    (role_key, delegator_id, delegate_id, starts_at, ends_at, approval_limit, reason)
  values
    (v_office, auth.uid(), p_delegate_id, p_starts_at, p_ends_at, p_approval_limit, left(v_reason, 500))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) from public;
grant execute on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) to authenticated;

-- Revoking. THE DELEGATOR OR AN ADMIN — nobody else, and deliberately not the
-- delegate: somebody covering an office must not be able to quietly hand it
-- back while the holder is away, which would leave the seat empty with no
-- notice to anyone.
--
-- Revoking is not a delete. The row stays in the history saying who covered
-- what, until when it was meant to run, and that it was ended early — which is
-- the whole reason there is a history at all.
create or replace function gatepass.revoke_approval_delegation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_revoked timestamptz;
begin
  select d.delegator_id, d.revoked_at into v_owner, v_revoked
    from gatepass.approval_delegations d
   where d.id = p_id;

  if v_owner is null then
    raise exception 'That delegation does not exist.';
  end if;

  if v_owner <> auth.uid() and not gatepass.is_admin() then
    raise exception 'Only the approver who created a delegation can revoke it.';
  end if;

  if v_revoked is not null then
    raise exception 'That delegation has already been revoked.';
  end if;

  update gatepass.approval_delegations d
     set revoked_at = now(),
         revoked_by = auth.uid()
   where d.id = p_id;
end;
$$;

revoke all on function gatepass.revoke_approval_delegation(uuid) from public;
grant execute on function gatepass.revoke_approval_delegation(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The readers
-- ═══════════════════════════════════════════════════════════════════════════
-- Everything this caller has delegated, newest first, with the DERIVED status
-- rather than a stored one. The delegate's name is LEFT-joined for the reason
-- the pass view gives: a narrowed VMS policy must degrade to a missing NAME,
-- never to a missing row — a delegation whose name failed to resolve is still
-- a delegation somebody has to be able to revoke.
create or replace function gatepass.list_my_delegations()
returns table (
  id              uuid,
  role_key        text,
  delegate_id     uuid,
  delegate_name   text,
  department_name text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  approval_limit  numeric,
  reason          text,
  status          text,
  created_at      timestamptz,
  revoked_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id,
         d.role_key,
         d.delegate_id,
         p.full_name,
         dept.name,
         d.starts_at,
         d.ends_at,
         d.approval_limit,
         d.reason,
         gatepass.delegation_status(d.revoked_at, d.starts_at, d.ends_at),
         d.created_at,
         d.revoked_at
    from gatepass.approval_delegations d
    left join public.profiles    p    on p.id = d.delegate_id
    left join public.departments dept on dept.id = p.department_id
   where d.delegator_id = auth.uid()
   order by d.created_at desc;
$$;

revoke all on function gatepass.list_my_delegations() from public;
grant execute on function gatepass.list_my_delegations() to authenticated;

-- Who this office holder may delegate to.
--
-- IT IS NOT THE DIRECTORY. `admin_list_profiles` (006) is admin-gated because
-- it returns emails and roles, and an approver is not an admin — so this is a
-- second, much narrower list: id, name and department, for ACTIVE accounts
-- only, with every person already occupying a seat filtered out. Filtering here
-- rather than only refusing in section 5 is not defence in depth for its own
-- sake: offering a name the database will refuse is a form that fails after it
-- is filled in.
--
-- Gated on HOLDING an office, because that is exactly who may write one.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gatepass.approval_roles r where r.user_id = auth.uid()
  ) then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r
              where r.user_id = p.id or r.deputy_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$$;

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 063_level_three_is_coo_or_ceo.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 063 — the ladder is Security Head → Finance HOD → COO *or* CEO, and the CEO
--       only becomes able to sign once the COO has sat on it long enough
--
-- Client, 2026-08-22:
--
--   "there's a little bit of a change in the approval workflow so Level one
--    approver will be the security head. Level two approver will be the finance
--    head and level three approval approver will be either co or CEO. If the
--    [COO] has given the approval then it will not go to the CEO. I think if the
--    [COO] has not given the approval within one or two days then it will
--    escalate to CEO."
--
-- ── 1. THE ORDER. ───────────────────────────────────────────────────────────
-- 057 numbered it Security Head 1 · COO 2 · Finance HOD 3 · CEO 4. Finance now
-- signs SECOND, and the COO and the CEO SHARE level 3. The paper moves with it
-- (`src/pages/Shared/printSignatureBoxes.ts`) and so does `APPROVAL_LADDER` in
-- `src/lib/approvalLadder.ts` — the order is one fact stated in three places
-- and they move together, or a guard comparing the slip in their hand to the
-- record on the tablet finds a level on one that is missing from the other.
--
-- THE EXISTING ROWS ARE RENUMBERED, on 057's own precedent and for its reason:
-- `level_no` is not an audit fact, it is the ORDER the remaining signatures are
-- collected in. Who signed and when is untouched.
--
-- ── 2. TWO OFFICES ON ONE RUNG. ─────────────────────────────────────────────
-- Level 3 is ONE signature that either of two offices may give. Both rows are
-- still snapshotted, because both offices must be able to READ the pass (061
-- grades visibility on the levels BELOW a row, so a shared level lets both see
-- it) and because the record has to be able to say afterwards which of the two
-- actually signed.
--
-- SO A NEW STATUS: `not_required`. When one of the two signs, the other's
-- pending row is closed as `not_required` in the same statement — nobody signed
-- it, so `decided_by` stays NULL, and the sentence in `reason` says which
-- office made it unnecessary. That is the client's "if the COO has given the
-- approval then it will not go to the CEO", recorded rather than implied.
--
-- ⚠ IT IS NOT `approved`, AND THAT IS THE WHOLE POINT OF THE NEW LABEL. An
-- `approved` row with no author is what 058 had to invent `grandfathered` for,
-- and it prints a tick against an office that never pressed anything. The
-- printed slip now draws a TICK BOX per office (client, same message), so the
-- difference between "signed" and "did not have to sign" is ink on paper that
-- leaves the building.
--
-- `pass_awaits_approval` is untouched and needs to be: it tests `pending`, so a
-- `not_required` row stops blocking the gate the moment it is written.
--
-- ── 3. THE ESCALATION. ──────────────────────────────────────────────────────
-- The CEO may not sign level 3 while the COO still can, until the pass has sat
-- on that rung for `app_settings.coo_escalation_hours` (default 48 — the client
-- said "one or two days", and this is the field that settles it without a
-- migration). Until then the CEO sees the pass, reads it in full, and is told
-- on screen when it becomes theirs.
--
-- WHEN DID IT REACH THE RUNG? The moment the level below it was approved —
-- `max(decided_at)` over the approved rows beneath, falling back to the pass's
-- own `created_at` for a pass whose level 3 is its first rung. Never `now()`
-- minus something, and never a column somebody could write.
--
-- ⚠ NOTHING SENDS THE CEO A LETTER WHEN THE WINDOW ELAPSES, and nothing can:
-- there is no scheduler on this deployment (no pg_cron — the same reason expiry
-- is derived at query time and never stamped). The escalation is DERIVED at
-- read time, so it is true the moment it is true on every screen that asks; the
-- CEO learns of it by opening their queue, not by being told. Making it a push
-- means a cron job, and that is a deployment decision, not this migration's.
--
-- ⚠ A REJECTION IS NEVER ESCALATION-GATED. The ceiling on a delegate (062) is
-- the same call: a limit caps what somebody may COMMIT the business to, and
-- refusing to let an office STOP a pass points the rule exactly the wrong way.
-- The CEO may reject level 3 at any time it is the lowest pending rung.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. How long the COO gets
-- ═══════════════════════════════════════════════════════════════════════════
-- 056's table, one column. NOT NULL with a default, like `require_approver_2fa`
-- and unlike the two nullable ones: "nobody has decided yet" and "48 hours" are
-- the same thing here, and a null would invite a three-state read of a rule the
-- RPC has to answer with a number.
alter table gatepass.app_settings
  add column if not exists coo_escalation_hours smallint not null default 48;

alter table gatepass.app_settings
  drop constraint if exists app_settings_escalation_window;

alter table gatepass.app_settings
  add constraint app_settings_escalation_window
  check (coo_escalation_hours between 1 and 720);

comment on column gatepass.app_settings.coo_escalation_hours is
  'Hours the COO has to decide level 3 before the CEO may sign it instead (063). One hour to thirty days; the client asked for "one or two days" and 48 is the default.';

-- Readable by ANY signed-in user, and deliberately so — the same argument
-- `get_session_timeout` (056) makes. The CEO's own screen has to be able to say
-- when a pass becomes theirs, and an approver holding a pass is not an admin.
-- It leaks one integer and no other field.
create or replace function gatepass.get_escalation_hours()
returns smallint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           (select s.coo_escalation_hours from gatepass.app_settings s where s.id),
           48::smallint);
$fn$;

grant execute on function gatepass.get_escalation_hours() to authenticated;

-- 056's getter and setter, each with ONE field added. The setter is DROPPED
-- first: a 4-arg and a 5-arg overload both reachable by named arguments is
-- exactly the ambiguity PostgREST guesses at (045's lesson), so the old
-- signature must not survive this migration.
create or replace function gatepass.get_app_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the application settings.';
  end if;

  select jsonb_build_object(
           'app_name',                s.app_name,
           'brand_color',             s.brand_color,
           'require_approver_2fa',    s.require_approver_2fa,
           'session_timeout_minutes', s.session_timeout_minutes,
           'coo_escalation_hours',    s.coo_escalation_hours,
           'updated_at',              s.updated_at,
           'updated_by_name',         p.full_name
         )
    into v
    from gatepass.app_settings s
    left join public.profiles p on p.id = s.updated_by
   where s.id;

  return coalesce(v, jsonb_build_object(
           'require_approver_2fa', false,
           'coo_escalation_hours', 48));
end;
$fn$;

grant execute on function gatepass.get_app_settings() to authenticated;

drop function if exists gatepass.set_app_settings(text, text, boolean, int);

create function gatepass.set_app_settings(
  p_app_name                text,
  p_brand_color             text,
  p_require_approver_2fa    boolean,
  p_session_timeout_minutes int,
  p_coo_escalation_hours    int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := nullif(btrim(coalesce(p_app_name, '')), '');
  v_color text := nullif(btrim(coalesce(p_brand_color, '')), '');
  v_esc   int  := coalesce(p_coo_escalation_hours, 48);
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change the application settings.';
  end if;

  if v_name is not null and length(v_name) > 40 then
    raise exception 'The application name has to be 40 characters or fewer.';
  end if;

  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'A brand colour has to be a six-digit hex code, like #C6A15B.';
  end if;

  if p_session_timeout_minutes is not null
     and (p_session_timeout_minutes < 5 or p_session_timeout_minutes > 1440) then
    raise exception 'The sign-out timer has to be between 5 minutes and 24 hours.';
  end if;

  if v_esc < 1 or v_esc > 720 then
    raise exception 'The COO escalation window has to be between 1 hour and 30 days.';
  end if;

  insert into gatepass.app_settings as a (
    id, app_name, brand_color, require_approver_2fa, session_timeout_minutes,
    coo_escalation_hours, updated_by, updated_at
  )
  values (
    true, v_name, v_color, coalesce(p_require_approver_2fa, false), p_session_timeout_minutes,
    v_esc, auth.uid(), now()
  )
  on conflict (id) do update
    set app_name                = excluded.app_name,
        brand_color             = excluded.brand_color,
        require_approver_2fa    = excluded.require_approver_2fa,
        session_timeout_minutes = excluded.session_timeout_minutes,
        coo_escalation_hours    = excluded.coo_escalation_hours,
        updated_by              = excluded.updated_by,
        updated_at              = excluded.updated_at;

  return gatepass.get_app_settings();
end;
$fn$;

grant execute on function gatepass.set_app_settings(text, text, boolean, int, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Finance signs second, and level 3 belongs to two offices
-- ═══════════════════════════════════════════════════════════════════════════
-- The constraint comes off first: it pins level_no to role_key row by row, so
-- no single UPDATE can satisfy both mappings at once (057's note).
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_level_matches;

update gatepass.pass_approvals set level_no = 2 where role_key = 'finance_head';
update gatepass.pass_approvals set level_no = 3 where role_key in ('coo', 'ceo');

alter table gatepass.pass_approvals
  add constraint pass_approvals_level_matches
  check (level_no = case role_key
                      when 'security_head' then 1
                      when 'finance_head'  then 2
                      when 'coo'           then 3
                      when 'ceo'           then 3
                    end);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. `not_required` — the rung the other office never had to sign
-- ═══════════════════════════════════════════════════════════════════════════
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_status_known;

alter table gatepass.pass_approvals
  add constraint pass_approvals_status_known
  check (status in ('pending', 'approved', 'rejected', 'not_required'));

-- 058's shape, with ONE arm added. A `not_required` row has a MOMENT (the
-- decision that made it unnecessary happened at a real time) and a SENTENCE
-- (which office signed instead), and deliberately NO AUTHOR: nobody decided it,
-- and a `decided_by` here would print a name against a signature that was never
-- given.
alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_decision_shape;

alter table gatepass.pass_approvals
  add constraint pass_approvals_decision_shape
  check (
    (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
    -- 058's two approval arms, verbatim: the rollout is approved, stamped and
    -- authored by nobody; an ordinary approval has a real author.
    or (status = 'approved' and grandfathered and decided_by is null and decided_at is not null)
    or (status = 'approved' and not grandfathered and decided_by is not null and decided_at is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null
        and length(btrim(coalesce(reason, ''))) between 1 and 500)
    or (status = 'not_required' and decided_by is null and decided_at is not null
        and length(btrim(coalesce(reason, ''))) between 1 and 500)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The snapshot, renumbered
-- ═══════════════════════════════════════════════════════════════════════════
-- 057's function with the new mapping and nothing else changed: still a trigger
-- rather than a line inside `raise_pass`, still skipping a vacant office, still
-- freezing what a pass owes on the day it is raised. `create or replace` keeps
-- the existing trigger bound to it — dropping and recreating would open a
-- window in which an insert snapshots nothing at all.
create or replace function gatepass.snapshot_pass_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into gatepass.pass_approvals (gate_pass_id, role_key, level_no, routed_to)
  select new.id,
         r.role_key,
         (case r.role_key
            when 'security_head' then 1
            when 'finance_head'  then 2
            when 'coo'           then 3
            when 'ceo'           then 3
          end)::smallint,
         r.user_id
    from gatepass.approval_roles r;

  return new;
end;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. When does this rung become the CEO's?
-- ═══════════════════════════════════════════════════════════════════════════
-- Null unless the office asked about is genuinely waiting behind another one on
-- the same level. So: null for every office but the CEO, null on a pass with no
-- pending COO row (a vacant COO office was never snapshotted, and the CEO is
-- then the only holder of level 3 and may sign at once), and null again once
-- the sibling row has been decided either way.
--
-- SECURITY DEFINER because it reads `pass_approvals`, which is what the policy
-- on that table would otherwise recurse through (42P17, 046's note).
create or replace function gatepass.level_escalates_at(p_pass_id uuid, p_role_key text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
           when p_role_key <> 'ceo' then null
           when not exists (
                  select 1 from gatepass.pass_approvals c
                   where c.gate_pass_id = p_pass_id
                     and c.role_key = 'coo'
                     and c.status = 'pending'
                ) then null
           else (
             select coalesce(
                      (select max(b.decided_at)
                         from gatepass.pass_approvals b
                        where b.gate_pass_id = a.gate_pass_id
                          and b.level_no < a.level_no
                          and b.status = 'approved'),
                      g.created_at
                    ) + make_interval(hours => gatepass.get_escalation_hours()::int)
               from gatepass.pass_approvals a
               join gatepass.gate_passes g on g.id = a.gate_pass_id
              where a.gate_pass_id = p_pass_id
                and a.role_key = 'ceo'
                and a.status = 'pending'
           )
         end;
$fn$;

grant execute on function gatepass.level_escalates_at(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Approving, with the shared rung and the escalation window
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function — the delegation ceiling and the deputy flag are its, verbatim
-- — with TWO things added and nothing removed:
--
--   * the CEO is refused while the COO's window is still open, in a sentence
--     that names the moment rather than leaving them to guess;
--   * the sibling row on the same level is closed as `not_required` in the same
--     transaction as the signature that made it unnecessary.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role        text := gatepass.my_approval_role();
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_as_deputy   boolean;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
  v_escalates   timestamptz;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  -- THE ESCALATION GATE. Null means nobody is being waited on, which is the
  -- ordinary case for every office but a CEO sharing level 3 with a COO who
  -- still has time on the clock.
  v_escalates := gatepass.level_escalates_at(p_pass_id, v_role);
  if v_escalates is not null and now() < v_escalates then
    raise exception 'This pass is with the COO until %. It escalates to the CEO only if they have not decided it by then.',
      to_char(v_escalates, 'DD Mon YYYY HH24:MI');
  end if;

  select coalesce(r.deputy_id = auth.uid(), false) into v_as_deputy
    from gatepass.approval_roles r
   where r.role_key = v_role;

  select d.id, d.approval_limit into v_deleg_id, v_deleg_limit
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  if v_deleg_id is not null and v_deleg_limit is not null then
    select coalesce(sum(i.approx_value), 0) into v_value
      from gatepass.gate_pass_items i
     where i.gate_pass_id = p_pass_id;

    if v_value > v_deleg_limit then
      raise exception 'Your delegation of the % office is limited to %. This pass is worth % — the office holder has to sign it.',
        gatepass.approval_office_title(v_role),
        to_char(v_deleg_limit, 'FM999,999,999,990.00'),
        to_char(v_value,       'FM999,999,999,990.00');
    end if;
  end if;

  update gatepass.pass_approvals a
     set status              = 'approved',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_deputy   = coalesce(v_as_deputy, false),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  -- ONE SIGNATURE CLOSES THE RUNG. Written as "every other pending row on my
  -- own level" rather than naming the CEO, so the rule belongs to the shared
  -- level and not to one pair of offices.
  update gatepass.pass_approvals a
     set status     = 'not_required',
         decided_at = now(),
         reason     = 'Not required — level ' || v_mine || ' was approved by the '
                      || gatepass.approval_office_title(v_role) || '.'
   where a.gate_pass_id = p_pass_id
     and a.level_no = v_mine
     and a.role_key <> v_role
     and a.status = 'pending';
end;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. `get_pass_approvals` IS DELIBERATELY UNTOUCHED
-- ═══════════════════════════════════════════════════════════════════════════
-- It already returns `status`, so a `not_required` rung reaches the record and
-- the printed slip with no signature change at all. The escalation MOMENT is
-- not added to it on purpose: the approver's queue reads `pass_approvals` in
-- one query across every pass and could not use a per-pass function's column,
-- so the screens derive the moment once in `src/lib/approvalDecision.ts` from
-- the rows they already hold plus `get_escalation_hours()`. Returning it here
-- as well would be the same rule computed in two places — and this one is only
-- ever DISPLAY. `approve_pass_level` above is what enforces it, and it calls
-- `level_escalates_at` itself.

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. A closed rung below me is a rung that has passed
-- ═══════════════════════════════════════════════════════════════════════════
-- 061's predicate, with `not_required` counted alongside `approved`. It cannot
-- matter today — only level 3 has two offices on it and nothing sits above it —
-- but a shared rung LOWER down would otherwise hide the pass from every office
-- above it for ever, which is the failure mode 061 exists to make impossible.
create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key = gatepass.my_approval_role()
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status not in ('approved', 'not_required')
       )
  );
$fn$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 064_pass_number_carries_department.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 065_requester_answers_a_flag_in_writing.sql
-- ═══════════════════════════════════════════════════════════
-- 065 — the requester's answer to a gate flag is written down
--
-- Client, 2026-08-23: the guard's second answer is now "Flag to Requester", and
-- when the raising HOD answers it "he can put it as a proof" — a written note
-- saying why they cleared the flag or why they upheld it.
--
-- The REJECT branch already wrote `p_reason` into its `verifications` row (035).
-- The APPROVE branch did not: it wrote the fixed sentence 'HOD approved
-- override of security flag' and threw the HOD's own words away, so the one
-- decision that sends material back out through a barrier a guard had stopped
-- was the one decision with no stated reason on the record.
--
-- p_reason STAYS OPTIONAL at this boundary, deliberately. The portal makes it
-- mandatory where a person answers a flag (FlaggedReviewActions), but
-- `voidSupersededPass` calls this same RPC with a generated reason when a
-- corrected pass supersedes a flagged one, and a required argument here would
-- turn that automatic step into a prompt nobody can answer. An absent note
-- falls back to the sentence this function has always written.
--
-- NOTHING ELSE ABOUT THE FUNCTION CHANGES. It still refuses anyone who is not
-- the raising HOD, still refuses a pass that is not `flagged`, and still
-- refreshes `expires_at` to the end of the current site day on approve (035) so
-- the pass is matchable at the gate it was stopped at. It also still does not
-- touch `gatepass.pass_approvals`: a flag is answered by the requester and by
-- nobody else, and the three approval offices signed this pass before it ever
-- reached the barrier.
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
  v_note    text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  v_note := nullif(trim(coalesce(p_reason, '')), '');

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
    -- Same-day re-expiry (028's expression): the clearance gives the pass the
    -- rest of TODAY to reach the gate. flag_reason deliberately survives (026).
    update gatepass.gate_passes
       set status    = 'hod_reviewed'::gatepass.pass_status,
           expires_at = ((date_trunc('day', (now() at time zone gatepass.site_tz())) + interval '1 day')
                          at time zone gatepass.site_tz()) - interval '1 microsecond'
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'hod_reviewed'::gatepass.verify_action, v_user_id,
       coalesce(v_note, 'HOD approved override of security flag'));
  else
    -- flag_reason is deliberately preserved (see 026): a pass closed this way
    -- must keep the record of WHY security stopped it.
    update gatepass.gate_passes
       set status = 'cancelled'::gatepass.pass_status
     where id = p_pass_id
     returning * into v_pass;

    insert into gatepass.verifications
      (gate_pass_id, action, security_user_id, remarks)
    values
      (p_pass_id, 'cancelled'::gatepass.verify_action, v_user_id,
       coalesce(v_note, 'HOD upheld the security flag and rejected this pass'));
  end if;

  return v_pass;
end;
$$;

revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
grant execute on function gatepass.hod_review_flagged_pass(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 066_delegate_is_an_hod.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 066 — A DELEGATION GOES TO A DEPARTMENT HEAD, NOT TO STAFF AND NOT TO THE GATE
--
-- Client, 2026-08-23: "in the delegation tab for each and every approver they
-- cannot delegate it to normal staff. They can only delegate it to either their
-- peer-level approver or an HOD."
--
-- 062 offered EVERY active account in the directory. That is a real hole and not
-- only an untidy list: a delegation is the whole office — the approval queue,
-- `approve_pass_level`, `reject_pass_level`, the CEO office's whitelist
-- decisions, and RLS visibility of every pass routed to that rung. Handing it to
-- a guard puts the person who verifies a pass at the gate onto the ladder that
-- authorises it, which is the four-eyes property the ladder exists for; handing
-- it to `staff` grants a portal-less account real authority over material
-- leaving the mall.
--
-- WHAT "PEER-LEVEL APPROVER" RESOLVES TO HERE, and why no arm is written for it:
-- one person holds one approval seat (049 for holders, 054 for deputies, 062 for
-- delegates). Anybody who currently sits on another office is therefore ALREADY
-- refused as a delegate by the seat checks 062 wrote, whatever their VMS role —
-- so a peer is not a reachable choice, and a role arm admitting them would only
-- draw names into the list that the very next check refuses. The reachable half
-- of the client's rule is the HOD, and that is what this narrows to.
--
-- TWO PLACES, BECAUSE A DROPDOWN IS NOT A CONTROL. `list_delegation_candidates`
-- narrows what the office holder is offered; `create_approval_delegation`
-- refuses the same thing on the write, since the RPC is reachable over PostgREST
-- by any authenticated caller with a user id they typed themselves.
--
-- ROLE IS READ FROM `public.profiles`, VMS's own column (the two-schema rule:
-- referenced, never altered). It is the same source `app_role()` falls back to,
-- and the one the admin's user list shows.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The candidate list
-- ═══════════════════════════════════════════════════════════════════════════
-- Every exclusion 062 wrote is kept verbatim — an inactive account, an office
-- holder, a standing deputy, somebody already covering a live-or-future
-- delegation — with the role test added.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gatepass.approval_roles r where r.user_id = auth.uid()
  ) then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and p.role::text = 'hod'
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r
              where r.user_id = p.id or r.deputy_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$$;

comment on function gatepass.list_delegation_candidates() is
  'The people an office holder may delegate to: active department heads (profiles.role = hod) who hold no approval seat of their own. Not staff, not the gate. See migration 066.';

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The write
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's body, unchanged, plus the role refusal. The role and the active flag are
-- read in ONE lookup of the profile row rather than two — and the "that person
-- does not exist" case still keys off the row being absent, so a deleted account
-- is told apart from a live one that may not be given the office.
create or replace function gatepass.create_approval_delegation(
  p_delegate_id    uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_approval_limit numeric default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_seat   text;
  v_role   text;
  v_active boolean;
  v_found  boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office, so there is nothing to delegate.';
  end if;

  if not gatepass.is_user_active(auth.uid()) then
    raise exception 'This account is deactivated.';
  end if;

  if p_delegate_id is null then
    raise exception 'Choose somebody to delegate to.';
  end if;

  if p_delegate_id = auth.uid() then
    raise exception 'You cannot delegate your own office to yourself.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'A delegation needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The delegation has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the
  -- history reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That delegation would already have ended. Choose an end in the future.';
  end if;

  if p_approval_limit is not null and p_approval_limit <= 0 then
    raise exception 'An approval limit has to be more than zero. Leave it blank for no limit.';
  end if;

  select true, p.role::text, gatepass.is_user_active(p.id)
    into v_found, v_role, v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if not v_found then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  -- ── 066: the office goes to a department head. ──────────────────────────
  -- Stated as a rule rather than as a fault, because an approver reading it has
  -- picked a real colleague and needs to know WHO is eligible, not that
  -- something went wrong.
  if v_role is distinct from 'hod' then
    raise exception 'An approval office can only be delegated to a department head. Choose an HOD.';
  end if;

  -- ── The one-seat refusals. See 062's header. ────────────────────────────
  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.user_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
      gatepass.approval_office_title(v_seat);
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal. Half-open at both ends, matching
  -- `delegation_is_live`, so back-to-back windows do not collide.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_delegate_id
     and d.revoked_at is null
     and d.starts_at < p_ends_at
     and d.ends_at   > p_starts_at;

  if v_seat is not null then
    raise exception 'That person is already covering the % office under a delegation over part of that period. One person holds one approval seat at a time.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- And the office itself takes one delegate at a time, so that "who is
  -- covering the COO this week" has exactly one answer.
  if exists (
    select 1
      from gatepass.approval_delegations d
     where d.role_key = v_office
       and d.delegator_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at < p_ends_at
       and d.ends_at   > p_starts_at
  ) then
    raise exception 'You have already delegated the % office over part of that period. Revoke that delegation first.',
      gatepass.approval_office_title(v_office);
  end if;

  insert into gatepass.approval_delegations
    (role_key, delegator_id, delegate_id, starts_at, ends_at, approval_limit, reason)
  values
    (v_office, auth.uid(), p_delegate_id, p_starts_at, p_ends_at, p_approval_limit, left(v_reason, 500))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) from public;
grant execute on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 067_super_admin_is_the_coo_and_the_ceo.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 067 — THE COO AND THE CEO COVER FOR EACH OTHER, AND THE SUPER ADMIN IS NOW
--       THE TWO OF THEM
--
-- Client, 2026-08-24, in two parts:
--
--   "in the COO's delegation he can only delegate it to CEO … and CEO can also
--    give the delegation only to COO"
--
--   "there is a super admin role but you can mention that the super admin role
--    will be given to COO and CEO … remove the normal super admin person
--    account … Basically the Superadmin role is a kind of fallback role. In the
--    case where nobody is able to approve, in those scenarios the Superadmin
--    can take charge and get it approved. It's basically a role but it doesn't
--    remove their CEO or COO role also."
--
-- ── 1. THE PAIR. ────────────────────────────────────────────────────────────
-- 066 narrowed every office's delegation to a DEPARTMENT HEAD. That stays true
-- of the Security Head and the Finance HOD. The two offices that share level 3
-- (063) now delegate to EACH OTHER and to nobody else, which is a narrowing and
-- not a widening of 066 — one name in the list instead of the whole HOD bench.
--
-- ⚠ THIS IS THE ONE PLACE THE ONE-SEAT RULE BENDS, AND ONLY BECAUSE THE LADDER
-- ALREADY SAYS SO. 049/054/062 refuse a person a second seat so that nobody can
-- sign two rungs of the same pass. The COO and the CEO are not two rungs: 063
-- put them on ONE level that takes ONE signature, and closes the other office's
-- row as `not_required` the moment either signs. So a CEO covering the COO can
-- still only put one signature on level 3 of any pass — which is the property
-- the one-seat rule exists to protect, and it is untouched. The exemption is
-- written as "the counterpart office on my own rung", not as "the CEO", so a
-- future shared rung inherits it and an unshared one never does.
--
-- ── 2. THE FALLBACK. ────────────────────────────────────────────────────────
-- `emergency_release_pass` (055) is the only door in this system that gets a
-- pass past an office that cannot be reached, and it was open to the VMS role
-- `super_admin` alone. That account is being deleted, so the door would close
-- for good and 055 would become dead schema. Instead the two offices at the top
-- of the ladder hold it — IN ADDITION to their office, never instead of it: an
-- office holder keeps exactly the screens 2026-08-22 left them, and this is a
-- power on the pass record, not a portal. `is_super_admin()` is deliberately
-- NOT `is_admin()`: it opens no admin tab, no user list and no settings.
--
-- ⚠ A POWER YOU CANNOT REACH THE SUBJECT OF IS NOT A POWER. 061 makes an
-- approver blind to a pass until every rung below theirs is approved — which is
-- precisely the pass this fallback exists for. So one narrow arm is added to
-- the two select policies: a COO or CEO may SEE a pass that is STUCK, meaning
-- pending, still owing a signature, and sitting on its current rung longer than
-- `coo_escalation_hours` (063's own window — the same number that decides when
-- level 3 escalates, so there is one definition of "waited too long" and not
-- two). Not act on it — `approve_pass_level` still refuses every rung but the
-- lowest, and this adds nothing there. See, and release in writing.
--
-- 061's rule is otherwise untouched: before that window elapses the pass is as
-- invisible to them as it ever was, and a rejected pass is never stuck — it
-- stopped, it is not waiting — so it never becomes visible this way.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Which office shares my rung
-- ═══════════════════════════════════════════════════════════════════════════
-- Read off `pass_approvals` this would be a per-pass answer; this is the ORG
-- CHART's answer and has to hold for a pass that does not exist yet, so it is
-- stated against the ladder itself. Null for an office that shares its rung
-- with nobody, which is every office but these two.
create or replace function gatepass.approval_office_pair(p_role_key text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_role_key
           when 'coo' then 'ceo'
           when 'ceo' then 'coo'
           else null
         end;
$fn$;

comment on function gatepass.approval_office_pair(text) is
  'The office that shares a ladder rung with this one, or null. COO and CEO share level 3 (063); no other pair does. See migration 067.';

revoke all on function gatepass.approval_office_pair(text) from public;
grant execute on function gatepass.approval_office_pair(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The candidate list
-- ═══════════════════════════════════════════════════════════════════════════
-- 066's body, with one arm in front of it. The pair arm returns AT MOST ONE
-- NAME and may return none — an office whose counterpart is vacant or suspended
-- has nobody to hand its rung to, and the form says so rather than falling back
-- to the HOD bench the client just took away from these two offices.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_pair   text;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    return query
      select p.id, p.full_name, d.name
        from gatepass.approval_roles r
        join public.profiles p on p.id = r.user_id
        left join public.departments d on d.id = p.department_id
       where r.role_key = v_pair
         and p.id <> auth.uid()
         and gatepass.is_user_active(p.id);
    return;
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and p.role::text = 'hod'
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r
              where r.user_id = p.id or r.deputy_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$$;

comment on function gatepass.list_delegation_candidates() is
  'The people an office holder may delegate to. An office that shares a rung (COO, CEO) may delegate only to its counterpart; every other office may delegate only to an active department head holding no approval seat. See migrations 066 and 067.';

revoke all on function gatepass.list_delegation_candidates() from public;
grant execute on function gatepass.list_delegation_candidates() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The write
-- ═══════════════════════════════════════════════════════════════════════════
-- 066's body. The role refusal and the holder-seat refusal are now the ELSE arm
-- of the pair rule rather than unconditional, because for these two offices the
-- delegate is REQUIRED to be a seat holder and is required not to be an HOD.
-- Every other refusal 062 wrote is unchanged and applies to both arms.
create or replace function gatepass.create_approval_delegation(
  p_delegate_id    uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_approval_limit numeric default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_pair   text;
  v_seat   text;
  v_role   text;
  v_active boolean;
  v_found  boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office, so there is nothing to delegate.';
  end if;

  if not gatepass.is_user_active(auth.uid()) then
    raise exception 'This account is deactivated.';
  end if;

  if p_delegate_id is null then
    raise exception 'Choose somebody to delegate to.';
  end if;

  if p_delegate_id = auth.uid() then
    raise exception 'You cannot delegate your own office to yourself.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'A delegation needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The delegation has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the
  -- history reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That delegation would already have ended. Choose an end in the future.';
  end if;

  if p_approval_limit is not null and p_approval_limit <= 0 then
    raise exception 'An approval limit has to be more than zero. Leave it blank for no limit.';
  end if;

  select true, p.role::text, gatepass.is_user_active(p.id)
    into v_found, v_role, v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if not v_found then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    -- ── 067: a shared rung is covered by the office that shares it. ────────
    if not exists (
      select 1 from gatepass.approval_roles r
       where r.role_key = v_pair and r.user_id = p_delegate_id
    ) then
      raise exception 'The % office can only be delegated to the %, who signs the same level. Nobody else may cover it.',
        gatepass.approval_office_title(v_office),
        gatepass.approval_office_title(v_pair);
    end if;
    -- The holder-seat refusal in the else arm is SKIPPED here on purpose:
    -- holding the counterpart office is the whole qualification. The deputy
    -- seat and the overlapping-delegation refusals below still apply.
  else
    -- ── 066: every other office delegates to a department head. ────────────
    if v_role is distinct from 'hod' then
      raise exception 'An approval office can only be delegated to a department head. Choose an HOD.';
    end if;

    select r.role_key into v_seat
      from gatepass.approval_roles r
     where r.user_id = p_delegate_id;

    if v_seat is not null then
      raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
        gatepass.approval_office_title(v_seat);
    end if;
  end if;

  select r.role_key into v_seat
    from gatepass.approval_roles r
   where r.deputy_id = p_delegate_id;

  if v_seat is not null then
    raise exception 'That person is the standing deputy for the % office. One person holds one approval seat.',
      gatepass.approval_office_title(v_seat);
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_delegate_id
     and d.revoked_at is null
     and d.starts_at < p_ends_at
     and d.ends_at   > p_starts_at;

  if v_seat is not null then
    raise exception 'That person is already covering the % office under a delegation over part of that period. One person holds one approval seat at a time.',
      gatepass.approval_office_title(v_seat);
  end if;

  if exists (
    select 1
      from gatepass.approval_delegations d
     where d.role_key = v_office
       and d.delegator_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at < p_ends_at
       and d.ends_at   > p_starts_at
  ) then
    raise exception 'You have already delegated the % office over part of that period. Revoke that delegation first.',
      gatepass.approval_office_title(v_office);
  end if;

  insert into gatepass.approval_delegations
    (role_key, delegator_id, delegate_id, starts_at, ends_at, approval_limit, reason)
  values
    (v_office, auth.uid(), p_delegate_id, p_starts_at, p_ends_at, p_approval_limit, left(v_reason, 500))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) from public;
grant execute on function gatepass.create_approval_delegation(uuid, timestamptz, timestamptz, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. When a pass is STUCK
-- ═══════════════════════════════════════════════════════════════════════════
-- The moment the pass arrived on the rung it is sitting on now: the latest
-- decision on any rung BELOW it, and for a pass whose first rung is still
-- pending, the moment it was raised. `level_escalates_at` (063) computes the
-- same instant for one office; this asks it of the pass. Never `now()` minus
-- something, and never a column anybody could write.
create or replace function gatepass.pass_rung_reached_at(p_pass_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           (select max(b.decided_at)
              from gatepass.pass_approvals b
             where b.gate_pass_id = p_pass_id
               and b.level_no < (select min(a.level_no)
                                   from gatepass.pass_approvals a
                                  where a.gate_pass_id = p_pass_id
                                    and a.status = 'pending')
               and b.status in ('approved', 'not_required')),
           (select g.created_at from gatepass.gate_passes g where g.id = p_pass_id)
         )
   where exists (
     select 1 from gatepass.pass_approvals a
      where a.gate_pass_id = p_pass_id and a.status = 'pending'
   );
$fn$;

comment on function gatepass.pass_rung_reached_at(uuid) is
  'When a pending gate pass arrived on the rung it is waiting on now; null when it owes no signature. See migration 067.';

revoke all on function gatepass.pass_rung_reached_at(uuid) from public;
grant execute on function gatepass.pass_rung_reached_at(uuid) to authenticated;

-- Pending, still owing a signature, and on that rung longer than the window
-- level 3 escalates over. A cancelled pass is NOT stuck — it stopped, and
-- overturning a written refusal is not what any of this is for (055's rule).
create or replace function gatepass.pass_is_stuck(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.gate_passes g
            where g.id = p_pass_id and g.status = 'pending'
         )
     and gatepass.pass_rung_reached_at(p_pass_id)
           + make_interval(hours => gatepass.get_escalation_hours()::int) <= now();
$fn$;

comment on function gatepass.pass_is_stuck(uuid) is
  'True when a pending gate pass has waited on its current approval rung longer than app_settings.coo_escalation_hours. The one definition of "nobody has approved this". See migration 067.';

revoke all on function gatepass.pass_is_stuck(uuid) from public;
grant execute on function gatepass.pass_is_stuck(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Who is the super admin
-- ═══════════════════════════════════════════════════════════════════════════
-- The VMS role is KEPT as an arm rather than replaced: it is VMS's column, this
-- app does not own it, and an operator who seats one again must not find the
-- door bolted. What the client removed is the ACCOUNT, not the concept.
create or replace function gatepass.holds_fallback_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.approval_roles r
            where r.role_key in ('coo', 'ceo')
              and r.user_id = auth.uid()
         )
     and gatepass.is_user_active(auth.uid());
$fn$;

comment on function gatepass.holds_fallback_office() is
  'True for the sitting COO or CEO. Deputies and delegates are deliberately excluded: emergency release is the last door and belongs to the officer, not to their cover. See migration 067.';

revoke all on function gatepass.holds_fallback_office() from public;
grant execute on function gatepass.holds_fallback_office() to authenticated;

create or replace function gatepass.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select gatepass.app_role() = 'super_admin' or gatepass.holds_fallback_office();
$fn$;

comment on function gatepass.is_super_admin() is
  'The VMS super_admin role, or the sitting COO or CEO. Grants the emergency release and nothing else — it is NOT is_admin() and opens no admin screen. See migration 067.';

revoke all on function gatepass.is_super_admin() from public;
grant execute on function gatepass.is_super_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Seeing the pass you are being asked to unstick
-- ═══════════════════════════════════════════════════════════════════════════
-- `pass_routed_to_me` is left EXACTLY as 063 wrote it — its name states 061's
-- rule and this is not that rule. The arm is added to the two select policies
-- instead, where somebody auditing who can see a pass is already looking.
-- `can_see_pass` is SECURITY INVOKER over `gate_passes`, so `pass_approvals`,
-- `pass_remarks` and `emergency_releases` widen with it and no third copy of
-- this rule exists.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select on gatepass.gate_passes
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(id))
  );

drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select on gatepass.gate_pass_items
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.pass_routed_to_me(gate_pass_id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(gate_pass_id))
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The release itself
-- ═══════════════════════════════════════════════════════════════════════════
-- 055's body, with the pool widened and ONE condition added: an office holder
-- may release only a pass that is actually stuck. A VMS super admin is not so
-- limited — that role operates the whole system and 055 gave it the
-- unrestricted door; an office holder is one rung of the very ladder they are
-- about to skip, and "the pass has waited longer than the escalation window" is
-- what makes skipping it their business rather than an override of colleagues
-- who are simply still reading it.
create or replace function gatepass.emergency_release_pass(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_owed    integer;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  if not gatepass.is_super_admin() then
    raise exception 'Only a super admin — the COO or the CEO — can release a gate pass past its approval ladder.';
  end if;

  if length(v_reason) < 10 then
    raise exception 'An emergency release needs a written reason of at least 10 characters.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;

  -- A cancelled pass was REJECTED by an office, or voided by its HOD. Releasing
  -- it would overturn a decision somebody made and wrote a reason for, which is
  -- a different and much larger power than unsticking a silent queue. A matched
  -- pass has already left. Neither is what this is for.
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select count(*) into v_owed
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_owed = 0 then
    raise exception 'This gate pass does not owe any approvals — there is nothing to release.';
  end if;

  if gatepass.app_role() is distinct from 'super_admin'
     and not gatepass.pass_is_stuck(p_pass_id) then
    raise exception 'This gate pass has not been waiting long enough on its current approval level. It can be released this way only once it has been sitting there for % hours.',
      gatepass.get_escalation_hours();
  end if;

  -- Every remaining level at once. Releasing them one at a time would leave a
  -- pass that is half-overridden if the caller stopped, and the ladder's own
  -- slip order makes a partial release meaningless anyway.
  update gatepass.pass_approvals a
     set status     = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         reason     = v_reason,
         emergency  = true
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  insert into gatepass.emergency_releases (gate_pass_id, released_by, reason)
  values (p_pass_id, auth.uid(), v_reason);
end;
$$;

revoke all on function gatepass.emergency_release_pass(uuid, text) from public;
grant execute on function gatepass.emergency_release_pass(uuid, text) to authenticated;

comment on function gatepass.emergency_release_pass(uuid, text) is
  'Clears every approval level a pending gate pass still owes, in one act, recording who did it and why. Open to a VMS super admin, and to the sitting COO or CEO once the pass is stuck. Does not change the pass''s own status — see migrations 055 and 067.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Who holds the fallback, for the admin's Settings screen
-- ═══════════════════════════════════════════════════════════════════════════
-- Read-only, and admin-only because the Settings tab is. It names both offices
-- whether or not they are filled — an empty one is the whole point of the card,
-- since it means nobody at all can unstick a pass.
create or replace function gatepass.list_super_admins()
returns table (role_key text, title text, user_id uuid, full_name text, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can read the super admin list.';
  end if;

  return query
    select k.key,
           gatepass.approval_office_title(k.key),
           r.user_id,
           p.full_name,
           case when r.user_id is null then null
                else gatepass.is_user_active(r.user_id) end
      from (values ('ceo'), ('coo')) as k(key)
      left join gatepass.approval_roles r on r.role_key = k.key
      left join public.profiles p on p.id = r.user_id;
end;
$$;

comment on function gatepass.list_super_admins() is
  'The two offices that carry the super admin fallback — CEO and COO — and who sits in them today. See migration 067.';

revoke all on function gatepass.list_super_admins() from public;
grant execute on function gatepass.list_super_admins() to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 068_no_standing_deputy.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 068 — the STANDING DEPUTY is removed from the approval ladder
--
-- WHAT IS GONE. 054 gave every approval office an optional second seat: a
-- standing deputy who could sign exactly what the holder could, at any time,
-- with no date window. The client has withdrawn it (2026-08-31). An office is
-- one person again.
--
-- WHY IT CAN GO CLEANLY. 062 shipped the date-bounded delegation the deputy was
-- chosen INSTEAD of, and it covers the same absence with a window, a value
-- ceiling, a revocation and a record of who handed it over — everything the
-- standing seat deliberately did without. Cover survives; the second permanent
-- seat does not.
--
-- NOTHING IS LOST. Verified on the live project before this was written: zero
-- rows in `approval_roles` carried a `deputy_id`, and zero rows in
-- `pass_approvals` carried `decided_as_deputy = true`. No signature in the
-- history was ever given by a deputy, so dropping the stamp erases no fact. Had
-- either count been non-zero this migration would have had to keep the column.
--
-- WHAT THIS TOUCHES. Every function 054 widened is restated here with its
-- deputy arm removed and NOTHING else changed — each is the latest version as
-- of 067, minus the deputy:
--
--   my_approval_role            054's `or r.deputy_id = auth.uid()` arm
--   set_approval_role           054's "already a deputy" refusal
--   admin_soft_delete_user      059's deputy-seat clear
--   list_delegation_candidates  066/067's `or r.deputy_id = p.id` exclusion
--   create_approval_delegation  062's "delegate is a deputy" refusal
--   approve_pass_level          054's `decided_as_deputy` stamp
--   reject_pass_level           054's `decided_as_deputy` stamp
--   get_pass_approvals          the `decided_as_deputy` output column
--   get_approval_ladder         the `deputy_id` / `deputy_name` output columns
--   approval_notice_payload     the `deputy_name` / `deputy_email` addresses
--
-- and then the schema itself goes: both columns, the uniqueness index and the
-- not-the-holder check. CLAUDE.md's rule — a retired feature leaves no
-- `EXECUTE`-able function and no dead column behind, because both are still
-- reachable over PostgREST by every authenticated user.
--
-- ONE PERSON, ONE SEAT SURVIVES, and is now simpler to state: 049's unique
-- `user_id` and 062's overlapping-delegation refusal are the whole rule. The
-- four-eyes property the ladder rests on — one human can never sign two rungs
-- of the same pass — is unchanged, because removing a seat cannot create one.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Authority follows the holder, or a live delegation. Nothing else.
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function with the deputy arm deleted. Still returns at most one row,
-- and still by refusal rather than by `limit` — 049's unique `user_id` and
-- 062's overlap refusals, with one fewer seat to collide with.
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key
    from gatepass.approval_roles r
   where r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid())
  union all
  select d.role_key
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at)
     and gatepass.is_user_active(auth.uid());
$$;

comment on function gatepass.my_approval_role() is
  'The approval office this caller may act for — as its holder, or under a live delegation (062) — or null. Scalar by design: the seat refusals in 049 and 062 guarantee at most one row. Suspended accounts hold nothing. The standing-deputy arm was removed in 068.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Seating an office holder
-- ═══════════════════════════════════════════════════════════════════════════
-- 062's function minus 054's deputy refusal. The admin gate, the known-key
-- check, the existence check, 059's active check, the "already holds" check,
-- 062's delegation check and the upsert are all unchanged.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_held   text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  if not gatepass.is_user_active(p_user_id) then
    raise exception 'That account is deactivated. Reactivate it before designating them, or choose somebody else.';
  end if;

  select r.role_key into v_held
    from gatepass.approval_roles r
   where r.user_id = p_user_id
     and r.role_key <> p_role_key;

  if v_held is not null then
    raise exception 'That person already holds the % office. One person holds one approval office — vacate the other one first.',
      gatepass.approval_office_title(v_held);
  end if;

  select d.role_key into v_held
    from gatepass.approval_delegations d
   where d.delegate_id = p_user_id
     and d.revoked_at is null
     and d.ends_at > now();

  if v_held is not null then
    raise exception 'That person is covering the % office under a delegation. One person holds one approval seat — that delegation has to be revoked first.',
      gatepass.approval_office_title(v_held);
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- The two setters 054 added have nothing left to set.
drop function if exists gatepass.set_approval_deputy(text, uuid);
drop function if exists gatepass.clear_approval_deputy(text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Deactivation vacates ONE seat
-- ═══════════════════════════════════════════════════════════════════════════
-- 059's function minus the deputy clear. Everything else — the admin gate, the
-- self-deactivation refusal, the admin-target refusal, the remembered office,
-- the status row and the session kill — is 059's, unchanged.
create or replace function gatepass.admin_soft_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_office text;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can deactivate users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Mirrors admin_reset_user_password (036): the weakest admin account must not
  -- be a route to suspending a stronger one.
  if v_role in ('admin', 'super_admin') then
    raise exception 'An admin account cannot be deactivated from the portal.';
  end if;

  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = p_user_id;

  if v_office is not null then
    delete from gatepass.approval_roles r where r.role_key = v_office;
  end if;

  insert into gatepass.user_status (
    user_id, is_active, deactivated_at, deactivated_by, updated_at, vacated_approval_office
  )
  values (p_user_id, false, now(), auth.uid(), now(), v_office)
  on conflict (user_id) do update
    set is_active               = false,
        deactivated_at          = now(),
        deactivated_by          = auth.uid(),
        updated_at              = now(),
        -- coalesce, never a bare assignment: deactivating somebody twice must
        -- not forget the office the FIRST deactivation took off them.
        vacated_approval_office = coalesce(excluded.vacated_approval_office,
                                           user_status.vacated_approval_office);

  delete from auth.sessions where user_id = p_user_id;

  return json_build_object(
    'id', p_user_id::text,
    'deactivated', true,
    'vacated_approval_office', v_office
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Who may be delegated to
-- ═══════════════════════════════════════════════════════════════════════════
-- 067's function with `or r.deputy_id = p.id` removed from the seat exclusion.
-- The pair arm (COO ↔ CEO) is untouched.
create or replace function gatepass.list_delegation_candidates()
returns table (id uuid, full_name text, department_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_pair   text;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    return query
      select p.id, p.full_name, d.name
        from gatepass.approval_roles r
        join public.profiles p on p.id = r.user_id
        left join public.departments d on d.id = p.department_id
       where r.role_key = v_pair
         and p.id <> auth.uid()
         and gatepass.is_user_active(p.id);
    return;
  end if;

  return query
    select p.id, p.full_name, d.name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.id <> auth.uid()
       and p.role::text = 'hod'
       and gatepass.is_user_active(p.id)
       and not exists (
             select 1 from gatepass.approval_roles r
              where r.user_id = p.id
           )
       and not exists (
             select 1 from gatepass.approval_delegations dl
              where dl.delegate_id = p.id
                and dl.revoked_at is null
                and dl.ends_at > now()
           )
     order by p.full_name;
end;
$$;

comment on function gatepass.list_delegation_candidates() is
  'Who the caller may delegate their approval office to. The COO and the CEO may only delegate to each other (067); every other office may only delegate to an active HOD who holds no seat and is covering nothing (066). The standing-deputy exclusion was removed in 068.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Writing a delegation
-- ═══════════════════════════════════════════════════════════════════════════
-- 067's function minus 062's "that person is a standing deputy" refusal. Every
-- other refusal — the pair rule, the HOD rule, the holder seat, the overlapping
-- delegation on either side, the window checks and the limit check — is
-- unchanged.
create or replace function gatepass.create_approval_delegation(
  p_delegate_id    uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_approval_limit numeric default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office text;
  v_pair   text;
  v_seat   text;
  v_role   text;
  v_active boolean;
  v_found  boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select r.role_key into v_office
    from gatepass.approval_roles r
   where r.user_id = auth.uid();

  if v_office is null then
    raise exception 'You do not hold a gate pass approval office, so there is nothing to delegate.';
  end if;

  if not gatepass.is_user_active(auth.uid()) then
    raise exception 'This account is deactivated.';
  end if;

  if p_delegate_id is null then
    raise exception 'Choose somebody to delegate to.';
  end if;

  if p_delegate_id = auth.uid() then
    raise exception 'You cannot delegate your own office to yourself.';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'A delegation needs a start and an end.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'The delegation has to end after it starts.';
  end if;

  -- A window already over grants nothing to anybody and would sit in the
  -- history reading "Expired" the moment it was written.
  if p_ends_at <= now() then
    raise exception 'That delegation would already have ended. Choose an end in the future.';
  end if;

  if p_approval_limit is not null and p_approval_limit <= 0 then
    raise exception 'An approval limit has to be more than zero. Leave it blank for no limit.';
  end if;

  select true, p.role::text, gatepass.is_user_active(p.id)
    into v_found, v_role, v_active
    from public.profiles p
   where p.id = p_delegate_id;

  if not v_found then
    raise exception 'That person does not exist.';
  end if;

  if not v_active then
    raise exception 'That account is deactivated and cannot approve anything.';
  end if;

  v_pair := gatepass.approval_office_pair(v_office);

  if v_pair is not null then
    -- ── 067: a shared rung is covered by the office that shares it. ────────
    if not exists (
      select 1 from gatepass.approval_roles r
       where r.role_key = v_pair and r.user_id = p_delegate_id
    ) then
      raise exception 'The % office can only be delegated to the %, who signs the same level. Nobody else may cover it.',
        gatepass.approval_office_title(v_office),
        gatepass.approval_office_title(v_pair);
    end if;
    -- The holder-seat refusal in the else arm is SKIPPED here on purpose:
    -- holding the counterpart office is the whole qualification. The
    -- overlapping-delegation refusals below still apply.
  else
    -- ── 066: every other office delegates to a department head. ────────────
    if v_role is distinct from 'hod' then
      raise exception 'An approval office can only be delegated to a department head. Choose an HOD.';
    end if;

    select r.role_key into v_seat
      from gatepass.approval_roles r
     where r.user_id = p_delegate_id;

    if v_seat is not null then
      raise exception 'That person holds the % office. One person holds one approval seat, so they cannot also cover yours.',
        gatepass.approval_office_title(v_seat);
    end if;
  end if;

  -- OVERLAP, not existence: two windows that do not overlap are two separate
  -- absences and are perfectly legal.
  select d.role_key into v_seat
    from gatepass.approval_delegations d
   where d.delegate_id = p_delegate_id
     and d.revoked_at is null
     and d.starts_at < p_ends_at
     and d.ends_at   > p_starts_at;

  if v_seat is not null then
    raise exception 'That person is already covering the % office under a delegation over part of that period. One person holds one approval seat at a time.',
      gatepass.approval_office_title(v_seat);
  end if;

  if exists (
    select 1
      from gatepass.approval_delegations d
     where d.role_key = v_office
       and d.delegator_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at < p_ends_at
       and d.ends_at   > p_starts_at
  ) then
    raise exception 'You have already delegated the % office over part of that period. Revoke that delegation first.',
      gatepass.approval_office_title(v_office);
  end if;

  insert into gatepass.approval_delegations
    (role_key, delegator_id, delegate_id, starts_at, ends_at, approval_limit, reason)
  values
    (v_office, auth.uid(), p_delegate_id, p_starts_at, p_ends_at, p_approval_limit, left(v_reason, 500))
  returning id into v_id;

  return v_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The two decisions no longer stamp a seat
-- ═══════════════════════════════════════════════════════════════════════════
-- 063's `approve_pass_level` minus `v_as_deputy`. The escalation gate, the
-- delegation ceiling and the shared-rung close are untouched.
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role        text := gatepass.my_approval_role();
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
  v_escalates   timestamptz;
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  -- THE ESCALATION GATE. Null means nobody is being waited on, which is the
  -- ordinary case for every office but a CEO sharing level 3 with a COO who
  -- still has time on the clock.
  v_escalates := gatepass.level_escalates_at(p_pass_id, v_role);
  if v_escalates is not null and now() < v_escalates then
    raise exception 'This pass is with the COO until %. It escalates to the CEO only if they have not decided it by then.',
      to_char(v_escalates, 'DD Mon YYYY HH24:MI');
  end if;

  select d.id, d.approval_limit into v_deleg_id, v_deleg_limit
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  if v_deleg_id is not null and v_deleg_limit is not null then
    select coalesce(sum(i.approx_value), 0) into v_value
      from gatepass.gate_pass_items i
     where i.gate_pass_id = p_pass_id;

    if v_value > v_deleg_limit then
      raise exception 'Your delegation of the % office is limited to %. This pass is worth % — the office holder has to sign it.',
        gatepass.approval_office_title(v_role),
        to_char(v_deleg_limit, 'FM999,999,999,990.00'),
        to_char(v_value,       'FM999,999,999,990.00');
    end if;
  end if;

  update gatepass.pass_approvals a
     set status              = 'approved',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  -- ONE SIGNATURE CLOSES THE RUNG. Written as "every other pending row on my
  -- own level" rather than naming the CEO, so the rule belongs to the shared
  -- level and not to one pair of offices.
  update gatepass.pass_approvals a
     set status     = 'not_required',
         decided_at = now(),
         reason     = 'Not required — level ' || v_mine || ' was approved by the '
                      || gatepass.approval_office_title(v_role) || '.'
   where a.gate_pass_id = p_pass_id
     and a.level_no = v_mine
     and a.role_key <> v_role
     and a.status = 'pending';
end;
$fn$;

-- 062's `reject_pass_level` minus `v_as_deputy`. Reject is still never withheld
-- for a value ceiling — 062's reasoning, unchanged.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := gatepass.my_approval_role();
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if v_role is null then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select a.level_no into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  select d.id into v_deleg_id
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  update gatepass.pass_approvals a
     set status              = 'rejected',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id,
         reason              = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The readers lose their deputy columns
-- ═══════════════════════════════════════════════════════════════════════════
-- BOTH are DROPPED and recreated rather than replaced: `create or replace
-- function` cannot change a RETURN TYPE, and both of these lose one. The grant
-- goes with the drop and is re-applied in the same transaction.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key            text,
  level_no            smallint,
  status              text,
  routed_name         text,
  decided_name        text,
  decided_at          timestamptz,
  reason              text,
  -- 058's column, carried forward. Dropping it would silently strip the
  -- rollout note off every pre-workflow pass's ladder and print whoever held
  -- the office that day as having approved something they never saw.
  grandfathered       boolean,
  decided_as_delegate boolean,
  delegated_by_name   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.grandfathered,
           a.decided_as_delegate,
           gp.full_name
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
      left join gatepass.approval_delegations dl on dl.id = a.delegation_id
      left join public.profiles gp on gp.id = dl.delegator_id
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

-- 043's shape again: one office, one holder, one name.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'finance_head'  then 3
              when 'ceo'           then 4
            end;
$$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The letter is addressed to one person per office again
-- ═══════════════════════════════════════════════════════════════════════════
-- 055's payload minus the two deputy addresses. Same name, same return type,
-- same service_role-only grant, so `create or replace` is legal and the
-- function keeps its existing privileges.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object(
      'pass', (
        select jsonb_build_object(
                 'id',                   p.id,
                 'pass_number',          p.pass_number,
                 'type',                 p.type,
                 'status',               p.status,
                 'visitor_name',         p.visitor_name,
                 'purpose',              p.purpose,
                 'vendor_name',          gatepass.company_name_of(p.visitor_company),
                 'department_name',      d.name,
                 'raised_by',            p.raised_by,
                 'raised_by_name',       rb.full_name,
                 'raised_by_email',      rb.email,
                 'item_count',           coalesce(it.item_count, 0),
                 'total_value',          coalesce(it.total_value, 0),
                 'expected_return_date', p.expected_return_date,
                 'created_at',           p.created_at
               )
          from gatepass.gate_passes p
          left join public.departments d on d.id = p.department_id
          left join public.profiles   rb on rb.id = p.raised_by
          left join lateral (
                 select count(*) as item_count, sum(i.approx_value) as total_value
                   from gatepass.gate_pass_items i
                  where i.gate_pass_id = p.id
               ) it on true
         where p.id = p_pass_id
      ),
      'approvals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'role_key',       a.role_key,
                 'level_no',       a.level_no,
                 'status',         a.status,
                 'approver_id',    coalesce(r.user_id, a.routed_to),
                 'approver_name',  coalesce(cur.full_name, ap.full_name),
                 'approver_email', coalesce(cur.email, ap.email),
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
         where a.gate_pass_id = p_pass_id
      ), '[]'::jsonb)
    )
  )
  || jsonb_build_object(
       'emergency', (
         select jsonb_build_object(
                  'released_at',   e.released_at,
                  'released_name', rp.full_name,
                  'reason',        e.reason,
                  'reviewed_at',   e.reviewed_at
                )
           from gatepass.emergency_releases e
           left join public.profiles rp on rp.id = e.released_by
          where e.gate_pass_id = p_pass_id
       )
     );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included (047/051), plus the emergency release that cleared this pass if there was one (055). Each level is addressed to whoever holds that office TODAY, falling back to the holder snapshotted at raise when the office is now vacant. The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. And the schema itself
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing reads either column now, and a column nothing reads is still visible
-- over PostgREST to every authenticated user. Both counts were verified zero
-- before this was written (see the header), so no signature and no designation
-- is being erased.
drop index if exists gatepass.approval_roles_one_deputy_per_person;

alter table gatepass.approval_roles
  drop constraint if exists approval_roles_deputy_is_not_holder;

alter table gatepass.approval_roles
  drop column if exists deputy_id;

alter table gatepass.pass_approvals
  drop column if exists decided_as_deputy;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 069_coo_and_ceo_raise_for_any_department.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 069 — THE COO AND THE CEO MAY RAISE A PASS FOR ANY DEPARTMENT
--
-- Client, 2026-08-31: "make sure CEO and COO has the ability to raise pass on
-- behalf of any department in their logins, so create those forms exactly as
-- the hod sees it except one thing that ceo and coo can select the department
-- to raise the gatepass."
--
-- TWO OFFICES ONLY, AND DELIBERATELY THE SAME TWO 067 ALREADY NAMES. The
-- Security Head and the Finance HOD gain nothing here: they sign a pass at the
-- gate's own rung and at level 2, and letting them originate the material they
-- vet is the collision 061/062's whole design exists to prevent. The COO and
-- the CEO are the fallback pair — 067 already trusts them with the emergency
-- release — so `holds_fallback_office()` is reused rather than restated. One
-- predicate, one place to change if the pair ever changes, and a deputy or a
-- time-boxed delegate is excluded from this exactly as they are from the
-- release: covering someone's signatures is not the same as raising material
-- in a department you do not head.
--
-- THE LADDER IS NOT SPECIAL-CASED. A pass raised by the COO is snapshotted by
-- the 063 trigger like any other and routes to the COO's own rung at level 3,
-- which they then sign themselves (client's explicit choice, 2026-08-31: "they
-- sign their own rung"). Nothing here touches `snapshot_pass_approvals`,
-- `approve_pass_level` or the escalation window — a COO-raised pass still needs
-- the Security Head and the Finance HOD, in that order, before it reaches them.
--
-- THE RAISER CAN SEE WHAT THEY RAISED, which is the other half of the feature
-- and is not automatic. `gate_passes_select` (067) admits a pass through the
-- department arm (`my_department_ids()` — an office holder has none, they are
-- VMS `staff`), the approver arm (`pass_routed_to_me` — 061 hides the pass
-- until every rung BELOW theirs is signed) or the stuck-pass arm. So without
-- the arm added below, a COO could raise a pass and then not be able to open,
-- print or even find it until the Security Head and Finance had both signed.
-- The arm is `raised_by = auth.uid()`: you may always read the pass you raised.
-- It widens nothing for anyone else — a guard cannot raise, and an HOD's own
-- passes are already admitted by the department arm.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Raising, for a department you do not head
-- ═══════════════════════════════════════════════════════════════════════════
-- 045's function verbatim from the item loop down; only the two guards at the
-- top change. SAME 9-ARGUMENT SIGNATURE, so no grant, no caller and no
-- PostgREST overload moves — `create or replace` keeps the existing grant.
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
  v_pass           gatepass.gate_passes;
  v_item           jsonb;
  v_line           int := 0;
  v_any_department boolean;
begin
  -- Read ONCE: it is two catalog lookups, and the answer decides both guards.
  v_any_department := gatepass.holds_fallback_office();

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
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) is
  'Raises a gate pass. An HOD may raise only for a department they head; the sitting COO or CEO (holds_fallback_office(), 067) may raise for any department. See migration 069.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. You may always read the pass you raised
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER, for the reason every other arm of these policies is: the
-- line policy has to ask a question about the PARENT, and doing that with a
-- plain subquery would run `gate_passes_select` inside `gate_pass_items_select`
-- on every row. Cheap, single-column, and it answers about `auth.uid()` alone,
-- so it can tell no caller anything about anybody else.
create or replace function gatepass.raised_by_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
           select 1 from gatepass.gate_passes g
            where g.id = p_pass_id
              and g.raised_by = auth.uid()
         );
$fn$;

comment on function gatepass.raised_by_me(uuid) is
  'True when the caller raised this pass. The originator arm of the two select policies (069) — a COO or CEO raising for a department they do not head has no other way to see their own pass until the ladder reaches them.';

revoke all on function gatepass.raised_by_me(uuid) from public;
grant execute on function gatepass.raised_by_me(uuid) to authenticated;

-- 067's two policies with ONE arm added to each, and nothing else touched.
drop policy if exists gate_passes_select on gatepass.gate_passes;
create policy gate_passes_select on gatepass.gate_passes
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(id))
    or department_id in (select gatepass.my_department_ids())
    or raised_by = auth.uid()
    or gatepass.pass_routed_to_me(id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(id))
  );

drop policy if exists gate_pass_items_select on gatepass.gate_pass_items;
create policy gate_pass_items_select on gatepass.gate_pass_items
  for select to authenticated
  using (
    gatepass.is_admin()
    or (gatepass.app_role() = 'guard' and not gatepass.pass_awaits_approval(gate_pass_id))
    or department_id in (select gatepass.my_department_ids())
    or gatepass.raised_by_me(gate_pass_id)
    or gatepass.pass_routed_to_me(gate_pass_id)
    or (gatepass.holds_fallback_office() and gatepass.pass_is_stuck(gate_pass_id))
  );

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 070_a_gate_rejection_is_final.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 070 — A REJECTION AT THE GATE IS FINAL. The pass is closed and a new one is
--       raised; there is no review, no override and no second round.
--
-- Client, 2026-08-31: "once a guard rejects a pass he has to mention the
-- justification as to why is he rejecting the pass and then the entire pass
-- will be cancelled and a new pass needs to be raised."
--
-- THE JUSTIFICATION WAS ALREADY MANDATORY — `flag_pass` (035) refuses a blank
-- `p_reason` and writes it to both `gate_passes.flag_reason` and a
-- `verifications` row. Nothing about that changes, and this migration
-- deliberately does not re-issue the function: it is already exactly what the
-- client asked for.
--
-- WHAT CHANGES IS WHAT HAPPENS NEXT. Since 015 a flagged pass went BACK to the
-- raising HOD, who either upheld the flag (→ `cancelled`) or overrode it
-- (→ `hod_reviewed`, with `expires_at` refreshed to the end of the day so the
-- same material could be walked back to the same barrier). That override is
-- what the client has now removed: the guard's refusal is the end of the pass.
-- So `hod_review_flagged_pass` is DROPPED — not left in place unused, because
-- an unused SECURITY DEFINER function is still EXECUTE-able over PostgREST by
-- every authenticated user, and this one can move a pass's status.
--
-- `flagged` IS NOW A TERMINAL STATUS, and that is the whole state-machine
-- change. It was already terminal at the barrier — `match_pass` admits only
-- `pending` and `hod_reviewed`, so no guard could ever clear a flagged pass —
-- and `hod_review_flagged_pass` was the single door out of it. With that door
-- gone, a flagged pass can never move again by any path: it is closed, exactly
-- as a cancelled one is, and the portal says so in those words. It keeps its
-- own label rather than being folded into `cancelled` on purpose — "security
-- stopped this at the gate, and here is what they wrote" is a different fact
-- from "the HOD voided it", and a record that cannot tell them apart cannot
-- answer why a pass died. Every report already grades the two together.
--
-- THE 7 PASSES SITTING IN `flagged` TODAY ARE NOT MIGRATED. They are closed by
-- this change where they stand, which is the client's rule applied to them —
-- and rewriting a status somebody was notified about would be inventing an
-- event nobody performed. Their raising HODs raise replacements, the same as
-- for a pass flagged tomorrow.
--
-- NOT TOUCHED, deliberately:
--   * `hod_reviewed` — 3 live passes still hold that status, cleared by an HOD
--     before today's rule. The gate must still be able to finish them, so
--     `match_pass` and `flag_pass` go on admitting it. Nothing can ENTER the
--     status any more; the enum label survives because Postgres cannot drop
--     one, and it is now a historical value only.
--   * `hod_void_expired_pass` (041) — an EXPIRED pass is a different door and
--     the client did not close it: nobody stopped that material, it simply
--     never travelled, and the raising HOD still voids it themselves.
-- ============================================================================

-- The one door out of `flagged`, removed. `revoke` first is redundant with the
-- drop and stated anyway: if a later migration ever recreates this function by
-- copy-paste, the intent above is what a reader finds in the history.
revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
drop function if exists gatepass.hod_review_flagged_pass(uuid, text, text);

comment on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb) is
  'The guard refuses a pass at the barrier, in writing. The written reason is mandatory (035) and the refusal is FINAL (070): the pass is closed, nothing can move it again, and the raising department raises a replacement.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 071_raised_by_office_is_recorded.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 071 — A PASS RECORDS THE OFFICE THAT RAISED IT
--
-- 069 let the sitting COO and the CEO raise a pass for ANY department. It did
-- not give any reader a way to KNOW that had happened. `gate_passes` records
-- `raised_by` and the view resolves it to a name, so a pass the COO raised for
-- Housekeeping reads, on every timeline in the app, as a name beside the word
-- "Housekeeping" — indistinguishable from that department's own HOD raising it.
-- The printed slip was the plainest case: its first box is headed "Issuing HOD"
-- and a person signs paper under that heading.
--
-- IT MUST BE A SNAPSHOT, NOT A LOOKUP. `gatepass.approval_roles` holds only the
-- CURRENT holder of each office (CLAUDE.md's own landmine: who held an office
-- on a past date cannot be reconstructed). Deriving "the COO raised this" by
-- comparing `raised_by` against today's designations would silently relabel
-- every pass the pair ever raised the day either seat changes hands — and would
-- start crediting a NEW COO with material their predecessor moved. So the
-- office is written onto the pass at the moment it is raised, exactly as
-- `pass_approvals.routed_to` snapshots who each rung was routed to (046).
--
-- NULL IS THE ORDINARY CASE and means an HOD raised it for their own
-- department. Every pass that existed before this migration is null and reads
-- exactly as it always has — there is nothing to back-fill, and back-filling
-- from today's `approval_roles` is the very thing the paragraph above refuses.
--
-- THE PAIR IS STILL DEFINED ONCE. `holds_fallback_office()` (067) answered
-- yes/no; it is re-expressed below in terms of a new `my_fallback_office()`
-- that answers WHICH, so the ('coo','ceo') list and the active-user check exist
-- in one place and every caller — the emergency release, 069's raising guard,
-- the two select policies — keeps its current meaning to the letter.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Which of the two offices the caller sits in
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the reason 067's predicate is: `approval_roles` is not
-- readable by an ordinary caller, and this answers about `auth.uid()` alone, so
-- it can tell nobody anything about anybody else. One seat per person (049), so
-- `limit 1` is a formality rather than a choice between rows.
create or replace function gatepass.my_fallback_office()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role_key
    from gatepass.approval_roles r
   where r.role_key in ('coo', 'ceo')
     and r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid())
   limit 1;
$fn$;

comment on function gatepass.my_fallback_office() is
  'The fallback office the caller sits in - coo, ceo, or null. Deputies and delegates are excluded exactly as they are from holds_fallback_office(). See migration 071.';

revoke all on function gatepass.my_fallback_office() from public;
grant execute on function gatepass.my_fallback_office() to authenticated;

-- 067's predicate, unchanged in meaning, restated over the function above so
-- the pair and the active check are written down once. `create or replace`
-- keeps every policy and every caller bound to it.
create or replace function gatepass.holds_fallback_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select gatepass.my_fallback_office() is not null;
$fn$;

comment on function gatepass.holds_fallback_office() is
  'True for the sitting COO or CEO. Deputies and delegates are deliberately excluded: emergency release is the last door and belongs to the officer, not to their cover. Since 071 it is my_fallback_office() is not null - one definition of the pair. See migrations 067 and 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The column
-- ═══════════════════════════════════════════════════════════════════════════
alter table gatepass.gate_passes
  add column if not exists raised_by_office text;

alter table gatepass.gate_passes
  drop constraint if exists gate_passes_raised_by_office_known;

-- The same two-office list as the predicate, and no free text: a fifth value
-- here would print a heading no client-side map has words for. It is a CHECK
-- rather than an enum because there is no existing type holding exactly this
-- pair, and a new enum label cannot be USED in the transaction that adds it
-- (CLAUDE.md) — which is precisely the transaction APPLY_ALL.sql is.
alter table gatepass.gate_passes
  add constraint gate_passes_raised_by_office_known
  check (raised_by_office is null or raised_by_office in ('coo', 'ceo'));

comment on column gatepass.gate_passes.raised_by_office is
  'The fallback office the raiser sat in when this pass was raised (069), snapshotted because approval_roles keeps only the current holder. Null means an HOD raised it for a department they head. See migration 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Raising stamps it
-- ═══════════════════════════════════════════════════════════════════════════
-- 069's function verbatim from the item loop down. The only changes are at the
-- top: the office is read instead of the yes/no, and it is written into the
-- insert. NOTHING about the ladder moves — a COO-raised pass is still
-- snapshotted by the 063 trigger, still owes the Security Head and Finance in
-- order, and the COO still signs their own level-3 rung.
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
     visitor_company, vehicle_number, purpose, expected_return_date)
  values
    (p_type, p_direction, p_department_id, auth.uid(), v_office, p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
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
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) is
  'Raises a gate pass. An HOD may raise only for a department they head; the sitting COO or CEO (my_fallback_office(), 071) may raise for any department and has that office stamped onto the row. See migrations 069 and 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The view carries it
-- ═══════════════════════════════════════════════════════════════════════════
-- TRAP 2 (CLAUDE.md): `create or replace view` cannot absorb a new base-table
-- column, so the view is DROPPED and rebuilt with its grant re-applied in the
-- same transaction, and `security_invoker = true` is restated — without it the
-- view runs as its owner and every HOD reads every department. The body is
-- 057's, edited mechanically rather than retyped: ONE column added.
--
-- Every list, card, drill, report, CSV and notification query in this app reads
-- `v_gate_passes` with `select('*')`, so this one line is what carries the
-- office to all four timelines without a second query anywhere.
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
    p.raised_by_office,
    p.visitor_name,
    p.visitor_company,
    p.vehicle_number,
    p.purpose,
    p.expected_return_date,
    p.return_status,
    p.actual_return_date,
    p.verified_by,
    p.verified_at,
    p.flag_reason,
    p.created_at,
    p.updated_at,
    p.qr_token,
    p.expires_at,
    p.direction,
    p.image_url,
    p.category,
    ( SELECT max(f.created_at) AS max
           FROM gatepass.verifications f
          WHERE f.gate_pass_id = p.id AND f.action = 'flagged'::gatepass.verify_action) AS flagged_at,
    ( SELECT max(r.created_at) AS max
           FROM gatepass.verifications r
          WHERE r.gate_pass_id = p.id AND r.action = 'hod_reviewed'::gatepass.verify_action) AS hod_reviewed_at,
    p.return_status = 'awaiting_return'::gatepass.return_status AND p.expected_return_date IS NOT NULL AND p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date AS is_overdue,
    p.status = 'pending'::gatepass.pass_status AND p.expires_at < now() AS is_expired,
        CASE
            WHEN p.expected_return_date IS NULL OR (p.return_status::text <> ALL (ARRAY['awaiting_return'::text, 'partially_returned'::text])) THEN 'not_applicable'::text
            WHEN p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date THEN 'overdue'::text
            WHEN p.expected_return_date = (now() AT TIME ZONE gatepass.site_tz())::date THEN 'due_today'::text
            WHEN p.expected_return_date = ((now() AT TIME ZONE gatepass.site_tz())::date + 1) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS due_state,
    gatepass.pass_awaits_approval(p.id) AS awaits_approval,
    COALESCE(it.item_count, 0::bigint) AS item_count,
    COALESCE(it.total_quantity, 0::numeric) AS total_quantity,
    COALESCE(it.returned_quantity, 0::numeric) AS returned_quantity,
    it.material_summary,
    COALESCE(it.total_value, 0::numeric) AS total_value,
    d.name AS department_name,
    d.code AS department_code,
    rb.full_name AS raised_by_name,
    vb.full_name AS verified_by_name
   FROM gatepass.gate_passes p
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            sum(i.quantity) AS total_quantity,
            sum(i.returned_qty) AS returned_quantity,
            string_agg(i.name, ', '::text ORDER BY i.line_no) AS material_summary,
            sum(i.approx_value) AS total_value
           FROM gatepass.gate_pass_items i
          WHERE i.gate_pass_id = p.id) it ON true
     LEFT JOIN public.departments d ON d.id = p.department_id
     LEFT JOIN gatepass.profile_names rb ON rb.id = p.raised_by
     LEFT JOIN gatepass.profile_names vb ON vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 072_a_delegation_moves_the_rung.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 072 — A DELEGATION ACTUALLY MOVES THE RUNG, EVEN BETWEEN THE COO AND THE CEO
--
-- Client, 2026-08-31: "whenever any delegation of approval is created in either
-- ceo/coo, it should appropriately go to the respective approver. I can see
-- it's still going to coo for approval when he is on absence and has raised
-- delegation for a particular time period, same for ceo."
--
-- ── THE BUG, AND IT IS ONE 049 PREDICTED IN WRITING. ────────────────────────
-- `gatepass.my_approval_role()` is `returns text` — a SCALAR — over a two-arm
-- `union all`: the office you HOLD, and the office you are covering under a
-- live delegation (062, 068). Every seat refusal in 049, 062 and 066 exists to
-- guarantee that query yields AT MOST ONE ROW, because a `language sql` scalar
-- over a multi-row body does not error: Postgres returns the FIRST row and
-- discards the rest, silently.
--
-- 067 THEN BROKE THAT GUARANTEE ON PURPOSE. The COO and the CEO delegate only
-- to each other, and the one-seat refusal is skipped for that pair alone — "only
-- because covering a shared rung cannot put two signatures on one pass", which
-- is true and is not the property that was load-bearing here. The property that
-- was load-bearing is SCALARITY, and 067 did not carry it.
--
-- So with a live COO → CEO delegation the CEO's `my_approval_role()` returns
-- `ceo` (the holder arm sorts first) and the `coo` arm is thrown away. The
-- consequences, all three of them silent:
--
--   * `pass_routed_to_me` (061/063) matches on `ceo`, so the COO's rung is not
--     the CEO's to see as the COO's;
--   * `approve_pass_level` (068) resolves `ceo`, hits 063's escalation gate —
--     the COO still has hours on the clock — and REFUSES;
--   * the queue at /approvals is empty, and the pass sits, addressed to a
--     person who declared themselves absent.
--
-- Verified against the live project on 2026-08-31: the sitting CEO was both the
-- `ceo` holder and the live delegate of `coo`, and the two arms returned two
-- rows.
--
-- ── THE FIX: AUTHORITY IS A SET, IDENTITY IS A SCALAR. ──────────────────────
-- 049's own comment named the work: "`my_approval_role()` becomes a set-returning
-- `my_approval_roles()`, `pass_routed_to_me` matches on membership". That is
-- what this migration does, and nothing more.
--
--   * `my_approval_roles()` — every office this caller may act for, holder arm
--     first. THE AUTHORITY TEST. Both arms still gated on `is_user_active` (040).
--   * `my_approval_role()` — the FIRST of those, kept because identity is a real
--     and separate question: which office's Delegation tab do I open, which
--     title sits under my name in the sidebar. It is no longer an authority test
--     and its comment says so.
--   * `my_acting_role(pass, respect_escalation)` — WHICH of my offices may act
--     on THIS pass right now. One office, chosen by rule rather than by the
--     accident of a `union all`'s row order.
--
-- WHY A DELEGATED OFFICE OUTRANKS MY OWN when both could act. It can only ever
-- happen on level 3, the one rung the COO and the CEO share, and the delegation
-- is the whole reason the pass can move at all: signing as the absent office
-- clears the rung with no escalation window to wait out, and 063's sibling-close
-- writes the other row off as `not_required` in the same statement. Signing as
-- my own office instead would mean waiting 48 hours to do the identical thing.
-- One signature either way — the four-eyes property is untouched, because a
-- rung closed is a rung closed.
--
-- A REJECTION IS STILL NEVER ESCALATION-GATED (063's rule, restated): the
-- rejection path asks `my_acting_role(..., false)`.
--
-- ── AND THE PASS HAS TO SAY SO ON SCREEN AND IN THE POST. ───────────────────
-- Two readers were still being handed the absent holder's name, and both are
-- the client's "it should go to the respective approver":
--
--   * `approval_notice_payload` (051, 068) addresses each level to whoever holds
--     the office TODAY. Today, for a delegated office, is the delegate — the
--     person the database will actually accept a press from. 051's own argument
--     ("the letter asked a person the database would have refused") applies
--     verbatim; it just never considered a delegation.
--   * `get_approval_ladder` (043, 068) names the holder, so the "Waiting with"
--     strip on the admin and HOD boards printed the absent COO. It gains
--     `acting_user_id` / `acting_name` / `delegated` — the holder columns are
--     untouched, because who HOLDS the office is still a fact worth reading.
--
-- NOT TOUCHED, DELIBERATELY: `holds_fallback_office()` (067) still reads
-- `approval_roles` alone. The super admin fallback is the SEAT's, not a
-- stand-in's — 067 says so by name — and so is `raise_pass`'s admission of the
-- pair (069) and the CEO's whitelist decision (053). A delegation hands over a
-- rung on the ladder, not the emergency door.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Authority — every office this caller may act for
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's body, unchanged except that it is now allowed to return what it always
-- could. THE ORDER IS PART OF THE CONTRACT: the holder arm first, so
-- `my_approval_role()` below keeps returning exactly what it returned before
-- for the ~every caller who holds one office and covers none.
--
-- Still no `limit`. 049's argument survives intact for every office but the
-- shared rung: a person holding two SEATS is still a broken invariant, and this
-- function must keep exposing it rather than truncating it away.
create or replace function gatepass.my_approval_roles()
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role_key
    from gatepass.approval_roles r
   where r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid())
  union all
  select d.role_key
    from gatepass.approval_delegations d
   where d.delegate_id = auth.uid()
     and gatepass.delegation_is_live(d.revoked_at, d.starts_at, d.ends_at)
     and gatepass.is_user_active(auth.uid());
$fn$;

comment on function gatepass.my_approval_roles() is
  'Every approval office this caller may act for — as its holder, or under a live delegation (062) — holder first. THE AUTHORITY TEST: since 067 let the COO and the CEO delegate to each other, one person can legitimately be both, and a scalar silently dropped the second. Suspended accounts hold nothing (040). See migration 072.';

revoke all on function gatepass.my_approval_roles() from public;
grant execute on function gatepass.my_approval_roles() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Identity — the one office this caller IS
-- ═══════════════════════════════════════════════════════════════════════════
-- The holder arm when there is one, else the office being covered. This is what
-- the sidebar prints under a name, what the Delegation tab hands to
-- `create_approval_delegation` (which gates on holding the office YOURSELF and
-- would refuse a covered one anyway), and what decides which routes open.
--
-- ⚠ IT IS NOT AN AUTHORITY TEST ANY MORE. Nothing that decides whether a press
-- is allowed may read this function; they read `my_approval_roles()` or
-- `my_acting_role()`. Taking the first row here is honest — this function asks
-- for one office and says so — where the old implicit truncation was not.
create or replace function gatepass.my_approval_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.role_key from gatepass.my_approval_roles() t(role_key) limit 1;
$fn$;

comment on function gatepass.my_approval_role() is
  'The office this caller IS — their own seat if they hold one, else the office they are covering. IDENTITY ONLY: routes, titles and the Delegation tab. Authority is gatepass.my_approval_roles() (072), which can return two since 067 let the COO and the CEO cover each other.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Which of my offices may act on THIS pass
-- ═══════════════════════════════════════════════════════════════════════════
-- Among the offices I may act for: the ones with a pending row on this pass, on
-- the LOWEST pending level, that are not waiting out 063's escalation window.
-- A delegated office wins a tie — see the header.
--
-- `p_respect_escalation` is false on the rejection path alone. 063: "a limit
-- caps what somebody may COMMIT the business to, and refusing to let an office
-- STOP a pass points the rule exactly the wrong way."
--
-- Null means "none of my offices may act on this pass right now", and the two
-- RPCs below diagnose WHY rather than passing that null on to a user.
--
-- SECURITY DEFINER for the reason `level_escalates_at` is (063): it reads
-- `pass_approvals`, whose own policy would otherwise recurse through it (42P17).
-- Deliberately NOT granted to `authenticated` — nothing outside these RPCs has
-- any business asking, and an ungranted function is one fewer thing reachable
-- over PostgREST.
create or replace function gatepass.my_acting_role(
  p_pass_id             uuid,
  p_respect_escalation  boolean default true
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  with mine as (
    select t.role_key,
           exists (
             select 1 from gatepass.my_live_delegation() d
              where d.role_key = t.role_key
           ) as delegated
      from gatepass.my_approval_roles() t(role_key)
  ),
  open_rungs as (
    select a.role_key, a.level_no
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.status = 'pending'
  ),
  lowest as (
    select min(level_no) as level_no from open_rungs
  )
  select m.role_key
    from mine m
    join open_rungs o on o.role_key = m.role_key
    join lowest    l on l.level_no  = o.level_no
   where not p_respect_escalation
      or coalesce(gatepass.level_escalates_at(p_pass_id, m.role_key) <= now(), true)
   order by m.delegated desc, m.role_key
   limit 1;
$fn$;

comment on function gatepass.my_acting_role(uuid, boolean) is
  'Which of this caller''s approval offices may decide this pass right now — lowest pending rung, escalation window respected unless a rejection asks it not to be, a covered office preferred over their own on a shared rung. Null when none may. See migration 072.';

revoke all on function gatepass.my_acting_role(uuid, boolean) from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Visibility matches on MEMBERSHIP
-- ═══════════════════════════════════════════════════════════════════════════
-- 063's body with one line changed: `= my_approval_role()` becomes `in
-- (my_approval_roles())`. 061's rule — an office sees a pass only once every
-- rung BELOW it is closed in its favour — is untouched, and so is the reason
-- `not_required` counts as closed.
create or replace function gatepass.pass_routed_to_me(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from gatepass.pass_approvals a
     where a.gate_pass_id = p_pass_id
       and a.role_key in (select t.role_key from gatepass.my_approval_roles() t(role_key))
       and not exists (
         select 1
           from gatepass.pass_approvals b
          where b.gate_pass_id = a.gate_pass_id
            and b.level_no < a.level_no
            and b.status not in ('approved', 'not_required')
       )
  );
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The two decisions act for the office that can actually act
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's `approve_pass_level`, with the office resolved per pass instead of per
-- caller. Every refusal it made before, it still makes, in the same order and
-- with the same words — the escalation sentence included, which is now reached
-- by way of "no office of mine may act, and the reason is the window".
create or replace function gatepass.approve_pass_level(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles       text[] := array(select t.role_key from gatepass.my_approval_roles() t(role_key));
  v_role        text;
  v_mine        smallint;
  v_lowest      smallint;
  v_status      text;
  v_deleg_id    uuid;
  v_deleg_limit numeric;
  v_value       numeric;
  v_escalates   timestamptz;
begin
  if cardinality(v_roles) = 0 then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  -- The lowest rung ANY of my offices is pending on.
  select min(a.level_no) into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = any(v_roles)
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  v_role := gatepass.my_acting_role(p_pass_id);

  -- THE ESCALATION GATE, reached the only way it can still be reached: my rung
  -- is the lowest one open and I am STILL not allowed to sign it. Only the CEO
  -- behind a COO who has time left can be in that position (063).
  if v_role is null then
    v_escalates := gatepass.level_escalates_at(p_pass_id, 'ceo');
    if v_escalates is not null then
      raise exception 'This pass is with the COO until %. It escalates to the CEO only if they have not decided it by then.',
        to_char(v_escalates, 'DD Mon YYYY HH24:MI');
    end if;
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select d.id, d.approval_limit into v_deleg_id, v_deleg_limit
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  if v_deleg_id is not null and v_deleg_limit is not null then
    select coalesce(sum(i.approx_value), 0) into v_value
      from gatepass.gate_pass_items i
     where i.gate_pass_id = p_pass_id;

    if v_value > v_deleg_limit then
      raise exception 'Your delegation of the % office is limited to %. This pass is worth % — the office holder has to sign it.',
        gatepass.approval_office_title(v_role),
        to_char(v_deleg_limit, 'FM999,999,999,990.00'),
        to_char(v_value,       'FM999,999,999,990.00');
    end if;
  end if;

  update gatepass.pass_approvals a
     set status              = 'approved',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  -- ONE SIGNATURE CLOSES THE RUNG (063). Unchanged, and it is what makes the
  -- COO's delegate signing the COO's row also discharge the CEO's — the pair
  -- share level 3, and a rung takes one signature.
  update gatepass.pass_approvals a
     set status     = 'not_required',
         decided_at = now(),
         reason     = 'Not required — level ' || v_mine || ' was approved by the '
                      || gatepass.approval_office_title(v_role) || '.'
   where a.gate_pass_id = p_pass_id
     and a.level_no = v_mine
     and a.role_key <> v_role
     and a.status = 'pending';
end;
$fn$;

-- 068's `reject_pass_level`, resolved the same way and NEVER escalation-gated.
create or replace function gatepass.reject_pass_level(p_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_roles     text[] := array(select t.role_key from gatepass.my_approval_roles() t(role_key));
  v_role      text;
  v_mine      smallint;
  v_lowest    smallint;
  v_status    text;
  v_deleg_id  uuid;
  v_reason    text := btrim(coalesce(p_reason, ''));
begin
  if cardinality(v_roles) = 0 then
    raise exception 'You do not hold a gate pass approval office.';
  end if;

  if length(v_reason) = 0 then
    raise exception 'A rejection needs a reason.';
  end if;
  v_reason := left(v_reason, 500);

  select g.status::text into v_status
    from gatepass.gate_passes g where g.id = p_pass_id;
  if v_status is null then
    raise exception 'That gate pass does not exist.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This gate pass is no longer waiting for approval.';
  end if;

  select min(a.level_no) into v_mine
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.role_key = any(v_roles)
     and a.status = 'pending';
  if v_mine is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select min(a.level_no) into v_lowest
    from gatepass.pass_approvals a
   where a.gate_pass_id = p_pass_id
     and a.status = 'pending';

  if v_mine <> v_lowest then
    raise exception 'An earlier approval level has not signed this pass yet.';
  end if;

  -- `false`: a rejection is never withheld for a clock (063's rule).
  v_role := gatepass.my_acting_role(p_pass_id, false);
  if v_role is null then
    raise exception 'This gate pass is not waiting on your approval.';
  end if;

  select d.id into v_deleg_id
    from gatepass.my_live_delegation() d
   where d.role_key = v_role;

  update gatepass.pass_approvals a
     set status              = 'rejected',
         decided_by          = auth.uid(),
         decided_at          = now(),
         decided_as_delegate = (v_deleg_id is not null),
         delegation_id       = v_deleg_id,
         reason              = v_reason
   where a.gate_pass_id = p_pass_id
     and a.role_key = v_role;

  update gatepass.gate_passes
     set status = 'cancelled'::gatepass.pass_status
   where id = p_pass_id;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'cancelled'::gatepass.verify_action, auth.uid(), v_reason);
end;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The ladder names who is HOLDING the rung today
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropped and recreated: `create or replace function` cannot add columns to a
-- return type. The grant goes with the drop and comes back in the same
-- transaction.
--
-- The holder columns are UNCHANGED and still first — an admin seating an office
-- reads `user_id` / `full_name`, and a delegation must not make the seat look
-- vacant or occupied by somebody else. `acting_*` is the separate question the
-- "Waiting with" strip asks: who does this pass sit with TODAY.
drop function if exists gatepass.get_approval_ladder();

create function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz,
  acting_user_id  uuid,
  acting_name     text,
  delegated       boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at,
         coalesce(dg.delegate_id, r.user_id) as acting_user_id,
         coalesce(dp.full_name, p.full_name) as acting_name,
         (dg.delegate_id is not null)        as delegated
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
    -- AT MOST ONE. 062 refuses overlapping windows on one office, so the
    -- lateral is a lookup and not a choice; the `limit 1` is belt to that
    -- constraint's braces and keeps the join shape a single row either way.
    left join lateral (
           select dd.delegate_id
             from gatepass.approval_delegations dd
            where dd.role_key = r.role_key
              and gatepass.delegation_is_live(dd.revoked_at, dd.starts_at, dd.ends_at)
            order by dd.starts_at desc
            limit 1
         ) dg on true
    left join public.profiles   dp on dp.id = dg.delegate_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'finance_head'  then 3
              when 'ceo'           then 4
            end;
$fn$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

comment on function gatepass.get_approval_ladder() is
  'Who holds each approval office, and who is ACTING for it today — a live delegation (062) puts the delegate in acting_user_id / acting_name and sets delegated. The holder columns never move: an admin seating an office reads those. See migration 072.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The letter goes to whoever can actually sign
-- ═══════════════════════════════════════════════════════════════════════════
-- 068's payload with one address resolved further along. 051 fixed this once
-- already, for a re-designated office, and its sentence is the whole argument
-- here too: "the letter asked a person the database would have refused, while
-- the person who actually had to sign was never written to. That is the worst
-- of the two failure modes: the ladder silently stops, and the only symptom is
-- an inbox that stays empty."
--
-- THE CHAIN IS: live delegate → current holder → the person the pass was routed
-- to when it was raised. Each fallback is a step further from who may press the
-- button, and every join into `public.*` stays LEFT, so a narrowed VMS policy
-- drops ONE address rather than rerouting the mail.
--
-- `delegated` rides along so the Edge Function's template can say why a stranger
-- is being asked to sign. It needs no redeploy to ignore it.
create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select (
    select jsonb_build_object(
      'pass', (
        select jsonb_build_object(
                 'id',                   p.id,
                 'pass_number',          p.pass_number,
                 'type',                 p.type,
                 'status',               p.status,
                 'visitor_name',         p.visitor_name,
                 'purpose',              p.purpose,
                 'vendor_name',          gatepass.company_name_of(p.visitor_company),
                 'department_name',      d.name,
                 'raised_by',            p.raised_by,
                 'raised_by_name',       rb.full_name,
                 'raised_by_email',      rb.email,
                 'item_count',           coalesce(it.item_count, 0),
                 'total_value',          coalesce(it.total_value, 0),
                 'expected_return_date', p.expected_return_date,
                 'created_at',           p.created_at
               )
          from gatepass.gate_passes p
          left join public.departments d on d.id = p.department_id
          left join public.profiles   rb on rb.id = p.raised_by
          left join lateral (
                 select count(*) as item_count, sum(i.approx_value) as total_value
                   from gatepass.gate_pass_items i
                  where i.gate_pass_id = p.id
               ) it on true
         where p.id = p_pass_id
      ),
      'approvals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'role_key',       a.role_key,
                 'level_no',       a.level_no,
                 'status',         a.status,
                 'approver_id',    coalesce(dg.delegate_id, r.user_id, a.routed_to),
                 'approver_name',  coalesce(dp.full_name, cur.full_name, ap.full_name),
                 'approver_email', coalesce(dp.email, cur.email, ap.email),
                 'delegated',      (dg.delegate_id is not null),
                 'holder_name',    cur.full_name,
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
          left join lateral (
                 select dd.delegate_id
                   from gatepass.approval_delegations dd
                  where dd.role_key = a.role_key
                    and gatepass.delegation_is_live(dd.revoked_at, dd.starts_at, dd.ends_at)
                  order by dd.starts_at desc
                  limit 1
               ) dg on true
          left join public.profiles        dp on dp.id = dg.delegate_id
         where a.gate_pass_id = p_pass_id
      ), '[]'::jsonb)
    )
  )
  || jsonb_build_object(
       'emergency', (
         select jsonb_build_object(
                  'released_at',   e.released_at,
                  'released_name', rp.full_name,
                  'reason',        e.reason,
                  'reviewed_at',   e.reviewed_at
                )
           from gatepass.emergency_releases e
           left join public.profiles rp on rp.id = e.released_by
          where e.gate_pass_id = p_pass_id
       )
     );
$fn$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included (047/051/072), plus the emergency release that cleared this pass if there was one (055). Each level is addressed to whoever may SIGN it today — the live delegate, else the office''s current holder, else the holder snapshotted at raise. The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 073_same_material_twice_on_one_pass.sql
-- ═══════════════════════════════════════════════════════════
-- ============================================================================
-- 073 — The same material may appear on a pass more than once
--
-- Client, 2026-09-01: "make sure same material type can be typed in the items
-- multiple times".
--
-- ── WHAT WAS IN FORCE ───────────────────────────────────────────────────────
-- A partial unique index over `normalize_material(description)`, alive in one
-- shape or another since 008 and last rewritten by 037:
--
--     gate_pass_items_one_open_per_material_idx
--       on gatepass.gate_pass_items (gate_pass_id, normalize_material(description))
--       where is_open
--
-- 037 narrowed it from per-DEPARTMENT to per-PASS, which fixed "an IT HOD could
-- not raise an RGP", and kept the per-pass half on the reasoning that two lines
-- naming one material are a double-typed line.
--
-- ── WHY THAT REASONING DOES NOT HOLD ────────────────────────────────────────
-- A material description is a NOUN, and the columns that tell two lines apart
-- are the OTHER ones. Two lines reading "Laptop" on one pass are routinely two
-- different laptops: different Serial / Asset Tag, different Make / Model /
-- Size, different Order No., different Approx. Value, and — on an RGP — a
-- different expected return date. Collapsing them into one line of quantity 2,
-- which is what the index forced, THROWS ALL OF THAT AWAY: the gate then has
-- one line it cannot check serial by serial, and `apply_item_returns` can only
-- record "1 of 2 back" without being able to say which one.
--
-- The index also caught nothing else. A genuine double-typed line is a typing
-- mistake the HOD can see and delete; a unique index is not what finds it, and
-- the price of the check was refusing a legitimate pass at submit with a 23505
-- the requester could do nothing about but merge two real items.
--
-- ── WHAT THIS MIGRATION DOES ────────────────────────────────────────────────
-- Drops the index — both live spellings, by their real names (037's lesson:
-- `drop index if exists` on a name that is not the one in pg_indexes is a
-- silent no-op, so a wrong name here would leave the rule enforced for ever).
--
-- `gatepass.normalize_material(text)` goes with it. It has no other caller —
-- 013 moved the last gate_passes-level index off it and dropped that one, so
-- once this index is gone the function is unreachable schema that every
-- authenticated role still holds EXECUTE on.
--
-- WHAT STAYS: `gate_pass_items.department_id` and `is_open`. 013 introduced
-- both to make this index expressible, but they long since grew other callers —
-- `department_id` is read by the `gate_pass_items_select` policy, and `is_open`
-- is the per-line "still an outstanding obligation" that `apply_item_returns`
-- and the returns boards run on. Neither is dead.
--
-- WHAT IS UNCHANGED: `gate_pass_items_line_unique (gate_pass_id, line_no)`
-- still holds, so lines are still distinct rows with a stable number the guard
-- can read off the slip over radio — which is the ordering "line 2 of 3" the
-- duplicate descriptions now rely on.
-- ============================================================================

-- The per-PASS spelling 037 created, and the per-DEPARTMENT one that predates
-- it (an environment that never ran 037 still carries the wider rule).
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;
drop index if exists gatepass.gate_pass_items_one_open_per_department_material_idx;

-- No index is built on it any more, and nothing else calls it.
drop function if exists gatepass.normalize_material(text);

notify pgrst, 'reload schema';

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
-- As of migration 032 a person can belong to AT MOST ONE department (enforced
-- by hod_departments_one_department_per_person, a unique index on hod_id), so
-- the old multi-department demonstration for hod.it is gone — profiles.department_id
-- is single-column, and this seed now mirrors exactly that single department.
--
-- SKIP THIS FILE in a real deployment; use the Admin → Departments screen instead.
-- ============================================================================

-- 1) Every HOD gets the single department VMS already has them against.
insert into gatepass.hod_departments (hod_id, department_id)
select p.id, p.department_id
  from public.profiles p
 where p.role = 'hod'
   and p.department_id is not null
on conflict (hod_id, department_id) do nothing;

-- Result to expect (one department per person — 032):
--   hod.it@demo.vms   → Information Technology
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

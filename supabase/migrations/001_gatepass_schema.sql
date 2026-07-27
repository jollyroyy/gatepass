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

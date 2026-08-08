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

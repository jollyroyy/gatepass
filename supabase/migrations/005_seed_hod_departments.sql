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

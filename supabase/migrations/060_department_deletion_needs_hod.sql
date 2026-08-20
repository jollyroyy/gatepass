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

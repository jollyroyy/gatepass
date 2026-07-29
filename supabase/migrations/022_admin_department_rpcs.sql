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

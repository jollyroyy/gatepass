// Departments tab. The shared-table warning below is the whole point of this
// screen: `public.departments` belongs to VMS too, so anything added, renamed,
// or recoded here is visible to VMS immediately.
//
// HOD coverage (`gatepass.hod_departments`) is a deliberate many-to-many: one
// HOD can cover several departments, and one department can have several HODs
// — the live DB already has two HODs per department.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp, pub } from '../../supabaseClient';
import type { Department, HodDepartment, Profile } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';

const SKELETON_ROWS = 4;

export default function DepartmentsTab(): React.ReactElement {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hodProfiles, setHodProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<HodDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [assignHodId, setAssignHodId] = useState('');
  const [assignDeptId, setAssignDeptId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The HOD list comes from gatepass.admin_list_profiles('hod'), not from
      // public.profiles — see src/lib/profiles.ts for why.
      const [deptRes, hods, assignRes] = await Promise.all([
        pub().from('departments').select('*').order('name'),
        fetchDirectory('hod'),
        gp().from('hod_departments').select('hod_id, department_id, created_at'),
      ]);
      if (deptRes.error) throw deptRes.error;
      if (assignRes.error) throw assignRes.error;
      setDepartments((deptRes.data as Department[] | null) ?? []);
      setHodProfiles(hods);
      setAssignments((assignRes.data as HodDepartment[] | null) ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hodMap = useMemo(() => new Map(hodProfiles.map((p) => [p.id, p])), [hodProfiles]);

  const assignmentsByDept = useMemo(() => {
    const map = new Map<string, HodDepartment[]>();
    for (const a of assignments) {
      const list = map.get(a.department_id) ?? [];
      list.push(a);
      map.set(a.department_id, list);
    }
    return map;
  }, [assignments]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const code = newCode.trim();
    if (!name || !code) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { error } = await pub().from('departments').insert({ name, code });
      if (error) throw error;
      setNewName('');
      setNewCode('');
      await load();
    } catch (err) {
      setCreateError(safeErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignHodId || !assignDeptId) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const { error } = await gp()
        .from('hod_departments')
        .insert({ hod_id: assignHodId, department_id: assignDeptId });
      if (error) {
        // hod_id + department_id is a composite primary key — a repeat
        // assignment collides on it. That is a normal user mistake, not a
        // system failure, so it gets its own plain-English message.
        if ((error as { code?: string }).code === '23505') {
          throw new Error('That HOD already covers this department.');
        }
        throw error;
      }
      setAssignHodId('');
      setAssignDeptId('');
      await load();
    } catch (err) {
      setAssignError(safeErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(hodId: string, departmentId: string) {
    setAssignError(null);
    try {
      const { error } = await gp()
        .from('hod_departments')
        .delete()
        .eq('hod_id', hodId)
        .eq('department_id', departmentId);
      if (error) throw error;
      setAssignments((prev) => prev.filter((a) => !(a.hod_id === hodId && a.department_id === departmentId)));
    } catch (err) {
      setAssignError(safeErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError && <div className="alert-error">{loadError}</div>}

      {/* Create department */}
      <div className="card p-5">
        <h2 className="section-title mb-3">Add a Department</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor="dept-name">
              Name
            </label>
            <input
              id="dept-name"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Quality Assurance"
            />
          </div>
          <div className="w-32">
            <label className="label" htmlFor="dept-code">
              Code
            </label>
            <input
              id="dept-code"
              className="input"
              value={newCode}
              maxLength={10}
              onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 10))}
              placeholder="e.g. QA"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={creating || !newName.trim() || !newCode.trim()}>
            {creating ? 'Adding…' : 'Add Department'}
          </button>
        </form>
        {createError && <div className="alert-error mt-3">{createError}</div>}
      </div>

      {/* Assign HOD */}
      <div className="card p-5">
        <h2 className="section-title mb-1">Assign an HOD to a Department</h2>
        <p className="text-xs text-navy-400 mb-3">
          One HOD can cover several departments, and one department can have several HODs.
        </p>
        <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor="assign-hod">
              HOD
            </label>
            <select
              id="assign-hod"
              className="input"
              value={assignHodId}
              onChange={(e) => setAssignHodId(e.target.value)}
            >
              <option value="">Select HOD…</option>
              {hodProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.email})
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor="assign-dept">
              Department
            </label>
            <select
              id="assign-dept"
              className="input"
              value={assignDeptId}
              onChange={(e) => setAssignDeptId(e.target.value)}
            >
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={assigning || !assignHodId || !assignDeptId}
          >
            {assigning ? 'Assigning…' : 'Assign'}
          </button>
        </form>
        {assignError && <div className="alert-error mt-3">{assignError}</div>}
      </div>

      {/* Department list */}
      <div>
        <h2 className="section-title mb-3">Departments</h2>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        ) : departments.length === 0 ? (
          <div className="table-wrap empty-state">No departments yet. Add one above.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {departments.map((d) => {
              const deptAssignments = assignmentsByDept.get(d.id) ?? [];
              return (
                <div key={d.id} className="card p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-navy-900">{d.name}</span>
                    <span className="type-chip">{d.code}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {deptAssignments.length === 0 ? (
                      <span className="text-xs text-navy-400">No HOD assigned yet.</span>
                    ) : (
                      deptAssignments.map((a) => {
                        const hod = hodMap.get(a.hod_id);
                        return (
                          <span key={a.hod_id} className="status-badge bg-surface-100 text-navy-700">
                            {hod ? hod.full_name : a.hod_id}
                            <button
                              type="button"
                              className="text-navy-400 hover:text-flagged-600"
                              title="Remove this HOD from this department"
                              onClick={() => handleUnassign(a.hod_id, d.id)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

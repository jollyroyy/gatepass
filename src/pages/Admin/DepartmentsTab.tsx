import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp, pub } from '../../supabaseClient';
import type { Department, HodDepartment, Profile } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';

const SKELETON_ROWS = 4;

interface DeptCard {
  dept: Department;
  hods: Profile[];
  strength: number;
}

export default function DepartmentsTab(): React.ReactElement {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hodProfiles, setHodProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<HodDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showList, setShowList] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignHodId, setAssignHodId] = useState('');
  const [assignDeptId, setAssignDeptId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
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

  const deptCards = useMemo<DeptCard[]>(() => {
    const assignByDept = new Map<string, HodDepartment[]>();
    for (const a of assignments) {
      const list = assignByDept.get(a.department_id) ?? [];
      list.push(a);
      assignByDept.set(a.department_id, list);
    }
    return departments.map((d) => {
      const deptAssigns = assignByDept.get(d.id) ?? [];
      const hods = deptAssigns.map((a) => hodMap.get(a.hod_id)).filter((p): p is Profile => !!p);
      return { dept: d, hods, strength: hods.length };
    });
  }, [departments, assignments, hodMap]);

  // Create
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const code = newCode.trim().toUpperCase();
    if (!name || !code) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { error } = await pub().from('departments').insert({ name, code });
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error(`Department "${code}" already exists.`);
        }
        throw error;
      }
      setShowCreate(false);
      setNewName('');
      setNewCode('');
      await load();
    } catch (err) {
      setCreateError(safeErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  // Assign
  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignHodId || !assignDeptId) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const { error } = await gp().from('hod_departments').insert({ hod_id: assignHodId, department_id: assignDeptId });
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error('That HOD already covers this department.');
        }
        throw error;
      }
      setShowAssign(false);
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
    try {
      const { error } = await gp().from('hod_departments').delete().eq('hod_id', hodId).eq('department_id', departmentId);
      if (error) throw error;
      setAssignments((prev) => prev.filter((a) => !(a.hod_id === hodId && a.department_id === departmentId)));
    } catch (err) {
      setLoadError(safeErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError && <div className="alert-error">{loadError}</div>}

      {/* ── Header strip ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title mb-0.5">Departments</h2>
          <p className="text-sm text-navy-400">{departments.length} department{departments.length !== 1 ? 's' : ''} · {hodProfiles.length} HOD{departments.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary text-sm" onClick={() => setShowCreate(true)}>
            Add Department
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setShowAssign(true)}>
            Assign HOD
          </button>
          <button
            type="button"
            className={`text-sm font-medium px-4 py-2 rounded-xl border transition-all ${showList ? 'bg-brand-500 text-white border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
            onClick={() => setShowList((p) => !p)}
          >
            {showList ? 'Hide Departments' : 'Show All Departments'}
          </button>
        </div>
      </div>

      {/* ── Department cards ── */}
      {!showList ? (
        <div className="card p-8 text-center">
          <p className="text-navy-400 text-sm">Click <strong>"Show All Departments"</strong> to view the department directory.</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : deptCards.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-navy-400 text-sm">No departments yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {deptCards.map((c) => (
            <div
              key={c.dept.id}
              className="group relative rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5"
              style={{
                background: 'rgb(var(--glass-bg) / 0.4)',
                backdropFilter: 'blur(20px) saturate(150%)',
                WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                border: '1px solid rgb(var(--c-surface-200) / 0.6)',
              }}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="font-bold text-navy-950 text-base font-display truncate">{c.dept.name}</h3>
                  <span className="type-chip mt-1 inline-block">{c.dept.code}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-brand-50 text-brand-700 text-xs font-bold tabular">
                    {c.strength}
                  </span>
                  <span className="text-[10px] font-medium text-navy-400 uppercase tracking-wider">HODs</span>
                </div>
              </div>

              {/* HOD list */}
              <div className="flex flex-col gap-1.5">
                {c.hods.length === 0 ? (
                  <p className="text-xs text-navy-400 italic">No HOD assigned</p>
                ) : (
                  c.hods.map((hod) => (
                    <div key={hod.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-100/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-navy-800 truncate">{hod.full_name}</p>
                        <p className="text-[11px] text-navy-400 truncate">{hod.email}</p>
                      </div>
                      <button
                        type="button"
                        className="text-navy-300 hover:text-flagged-600 transition-colors shrink-0"
                        title="Remove HOD from this department"
                        onClick={() => handleUnassign(hod.id, c.dept.id)}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Department Modal ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Add Department</h2>
            <p className="text-sm text-navy-500 mb-5">Create a new department visible to both GatePass and VMS.</p>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="label">Department Name</label>
                <input className="input" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Quality Assurance" autoFocus />
              </div>
              <div>
                <label className="label">Code</label>
                <input className="input" required maxLength={10} value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 10))} placeholder="e.g. QA" />
              </div>
              {createError && <div className="alert-error">{createError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowCreate(false); setCreateError(null); }}>Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={creating || !newName.trim() || !newCode.trim()}>
                  {creating ? 'Adding…' : 'Add Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign HOD Modal ── */}
      {showAssign && (
        <div className="modal-overlay" onClick={() => setShowAssign(false)}>
          <div className="modal-content p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Assign HOD</h2>
            <p className="text-sm text-navy-500 mb-5">Link an HOD to a department. One HOD can cover multiple departments.</p>
            <form onSubmit={handleAssign} className="flex flex-col gap-4">
              <div>
                <label className="label">HOD</label>
                <select className="input" value={assignHodId} onChange={(e) => setAssignHodId(e.target.value)}>
                  <option value="">Select HOD…</option>
                  {hodProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Department</label>
                <select className="input" value={assignDeptId} onChange={(e) => setAssignDeptId(e.target.value)}>
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>
              {assignError && <div className="alert-error">{assignError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowAssign(false); setAssignError(null); }}>Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={assigning || !assignHodId || !assignDeptId}>
                  {assigning ? 'Assigning…' : 'Assign HOD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

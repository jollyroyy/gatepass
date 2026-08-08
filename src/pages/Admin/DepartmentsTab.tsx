import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, gp, pub } from '../../supabaseClient';
import type { Department, HodDepartment, Profile } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { nameError, deptCodeError } from '../../lib/nameValidation';
import KpiCard from '../../components/KpiCard';
import HodDirectory from './HodDirectory';
import DepartmentNameCodeFields from './DepartmentNameCodeFields';

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
  const [showHods, setShowHods] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNameErr, setCreateNameErr] = useState<string | null>(null);
  const [createCodeErr, setCreateCodeErr] = useState<string | null>(null);

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignHodId, setAssignHodId] = useState('');
  const [assignDeptId, setAssignDeptId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Edit modal
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNameErr, setEditNameErr] = useState<string | null>(null);
  const [editCodeErr, setEditCodeErr] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<{ dept: Department; reason: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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

  const unassignedCount = useMemo(() => deptCards.filter((c) => c.strength === 0).length, [deptCards]);

  // The person→department view: one row per HOD, their (single) department.
  // Built from the same `assignments` array as deptCards, so the two views can
  // never disagree about who heads what.
  const hodEntries = useMemo(() => {
    const deptMap = new Map(departments.map((d) => [d.id, d]));
    return hodProfiles.map((hod) => ({
      hod,
      departments: assignments
        .filter((a) => a.hod_id === hod.id)
        .map((a) => deptMap.get(a.department_id))
        .filter((d): d is Department => !!d)
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));
  }, [hodProfiles, assignments, departments]);

  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('depts-admin-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => { void load(true); })
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'hod_departments' }, () => { void load(true); })
        .subscribe();
    } catch {
      // No realtime available — the page still works from the initial load.
    }
    return () => {
      try { if (ch) supabase.removeChannel(ch); } catch { /* ignore cleanup */ }
    };
  }, [load]);

  // Create
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const nameErr = nameError(newName, 'Department name');
    const codeErr = deptCodeError(newCode.trim().toUpperCase());
    setCreateNameErr(nameErr);
    setCreateCodeErr(codeErr);
    if (nameErr || codeErr) return;
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
      setCreateNameErr(null);
      setCreateCodeErr(null);
      await load();
    } catch (err) {
      setCreateError(safeErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  // Assign — one department per person (032): assigning an HOD who already
  // covers a department MOVES them (delete-then-insert), never adds a second.
  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignHodId || !assignDeptId) return;
    setAssigning(true);
    setAssignError(null);
    try {
      if (assignments.some((a) => a.hod_id === assignHodId)) {
        const { error: delErr } = await gp().from('hod_departments').delete().eq('hod_id', assignHodId);
        if (delErr) throw delErr;
      }
      const { error } = await gp().from('hod_departments').insert({ hod_id: assignHodId, department_id: assignDeptId });
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error('That HOD is already assigned to this department.');
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

  // Edit
  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editDept) return;
    const nameErr = nameError(editName, 'Department name');
    const codeErr = deptCodeError(editCode.trim().toUpperCase());
    setEditNameErr(nameErr);
    setEditCodeErr(codeErr);
    if (nameErr || codeErr) return;
    const name = editName.trim();
    const code = editCode.trim().toUpperCase();
    if (!name || !code) return;
    setEditing(true);
    setEditError(null);
    try {
      const { error } = await gp().rpc('admin_update_department', { p_dept_id: editDept.id, p_name: name, p_code: code });
      if (error) throw error;
      setEditDept(null);
      setEditName('');
      setEditCode('');
      setEditNameErr(null);
      setEditCodeErr(null);
      await load();
    } catch (err) {
      setEditError(safeErrorMessage(err));
    } finally {
      setEditing(false);
    }
  }

  // Delete
  async function handleDelete() {
    if (!deleteTarget || !deleteTarget.reason.trim()) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error } = await gp().rpc('admin_delete_department', { p_dept_id: deleteTarget.dept.id, p_reason: deleteTarget.reason });
      if (error) throw error;
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(safeErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError && <div className="alert-error">{loadError}</div>}

      {/* ── Stats at a glance (live via Realtime) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Departments" value={departments.length} tone="brand" onClick={() => setShowList((p) => !p)} />
        <KpiCard
          label="Heads of Department"
          value={hodProfiles.length}
          tone="neutral"
          active={showHods}
          onClick={() => setShowHods((p) => !p)}
        />
        <KpiCard label="Awaiting an HOD" value={unassignedCount} tone={unassignedCount > 0 ? 'flagged' : 'neutral'} />
      </div>

      {showHods && <HodDirectory entries={hodEntries} />}

      {/* ── Header strip ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title mb-0.5">Departments</h2>
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
        // One department per full-width row. The old 3-across grid squeezed a
        // department with several HODs into a tall narrow column.
        <div data-testid="department-rows" className="flex flex-col gap-4">
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
              {/* Row layout: identity + actions on the left, HODs on the right,
                  so a department with four HODs grows sideways, not downwards. */}
              <div className="flex flex-col lg:flex-row lg:items-start gap-5">
              <div className="flex items-start justify-between gap-3 lg:w-72 lg:shrink-0">
                <div className="min-w-0">
                  <h3 className="font-bold text-navy-950 text-base font-display truncate">{c.dept.name}</h3>
                  <span className="type-chip mt-1 inline-block">{c.dept.code}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="text-navy-300 hover:text-brand-600 transition-colors"
                    title="Edit department"
                    onClick={() => { setEditDept(c.dept); setEditName(c.dept.name); setEditCode(c.dept.code); setEditError(null); setEditNameErr(null); setEditCodeErr(null); }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="text-navy-300 hover:text-flagged-600 transition-colors"
                    title="Delete department"
                    onClick={() => setDeleteTarget({ dept: c.dept, reason: '' })}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-brand-50 text-brand-700 text-xs font-bold tabular">
                    {c.strength}
                  </span>
                  <span className="text-[10px] font-medium text-navy-400 uppercase tracking-wider">HODs</span>
                </div>
              </div>

              {/* HOD list */}
              <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
              <DepartmentNameCodeFields
                name={newName} code={newCode} nameErr={createNameErr} codeErr={createCodeErr}
                onNameChange={(v) => { setNewName(v); setCreateNameErr(null); }}
                onCodeChange={(v) => { setNewCode(v); setCreateCodeErr(null); }}
                autoFocus
              />
              {createError && <div className="alert-error">{createError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowCreate(false); setCreateError(null); setCreateNameErr(null); setCreateCodeErr(null); }}>Cancel</button>
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
            <p className="text-sm text-navy-500 mb-5">Link an HOD to a department. A person can belong to at most one — assigning someone already assigned elsewhere moves them.</p>
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

      {/* ── Edit Department Modal ── */}
      {editDept && (
        <div className="modal-overlay" onClick={() => { setEditDept(null); setEditError(null); }}>
          <div className="modal-content p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Edit Department</h2>
            <p className="text-sm text-navy-500 mb-5">Update details for <strong>{editDept.name}</strong>.</p>
            <form onSubmit={handleEdit} className="flex flex-col gap-4">
              <DepartmentNameCodeFields
                name={editName} code={editCode} nameErr={editNameErr} codeErr={editCodeErr}
                onNameChange={(v) => { setEditName(v); setEditNameErr(null); }}
                onCodeChange={(v) => { setEditCode(v); setEditCodeErr(null); }}
                autoFocus
              />
              {editError && <div className="alert-error">{editError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={() => { setEditDept(null); setEditError(null); setEditNameErr(null); setEditCodeErr(null); }}>Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={editing || !editName.trim() || !editCode.trim()}>
                  {editing ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Department Confirmation Modal ── */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>
          <div className="modal-content p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-flagged-600 mb-1">Delete Department?</h2>
            <p className="text-sm text-navy-600 mt-4">
              This will permanently delete &ldquo;{deleteTarget.dept.name}&rdquo; ({deleteTarget.dept.code}). This cannot be undone.
            </p>
            <p className="text-xs text-flagged-600/80 mt-2">
              All HOD assignments for this department will also be removed.
            </p>
            <div className="mt-5">
              <label className="label">Reason for deletion</label>
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Department merged with Finance"
                value={deleteTarget.reason}
                onChange={(e) => setDeleteTarget((prev) => prev ? { ...prev, reason: e.target.value } : null)}
              />
            </div>
            {deleteError && <div className="alert-error mt-3">{deleteError}</div>}
            <div className="flex flex-col-reverse md:flex-row gap-3 mt-5">
              <button type="button" className="btn-secondary flex-1" onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>Cancel</button>
              <button
                type="button"
                className="btn-danger flex-1"
                disabled={deleting || !deleteTarget.reason.trim()}
                onClick={handleDelete}
              >
                {deleting ? 'Deleting…' : 'Delete Department'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

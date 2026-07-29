import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile, UserRole } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateOnly } from '../../lib/formatDate';

type RoleFilter = 'all' | 'hod' | 'guard' | 'admin' | 'staff';

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hod', label: 'HOD' },
  { key: 'guard', label: 'Guard' },
  { key: 'admin', label: 'Admin' },
  { key: 'staff', label: 'Inactive' },
];

const ROLE_CHIP: Record<UserRole, string> = {
  guard: 'bg-brand-50 text-brand-700 border border-brand-500/25',
  hod: 'bg-matched-50 text-matched-700 border border-matched-500/25',
  admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  super_admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  staff: 'bg-surface-100 text-navy-600 border border-surface-200',
};

const ROLE_LABEL: Record<UserRole, string> = {
  guard: 'Guard',
  hod: 'HOD',
  admin: 'Admin',
  super_admin: 'Super Admin',
  staff: 'Inactive',
};

const CREATE_ROLES: { key: 'guard' | 'hod' | 'staff'; label: string }[] = [
  { key: 'guard', label: 'Guard' },
  { key: 'hod', label: 'HOD' },
  { key: 'staff', label: 'Staff (no access)' },
];

const EDIT_ROLES: { key: 'guard' | 'hod' | 'staff'; label: string }[] = [
  { key: 'guard', label: 'Guard' },
  { key: 'hod', label: 'HOD' },
  { key: 'staff', label: 'Deactivate (Staff)' },
];

interface Dept {
  id: string;
  name: string;
  code: string;
}

function matchesFilter(role: UserRole, filter: RoleFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'admin') return role === 'admin' || role === 'super_admin';
  if (filter === 'staff') return role === 'staff';
  return role === filter;
}

const SKELETON_ROWS = 6;

export default function UsersTab(): React.ReactElement {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [deptNamesByHod, setDeptNamesByHod] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>('all');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState<'guard' | 'hod' | 'staff'>('guard');
  const [createDeptIds, setCreateDeptIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'guard' | 'hod' | 'staff'>('guard');
  const [editDeptIds, setEditDeptIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Soft-delete
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, deptRes, assignRes] = await Promise.all([
        fetchDirectory(),
        gp().schema('public').from('departments').select('id, name, code').order('name'),
        gp().from('hod_departments').select('hod_id, department_id'),
      ]);
      const deptNameById = new Map(
        ((deptRes.data ?? []) as Dept[]).map((d) => [d.id, d.name]),
      );
      const map = new Map<string, string[]>();
      for (const a of (assignRes.data ?? []) as { hod_id: string; department_id: string }[]) {
        const name = deptNameById.get(a.department_id);
        if (!name) continue;
        const list = map.get(a.hod_id) ?? [];
        list.push(name);
        map.set(a.hod_id, list);
      }
      setProfiles(rows);
      setDepartments((deptRes.data as Dept[] | null) ?? []);
      setDeptNamesByHod(map);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => profiles.filter((p) => matchesFilter(p.role, filter)), [profiles, filter]);

  function resetCreate() {
    setCreateEmail('');
    setCreatePassword('');
    setCreateName('');
    setCreateRole('guard');
    setCreateDeptIds([]);
    setCreateError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const email = createEmail.trim();
    const password = createPassword.trim();
    const name = createName.trim();
    if (!email || !password || !name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_create_user', {
        p_email: email,
        p_password: password,
        p_full_name: name,
        p_role: createRole,
        p_department_ids: createRole === 'hod' && createDeptIds.length > 0 ? createDeptIds : null,
      });
      if (rpcErr) throw rpcErr;
      setShowCreate(false);
      resetCreate();
      await load();
    } catch (err) {
      setCreateError(safeErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(p: Profile) {
    setEditProfile(p);
    setEditName(p.full_name);
    const role = p.role === 'guard' || p.role === 'hod' || p.role === 'staff' ? p.role : 'staff';
    setEditRole(role);
    setEditDeptIds([]);
    setEditError(null);
  }

  function closeEdit() {
    setEditProfile(null);
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editProfile) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    setEditError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_update_user', {
        p_user_id: editProfile.id,
        p_full_name: name,
        p_role: editRole,
        p_department_ids: editRole === 'hod' && editDeptIds.length > 0 ? editDeptIds : editRole === 'hod' ? [] : null,
      });
      if (rpcErr) throw rpcErr;
      closeEdit();
      await load();
    } catch (err) {
      setEditError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSoftDelete(profile: Profile) {
    setDeletingId(profile.id);
    try {
      const { error: rpcErr } = await gp().rpc('admin_soft_delete_user', { p_user_id: profile.id });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  const isAdminRole = (r: UserRole) => r === 'admin' || r === 'super_admin';

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="alert-error">{error}</div>}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tab-group w-fit">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? 'tab-active' : 'tab-inactive'}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
          Add User
        </button>
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="table-wrap empty-state">No users match this filter.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Departments</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold text-navy-900">{p.full_name}</td>
                  <td>{p.email}</td>
                  <td>
                    <span className={`status-badge ${ROLE_CHIP[p.role]}`}>{ROLE_LABEL[p.role]}</span>
                  </td>
                  <td className="text-sm text-navy-500">
                    {p.role === 'hod' ? deptNamesByHod.get(p.id)?.join(', ') || '—' : '—'}
                  </td>
                  <td className="tabular whitespace-nowrap">{formatDateOnly(p.created_at)}</td>
                  <td className="text-right">
                    {!isAdminRole(p.role) ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="text-xs font-medium text-navy-500 hover:text-brand-600"
                          onClick={() => openEdit(p)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-medium text-flagged-600 hover:text-flagged-800"
                          disabled={deletingId === p.id}
                          onClick={() => handleSoftDelete(p)}
                        >
                          {deletingId === p.id ? '…' : 'Deactivate'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-navy-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Add User</h2>
            <p className="text-sm text-navy-500 mb-5">Provision a new guard, HOD, or staff account.</p>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" required value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="user@company.com" />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" required minLength={6} value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="Min 6 characters" />
              </div>
              <div>
                <label className="label">Full Name</label>
                <input className="input" required value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={createRole} onChange={(e) => { setCreateRole(e.target.value as 'guard' | 'hod' | 'staff'); setCreateDeptIds([]); }}>
                  {CREATE_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              {createRole === 'hod' && (
                <div>
                  <label className="label">Departments</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {departments.map((d) => {
                      const selected = createDeptIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${selected ? 'bg-brand-500 text-white border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
                          onClick={() => setCreateDeptIds((prev) => selected ? prev.filter((id) => id !== d.id) : [...prev, d.id])}
                        >
                          {d.name} ({d.code})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {createError && <div className="alert-error">{createError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowCreate(false); resetCreate(); }}>Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={creating || !createEmail.trim() || !createPassword.trim() || !createName.trim()}>
                  {creating ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Deactivate Confirmation ── */}
      {deactivateTarget && (
        <div className="modal-overlay" onClick={() => setDeactivateTarget(null)}>
          <div className="modal-content p-6 max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Deactivate User?</h2>
            <p className="text-sm text-navy-600 mb-2">
              <strong>{deactivateTarget.full_name}</strong> ({deactivateTarget.email}) will lose all app access.
            </p>
            <p className="text-xs text-navy-400 mb-5">Their pass history is preserved. This can be reversed by changing their role back.</p>
            <div className="flex flex-col-reverse md:flex-row gap-3">
              <button type="button" className="btn-secondary flex-1" onClick={() => setDeactivateTarget(null)}>Cancel</button>
              <button type="button" className="btn-danger flex-1" disabled={deletingId === deactivateTarget.id} onClick={() => { const t = deactivateTarget; setDeactivateTarget(null); void handleSoftDelete(t); }}>
                {deletingId === deactivateTarget.id ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editProfile && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-content p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-navy-950 mb-1">Edit User</h2>
            <p className="text-sm text-navy-500 mb-5">{editProfile.email}</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={editRole} onChange={(e) => { setEditRole(e.target.value as 'guard' | 'hod' | 'staff'); setEditDeptIds([]); }}>
                  {EDIT_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              {editRole === 'hod' && (
                <div>
                  <label className="label">Departments</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {departments.map((d) => {
                      const selected = editDeptIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${selected ? 'bg-brand-500 text-white border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
                          onClick={() => setEditDeptIds((prev) => selected ? prev.filter((id) => id !== d.id) : [...prev, d.id])}
                        >
                          {d.name} ({d.code})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {editError && <div className="alert-error">{editError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={closeEdit}>Cancel</button>
                <button type="button" className="btn-primary flex-1" disabled={saving || !editName.trim()} onClick={handleEditSave}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

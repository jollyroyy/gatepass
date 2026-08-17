import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile, UserRole } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateOnly } from '../../lib/formatDate';
import { nameError } from '../../lib/nameValidation';
import ResetPasswordSection from './ResetPasswordSection';
import ModalShell from '../../components/ModalShell';
import {
  ASSIGNABLE_ROLES,
  ROLE_CHIP,
  ROLE_LABEL,
  accountStatusChip,
  accountStatusLabel,
  isAccountActive,
  isAssignableRole,
  type AssignableRole,
} from '../../lib/userStatus';

// `inactive` is a STATUS filter, not a role filter (migration 040). The Guard
// and HOD filters therefore still list a suspended guard or HOD — they are
// still a guard and an HOD, which is the whole point of splitting the columns.
type RoleFilter = 'all' | 'hod' | 'guard' | 'admin' | 'inactive';

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hod', label: 'HOD' },
  { key: 'guard', label: 'Guard' },
  { key: 'admin', label: 'Admin' },
  { key: 'inactive', label: 'Inactive' },
];

interface Dept {
  id: string;
  name: string;
  code: string;
}

function matchesFilter(p: Profile, filter: RoleFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'inactive') return !isAccountActive(p.role, p.is_active);
  if (filter === 'admin') return p.role === 'admin' || p.role === 'super_admin';
  return p.role === filter;
}

const SKELETON_ROWS = 6;

export default function UsersTab(): React.ReactElement {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [deptNamesByHod, setDeptNamesByHod] = useState<Map<string, string[]>>(new Map());
  const [deptIdByHod, setDeptIdByHod] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>('all');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState<AssignableRole>('guard');
  const [createDeptId, setCreateDeptId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNameErr, setCreateNameErr] = useState<string | null>(null);

  // Edit modal
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<AssignableRole>('guard');
  const [editDeptId, setEditDeptId] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNameErr, setEditNameErr] = useState<string | null>(null);

  // Deactivate / reactivate — one in-flight id covers both, since a row can
  // only ever offer one of the two.
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
      const idMap = new Map<string, string>();
      for (const a of (assignRes.data ?? []) as { hod_id: string; department_id: string }[]) {
        const name = deptNameById.get(a.department_id);
        if (!name) continue;
        const list = map.get(a.hod_id) ?? [];
        list.push(name);
        map.set(a.hod_id, list);
        if (!idMap.has(a.hod_id)) idMap.set(a.hod_id, a.department_id);
      }
      setProfiles(rows);
      setDepartments((deptRes.data as Dept[] | null) ?? []);
      setDeptNamesByHod(map);
      setDeptIdByHod(idMap);
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

  const filtered = useMemo(() => profiles.filter((p) => matchesFilter(p, filter)), [profiles, filter]);

  function resetCreate() {
    setCreateEmail('');
    setCreatePassword('');
    setCreateName('');
    setCreateRole('guard');
    setCreateDeptId('');
    setCreateError(null);
    setCreateNameErr(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const nameErr = nameError(createName, 'Name');
    setCreateNameErr(nameErr);
    if (nameErr) return;
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
        p_department_ids: createRole === 'hod' && createDeptId ? [createDeptId] : null,
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
    // A legacy `staff` row has no assignable role to pre-fill; it defaults to
    // Guard, which is the choice the admin is here to make. Saving cannot
    // reinstate anyone by accident — access comes back only via Reactivate.
    setEditRole(isAssignableRole(p.role) ? p.role : 'guard');
    setEditDeptId(deptIdByHod.get(p.id) ?? '');
    setEditError(null);
    setEditNameErr(null);
  }

  function closeEdit() {
    setEditProfile(null);
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editProfile) return;
    const nameErr = nameError(editName, 'Name');
    setEditNameErr(nameErr);
    if (nameErr) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    setEditError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_update_user', {
        p_user_id: editProfile.id,
        p_full_name: name,
        p_role: editRole,
        p_department_ids: editRole === 'hod' ? (editDeptId ? [editDeptId] : []) : null,
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

  // Reactivation needs no confirmation and no role choice: 040 kept the role
  // and the department assignment, so this restores exactly what was suspended.
  // It is also not destructive — the reason Deactivate has a dialog.
  async function handleReactivate(profile: Profile) {
    setDeletingId(profile.id);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_reactivate_user', { p_user_id: profile.id });
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
                <th>Status</th>
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
                  <td>
                    <span className={`status-badge ${accountStatusChip(p.role, p.is_active)}`}>
                      {accountStatusLabel(p.role, p.is_active)}
                    </span>
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
                        {!isAssignableRole(p.role) ? (
                          // A legacy `staff` row: nothing to reactivate, because
                          // there is no role to restore — the flag says active
                          // and the account still reaches nothing. Editing it
                          // into a Guard or an HOD is what makes it usable, and
                          // `admin_reactivate_user` refuses such a target for
                          // exactly this reason. Only Edit is offered.
                          null
                        ) : !isAccountActive(p.role, p.is_active) ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-matched-600 hover:text-matched-800"
                            disabled={deletingId === p.id}
                            onClick={() => void handleReactivate(p)}
                          >
                            {deletingId === p.id ? '…' : 'Reactivate'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs font-medium text-flagged-600 hover:text-flagged-800"
                            disabled={deletingId === p.id}
                            // Opens the confirmation — never deactivates directly.
                            // This used to call handleSoftDelete(p), so one stray
                            // click on a dense table row revoked a person's access
                            // with no prompt, and the confirmation dialog below was
                            // unreachable dead UI.
                            onClick={() => setDeactivateTarget(p)}
                          >
                            {deletingId === p.id ? '…' : 'Deactivate'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-navy-500">—</span>
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
        <ModalShell onClose={() => { setShowCreate(false); resetCreate(); }} labelledBy="create-user-title">
            <h2 id="create-user-title" className="modal-title mb-1">Add User</h2>
            <p className="text-sm text-navy-500 mb-5">Provision a new guard or HOD account.</p>
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
                <input className={`input ${createNameErr ? 'input-error' : ''}`} required value={createName} onChange={(e) => { setCreateName(e.target.value); setCreateNameErr(null); }} placeholder="Jane Doe" />
                {createNameErr && <p className="field-error">{createNameErr}</p>}
              </div>
              <div>
                <label className="label" htmlFor="create-user-role">Role</label>
                <select id="create-user-role" className="input" value={createRole} onChange={(e) => { setCreateRole(e.target.value as AssignableRole); setCreateDeptId(''); }}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              {createRole === 'hod' && (
                <div>
                  <label className="label">Department</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {departments.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${createDeptId === d.id ? 'bg-brand-500 text-brand-ink border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
                        onClick={() => setCreateDeptId(createDeptId === d.id ? '' : d.id)}
                      >
                        {d.name} ({d.code})
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-navy-500 mt-1.5">One department per person — pick a single one.</p>
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
        </ModalShell>
      )}

      {/* ── Deactivate Confirmation ── */}
      {/* Closing (×, Escape, backdrop) all route to Cancel — never Deactivate. */}
      {deactivateTarget && (
        <ModalShell onClose={() => setDeactivateTarget(null)} className="max-w-sm" labelledBy="deactivate-user-title">
            <h2 id="deactivate-user-title" className="modal-title mb-1">Deactivate User?</h2>
            <p className="text-sm text-navy-600 mb-2">
              <strong>{deactivateTarget.full_name}</strong> ({deactivateTarget.email}) will lose all app access.
            </p>
            <p className="text-xs text-navy-500 mb-5">Their pass history is preserved. This can be reversed by changing their role back.</p>
            <div className="flex flex-col-reverse md:flex-row gap-3">
              <button type="button" className="btn-secondary flex-1" onClick={() => setDeactivateTarget(null)}>Cancel</button>
              <button type="button" className="btn-danger flex-1" disabled={deletingId === deactivateTarget.id} onClick={() => { const t = deactivateTarget; setDeactivateTarget(null); void handleSoftDelete(t); }}>
                {deletingId === deactivateTarget.id ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
        </ModalShell>
      )}

      {/* ── Edit User Modal ── */}
      {editProfile && (
        <ModalShell onClose={closeEdit} labelledBy="edit-user-title">
            <h2 id="edit-user-title" className="modal-title mb-1">Edit User</h2>
            <p className="text-sm text-navy-500 mb-5">{editProfile.email}</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label">Full Name</label>
                <input className={`input ${editNameErr ? 'input-error' : ''}`} value={editName} onChange={(e) => { setEditName(e.target.value); setEditNameErr(null); }} />
                {editNameErr && <p className="field-error">{editNameErr}</p>}
              </div>
              <div>
                <label className="label" htmlFor="edit-user-role">Role</label>
                <select id="edit-user-role" className="input" value={editRole} onChange={(e) => { setEditRole(e.target.value as AssignableRole); setEditDeptId(''); }}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              {editRole === 'hod' && (
                <div>
                  <label className="label">Department</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {departments.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${editDeptId === d.id ? 'bg-brand-500 text-brand-ink border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
                        onClick={() => setEditDeptId(editDeptId === d.id ? '' : d.id)}
                      >
                        {d.name} ({d.code})
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-navy-500 mt-1.5">One department per person — leave empty to unassign.</p>
                </div>
              )}
              {editError && <div className="alert-error">{editError}</div>}
              <div className="flex flex-col-reverse md:flex-row gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={closeEdit}>Cancel</button>
                <button type="button" className="btn-primary flex-1" disabled={saving || !editName.trim()} onClick={handleEditSave}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>

              <ResetPasswordSection profile={editProfile} />
            </div>
        </ModalShell>
      )}
    </div>
  );
}

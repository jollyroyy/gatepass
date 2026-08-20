import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import AddUserModal from './AddUserModal';
import EditUserModal from './EditUserModal';
import DeactivateUserModal from './DeactivateUserModal';
import ReactivateUserModal from './ReactivateUserModal';
import UsersTable from './UsersTable';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';
import { isAssignableRole, isDirectoryActive } from '../../lib/userStatus';

// `inactive` is a STATUS filter, not a role filter (migration 040) — and since
// 2026-08-19 it is the ONLY tab that shows an inactive person. Every other tab,
// All included, lists active accounts alone.
//
// That reverses this file's earlier rule, which had the Guard and HOD tabs
// carry suspended people too on the grounds that "they are still a guard". The
// client overruled it by name: "when you are showing all users, it should only
// show the active users and move all the inactive users to the inactive tab".
// The cost is that a suspended guard is now reachable through one tab rather
// than two — which is the point, not a side effect.
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

function matchesFilter(p: Profile, filter: RoleFilter, active: boolean): boolean {
  if (filter === 'inactive') return !active;
  // The status test comes FIRST for every other tab, so there is exactly one
  // place a person's activeness decides whether they are listed.
  if (!active) return false;
  if (filter === 'all') return true;
  if (filter === 'admin') return p.role === 'admin' || p.role === 'super_admin';
  return p.role === filter;
}

export default function UsersTab(): React.ReactElement {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [deptNamesByHod, setDeptNamesByHod] = useState<Map<string, string[]>>(new Map());
  const [deptIdByHod, setDeptIdByHod] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>('all');

  // Create / Edit modals — the forms themselves live in AddUserModal.tsx and
  // EditUserModal.tsx (300-line cap); this tab only owns whether one is open.
  const [showCreate, setShowCreate] = useState(false);
  const [editProfile, setEditProfile] = useState<Profile | null>(null);

  // Who currently holds each of the four approval offices (migration 046).
  // One shared read: the Add-User modal's "this will move the office" note
  // and this table's office title both key off the same rows.
  const approvalRoles = useApprovalRoles();
  const officeByUserId = useMemo(() => {
    const m = new Map<string, ApprovalRoleKey>();
    for (const r of approvalRoles) m.set(r.user_id, r.role_key);
    return m;
  }, [approvalRoles]);

  // Deactivate / reactivate — one in-flight id covers both, since a row can
  // only ever offer one of the two.
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  // Set only for a row with NO role to restore — see handleReactivateClick.
  const [reactivateTarget, setReactivateTarget] = useState<Profile | null>(null);
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

  const filtered = useMemo(
    () =>
      profiles.filter((p) =>
        matchesFilter(p, filter, isDirectoryActive(p.role, p.is_active, officeByUserId.has(p.id))),
      ),
    [profiles, filter, officeByUserId],
  );

  function closeEdit() {
    setEditProfile(null);
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

  /**
   * Where a Reactivate press goes.
   *
   * A suspended guard or HOD keeps their role and their department through the
   * suspension (040), so there is nothing to ask and the RPC is called
   * directly. A `staff` row has no role to restore and `admin_reactivate_user`
   * raises on exactly that, so it opens the role choice first — the button is
   * offered on both, which is what the client asked for, and on neither is it
   * a control that fails when pressed.
   */
  function handleReactivateClick(profile: Profile) {
    if (isAssignableRole(profile.role)) {
      void handleReactivate(profile);
      return;
    }
    setReactivateTarget(profile);
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

      <UsersTable
        loading={loading}
        rows={filtered}
        deptNamesByHod={deptNamesByHod}
        officeByUserId={officeByUserId}
        deletingId={deletingId}
        onEdit={setEditProfile}
        onReactivate={handleReactivateClick}
        onDeactivateRequest={setDeactivateTarget}
      />

      {/* ── Create User Modal ── */}
      {showCreate && (
        <AddUserModal
          departments={departments}
          approvalRoles={approvalRoles}
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}

      {/* ── Deactivate Confirmation ── */}
      {deactivateTarget && (
        <DeactivateUserModal
          profile={deactivateTarget}
          deactivating={deletingId === deactivateTarget.id}
          onClose={() => setDeactivateTarget(null)}
          onConfirm={() => {
            const t = deactivateTarget;
            setDeactivateTarget(null);
            void handleSoftDelete(t);
          }}
        />
      )}

      {/* ── Reactivate (role choice) ── */}
      {reactivateTarget && (
        <ReactivateUserModal
          profile={reactivateTarget}
          departments={departments}
          onClose={() => setReactivateTarget(null)}
          onReactivated={load}
        />
      )}

      {/* ── Edit User Modal ── */}
      {editProfile && (
        <EditUserModal
          profile={editProfile}
          departments={departments}
          currentDeptId={deptIdByHod.get(editProfile.id) ?? ''}
          office={officeByUserId.get(editProfile.id) ?? null}
          approvalRoles={approvalRoles}
          onClose={closeEdit}
          onSaved={load}
        />
      )}
    </div>
  );
}

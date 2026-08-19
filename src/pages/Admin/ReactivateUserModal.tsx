// Reactivating someone whose row carries NO role to restore.
//
// `admin_reactivate_user` (040) raises "Give this person a role (Guard or HOD)
// before reactivating." on a `staff` target, deliberately: flipping the flag
// alone would report a person as Active who still cannot sign in to anything.
// The portal used to answer that by offering such a row no Reactivate button at
// all — which is what the client hit ("I don't see any reactivate option when
// we are seeing the inactive users").
//
// So the button exists on every inactive row now, and on a roleless one it
// opens THIS: the role choice the RPC is asking for, written with
// `admin_update_user` immediately before the reactivation it unblocks. Two
// calls, in that order, because the second is illegal until the first lands.
//
// A suspended guard or HOD never reaches this file — their role survived the
// suspension (040 stopped erasing it), so there is nothing to ask and
// `UsersTab` calls the RPC straight from the row.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import ModalShell from '../../components/ModalShell';
import { ASSIGNABLE_ROLES, type AssignableRole } from '../../lib/userStatus';

interface Dept {
  id: string;
  name: string;
  code: string;
}

interface ReactivateUserModalProps {
  profile: Profile;
  departments: Dept[];
  onClose: () => void;
  onReactivated: () => Promise<void> | void;
}

export default function ReactivateUserModal({
  profile,
  departments,
  onClose,
  onReactivated,
}: ReactivateUserModalProps): React.ReactElement {
  const [role, setRole] = useState<AssignableRole>('guard');
  const [deptId, setDeptId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      // The name is sent unchanged: this popup is not an edit form, and
      // omitting it would leave `admin_update_user`'s `p_full_name` null.
      const { error: roleErr } = await gp().rpc('admin_update_user', {
        p_user_id: profile.id,
        p_full_name: profile.full_name,
        p_role: role,
        p_department_ids: role === 'hod' ? (deptId ? [deptId] : []) : null,
      });
      if (roleErr) throw roleErr;

      const { error: rpcErr } = await gp().rpc('admin_reactivate_user', {
        p_user_id: profile.id,
      });
      if (rpcErr) throw rpcErr;

      await onReactivated();
      onClose();
    } catch (err) {
      // The role may well have been written before the failure. That is not
      // left silent: the list reloads underneath, so the row shows its new
      // role and still reads Inactive — which is exactly what happened.
      setError(safeErrorMessage(err));
      await onReactivated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} labelledBy="reactivate-user-title">
      <h2 id="reactivate-user-title" className="modal-title mb-1">
        Reactivate User?
      </h2>
      <p className="text-sm text-navy-600 mb-1">
        <strong>{profile.full_name}</strong> ({profile.email})
      </p>
      <p className="text-xs text-navy-500 mb-5">
        This account has no role to restore, so give it one — an account with no role can sign in
        and still reach nothing.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="reactivate-user-role">
            Role
          </label>
          <select
            id="reactivate-user-role"
            className="input"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as AssignableRole);
              setDeptId('');
            }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {role === 'hod' && (
          <div>
            <label className="label">Department</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {departments.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${deptId === d.id ? 'bg-brand-500 text-brand-ink border-brand-500' : 'bg-surface-100 text-navy-600 border-surface-300 hover:border-brand-400'}`}
                  onClick={() => setDeptId(deptId === d.id ? '' : d.id)}
                >
                  {d.name} ({d.code})
                </button>
              ))}
            </div>
            <p className="text-xs text-navy-500 mt-1.5">
              One department per person — leave empty to assign one later.
            </p>
          </div>
        )}
        {error && <div className="alert-error">{error}</div>}
        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-1" disabled={saving} onClick={handleConfirm}>
            {saving ? 'Reactivating…' : 'Reactivate'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

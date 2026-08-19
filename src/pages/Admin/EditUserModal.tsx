// The Edit-User popup, split out of UsersTab.tsx (300-line cap).
//
// UNCHANGED BY MIGRATION 046, ON PURPOSE: `admin_update_user` was not
// extended to accept an office key, and it cannot move one — designating or
// vacating a Security Head / COO / CEO / Finance HOD is `set_approval_role` /
// `clear_approval_role`, already exposed on Admin → Users as the "Gate pass
// approval ladder" card (`ApprovalLadderCard.tsx`). So this dropdown keeps
// offering Guard and HOD only (`ASSIGNABLE_ROLES`), exactly as before 046.
// When the row being edited already holds an office, the modal says so and
// points at that card, so the admin isn't left looking for a control that
// isn't here.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { nameError } from '../../lib/nameValidation';
import ModalShell from '../../components/ModalShell';
import ResetPasswordSection from './ResetPasswordSection';
import { ASSIGNABLE_ROLES, isAssignableRole, type AssignableRole } from '../../lib/userStatus';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';

interface Dept {
  id: string;
  name: string;
  code: string;
}

interface EditUserModalProps {
  profile: Profile;
  departments: Dept[];
  currentDeptId: string;
  office: ApprovalRoleKey | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function EditUserModal({
  profile,
  departments,
  currentDeptId,
  office,
  onClose,
  onSaved,
}: EditUserModalProps): React.ReactElement {
  const [name, setName] = useState(profile.full_name);
  // A legacy `staff` row (including an office holder — their VMS role really
  // is `staff`) has no assignable role to pre-fill; it defaults to Guard,
  // which is the choice the admin is here to make. Saving cannot reinstate
  // anyone by accident — access comes back only via Reactivate, and an
  // office is moved only on the ladder card, never from here.
  const [role, setRole] = useState<AssignableRole>(isAssignableRole(profile.role) ? profile.role : 'guard');
  const [deptId, setDeptId] = useState(currentDeptId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  async function handleSave() {
    const err = nameError(name, 'Name');
    setNameErr(err);
    if (err) return;
    const nm = name.trim();
    if (!nm) return;
    setSaving(true);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_update_user', {
        p_user_id: profile.id,
        p_full_name: nm,
        p_role: role,
        p_department_ids: role === 'hod' ? (deptId ? [deptId] : []) : null,
      });
      if (rpcErr) throw rpcErr;
      await onSaved();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} labelledBy="edit-user-title">
      <h2 id="edit-user-title" className="modal-title mb-1">
        Edit User
      </h2>
      <p className="text-sm text-navy-500 mb-5">{profile.email}</p>
      <div className="flex flex-col gap-4">
        {office && (
          <div className="alert-info text-sm">
            This person holds the {APPROVAL_ROLE_TITLES[office]} office. That is changed on the
            &ldquo;Gate pass approval ladder&rdquo; card below, not here — this form only edits
            their VMS role and department.
          </div>
        )}
        <div>
          <label className="label">Full Name</label>
          <input
            className={`input ${nameErr ? 'input-error' : ''}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameErr(null);
            }}
          />
          {nameErr && <p className="field-error">{nameErr}</p>}
        </div>
        <div>
          <label className="label" htmlFor="edit-user-role">
            Role
          </label>
          <select
            id="edit-user-role"
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
            <p className="text-xs text-navy-500 mt-1.5">One department per person — leave empty to unassign.</p>
          </div>
        )}
        {error && <div className="alert-error">{error}</div>}
        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={saving || !name.trim()}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <ResetPasswordSection profile={profile} />
      </div>
    </ModalShell>
  );
}

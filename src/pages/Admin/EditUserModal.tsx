// The Edit-User popup, split out of UsersTab.tsx (300-line cap).
//
// THE ROLE CONTROL OFFERS THE FOUR APPROVAL OFFICES TOO (client, 2026-08-20:
// "in the role they are only showing HOD but they should not show as HOD —
// show all those roles to be selected from during the edit option"). Until now
// it offered Guard and HOD alone and pointed at the "Gate pass approval
// ladder" card, so a CEO opened here read "HOD" — a role they do not hold.
//
// NO MIGRATION WAS NEEDED and no RPC was widened: an office is still moved by
// `set_approval_role` / `clear_approval_role` (043/049), exactly as the ladder
// card does it. This form only sequences the calls the change implies:
//
//   1. vacate the office this person holds, if they are leaving it —
//      `set_approval_role` REFUSES somebody who already holds a different
//      office (049's unique index), so the clear has to come first;
//   2. `admin_update_user` with the VMS role — `staff` for an office holder,
//      which is what `admin_create_user` writes for one (046), and no
//      department, because an office grants none;
//   3. take up the new office.
//
// AN OFFICE HAS ONE HOLDER, by primary key, so picking an office somebody else
// holds MOVES it off them — the inline note says so, naming them.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import type { Profile } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { personNameError } from '../../lib/nameValidation';
import ModalShell from '../../components/ModalShell';
import ResetPasswordSection from './ResetPasswordSection';
import {
  CREATABLE_ROLES,
  isApprovalOffice,
  isAssignableRole,
  type CreatableRole,
} from '../../lib/userStatus';
import {
  APPROVAL_ROLE_TITLES,
  type ApprovalRoleKey,
  type ApprovalRoleRow,
} from '../../lib/approvalLadder';

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
  approvalRoles: ApprovalRoleRow[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function EditUserModal({
  profile,
  departments,
  currentDeptId,
  office,
  approvalRoles,
  onClose,
  onSaved,
}: EditUserModalProps): React.ReactElement {
  const [name, setName] = useState(profile.full_name);
  // THE OFFICE WINS over the VMS role when the person holds one: an office
  // holder's `profiles.role` really is `staff` (046), and pre-filling "Guard"
  // or "HOD" there is exactly what the client reported. A legacy `staff` row
  // holding no office still defaults to Guard — that is the choice the admin
  // came here to make.
  const [role, setRole] = useState<CreatableRole>(
    office ?? (isAssignableRole(profile.role) ? profile.role : 'guard')
  );
  const [deptId, setDeptId] = useState(currentDeptId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const nextOffice = isApprovalOffice(role) ? role : null;
  // Whoever holds the office being picked, when that is not this person.
  const displacing = nextOffice
    ? approvalRoles.find((r) => r.role_key === nextOffice && r.user_id !== profile.id)
    : undefined;

  async function handleSave() {
    const err = personNameError(name, 'Name');
    setNameErr(err);
    if (err) return;
    const nm = name.trim();
    if (!nm) return;
    setSaving(true);
    setError(null);
    try {
      if (office && office !== nextOffice) {
        const { error: clearErr } = await gp().rpc('clear_approval_role', { p_role_key: office });
        if (clearErr) throw clearErr;
      }

      const { error: rpcErr } = await gp().rpc('admin_update_user', {
        p_user_id: profile.id,
        p_full_name: nm,
        p_role: nextOffice ? 'staff' : role,
        p_department_ids: nextOffice ? [] : role === 'hod' ? (deptId ? [deptId] : []) : null,
      });
      if (rpcErr) throw rpcErr;

      if (nextOffice && nextOffice !== office) {
        const { error: setErr } = await gp().rpc('set_approval_role', {
          p_role_key: nextOffice,
          p_user_id: profile.id,
        });
        if (setErr) throw setErr;
      }

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
              setRole(e.target.value as CreatableRole);
              setDeptId('');
            }}
          >
            <optgroup label="Role">
              {CREATABLE_ROLES.filter((r) => r.kind === 'role').map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Gate pass approval office">
              {CREATABLE_ROLES.filter((r) => r.kind === 'office').map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </optgroup>
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
        {nextOffice && (
          <div className="alert-info text-sm">
            <p>
              This person will only see and act on the gate passes waiting for the{' '}
              {APPROVAL_ROLE_TITLES[nextOffice]}&rsquo;s approval — no department, no Raise Pass,
              and no gate screens.
            </p>
            {displacing && (
              <p className="mt-1">
                {APPROVAL_ROLE_TITLES[nextOffice]} is currently{' '}
                <strong>{displacing.full_name ?? 'someone else'}</strong>. Saving moves the office
                to this person.
              </p>
            )}
          </div>
        )}
        {office && !nextOffice && (
          <div className="alert-info text-sm">
            Saving vacates the {APPROVAL_ROLE_TITLES[office]} office. A pass already waiting on it
            stays where it is until somebody else is designated.
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

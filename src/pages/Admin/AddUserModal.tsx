// The Add-User popup, split out of UsersTab.tsx (300-line cap; see CLAUDE.md's
// "known, not fixed" note that this extraction pays off).
//
// Migration 046: the Role control offers Guard and HOD (VMS roles) AND the
// four gate-pass approval offices — Security Head / COO / CEO / Finance HOD
// (`CREATABLE_ROLES` in userStatus.ts). An office is grouped under its own
// `<optgroup>` so it is never mistaken for a VMS role: it grants no
// department, no Raise Pass, no gate screen — only the Pending Approvals
// queue for that one office (`admin_create_user` creates the account as VMS
// `staff` and writes `gatepass.approval_roles` in the same transaction).
//
// AN OFFICE HAS EXACTLY ONE HOLDER. `approval_roles` is keyed by `role_key`,
// so creating a second CEO MOVES the office off whoever holds it now — the
// inline note says so, naming the current holder from `useApprovalRoles()`
// (already fetched by the caller; no new query here).
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';
import { personNameError } from '../../lib/nameValidation';
import ModalShell from '../../components/ModalShell';
import { CREATABLE_ROLES, isApprovalOffice, type CreatableRole } from '../../lib/userStatus';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleRow } from '../../lib/approvalLadder';

interface Dept {
  id: string;
  name: string;
  code: string;
}

interface AddUserModalProps {
  departments: Dept[];
  approvalRoles: ApprovalRoleRow[];
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

export default function AddUserModal({
  departments,
  approvalRoles,
  onClose,
  onCreated,
}: AddUserModalProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<CreatableRole>('guard');
  const [deptId, setDeptId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const office = isApprovalOffice(role) ? role : null;
  const currentHolder = office ? approvalRoles.find((r) => r.role_key === office) : undefined;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const err = personNameError(name, 'Name');
    setNameErr(err);
    if (err) return;
    const em = email.trim();
    const pw = password.trim();
    const nm = name.trim();
    if (!em || !pw || !nm) return;
    setCreating(true);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_create_user', {
        p_email: em,
        p_password: pw,
        p_full_name: nm,
        p_role: role,
        p_department_ids: role === 'hod' && deptId ? [deptId] : null,
      });
      if (rpcErr) throw rpcErr;
      await onCreated();
      onClose();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalShell onClose={onClose} labelledBy="create-user-title">
      <h2 id="create-user-title" className="modal-title mb-1">
        Add User
      </h2>
      <p className="text-sm text-navy-500 mb-5">
        Provision a new guard, HOD, or gate pass approval office account.
      </p>
      <form onSubmit={handleCreate} className="flex flex-col gap-4">
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
          />
        </div>
        <div>
          <label className="label">Full Name</label>
          <input
            className={`input ${nameErr ? 'input-error' : ''}`}
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameErr(null);
            }}
            placeholder="Jane Doe"
          />
          {nameErr && <p className="field-error">{nameErr}</p>}
        </div>
        <div>
          <label className="label" htmlFor="create-user-role">
            Role
          </label>
          <select
            id="create-user-role"
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
            <p className="text-xs text-navy-500 mt-1.5">One department per person — pick a single one.</p>
          </div>
        )}
        {office && (
          <div className="alert-info text-sm">
            <p>
              This person will only be able to see and act on the gate passes waiting for the{' '}
              {APPROVAL_ROLE_TITLES[office]}&rsquo;s approval — no department, no Raise Pass, and
              no gate screens.
            </p>
            {currentHolder && (
              <p className="mt-1">
                {APPROVAL_ROLE_TITLES[office]} is currently{' '}
                <strong>{currentHolder.full_name ?? 'someone'}</strong>. Creating this account
                will move the office to the new person.
              </p>
            )}
          </div>
        )}
        {error && <div className="alert-error">{error}</div>}
        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={creating || !email.trim() || !password.trim() || !name.trim()}
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

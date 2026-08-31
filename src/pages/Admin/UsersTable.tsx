// The directory table itself, split out of UsersTab.tsx (300-line cap).
// Owns loading/empty states and every row's action cluster; UsersTab owns the
// data (profiles, departments, office designations) and what a click does.
import React from 'react';
import type { Profile, UserRole } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { ROLE_CHIP, ROLE_LABEL, isDirectoryActive } from '../../lib/userStatus';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';

/** A holder of one of the four gate pass approval offices reads their office
 *  title, not the bare VMS `staff` role their profile row actually carries
 *  (migration 046) — "staff" is true and useless to an admin reading this
 *  screen. `bg-accent-*` because it names a designation, not a VMS role. */
const OFFICE_CHIP = 'bg-accent-50 text-accent-700 border border-accent-500/25';

/** The Status chip. `accountStatusChip` takes a role and a flag; this table
 *  has already resolved those into one answer via `isDirectoryActive`, so it
 *  colours from the answer rather than asking the question a second time with
 *  a narrower set of facts. The two tints are `accountStatusChip`'s own. */
const directoryStatusChip = (active: boolean): string =>
  active
    ? 'bg-matched-50 text-matched-700 border border-matched-500/25'
    : 'bg-surface-100 text-navy-600 border border-surface-200';

const SKELETON_ROWS = 6;

const isAdminRole = (r: UserRole) => r === 'admin' || r === 'super_admin';

interface UsersTableProps {
  loading: boolean;
  rows: Profile[];
  deptNamesByHod: Map<string, string[]>;
  officeByUserId: Map<string, ApprovalRoleKey>;
  deletingId: string | null;
  onEdit: (p: Profile) => void;
  onReactivate: (p: Profile) => void;
  onDeactivateRequest: (p: Profile) => void;
}

export default function UsersTable({
  loading,
  rows,
  deptNamesByHod,
  officeByUserId,
  deletingId,
  onEdit,
  onReactivate,
  onDeactivateRequest,
}: UsersTableProps): React.ReactElement {
  if (loading) {
    return (
      <div className="table-wrap p-4 flex flex-col gap-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div key={i} className="skeleton h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="table-wrap empty-state">No users match this filter.</div>;
  }

  return (
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
            <th className="sticky-action" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const office = officeByUserId.get(p.id);
            // `isDirectoryActive`, not `isAccountActive`: an office holder's
            // VMS role really is `staff`, and only this screen knows they hold
            // an office (046). Every other reader of a profile row asks the
            // narrower question.
            const active = isDirectoryActive(p.role, p.is_active, Boolean(office));
            return (
              <tr key={p.id}>
                <td className="font-semibold text-navy-900">{p.full_name}</td>
                <td>{p.email}</td>
                <td>
                  {office ? (
                    <span className={`status-badge ${OFFICE_CHIP}`}>{APPROVAL_ROLE_TITLES[office]}</span>
                  ) : (
                    <span className={`status-badge ${ROLE_CHIP[p.role]}`}>{ROLE_LABEL[p.role]}</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${directoryStatusChip(active)}`}>
                    {active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="text-sm text-navy-500">
                  {p.role === 'hod' ? deptNamesByHod.get(p.id)?.join(', ') || '—' : '—'}
                </td>
                <td className="tabular whitespace-nowrap">{formatDateOnly(p.created_at)}</td>
                <td className="text-right sticky-action">
                  {/* AN OFFICE HOLDER GETS EDIT AND DEACTIVATE LIKE ANYONE
                      ELSE (client, 2026-08-20: "make sure that all these four
                      roles should have the deactivate and edit option also for
                      the admin"). This REVERSES 046's rule that a row holding
                      one of the four offices carried no suspend/restore control
                      at all, on the grounds that `approval_roles` — not the
                      `staff` role — is what grants them their access. That
                      argument was never the whole story: `my_approval_role()`
                      gates on `is_user_active`, so suspending an office holder
                      really does empty their queue, and it was the one kind of
                      account an admin could not shut out. Migration 057 makes
                      the return trip work too — 040's `admin_reactivate_user`
                      refused every `staff` target, which would have made
                      Deactivate a one-way door for a COO. Their OFFICE is still
                      moved on the ladder card; this suspends the person. */}
                  {!isAdminRole(p.role) ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-navy-500 hover:text-brand-600"
                        onClick={() => onEdit(p)}
                      >
                        Edit
                      </button>
                      {!active ? (
                        // EVERY inactive row offers Reactivate, including a
                        // roleless `staff` one — the client asked for exactly
                        // that. What differs is what the press does:
                        // `admin_reactivate_user` refuses a target with no role
                        // to restore, so such a row opens the role choice
                        // (`ReactivateUserModal`) and a suspended guard/HOD
                        // goes straight to the RPC. UsersTab decides which,
                        // because it is the one holding the department list.
                        <button
                          type="button"
                          className="text-xs font-medium text-matched-600 hover:text-matched-800"
                          disabled={deletingId === p.id}
                          onClick={() => onReactivate(p)}
                        >
                          {deletingId === p.id ? '…' : 'Reactivate'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-medium text-flagged-600 hover:text-flagged-800"
                          disabled={deletingId === p.id}
                          // Opens the confirmation — never deactivates directly.
                          // This used to call the RPC directly, so one stray
                          // click on a dense table row revoked a person's
                          // access with no prompt.
                          onClick={() => onDeactivateRequest(p)}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

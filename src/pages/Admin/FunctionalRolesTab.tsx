// FUNCTIONAL ROLES — Admin → Functional Roles, beside Users and Departments.
//
// Client, 2026-08-20: "one more button for the functional roles ... one should
// be able to create the functional roles and assign. All the functional role
// list should be mentioned there and what is the purpose and all those things
// under the admin section, just beside the users and departments."
//
// THREE THINGS ON ONE SCREEN, in the order an admin needs them:
//   1. every role, what it is for, and what holding it actually lets somebody
//      do — `src/lib/functionalRoles.ts`, written from the policies and RPCs
//      that enforce it rather than from intent;
//   2. CREATE somebody in a role — the same `AddUserModal` the Users tab opens,
//      not a copy of it. It already offers Guard, HOD and the four approval
//      offices, and writes the office row in the same transaction (046);
//   3. ASSIGN the four offices — `ApprovalLadderCard`, the one control that
//      seats an office holder. Rendered here as well as on the
//      Users tab because this is the screen the client will look for it on, and
//      it is ONE component reading one RPC, so the two cannot disagree.
//
// ⚠ A NEW KIND OF ROLE CANNOT BE INVENTED HERE, and the page says so out loud.
// A role is either a value of VMS's `profiles.role` enum — a table this app
// must not alter — or one of the four `approval_roles` keys, fixed by a CHECK
// constraint. A screen offering "add role" would be offering something the
// database refuses.
import React, { useCallback, useEffect, useState } from 'react';
import { pub } from '../../supabaseClient';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import {
  FUNCTIONAL_ROLES,
  GRANT_NOTE,
  roleHeadcount,
  type FunctionalRole,
} from '../../lib/functionalRoles';
import { isApprovalOffice } from '../../lib/userStatus';
import type { Department, Profile } from '../../types';
import ApprovalLadderCard from './ApprovalLadderCard';
import AddUserModal from './AddUserModal';

export default function FunctionalRolesTab(): React.ReactElement {
  const [people, setPeople] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { roles: ladder, reload: reloadLadder } = useApprovalRoles();

  const load = useCallback(async () => {
    try {
      const [dir, depts] = await Promise.all([
        fetchDirectory(),
        pub().from('departments').select('*').order('name'),
      ]);
      setPeople(dir);
      setDepartments((depts.data as Department[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="alert-error">{error}</div>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title mb-0.5">Functional Roles</h2>
          <p className="page-subtitle">
            Every role this system has, what it is for, and who holds it. Roles themselves are
            fixed — a person is created <em>in</em> a role, and the four approval offices are
            seated on the ladder below.
          </p>
        </div>
        <button type="button" className="btn-primary text-sm" onClick={() => setShowCreate(true)}>
          Create Role Holder
        </button>
      </div>

      <div data-testid="functional-role-list" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {FUNCTIONAL_ROLES.map((role) => (
          <RoleCard
            key={role.key}
            role={role}
            headcount={roleHeadcount(people, role.key)}
            holder={
              isApprovalOffice(role.key)
                ? (ladder.find((r) => r.role_key === role.key)?.full_name ?? null)
                : null
            }
          />
        ))}
      </div>

      {/* The one control that seats an office. Its own card says, correctly,
          that a designation here grants real authority. */}
      <ApprovalLadderCard />

      {showCreate && (
        <AddUserModal
          departments={departments}
          approvalRoles={ladder}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await Promise.all([load(), reloadLadder()]);
          }}
        />
      )}
    </div>
  );
}

function RoleCard({
  role,
  headcount,
  holder,
}: {
  role: FunctionalRole;
  headcount: number | null;
  holder: string | null;
}): React.ReactElement {
  const isOffice = role.kind === 'Gate pass approval office';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="card-title mb-0.5">{role.title}</h3>
          <span className="type-chip">{role.kind}</span>
        </div>
        {/* An office is counted by its SEAT (one holder, by primary key); a VMS
            role by how many ACTIVE accounts carry it. Printing a headcount for
            an office would say "4 CEOs" the moment four approvers exist. */}
        {isOffice ? (
          <span className="text-xs text-navy-500 shrink-0 text-right">
            {holder ? (
              <>
                Held by
                <br />
                <strong className="text-navy-800">{holder}</strong>
              </>
            ) : (
              <em className="text-flagged-600">Not designated yet</em>
            )}
          </span>
        ) : headcount !== null ? (
          <span className="text-xs text-navy-500 shrink-0 text-right">
            <strong className="text-navy-800 text-base tabular">{headcount}</strong>
            <br />
            active
          </span>
        ) : null}
      </div>

      <p className="text-sm text-navy-700 mt-3">{role.purpose}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {role.can.map((line) => (
          <li key={line} className="text-xs text-navy-600 flex gap-2">
            <span aria-hidden="true" className="text-brand-600">
              •
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-navy-500 mt-3 border-t border-surface-200 pt-2">
        {GRANT_NOTE[role.grantedBy]}
      </p>
    </div>
  );
}

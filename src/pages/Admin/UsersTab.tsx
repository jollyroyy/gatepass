// Users tab — deliberately read-only, on two fronts:
//
//  1. Account creation is NOT built here. Creating an auth user needs the
//     Supabase service-role key, which must never reach client code. New
//     accounts are provisioned server-side via `npm run create-user`
//     (scripts/create-user.ts) — see the panel below for the exact command.
//  2. Role is rendered read-only. `profiles.role` drives authorization for
//     BOTH this app's RLS and VMS's, and is guarded by VMS's own RLS policy.
//     Letting this screen edit it would mean a client-side page mutating its
//     own authorization boundary. This is a safety boundary, not an omission
//     — role changes go through the same script.
import React, { useEffect, useMemo, useState } from 'react';
import { pub, gp } from '../../supabaseClient';
import type { Profile, UserRole } from '../../types';
import { fetchDirectory } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateOnly } from '../../lib/formatDate';

type RoleFilter = 'all' | 'hod' | 'guard' | 'admin' | 'staff';

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hod', label: 'HOD' },
  { key: 'guard', label: 'Security' },
  { key: 'admin', label: 'Admin' },
  { key: 'staff', label: 'Staff' },
];

/** Direct lookup — never derive the role chip colour from string matching. */
const ROLE_CHIP: Record<UserRole, string> = {
  guard: 'bg-brand-50 text-brand-700 border border-brand-500/25',
  hod: 'bg-matched-50 text-matched-700 border border-matched-500/25',
  admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  super_admin: 'bg-flagged-50 text-flagged-700 border border-flagged-500/25',
  staff: 'bg-surface-100 text-navy-600 border border-surface-200',
};

const ROLE_LABEL: Record<UserRole, string> = {
  guard: 'Security',
  hod: 'HOD',
  admin: 'Admin',
  super_admin: 'Super Admin',
  staff: 'Staff',
};

function matchesFilter(role: UserRole, filter: RoleFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'admin') return role === 'admin' || role === 'super_admin';
  return role === filter;
}

const SKELETON_ROWS = 6;

export default function UsersTab(): React.ReactElement {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deptNamesByHod, setDeptNamesByHod] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // gatepass.admin_list_profiles() — admin-gated, and ordered server-side.
        // Reading public.profiles from the client is what broke on VMS's
        // recursive policy; see src/lib/profiles.ts.
        const rows = await fetchDirectory();

        const [assignRes, deptRes] = await Promise.all([
          gp().from('hod_departments').select('hod_id, department_id'),
          pub().from('departments').select('id, name'),
        ]);
        if (assignRes.error) throw assignRes.error;
        if (deptRes.error) throw deptRes.error;

        const deptNameById = new Map(
          ((deptRes.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]),
        );
        const map = new Map<string, string[]>();
        for (const a of (assignRes.data ?? []) as { hod_id: string; department_id: string }[]) {
          const name = deptNameById.get(a.department_id);
          if (!name) continue;
          const list = map.get(a.hod_id) ?? [];
          list.push(name);
          map.set(a.hod_id, list);
        }

        if (!cancelled) {
          setProfiles(rows);
          setDeptNamesByHod(map);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(safeErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => profiles.filter((p) => matchesFilter(p.role, filter)), [profiles, filter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="alert-warning">
        <span>
          <strong>Accounts are not created here.</strong> Creating a login requires the Supabase service-role key,
          which must never reach the browser. Provision a new account from the project root:
          <code className="block mt-1.5 px-2 py-1 rounded bg-black/5 text-xs whitespace-pre-wrap break-all">
            npm run create-user -- --email new.user@company.com --password "TempPass123!" --name "Jane Doe" --role
            hod --dept ENG
          </code>
          Role changes are made the same way — the Role column below is read-only.
        </span>
      </div>

      {error && <div className="alert-error">{error}</div>}

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
                  <td>{p.role === 'hod' ? deptNamesByHod.get(p.id)?.join(', ') || '—' : '—'}</td>
                  <td className="tabular whitespace-nowrap">{formatDateOnly(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

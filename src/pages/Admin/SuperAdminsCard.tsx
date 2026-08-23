// Admin → Settings → who the super admins are (migration 067).
//
// Client, 2026-08-24: "there is a super admin role but you can mention that the
// super admin role will be given to COO and CEO … in the admin portal settings
// section you put CEO / Super Admin. Also put COO / Super Admin."
//
// READ-ONLY, AND THAT IS THE POINT. There is no select here because there is
// nothing to choose: the super admin is not a person somebody appoints, it is
// whoever is sitting in these two offices today. The place that changes is
// Admin → Users → Gate pass approval ladder, and this card says so and links
// nowhere else. A second control that wrote the same fact would be a second
// answer to "who is the super admin".
//
// AN EMPTY OFFICE IS THE HEADLINE, not a quiet gap. If neither seat is filled
// then nobody in the system can release a pass its ladder has stopped
// answering, and an admin needs to read that here rather than discover it the
// night a pass is stuck.
//
// WHAT IT DOES NOT SAY. It does not claim these two can reach the admin portal:
// `is_super_admin()` is deliberately not `is_admin()`, an office holder still
// gets "Pending for My Approval" and "Delegation" and nothing else, and a card
// that implied otherwise would be describing access that does not exist.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';

/** One row of `gatepass.list_super_admins()`. `full_name` and `is_active` are
 *  null for a vacant office — the row is still returned, because naming an
 *  empty seat is what this card is for. */
interface SuperAdminRow {
  role_key: string;
  title: string;
  user_id: string | null;
  full_name: string | null;
  is_active: boolean | null;
}

export default function SuperAdminsCard(): React.ReactElement {
  const [rows, setRows] = useState<SuperAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('list_super_admins');
      if (err) throw err;
      setRows((data as SuperAdminRow[] | null) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filled = rows.filter((r) => r.user_id && r.is_active !== false);

  return (
    <div className="card p-4 space-y-3">
      <h2 className="section-title mb-0">Super administrators</h2>
      <p className="text-sm text-navy-500">
        The super admin is not a separate account. It is carried by the two offices at the top of
        the gate pass approval ladder — the{' '}
        <strong className="text-navy-700">CEO</strong> and the{' '}
        <strong className="text-navy-700">COO</strong> — alongside the office itself, and it moves
        with the seat. Designate them under <strong className="text-navy-700">Users</strong>, on the
        approval ladder.
      </p>
      <p className="text-sm text-navy-500">
        It is a <strong className="text-navy-700">fallback and nothing more</strong>: when a gate
        pass has waited on one approval level longer than the escalation window, either of them can
        release it past the offices that have not answered — in writing, and another admin reviews
        it afterwards. It opens no admin screen.
      </p>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-6 w-1/2" />
          <div className="skeleton h-6 w-1/2" />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="super-admins">
            {rows.map((r) => (
              <li key={r.role_key} className="flex flex-col">
                <p className="text-sm font-semibold text-navy-900">
                  {r.title} / Super Admin
                </p>
                {r.user_id ? (
                  <p className="text-xs text-navy-500">
                    {r.full_name ?? 'Unnamed account'}
                    {r.is_active === false ? ' · deactivated, so this seat can release nothing' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-pending-700">Not designated yet</p>
                )}
              </li>
            ))}
          </ul>

          {filled.length === 0 && (
            <div className="alert-error">
              Neither office is filled, so nobody can release a gate pass its approval ladder has
              stopped answering. Designate a CEO or a COO under Users.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Who signs a gate pass — the four offices between the issuing HOD and the gate
// (migration 043).
//
// This designates NO POWER. Unlike the CEO approver card beside it, holding one
// of these offices opens no route, no RPC and no queue: it decides which name is
// printed beside a level on the pass record and on the printed slip. That is why
// an ordinary admin may set it, and why the designee can hold any role — a
// Security Head is plausibly a `guard` account and a Finance HOD a `staff` one.
//
// AN EMPTY OFFICE IS SAID OUT LOUD, on this card and on every pass record ("Not
// designated yet"), because the alternative is a record that prints a level with
// no name and reads as a rendering fault rather than a gap in the org chart.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { fetchDirectory } from '../../lib/profiles';
import type { Profile } from '../../types';
import {
  APPROVAL_LADDER, APPROVAL_ROLE_TITLES, type ApprovalRoleKey, type ApprovalRoleRow,
} from '../../lib/approvalLadder';
import { safeErrorMessage } from '../../lib/errors';

export default function ApprovalLadderCard(): React.ReactElement {
  const [rows, setRows] = useState<ApprovalRoleRow[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ApprovalRoleKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('get_approval_ladder');
      if (err) throw err;
      setRows((data as ApprovalRoleRow[] | null) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        setPeople(await fetchDirectory());
      } catch (err) {
        setError(safeErrorMessage(err));
      }
    })();
  }, []);

  async function assign(key: ApprovalRoleKey, userId: string): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      const { error: err } = userId
        ? await gp().rpc('set_approval_role', { p_role_key: key, p_user_id: userId })
        : await gp().rpc('clear_approval_role', { p_role_key: key });
      if (err) throw err;
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const held = new Map(rows.map((r) => [r.role_key, r]));

  return (
    <div className="card p-4 space-y-3">
      <h2 className="section-title mb-0">Gate pass approval ladder</h2>
      <p className="text-sm text-navy-500">
        The four offices that sign a gate pass between the issuing HOD and the gate. Their names are
        printed on every pass record and on the printed slip; designating somebody grants no access
        of any kind.
      </p>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-6 w-1/2" />
          <div className="skeleton h-6 w-1/2" />
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {APPROVAL_LADDER.map(({ key, level }) => {
            const row = held.get(key);
            return (
              <li key={key} className="flex flex-wrap items-center gap-3">
                <div className="min-w-[12rem]">
                  <p className="text-sm font-semibold text-navy-900">
                    Level {level} · {APPROVAL_ROLE_TITLES[key]}
                  </p>
                  {row ? (
                    <p className="text-xs text-navy-500">
                      {row.full_name ?? 'Unnamed account'}
                      {row.department_name ? ` · ${row.department_name}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-pending-700">Not designated yet</p>
                  )}
                </div>
                <select
                  className="input flex-1 min-w-[14rem]"
                  aria-label={`${APPROVAL_ROLE_TITLES[key]} account`}
                  value={row?.user_id ?? ''}
                  disabled={busy !== null}
                  onChange={(e) => void assign(key, e.target.value)}
                >
                  <option value="">Nobody designated</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                  ))}
                </select>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// Who signs a gate pass — the four offices between the issuing HOD and the gate
// (migration 043).
//
// ⚠ THIS DESIGNATES REAL AUTHORITY. This card's copy used to say the opposite
// ("designating somebody grants no access of any kind"), which was true of 043
// and was made FALSE by 046 without the sentence ever being revised. Holding
// one of these offices opens `/approvals`, admits the person to
// `approve_pass_level` and `reject_pass_level`, and makes every pass routed to
// that office visible to them under `gate_passes_select`. Since 053 the CEO
// office additionally decides blacklist whitelist requests. Say so on screen:
// an admin choosing from a directory of every account needs to know that this
// select is a grant.
//
// ONE OFFICE, ONE PERSON. There is no second seat: 054's standing deputy was
// withdrawn by the client and removed in 068. Cover for an absence is a
// DELEGATION the holder writes themselves (062) — a window, a value ceiling and
// a revocation — not a permanent second signature an admin names here. The
// database refuses to seat anyone twice (049), so no single human can ever sign
// two rungs of the same pass; the refusal comes back as a sentence naming the
// seat already held, and this card just shows it.
//
// AN EMPTY OFFICE IS SAID OUT LOUD, on this card and on every pass record ("Not
// designated yet"), because the alternative is a record that prints a level
// with no name and reads as a rendering fault rather than a gap in the org
// chart.
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
  const [busy, setBusy] = useState<string | null>(null);

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
      // Choosing the blank option CLEARS the office rather than writing a null,
      // because those are different operations in the database and only one of
      // them is legal on a NOT NULL column.
      const call = userId
        ? gp().rpc('set_approval_role', { p_role_key: key, p_user_id: userId })
        : gp().rpc('clear_approval_role', { p_role_key: key });
      const { error: err } = await call;
      if (err) throw err;
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const held = new Map(rows.map((r) => [r.role_key, r]));

  // ONLY AN ACTIVE ACCOUNT MAY BE SEATED (migration 059): `my_approval_role()`
  // gates on `is_user_active`, so a suspended holder is an office that can
  // approve nothing while this card reads as staffed. The RPC refuses it in a
  // sentence; this stops the admin being offered the choice at all.
  //
  // `is_active` is OPTIONAL on `Profile` (it is coalesced to true in the
  // database, and an older directory row simply omits it), so the test is
  // `!== false` rather than `=== true` — a missing flag must not empty the list.
  const selectable = people.filter((p) => p.is_active !== false);

  return (
    <div className="card p-4 space-y-3">
      <h2 className="section-title mb-0">Gate pass approval ladder</h2>
      <p className="text-sm text-navy-500">
        The four offices that sign a gate pass between the issuing HOD and the gate. Their names are
        printed on every pass record and on the printed slip.{' '}
        <strong className="text-navy-700">Designating somebody grants them real authority</strong> —
        the approvals queue, and the power to approve or reject every pass routed to that office.
      </p>
      <p className="text-sm text-navy-500">
        One person holds one office only, so nobody can sign two levels of the same pass. Only
        active accounts are listed, and deactivating a holder vacates their office. An office
        holder covers their own absence from the Delegation screen.
      </p>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-6 w-1/2" />
          <div className="skeleton h-6 w-1/2" />
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {APPROVAL_LADDER.map(({ key, level }) => {
            const row = held.get(key);
            const title = APPROVAL_ROLE_TITLES[key];
            return (
              <li key={key} className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-semibold text-navy-900">
                    Level {level} · {title}
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
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className="input flex-1 min-w-[14rem]"
                    aria-label={`${title} account`}
                    value={row?.user_id ?? ''}
                    disabled={busy !== null}
                    onChange={(e) => void assign(key, e.target.value)}
                  >
                    <option value="">Nobody designated</option>
                    {selectable.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

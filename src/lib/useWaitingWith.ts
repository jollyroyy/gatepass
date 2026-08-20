// The reads behind the "Waiting with" strip at the foot of both dashboards.
//
// TWO SOURCES, AND NEITHER IS AN AGGREGATE: `gatepass.pass_approvals` for the
// passes the board is already holding, and `get_approval_ladder()` for who
// holds each office today. Every figure is then derived from those arrays by
// `buildWaitingWith`, so the strip counts exactly the passes the board above it
// counted — this app's board invariant, one level down.
//
// THE APPROVALS READ IS NARROWED TO THE PASS IDS THE BOARD ALREADY HAS.
// `pass_approvals` carries no `raised_by` and no department of its own, so
// `.in('gate_pass_id', …)` is the only way to scope it; it is the same shape
// `useHodBoardData` and `useOpenReturns` use. An HOD board passes its own
// already-loaded rows in through `approvals` instead, so that page still makes
// exactly the two reads it made before.
//
// A FAILED READ IS AN EMPTY STRIP, NEVER AN ERROR SCREEN. The five figures on
// the board above are the page; a broken org-chart or approvals read leaves the
// strip reading all zero — the same call `useApprovalRoles` makes for the same
// reason.
import { useEffect, useMemo, useState } from 'react';
import { gp } from '../supabaseClient';
import type { GatePassView } from '../types';
import { useApprovalRoles } from './useApprovalRoles';
import {
  buildWaitingWith,
  passesRaisedToday,
  type WaitingApprovalRow,
  type WaitingRow,
} from './waitingWith';

export function useWaitingWith(
  rows: GatePassView[],
  stamp: number,
  /** Already-loaded `pass_approvals` rows. Pass them and this hook makes no
   *  approvals query of its own; omit them and it fetches for `today`'s ids. */
  approvals?: WaitingApprovalRow[],
): { today: GatePassView[]; waiting: WaitingRow[] } {
  const { roles } = useApprovalRoles();
  const [fetched, setFetched] = useState<WaitingApprovalRow[]>([]);

  const today = useMemo(() => passesRaisedToday(rows, stamp), [rows, stamp]);
  const ids = useMemo(() => today.map((p) => p.id).join(','), [today]);
  const provided = approvals !== undefined;

  useEffect(() => {
    if (provided) return;
    if (!ids) {
      setFetched([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await gp()
          .from('pass_approvals')
          .select('gate_pass_id, role_key, level_no, status')
          .in('gate_pass_id', ids.split(','));
        if (cancelled) return;
        setFetched(res.error ? [] : ((res.data as WaitingApprovalRow[] | null) ?? []));
      } catch {
        if (!cancelled) setFetched([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, provided]);

  const source = approvals ?? fetched;
  const waiting = useMemo(
    () => buildWaitingWith(today, source, roles),
    [today, source, roles],
  );

  return { today, waiting };
}

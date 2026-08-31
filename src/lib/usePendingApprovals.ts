// The reads behind the Pending Approvals screen (migration 046): every
// `pass_approvals` row this reader may see, and the passes those rows belong
// to — the queue waiting on their signature AND everything they have already
// approved or rejected (client, 2026-08-20: "all four approvers should be able
// to see all the gate passes that they have approved and rejected").
//
// THE APPROVALS ARE READ FIRST AND THE PASSES ARE NARROWED TO THEM. It used to
// be two parallel reads with the passes fixed at `status = 'pending'` — which
// is exactly the set a history cannot come out of, since a pass approved last
// week has moved on. Dropping that filter without narrowing would hand a
// Security Head who is also a `guard` account the whole register (046 gives a
// guard every pass that owes no signature); asking `pass_approvals` first and
// fetching by id gives both lists their rows and nothing else.
//
// No aggregate. RLS (`pass_approvals_select_with_pass`, 046) already scopes the
// first read to what this reader may see, so `.in('id', …)` narrows a query
// rather than deciding access — the policies still do that.
//
// BOTH READS ARE FILTERED SERVER-SIDE AND PAGED, and that is not tidiness.
// PostgREST caps a response at 1000 rows and says nothing about it. The first
// read used to ask for EVERY approval row this reader may see and narrow it in
// TypeScript, so once the four offices had written more than a thousand rows
// between them the newest ones fell off the end of the page — and a gate pass
// routed to an office simply never appeared in that office's queue. Measured on
// 2026-08-24: 1124 rows readable, 1000 returned, the most recently routed row
// absent, and "Nothing is waiting on your signature" printed over 231 pending
// requests. A request nobody can see is a request nobody signs.
//
// So the `role_key = my office OR decided_by = me` rule that
// `passIdsOnMyLadder` expresses is now ALSO stated to the server, and
// `fetchAllRows` keeps asking until a page comes back short. The client-side
// narrowing stays: it is what turns rows into ids, and it is unit-tested.
//
// THE SIGNED-IN UID IS PART OF THE ANSWER: a decision is a fact about the
// person who pressed the button, not about the office, so `decidedByMe` needs
// it. It is resolved once, defensively — a failure leaves the two history
// lists empty rather than showing somebody else's signatures.
//
// AFTER approve/reject THE LIST IS RE-READ, NEVER PATCHED (`reload`) — only the
// database knows whether that press was the pass's last pending level, and
// whether the caller's OWN queue moved because someone above them just cleared
// it.
import { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../supabaseClient';
import type { GatePassView } from '../types';
import type { PassApproval } from './pendingApprovals';
import { passIdsOnMyLadder } from './approvalHistory';
import { safeErrorMessage } from './errors';
import { fetchAllRows } from './fetchAllRows';

export interface PendingApprovalsData {
  passes: GatePassView[];
  approvals: PassApproval[];
  /** The signed-in user's own uid, or `null` until it resolves (or if it
   *  never does). Only `decidedByMe` reads it. */
  userId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePendingApprovals(offices: string[]): PendingApprovalsData {
  // A NEW ARRAY EVERY RENDER IS A NEW `load` EVERY RENDER, and `load` is an
  // effect dependency that fires two paged reads. The offices are a short,
  // ordered list of literals, so their joined text is a sound identity.
  const key = offices.join(',');
  const [passes, setPasses] = useState<GatePassView[]>([]);
  const [approvals, setApprovals] = useState<PassApproval[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      const mineOffices = key ? key.split(',') : [];
      // No office held: nothing to query, and no query is made — the caller
      // renders the no-office state before this even runs.
      if (mineOffices.length === 0) {
        setPasses([]);
        setApprovals([]);
        setLoading(false);
        setError(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        let uid: string | null = null;
        try {
          const { data } = await supabase.auth.getUser();
          uid = data?.user?.id ?? null;
        } catch {
          // No session resolved: the queue still loads, and the two history
          // lists stay empty rather than guessing whose signature is whose.
        }
        setUserId(uid);

        // `or(...)` mirrors passIdsOnMyLadder exactly. The `decided_by` arm is
        // dropped when the uid did not resolve, rather than sent as a filter on
        // the string "null" — which PostgREST would read as a literal.
        const offs = `role_key.in.(${mineOffices.join(',')})`;
        const mine = uid ? `${offs},decided_by.eq.${uid}` : offs;
        const rows = await fetchAllRows<PassApproval>((from, to) =>
          gp().from('pass_approvals').select('*').or(mine).range(from, to));
        setApprovals(rows);

        const ids = passIdsOnMyLadder(rows, uid, mineOffices);
        if (ids.length === 0) {
          // Nothing has ever been routed to this office. `.in('id', [])` is a
          // query with no possible result — skip it rather than make it.
          setPasses([]);
          setError(null);
          return;
        }
        // Chunked, for the same reason: `.in('id', …)` is still one response
        // and still capped, so a thousand-pass office would lose the tail.
        // 500 ids is roughly 18KB of URL, comfortably inside the request line
        // limit, and each chunk is itself paged.
        const CHUNK = 500;
        const found: GatePassView[] = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          found.push(...await fetchAllRows<GatePassView>((from, to) =>
            gp().from('v_gate_passes').select('*').in('id', slice).range(from, to)));
        }
        setPasses(found);
        setError(null);
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime, defensive: a partially-mocked client (tests) may not implement
  // `channel()`. Silent refresh so the queue never flashes a skeleton while
  // another office's decision moves a pass through the ladder.
  useEffect(() => {
    if (!key) return undefined;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('pending-approvals-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          void load(true);
        })
        .subscribe();
    } catch {
      // No realtime available — the initial load still populated the page.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [load, key]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { passes, approvals, userId, loading, error, reload };
}

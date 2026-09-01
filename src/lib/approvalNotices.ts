// What the bell has to say to an approval office (client, 2026-08-20: "Suppose
// I am the CEO. On the top right corner in the Bell notification it should show
// the number of the pending approvals for me in red colour across all the
// approvers").
//
// IT IS DERIVED ON MOUNT, NOT PUSHED. A pass is raised by an HOD and routed by
// a trigger; the office holder is usually not signed in when that happens, and
// realtime announces nothing to a browser that was closed. So this reads the
// queue the same way the queue SCREEN reads it — the same two tables, the same
// `inMyQueue` — which is what makes the badge and the list under it one figure
// rather than two that can disagree.
//
// THE RULE IS `inMyQueue` AND NOTHING ELSE. Not "my office has a pending row":
// since 061 a pass is only on this desk when every rung below it is approved,
// and a badge counting passes the Security Head has not signed would send a COO
// to a screen with nothing on it. Reusing the predicate is what keeps the two
// in step when the rule next moves.
//
// A COUNT THAT CANNOT BE DISMISSED AWAY. These notices are a live queue, not an
// announcement: dismissing one is not remembered (see `remember` in
// notifications.tsx), so the figure comes back on the next mount if the pass is
// still waiting — and stops coming back the moment it is decided, because the
// database no longer answers with it.
import { useEffect } from 'react';
import { gp } from '../supabaseClient';
import { fetchAllRows } from './fetchAllRows';
import type { GatePassView } from '../types';
import { rungTitle, type LadderRungKey } from './approvalLadder';
import { inMyQueue, sortOldestFirst, type PassApproval } from './pendingApprovals';
import { myStep, withEscalation } from './approvalDecision';

/** One thing the bell will say. Deliberately not an `AppNotification`: the id
 *  and the type belong to the provider that files it. */
export interface ApprovalNoticeFact {
  passId: string;
  passNumber: string;
  message: string;
  timestamp: string;
}

/** The words. It names the office, because a person who has just been moved
 *  from one chair to another needs to know which desk is asking, and it says
 *  what to do — this notice is the only push an approver gets in the app. */
export function approvalNoticeMessage(passNumber: string, office: LadderRungKey): string {
  // `rungTitle` and not the four-office map: since 077 an HOD is pushed a
  // notice about the level-0 rung of a pass raised under their own authority,
  // and that rung belongs to no office.
  return `${passNumber} is waiting for your approval as ${rungTitle(office)}. Open it to read the request and approve or reject it.`;
}

/** Oldest first, exactly as the queue screen orders it: the thing that has
 *  waited longest is the thing to sign. */
export function buildApprovalNotices(
  passes: GatePassView[],
  approvals: PassApproval[],
  /** Every office this reader may act for. Two of them, when a live COO -> CEO
   *  delegation is running (072) — and then the notice names the rung it is
   *  actually about, which may be the office being COVERED rather than the
   *  reader's own. Being asked to sign "as COO" is the whole message. */
  offices: LadderRungKey[],
): ApprovalNoticeFact[] {
  const byPass = new Map<string, PassApproval[]>();
  for (const a of approvals) {
    const list = byPass.get(a.gate_pass_id);
    if (list) list.push(a);
    else byPass.set(a.gate_pass_id, [a]);
  }
  return sortOldestFirst(inMyQueue(passes, approvals, offices)).map((p) => ({
    passId: p.id,
    passNumber: p.pass_number,
    message: approvalNoticeMessage(
      p.pass_number,
      myStep(withEscalation(byPass.get(p.id) ?? [], p.created_at), offices)?.role_key
        ?? offices[0],
    ),
    // Dated by the RAISE, not by the read: "4h ago" must mean the HOD has been
    // waiting four hours, which is the fact an approver is being asked about.
    timestamp: p.created_at,
  }));
}

/** The read behind the badge. Two queries, narrowed by id — the same shape
 *  `usePendingApprovals` uses, and for the same reason: RLS scopes the first
 *  one, so `.in('id', …)` narrows a query rather than deciding access.
 *
 *  AND FILTERED SERVER-SIDE AND PAGED, for the same reason as well. PostgREST
 *  caps a response at 1000 rows without saying so, and the four offices had
 *  written more than that between them — so the newest approvals fell off the
 *  end of the page and the bell went quiet about exactly the requests that had
 *  just arrived. A badge that under-counts is worse than no badge: it is an
 *  assurance that nothing is waiting. */
export function useApprovalNotices(
  offices: LadderRungKey[],
  onFact: (fact: ApprovalNoticeFact) => void,
): void {
  // A NEW ARRAY EVERY RENDER IS A NEW DEPENDENCY EVERY RENDER, and this effect
  // fires two paged reads. The offices are a short, ordered list of literals,
  // so their joined text is a sound identity for them.
  const key = offices.join(',');
  useEffect(() => {
    const mine = key ? (key.split(',') as LadderRungKey[]) : [];
    if (mine.length === 0) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        // Only this office's rungs, and only the ones still owing a decision:
        // the bell speaks about what is waiting, and nothing else.
        const rows = await fetchAllRows<PassApproval>((from, to) =>
          gp().from('pass_approvals').select('*')
            .in('role_key', mine).eq('status', 'pending').range(from, to));
        if (cancelled) return;
        const ids = [...new Set(rows.map((r) => r.gate_pass_id))];
        if (ids.length === 0) return;

        const CHUNK = 500;
        const passes: GatePassView[] = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          passes.push(...await fetchAllRows<GatePassView>((from, to) =>
            gp().from('v_gate_passes').select('*').in('id', slice).range(from, to)));
        }
        if (cancelled) return;
        for (const fact of buildApprovalNotices(passes, rows, mine)) onFact(fact);
      } catch {
        // The bell is an aid, never a gate. A failed read leaves it silent
        // rather than blocking the screen the approver came here to use.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, onFact]);
}

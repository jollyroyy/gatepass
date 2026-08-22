// WHO A PASS IS ACTUALLY WAITING WITH — the strip at the foot of both boards.
//
// Client, 2026-08-20: "in the dashboard you need to mention at the bottom how
// many are waiting for which person … in the dashboard of admin and in the
// dashboard of HOD, it's only for today."
//
// ONE PASS COUNTS ONCE, AGAINST ONE PERSON. Asked who a pass is waiting WITH,
// only one answer is true — the office that can act on it right now, which
// `approve_pass_level` (046) defines as the LOWEST still-pending rung and 061
// turned into RLS. The CEO is not waiting on a pass the Security Head has not
// signed; the pass has not reached them, and telling a board otherwise names
// four people as holding up one document.
//
// The HOD board's Approval Pending strip (`hodApprovals.ts`) now files passes
// by exactly the same rule, on the client's instruction of 2026-08-21. The two
// still differ in what they are a strip OF: this one names the four offices AND
// the gate, so its rows sum to every waiting pass; that one names approvers
// only, folds COO and CEO into "Other Approvers", and sums to the passes still
// climbing.
//
// A PASS WITH NOTHING PENDING ON ITS LADDER IS WAITING WITH THE GATE. That is
// every pass raised before an office was designated, every level closed by
// 058's rollout, and every pass that has finished climbing — `awaits_approval`
// is false on all of them and the guard can see them. The gate row is the only
// one that names no individual: which guard is on the barrier is not something
// this database records, and inventing a name would be worse than the honest
// "Security gate". The rows therefore SUM to the passes still waiting, with
// nothing falling between the ladder and the gate.
//
// THERE IS NO DAY CUT — IT IS A RUNNING QUEUE (client, 2026-08-21: "it should
// not be only the passes which were raised today, but all the passes which are
// pending for all those approvals accordingly. And remove the today word from
// the bottom from the admin view").
//
// It was cut to the day when it landed on 2026-08-20, on the client's own
// instruction, and `passesRaisedToday` was how both boards made that cut. The
// cost was flagged at the time and is what has now been paid: a pass raised last
// week and still unsigned was on nobody's strip, so the desk holding up the
// oldest document in the building was the one desk the board never named. An
// obligation does not discharge because the date rolled over — the same argument
// the admin Overview's own Pending Approvals card has always been built on
// (`pendingSplit.ts`), and the strip and that card now agree.
//
// SCOPE IS NOT THIS MODULE'S DOING: the admin board reads every pass, the HOD
// board reads only their own (RLS narrows to the department and
// `.eq('raised_by', …)` narrows again, both server-side). The same function is
// correct on both because it counts exactly what it is handed.
import type { GatePassView } from '../types';
import { APPROVAL_LADDER, APPROVAL_ROLE_TITLES, type ApprovalRoleKey, type ApprovalRoleRow } from './approvalLadder';
import { actingStep, type ApprovalStepRow } from './approvalDecision';
import { isExpiredPending } from './statusStyles';


/** A `pass_approvals` row, narrowed to what the slip-order rule needs plus the
 *  pass it belongs to. Wider rows satisfy it. */
export interface WaitingApprovalRow extends ApprovalStepRow {
  gate_pass_id: string;
}

/** The gate's own row — a string, not an `ApprovalRoleKey`, because it is not
 *  an office on the ladder. */
export const GATE_KEY = 'gate';

export interface WaitingRow {
  key: ApprovalRoleKey | typeof GATE_KEY;
  /** The desk: an office title, or "Security gate". */
  office: string;
  /** WHO. Null when nobody holds the office — which reads "Not designated yet",
   *  never a blank — and null on the gate row, which names no individual. */
  person: string | null;
  /** The office's standing deputy (054), who may sign exactly what the holder
   *  may. Named because "waiting for X" is only half true when a second person
   *  can clear it. */
  deputy: string | null;
  count: number;
}

/** Is this pass waiting on anybody at all? A matched, flagged, cancelled or
 *  expired pass is not, and an expired one cannot be cleared by the gate no
 *  matter who signs it. Exported because `useWaitingWith` narrows its
 *  `pass_approvals` read to exactly these passes — the strip must not fetch
 *  ladder rows for passes it is about to skip. */
export function isWaitingSomewhere(
  p: Pick<GatePassView, 'status' | 'is_expired'>,
): boolean {
  return p.status === 'pending' && !isExpiredPending(p);
}

/**
 * How many of `passes` each desk is holding.
 *
 * `passes` is whatever the board was handed (see the header — the admin's is
 * every pass, an HOD's is their own); `approvals` is the `pass_approvals` rows
 * for those passes; `roles` is `get_approval_ladder()`.
 *
 * A pass counts only while it is still `pending` and not expired: a matched,
 * flagged, cancelled or expired pass is not waiting for anybody, and an expired
 * one cannot be cleared by the gate no matter who signs it.
 */
export function buildWaitingWith(
  passes: GatePassView[],
  approvals: WaitingApprovalRow[],
  roles: ApprovalRoleRow[],
): WaitingRow[] {
  const byPass = new Map<string, WaitingApprovalRow[]>();
  for (const a of approvals) {
    const list = byPass.get(a.gate_pass_id);
    if (list) list.push(a);
    else byPass.set(a.gate_pass_id, [a]);
  }

  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const p of passes) {
    if (!isWaitingSomewhere(p)) continue;
    const rows = byPass.get(p.id) ?? [];
    const step = actingStep(rows);
    bump(step ? step.role_key : GATE_KEY);
  }

  const holder = new Map<ApprovalRoleKey, ApprovalRoleRow>(roles.map((r) => [r.role_key, r]));

  // The four offices in slip order, then the gate — a pass climbs the ladder
  // and only afterwards reaches the barrier, so the strip reads in the order a
  // pass travels.
  const office: WaitingRow[] = APPROVAL_LADDER.map(({ key }) => ({
    key,
    office: APPROVAL_ROLE_TITLES[key],
    person: holder.get(key)?.full_name ?? null,
    deputy: holder.get(key)?.deputy_name ?? null,
    count: counts.get(key) ?? 0,
  }));

  return [
    ...office,
    {
      key: GATE_KEY,
      office: 'Security gate',
      person: null,
      deputy: null,
      count: counts.get(GATE_KEY) ?? 0,
    },
  ];
}

/** Everything the strip is counting — the same figure as the rows' own sum, so
 *  the heading and the rows under it cannot disagree. */
export function waitingWithTotal(rows: WaitingRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0);
}

/** The line under each figure. The gate names no individual (see the header);
 *  a vacant office says so rather than printing an empty line, because a blank
 *  reads as a screen that failed to load. */
export function waitingPersonLabel(row: WaitingRow): string {
  if (row.key === GATE_KEY) return 'Guard on duty';
  if (!row.person) return 'Not designated yet';
  return row.deputy ? `${row.person} · deputy ${row.deputy}` : row.person;
}

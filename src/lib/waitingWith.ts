// WHO A PASS IS ACTUALLY WAITING WITH — the strip at the foot of both boards.
//
// Client, 2026-08-20: "in the dashboard you need to mention at the bottom how
// many are waiting for which person … in the dashboard of admin and in the
// dashboard of HOD, it's only for today."
//
// ONE PASS COUNTS ONCE, AGAINST ONE PERSON. This is deliberately NOT what
// `hodApprovals.ts` counts: that strip counts SIGNATURES STILL OWED at each
// office, so a pass owing four of them appears four times. Asked who a pass is
// waiting WITH, only one answer is true — the office that can act on it right
// now, which `approve_pass_level` (046) defines as the LOWEST still-pending
// rung. The CEO is not waiting on a pass the Security Head has not signed; the
// pass has not reached them, and telling a board otherwise names four people as
// holding up one document.
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
// TODAY IS THE CALLER'S CUT, and `passesRaisedToday` is how both boards make
// it — passes RAISED today, the same local-midnight day every other figure on
// those two boards uses. A pass raised last week and still climbing is not
// counted here; the client asked for today and the Pending Approvals card above
// (`pendingSplit.ts`) is the running figure that is not date-scoped.
//
// SCOPE BEYOND THE DAY IS NOT THIS MODULE'S DOING: the admin board reads every
// pass, the HOD board reads only their own (RLS narrows to the department and
// `.eq('raised_by', …)` narrows again, both server-side). The same function is
// correct on both because it counts exactly what it is handed.
import type { GatePassView } from '../types';
import { APPROVAL_LADDER, APPROVAL_ROLE_TITLES, type ApprovalRoleKey, type ApprovalRoleRow } from './approvalLadder';
import { lowestPendingLevel, type ApprovalStepRow } from './approvalDecision';
import { isExpiredPending } from './statusStyles';
import { dayStart, DAY_MS } from './localDay';

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

/** The passes raised in the local day containing `stamp`. Local midnight, the
 *  same cut `todayBounds` makes for every KPI on both boards. */
export function passesRaisedToday(rows: GatePassView[], stamp: number): GatePassView[] {
  const start = dayStart(stamp);
  const end = start + DAY_MS;
  return rows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= start && t < end;
  });
}

/**
 * How many of `passes` each desk is holding.
 *
 * `passes` is already scoped by the caller (today, and whatever the board's own
 * scope is); `approvals` is the `pass_approvals` rows for those passes; `roles`
 * is `get_approval_ladder()`.
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
    if (p.status !== 'pending' || isExpiredPending(p)) continue;
    const rows = byPass.get(p.id) ?? [];
    const lowest = lowestPendingLevel(rows);
    if (lowest === null) {
      bump(GATE_KEY);
      continue;
    }
    const step = rows.find((r) => r.level_no === lowest && r.status === 'pending');
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

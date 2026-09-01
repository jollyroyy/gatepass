// THE SLIP-ORDER RULE, STATED ONCE.
//
// `approve_pass_level` (migration 046) refuses a caller whose office is not the
// LOWEST still-pending rung on that pass. Two screens have to know the same
// thing before they draw a button — the approver's queue at `/approvals`, and
// the Approve / Reject bar at the foot of the gate pass record — and a second
// copy of the rule is a second thing to get wrong. Both read this module, so a
// button is never drawn on something the database would only refuse.
//
// It is generic over the ROW SHAPE because the same ladder arrives in two
// shapes: `pass_approvals` read straight off the table (the queue, which loads
// every pass's rows at once and so carries `gate_pass_id`), and
// `get_pass_approvals()` (one pass, with the holders' names joined on). Both
// carry the three fields the rule actually depends on, and nothing here needs
// any of the others.
//
// Pure. No queries, no React — the same split every derivation module in
// `src/lib` follows.
import type { ApprovalRoleKey } from './approvalLadder';
import type { PassApprovalStatus } from './passApprovalState';
import type { LadderRungKey } from './ladderRungs';

/**
 * THE OFFICES A READER MAY ACT FOR — one, several, or none.
 *
 * Several is not a hypothetical: since migration 067 the COO and the CEO
 * delegate only to each other, so a live COO → CEO delegation leaves the CEO
 * holding their own office AND covering the COO's. Migration 072 made
 * `gatepass.my_approval_roles()` return both, because the scalar before it
 * silently dropped the second one and the pass sat with an absent holder.
 *
 * A bare key is still accepted everywhere a list is, so every caller that has
 * exactly one office reads exactly as it did.
 */
/** Since 077 a RUNG KEY, not only an office key: an HOD answering for the
 *  level-0 `department_hod` rung of a pass raised under their authority holds no
 *  office at all, and every rule below is about which row of a pass's ladder is
 *  this reader's to press — a question that has never been about seats. */
export type ActingOffices = LadderRungKey | LadderRungKey[] | null | undefined;

/** `ActingOffices` as an array, always. Not exported as a convenience — the
 *  four functions below are the only things that should be asking. */
function officeList(offices: ActingOffices): LadderRungKey[] {
  if (!offices) return [];
  return Array.isArray(offices) ? offices : [offices];
}

/** The fields the rule depends on. Anything wider satisfies it. */
export interface ApprovalStepRow {
  /** The RUNG (077), which is the office on four of them and the department's
   *  HOD on the fifth. */
  role_key: LadderRungKey;
  level_no: number;
  status: PassApprovalStatus;
  /** When this office's own decision was recorded. Read only to work out when a
   *  shared rung was REACHED — see `withEscalation`. */
  decided_at?: string | null;
  /** WHEN THIS OFFICE MAY SIGN A RUNG IT SHARES WITH ANOTHER (migration 063).
   *  Null on every ordinary row, and null on a shared rung the reader is not
   *  waiting behind anybody on. Computed by `withEscalation` from rows the
   *  caller already holds — it is DISPLAY ONLY, and `approve_pass_level`
   *  enforces the same window itself. */
  escalates_at?: string | null;
}

/** How long the COO has before the CEO may sign level 3 instead. The database's
 *  own default (`app_settings.coo_escalation_hours`, 063) restated so a screen
 *  that could not read the setting still refuses the same presses the RPC
 *  refuses, rather than drawing a button on nothing. */
export const DEFAULT_ESCALATION_HOURS = 48;

/** The office that may sign a shared rung FIRST, and the one that may sign it
 *  only after the window. Stated once: `approvalLadder.ts` says the two are on
 *  one level, and this says which way round the waiting goes. */
const ESCALATES_FROM: ApprovalRoleKey = 'coo';
const ESCALATES_TO: ApprovalRoleKey = 'ceo';

/**
 * The same rows, with `escalates_at` filled in on the office that is waiting
 * behind another on its own level.
 *
 * MIRRORS `gatepass.level_escalates_at` (063) and is deliberately display-only:
 * the RPC computes the same moment itself and refuses the press, so this exists
 * for the one reason `canDecideApproval` exists at all — a button the database
 * would only refuse must never be drawn.
 *
 * The rung is REACHED when the level below it was approved, and for a pass
 * whose shared rung is its first, when the pass was raised. Never `now()` minus
 * something.
 */
export function withEscalation<T extends ApprovalStepRow>(
  rows: T[],
  passCreatedAt: string,
  hours: number = DEFAULT_ESCALATION_HOURS,
): T[] {
  const waiting = rows.find((r) => r.role_key === ESCALATES_TO && r.status === 'pending');
  const first = rows.find((r) => r.role_key === ESCALATES_FROM && r.status === 'pending');
  // Nobody is waiting behind anybody: no shared rung open, or the office that
  // gets first refusal has already decided (or was never designated, in which
  // case it was never snapshotted onto this pass at all).
  if (!waiting || !first || first.level_no !== waiting.level_no) return rows;

  const below = rows
    .filter((r) => r.level_no < waiting.level_no && r.status === 'approved' && r.decided_at)
    .map((r) => r.decided_at as string)
    .sort();
  const reached = below.length > 0 ? below[below.length - 1] : passCreatedAt;
  const at = new Date(new Date(reached).getTime() + hours * 3600_000).toISOString();

  return rows.map((r) => (r === waiting ? { ...r, escalates_at: at } : r));
}

/** The sentence a rung carries while it is waiting to escalate. Stated here
 *  because this module owns which way round the waiting goes; the ladder and
 *  the decision bar both print it. */
export function escalationNote(at: string): string {
  const when = new Date(at).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `With the COO — escalates to the CEO on ${when} if they have not decided`;
}

/** Is this office still waiting for a rung it shares to escalate to it? */
export function isHeldForEscalation(
  row: Pick<ApprovalStepRow, 'escalates_at'> | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row?.escalates_at) return false;
  return Date.parse(row.escalates_at) > now;
}

/** The first rung nobody has signed, or `null` when every rung is decided —
 *  and `null` too for a pass with no ladder at all, which is every pass raised
 *  before an office was designated (046 snapshots on insert and backfills
 *  nothing). */
export function lowestPendingLevel<T extends ApprovalStepRow>(rows: T[]): number | null {
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;
  return Math.min(...pending.map((r) => r.level_no));
}

/**
 * The one pending rung a pass is ACTUALLY sitting on, or null when it owes
 * nothing.
 *
 * The lowest pending level, and — since 063, where the COO and the CEO share
 * level 3 — the office on that level that may act first. The COO always gets
 * first refusal, so the office that only inherits the rung on a timer sorts
 * last, and an escalation-held row sorts behind one that is free to act. Two
 * boards count "who is this pass waiting with" and both must name the same
 * desk, so the rule lives here rather than in each of them.
 */
export function actingStep<T extends ApprovalStepRow>(rows: T[]): T | null {
  const lowest = lowestPendingLevel(rows);
  if (lowest === null) return null;
  const here = rows.filter((r) => r.level_no === lowest && r.status === 'pending');
  if (here.length === 0) return null;
  return here.find((r) => r.role_key !== ESCALATES_TO && !isHeldForEscalation(r)) ?? here[0];
}

/**
 * The rung on this pass that is MINE to answer for, or `null` when the pass is
 * not routed to any office I may act for.
 *
 * WITH TWO OFFICES IT IS A CHOICE, and it is the same one
 * `gatepass.my_acting_role` (072) makes server-side, or the button drawn here
 * would press an RPC that signs a different row: the lowest rung of mine, and
 * on a rung I hold twice, the one that is free to act rather than the one
 * waiting out an escalation window. A pass is never signed twice by this —
 * closing either row of a shared rung closes the other (063).
 */
export function myStep<T extends ApprovalStepRow>(
  rows: T[],
  offices: ActingOffices,
): T | null {
  const mine = officeList(offices);
  if (mine.length === 0) return null;
  const held = rows.filter((r) => mine.includes(r.role_key));
  if (held.length === 0) return null;
  const pending = held.filter((r) => r.status === 'pending');
  const from = pending.length > 0 ? pending : held;
  const lowest = Math.min(...from.map((r) => r.level_no));
  const here = from.filter((r) => r.level_no === lowest);
  return here.find((r) => !isHeldForEscalation(r)) ?? here[0];
}

/**
 * May this office decide this pass RIGHT NOW?
 *
 * Three conditions, and all three are the RPC's own: the pass is still
 * `pending` (a rejection cancels it, a gate clearance matches it, and neither
 * may be signed afterwards), my rung is still `pending`, and no earlier office
 * still owes a signature.
 */
export function canDecideApproval<T extends ApprovalStepRow>(
  passStatus: string,
  rows: T[],
  offices: ActingOffices,
): boolean {
  if (passStatus !== 'pending') return false;
  const mine = myStep(rows, offices);
  if (!mine || mine.status !== 'pending') return false;
  // A shared rung whose window has not run out is not mine yet, however low it
  // is (063). `approve_pass_level` refuses exactly this press.
  if (isHeldForEscalation(mine)) return false;
  return lowestPendingLevel(rows) === mine.level_no;
}

/**
 * The office actually holding this pass up, when it is NOT mine to sign.
 *
 * `null` means either that it is mine or that nothing is pending — the caller
 * has already asked `canDecideApproval` and only needs a name for the wait.
 * An office holder who sees no button and no reason cannot tell a queue that
 * is not theirs yet from a screen that failed to load.
 */
export function heldByOffice<T extends ApprovalStepRow>(
  rows: T[],
  offices: ActingOffices,
): LadderRungKey | null {
  const lowest = lowestPendingLevel(rows);
  if (lowest === null) return null;
  const mine = myStep(rows, offices);
  // MY OWN LEVEL CAN STILL BE SOMEBODY ELSE'S TURN. On a shared rung the office
  // waiting for the window is on the lowest level and still cannot act, and the
  // office holding it up is its neighbour — not an office below.
  if (mine && mine.level_no === lowest && !isHeldForEscalation(mine)) return null;
  const held = officeList(offices);
  const here = rows.filter((r) => r.level_no === lowest && r.status === 'pending'
    && !held.includes(r.role_key));
  return here.find((r) => !isHeldForEscalation(r))?.role_key ?? here[0]?.role_key ?? null;
}

/** "Level 2 of 3" — where this rung sits on the pass's own ladder, which is not
 *  always three rungs: a pass snapshots only the offices that were designated
 *  the day it was raised.
 *
 *  IT COUNTS LEVELS, NOT ROWS. Since 063 the COO and the CEO share level 3, so
 *  a pass with all four offices designated has FOUR rows and THREE levels —
 *  and "Level 3 of 4" would tell an approver there is a rung above them that
 *  does not exist. */
export function levelLabel<T extends ApprovalStepRow>(rows: T[], step: T): string {
  const levels = new Set(rows.map((r) => r.level_no)).size;
  return `Level ${step.level_no} of ${levels}`;
}

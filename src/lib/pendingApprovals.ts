// The Pending Approvals screen's derivations — one office's queue, the passes
// waiting on somebody ELSE below it, search and the two filters (client
// mock-up, 2026-08-19, migration 046).
//
// Derivation only, no queries — the same split `pendingOutFilters.ts` follows:
// the queue predicate, the search and the filters are all readings of the ONE
// array `usePendingApprovals` loads, so a count can never disagree with the
// list under it.
//
// THE SLIP-ORDER CLAUSE IS NOT DECORATION. `approve_pass_level` refuses a
// caller whose level is not the LOWEST still-pending one on that pass — so a
// pass with `security_head` still pending must not offer the CEO an Approve
// button, because pressing it would only return a database error. The two
// derivations below (`inMyQueue` / `waitingBelowMe`) are the same predicate
// read from both directions, over the same `PassApproval[]`.
import type { GatePassView } from '../types';
import type { ApprovalRoleKey } from './approvalLadder';
import { APPROVAL_LADDER, APPROVAL_ROLE_TITLES } from './approvalLadder';
import { partyOf } from './guardBoard';

/** One row of `gatepass.pass_approvals` — a single office's decision on a
 *  single pass, snapshotted when the pass was raised. Mirrors the migration
 *  046 table exactly; there is deliberately no TypeScript type for it in
 *  `src/types/index.ts` (out of scope for this screen to add one there). */
export interface PassApproval {
  gate_pass_id: string;
  role_key: ApprovalRoleKey;
  level_no: number;
  routed_to: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  created_at: string;
}

/** The lowest `level_no` still pending on one pass, or `null` when every row
 *  for it is decided (or the pass has no rows at all — an office designated
 *  after the pass was raised owes it nothing, by the snapshot's own design). */
function lowestPendingLevel(approvals: PassApproval[]): number | null {
  const pending = approvals.filter((a) => a.status === 'pending');
  if (pending.length === 0) return null;
  return Math.min(...pending.map((a) => a.level_no));
}

/** Passes belonging to me: my `role_key`'s row on that pass is `pending`, the
 *  pass itself is still `status === 'pending'`, and no earlier office still
 *  owes a signature. */
export function inMyQueue(
  passes: GatePassView[],
  approvals: PassApproval[],
  office: ApprovalRoleKey
): GatePassView[] {
  const byPass = new Map<string, PassApproval[]>();
  for (const a of approvals) {
    const list = byPass.get(a.gate_pass_id);
    if (list) list.push(a);
    else byPass.set(a.gate_pass_id, [a]);
  }
  return passes.filter((p) => {
    if (p.status !== 'pending') return false;
    const rows = byPass.get(p.id) ?? [];
    const mine = rows.find((a) => a.role_key === office);
    if (!mine || mine.status !== 'pending') return false;
    return lowestPendingLevel(rows) === mine.level_no;
  });
}

/** A pass routed to my office, but currently waiting on an EARLIER office —
 *  read-only, because pressing Approve on it would only be refused. Rendered
 *  in its own section so the reader can tell "nothing for me yet" apart from
 *  "the screen is broken": an empty queue and a queue that never loaded look
 *  identical without this. */
export interface WaitingBelowRow {
  pass: GatePassView;
  /** The office holding it up right now. */
  heldBy: ApprovalRoleKey;
}

export function waitingBelowMe(
  passes: GatePassView[],
  approvals: PassApproval[],
  office: ApprovalRoleKey
): WaitingBelowRow[] {
  const byPass = new Map<string, PassApproval[]>();
  for (const a of approvals) {
    const list = byPass.get(a.gate_pass_id);
    if (list) list.push(a);
    else byPass.set(a.gate_pass_id, [a]);
  }
  const out: WaitingBelowRow[] = [];
  for (const p of passes) {
    if (p.status !== 'pending') continue;
    const rows = byPass.get(p.id) ?? [];
    const mine = rows.find((a) => a.role_key === office);
    if (!mine || mine.status !== 'pending') continue;
    const lowest = lowestPendingLevel(rows);
    if (lowest === null || lowest === mine.level_no) continue;
    const holder = rows.find((a) => a.level_no === lowest && a.status === 'pending');
    if (!holder) continue;
    out.push({ pass: p, heldBy: holder.role_key });
  }
  return out;
}

/** "It is with the COO." — the note the read-only section prints beside a row
 *  it offers no button on. */
export function waitingNote(heldBy: ApprovalRoleKey): string {
  return `Waiting on ${APPROVAL_ROLE_TITLES[heldBy]}`;
}

/** Oldest request first — the thing that has waited longest is the thing to
 *  sign. Ties break on `pass_number` so the order is stable between renders
 *  (two passes raised in the same millisecond must not swap places on every
 *  re-render). */
export function sortOldestFirst(rows: GatePassView[]): GatePassView[] {
  return [...rows].sort((a, b) => {
    const byDate = a.created_at.localeCompare(b.created_at);
    return byDate !== 0 ? byDate : a.pass_number.localeCompare(b.pass_number);
  });
}

/** `pass_number`, vendor or purpose, case-insensitively, trimmed. Client-side
 *  over the rows already loaded — the same shape as every other guard-skinned
 *  list's search-within-the-page (as opposed to the GLOBAL search on the
 *  guard's own pages, which this screen does not offer: an approver signs off
 *  what is routed to them, not the whole register). */
export function matchesSearch(pass: GatePassView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    pass.pass_number.toLowerCase().includes(q)
    || partyOf(pass).toLowerCase().includes(q)
    || (pass.purpose ?? '').toLowerCase().includes(q)
  );
}

export interface PendingApprovalFilters {
  search: string;
  /** `''` means "All". */
  type: '' | 'RGP' | 'NRGP';
  department: string;
}

export const DEFAULT_APPROVAL_FILTERS: PendingApprovalFilters = {
  search: '',
  type: '',
  department: '',
};

/** Sorted, de-duplicated department options — built from the rows themselves,
 *  same rule as `scopeOptions` in `pendingOutFilters.ts`: an option that would
 *  return nothing is never offered. */
export function departmentOptions(rows: GatePassView[]): string[] {
  const departments = new Set<string>();
  for (const p of rows) {
    const dept = (p.department_name ?? '').trim();
    if (dept) departments.add(dept);
  }
  return [...departments].sort((a, b) => a.localeCompare(b));
}

/** The rows the table renders: search, then type, then department — the whole
 *  point of `matchesSearch` reading purpose/vendor/pass number is that a type
 *  or department select could never express it. */
export function applyApprovalFilters(
  rows: GatePassView[],
  f: PendingApprovalFilters
): GatePassView[] {
  return rows.filter((p) => {
    if (!matchesSearch(p, f.search)) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.department && (p.department_name ?? '') !== f.department) return false;
    return true;
  });
}

/** Re-exported so a caller need not also import `approvalLadder.ts` merely to
 *  print the slip order this screen's rules depend on. */
export const APPROVAL_LEVELS = APPROVAL_LADDER;

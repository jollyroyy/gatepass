// The Pending Approvals screen's derivations — one office's queue, search and
// the two filters (client mock-up, 2026-08-19, migration 046).
//
// Derivation only, no queries — the same split `pendingOutFilters.ts` follows:
// the queue predicate, the search and the filters are all readings of the ONE
// array `usePendingApprovals` loads, so a count can never disagree with the
// list under it.
//
// THE SLIP-ORDER CLAUSE IS NOT DECORATION. `approve_pass_level` refuses a
// caller whose level is not the LOWEST still-pending one on that pass — so a
// pass with `security_head` still pending must not offer the CEO an Approve
// button, because pressing it would only return a database error. That rule now
// lives in `approvalDecision.ts` and is IMPORTED, not restated: the Approve /
// Reject bar at the foot of the gate pass record decides with the same
// function, so the queue and the record can never disagree about whose turn it
// is.
//
// A pass routed to my office but still held up by an EARLIER one is NOT listed
// here at all (client, 2026-08-20: remove that section). The record's own
// decision bar still names the office holding it, for a reader who opens such
// a pass.
import type { GatePassView } from '../types';
import type { ApprovalRoleKey } from './approvalLadder';
import { APPROVAL_LADDER } from './approvalLadder';
import { canDecideApproval } from './approvalDecision';
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
  return passes.filter((p) => canDecideApproval(p.status, byPass.get(p.id) ?? [], office));
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

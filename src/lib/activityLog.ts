// THE ACTIVITY LOG — every recorded event across every pass, on one timeline.
//
// WHY THIS EXISTS. Asked "who approved this, when, and what was it worth?", the
// answer has always been in the database and has always been readable from the
// app — but only ONE PASS AT A TIME, on the pass record's own merged timeline.
// "What did this person approve last month" meant opening passes one by one.
// Nothing here is new information; it is the same three tables the record
// already reads, widened from one pass to all of them.
//
// THERE ARE NO LOG FILES AND NOTHING TO LOG INTO A SERVER FOR. Every event in
// this system is a row: `gate_passes.created_at` is the raise,
// `pass_approvals` is each office's decision, `verifications` is everything the
// gate did. This module merges those three into one ordered list.
//
// PURE — no queries, no React. The page does the reading; this decides what an
// event IS and how it reads, so a CSV and a screen can never disagree about it.
//
// WHAT IT DELIBERATELY DOES NOT CARRY, and both are worth knowing:
//   * NO IP ADDRESS, DEVICE OR BROWSER. `verifications.device_info` exists (014)
//     and `match_pass`/`flag_pass` both accept a `p_device_info`, but nothing in
//     this app has ever sent one, so every row is null. Making it real is a
//     frontend change, not a migration — see CLAUDE.md.
//   * NO SCAN ATTEMPTS AND NO EMAIL LOG. Both are recorded (`scan_attempts`,
//     `email_log`) and both are admin-readable; neither is what "who approved
//     this" means, and folding them in would bury the decisions among hundreds
//     of scans.
import type { GatePassView, VerifyAction } from '../types';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from './approvalLadder';

/** One thing that happened, to one pass, at one moment. */
export interface ActivityLogEntry {
  /** Stable identity for React keys and tests. Never the label. */
  key: string;
  at: string;
  passId: string;
  passNumber: string;
  /** What happened, in the words the rest of the app uses. */
  event: string;
  /** The person who did it, or null when this system records no name for it. */
  who: string | null;
  /** Department, office, reason, remark — whatever the event needs said. */
  detail: string | null;
}

/** The subset of `pass_approvals` this module needs. Read straight off the
 *  table (RLS scopes it), so `decided_by` is a uuid and the name is looked up
 *  from the directory rather than joined in SQL. */
export interface ApprovalEvent {
  gate_pass_id: string;
  role_key: ApprovalRoleKey;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  decided_as_deputy?: boolean;
  emergency?: boolean;
}

/** The subset of `v_verifications` this module needs. */
export interface GateEvent {
  id: string;
  gate_pass_id: string;
  action: VerifyAction;
  security_name?: string | null;
  remarks: string | null;
  gate_name?: string | null;
  created_at: string;
}

/** What the gate did, in this app's own words. A `Record` and not a chain, so a
 *  new verification action is a type error here rather than a blank row. */
export const GATE_EVENT_LABELS: Record<VerifyAction, string> = {
  matched: 'Cleared at the gate',
  flagged: 'Rejected at the security gate',
  returned: 'Return recorded',
  cancelled: 'Pass closed',
  held: 'Held at the gate',
  hod_reviewed: 'HOD decided the gate rejection',
};

/** `2026-08-20` in LOCAL time, which is what a person filtering by day means.
 *  Never `toISOString().slice(0,10)` — that is UTC and is a day out for half
 *  the evening in this timezone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Every event across the passes given, newest first.
 *
 * `names` maps a user id to a display name. It exists because `pass_approvals`
 * records `decided_by` as a uuid and this module reads the table directly —
 * `get_pass_approvals()` joins the names on, but it answers for one pass.
 */
export function buildActivityLog(
  passes: GatePassView[],
  approvals: ApprovalEvent[],
  gateEvents: GateEvent[],
  names: Map<string, string>,
): ActivityLogEntry[] {
  const passById = new Map(passes.map((p) => [p.id, p]));
  const numberOf = (id: string) => passById.get(id)?.pass_number ?? 'Unknown pass';
  const entries: ActivityLogEntry[] = [];

  for (const p of passes) {
    entries.push({
      key: `raised-${p.id}`,
      at: p.created_at,
      passId: p.id,
      passNumber: p.pass_number,
      event: 'Raised',
      who: p.raised_by_name,
      // The department and the money, because "what was it worth" is one of the
      // questions this screen exists to answer, and the value cannot change
      // afterwards — there is no edit path to a raised pass.
      detail: [p.department_name, p.material_summary].filter(Boolean).join(' · ') || null,
    });
  }

  for (const a of approvals) {
    // A level nobody has decided is not an event. It is the ABSENCE of one.
    if (a.status === 'pending' || !a.decided_at) continue;
    const office = APPROVAL_ROLE_TITLES[a.role_key] ?? a.role_key;
    const verb = a.status === 'approved' ? 'Approved' : 'Rejected';
    entries.push({
      key: `approval-${a.gate_pass_id}-${a.role_key}`,
      at: a.decided_at,
      passId: a.gate_pass_id,
      passNumber: numberOf(a.gate_pass_id),
      // AN EMERGENCY RELEASE IS NOT AN APPROVAL and must never read as one:
      // `decided_by` there is the super admin who overrode the ladder, and this
      // is the one line that keeps the log from crediting them with four
      // signatures they never gave (055).
      event: a.emergency ? `Released without ${office} approval` : `${verb} — ${office}`,
      who: (a.decided_by && names.get(a.decided_by)) || null,
      detail: [
        a.decided_as_deputy ? `standing deputy for the ${office}` : null,
        a.reason,
      ].filter(Boolean).join(' · ') || null,
    });
  }

  for (const g of gateEvents) {
    entries.push({
      key: `gate-${g.id}`,
      at: g.created_at,
      passId: g.gate_pass_id,
      passNumber: numberOf(g.gate_pass_id),
      event: GATE_EVENT_LABELS[g.action] ?? g.action,
      who: g.security_name ?? null,
      detail: [g.gate_name, g.remarks].filter(Boolean).join(' · ') || null,
    });
  }

  // Newest first: an activity log is read to find out what just happened. The
  // pass record's own timeline runs the other way, because there you are
  // reading one pass's story from its beginning.
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : -1));
}

export interface ActivityFilters {
  search: string;
  /** A single LOCAL day, or '' for the whole window. */
  day: string;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { search: '', day: '' };

/** Free text matches the pass number, the person and the event — the three
 *  things somebody actually arrives here knowing. */
export function applyActivityFilters(
  rows: ActivityLogEntry[],
  f: ActivityFilters,
): ActivityLogEntry[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.day && localDay(r.at) !== f.day) return false;
    if (!q) return true;
    return (
      r.passNumber.toLowerCase().includes(q) ||
      (r.who ?? '').toLowerCase().includes(q) ||
      r.event.toLowerCase().includes(q) ||
      (r.detail ?? '').toLowerCase().includes(q)
    );
  });
}

// GATE PASS REPORT (RGP & NRGP) — the data half of the client's report mock-up
// (2026-08-20). Pure functions, no React: the page loads `v_gate_passes` once
// and every figure, pill, option list and table row below is a reading of that
// ONE array. That is this app's oldest board rule — a number and the list it
// sits over cannot drift when neither is a second query.
//
// FOUR STATUS BUCKETS, AND THEY ARE DISJOINT. Every pass falls in exactly one,
// so the cards add up (Total = RGP + NRGP, and Completed + Pending + Partially
// Returned + Cancelled = Total).
//
//   * Completed   — the trip is over. An NRGP the gate cleared is finished (it
//                   is not coming back); an RGP is finished only when every line
//                   is back, which is `return_status = 'returned'`.
//   * Cancelled   — the pass died without completing: flagged at the gate, or
//                   cancelled (an approval rejection, an HOD upholding a flag, a
//                   voided expiry). An EXPIRED pass is here too — `match_pass`
//                   refuses it forever, so it is dead paperwork, not work in
//                   progress.
//   * Pending     — the pass has not been through the gate at all. It is sitting
//                   on ONE of two desks — the approval ladder, or the barrier —
//                   and the row's own pill names which. Both pass types are here.
//   * Partially Returned — an RGP that went out and has not fully come back. An
//                   OVERDUE pass is in this bucket — late is not finished. The
//                   bucket was called "In Progress" until the client renamed it
//                   (2026-08-21).
//
// ⚠ THE PARTIALLY RETURNED BUCKET TESTS THE RETURN LEG POSITIVELY, AND THAT IS
// THE WHOLE OF THE 2026-08-22 FIX. It used to be the REMAINDER — everything that
// was neither completed nor cancelled — so an NRGP waiting for a signature was
// filed under an obligation an NRGP cannot have (`return_status` is pinned to
// 'not_applicable' for every NRGP by `gate_passes_return_status_rgp_only`,
// migration 001). Client: "partial return can only be true for the RGP … if they
// are waiting for the gate for approval then put them under pending gate
// approval". The `pending` bucket is where they went. NOTHING WAS BACKFILLED:
// this is a reading of `v_gate_passes`, so every pass ever raised is re-filed the
// moment it is deployed.
//
// The row PILL says more than its bucket where more is true: an overdue pass
// reads "Overdue" and an expired one "Expired", both counted in the bucket above.
// Nothing about the arithmetic changes; a report printing "Partially Returned" against
// material three weeks late would be technically true and practically useless.
import type { GatePassView, PassType } from '../types';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';
import { IS_OPEN_RETURN } from './boardDrills';
import { isWaitingAtGate } from './gateQueue';
import { isExpiredPending } from './statusStyles';
import { passStageStyle } from './passStage';
import { csvCategory, csvDate, csvText } from './csvCells';
import type { CsvColumn } from './exportUtils';
import { formatCurrency } from './formatCurrency';

// ─── The buckets ─────────────────────────────────────────────────────────────

export type ReportStatus = 'completed' | 'pending' | 'in_progress' | 'cancelled';

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  completed: 'Completed',
  // The CARD's word for both desks. The ROW says which one — see
  // `reportStatusLabel`, which prints `passStageStyle`'s own label so the
  // register and the badge on the card above it cannot disagree.
  pending: 'Pending',
  // The KEY is unchanged — it is the bucket's identity, and it is what the
  // report's Status filter is persisted under. Only the WORD moved (client,
  // 2026-08-21): "replace the 'in progress' with 'partially returned' across
  // all the reporting everywhere in all the views". It is the same word
  // `RGP_STAGE_STYLES` now prints on a card, so the register and the badge over
  // it cannot disagree.
  in_progress: 'Partially Returned',
  cancelled: 'Cancelled',
};

/** The mock's pill colours, drawn from the `.gb-pill-*` set the guard's screens
 *  already use — no new hue, and no literal hex in a `.tsx`. */
export const REPORT_STATUS_PILL: Record<ReportStatus, string> = {
  completed: 'gb-pill-green',
  // Orange — "waiting on somebody", the tone `STAGE_TONES` already gives Pending
  // Gate Review, Pending Approval and Held at Gate on every card in the app.
  pending: 'gb-pill-orange',
  in_progress: 'gb-pill-blue',
  cancelled: 'gb-pill-red',
};

type PassFacts = Pick<
  GatePassView, 'status' | 'return_status' | 'is_expired' | 'is_overdue' | 'awaits_approval'
>;

/** Which of the four the pass is counted under. Exact enum tests only — no
 *  `includes()` chain, per the repo's no-fuzzy-matching rule.
 *
 *  The order is the precedence `passStageStyle` gives the badge: expiry and the
 *  two refusals outrank everything, then the return leg, then the desk. */
export function reportStatusOf(p: PassFacts): ReportStatus {
  if (isExpiredPending(p)) return 'cancelled';
  if (p.status === 'flagged' || p.status === 'cancelled') return 'cancelled';
  if (p.return_status === 'returned') return 'completed';
  // POSITIVE, never a remainder: only a pass whose return leg is actually open
  // is partially returned, and `IS_OPEN_RETURN` is false for every NRGP.
  if (IS_OPEN_RETURN[p.return_status]) return 'in_progress';
  // `matched` with no return loop at all is an NRGP through the gate: finished.
  if (p.status === 'matched') return 'completed';
  // pending / held / hod_reviewed — it never left the gate, so somebody still
  // owes a decision on it.
  return 'pending';
}

/** True when material is still out and past its date. `is_overdue` comes off
 *  `v_gate_passes` in the site's timezone and is NEVER recomputed here. */
export function isOverduePass(p: PassFacts): boolean {
  return IS_OPEN_RETURN[p.return_status] && p.is_overdue;
}

/** The word on the row's pill — the bucket, unless something sharper is true.
 *
 *  A PENDING PASS NAMES ITS DESK instead of printing the card's flat "Pending"
 *  (client, 2026-08-22: "if they are waiting for the gate for approval then put
 *  them under pending gate approval"). The words come from `passStageStyle`
 *  itself — Pending Approval / Pending Gate Review / Held at Gate / HOD Approved
 *  — so the register prints exactly what the card above it does and there is no
 *  second vocabulary to keep in step. */
export function reportStatusLabel(p: PassFacts): string {
  if (isExpiredPending(p)) return 'Expired';
  if (isOverduePass(p)) return 'Overdue';
  const bucket = reportStatusOf(p);
  if (bucket === 'pending') return passStageStyle(p).label;
  return REPORT_STATUS_LABELS[bucket];
}

/** Attention outranks the bucket's own colour, both in orange — the hue every
 *  Overdue and Expired badge in this app already wears. */
export function reportStatusPill(p: PassFacts): string {
  if (isExpiredPending(p) || isOverduePass(p)) return 'gb-pill-orange';
  return REPORT_STATUS_PILL[reportStatusOf(p)];
}

// ─── The filters ─────────────────────────────────────────────────────────────

/** The mock's Status select. The first four are the buckets; the last two are
 *  SUBSETS of a bucket, kept because the client asked for an overdue-only and
 *  an expired-only report (2026-08-18) and this select is now the one place a
 *  report is narrowed by state. The `in_progress` KEY is deliberately not
 *  renamed with its label — it is persisted state, and the word is the only
 *  thing the client moved. */
export type StatusFilter =
  | 'all' | ReportStatus | 'overdue' | 'expired' | 'pending_gate' | 'pending_approval';

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  // The fourth bucket (2026-08-22). The two desk options below it are SUBSETS of
  // this one, exactly as Overdue and Expired are subsets of Partially Returned.
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'Partially Returned' },
  { key: 'cancelled', label: 'Cancelled' },
  // The two desks a pass that has not moved can be sitting on (client,
  // 2026-08-21: "in the report also show pending gate review and pending for
  // approval as a drop-down filter for admin, for the entire department and for
  // individual HOD also"). Both are SUBSETS of Partially Returned, like the two below
  // them, and both are `pendingSplit`'s own predicates — the same split the
  // admin Overview and the HOD dashboard print under their Pending Approvals
  // card, so the report and the dashboards cannot disagree about the figure.
  { key: 'pending_gate', label: 'Pending Gate Review' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'expired', label: 'Expired' },
];

export type TypeFilter = 'all' | PassType;

export const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All (RGP & NRGP)' },
  { key: 'RGP', label: 'RGP' },
  { key: 'NRGP', label: 'NRGP' },
];

export interface ReportFilters {
  /** Inclusive `YYYY-MM-DD` day bounds — the mock's one Date Range control. */
  from: string;
  to: string;
  type: TypeFilter;
  status: StatusFilter;
  /** `''` is "All" on both of these. */
  createdBy: string;
  department: string;
}

/** True when anything is narrowed away from the defaults — what the Reset button
 *  is enabled by. The dates are excluded on purpose: a report always covers SOME
 *  range, so a range is not a filter there is anything to clear. */
export function isNarrowed(f: ReportFilters): boolean {
  return f.type !== 'all' || f.status !== 'all' || f.createdBy !== '' || f.department !== '';
}

/** Everything except the date range, which the page applies first (it is the
 *  only filter whose bounds are computed in local time). */
export function applyReportFilters(rows: GatePassView[], f: ReportFilters): GatePassView[] {
  return rows.filter((p) => {
    if (f.type !== 'all' && p.type !== f.type) return false;
    if (f.createdBy && p.raised_by !== f.createdBy) return false;
    if (f.department && p.department_id !== f.department) return false;
    switch (f.status) {
      case 'all': return true;
      case 'overdue': return isOverduePass(p);
      case 'expired': return isExpiredPending(p);
      // `awaits_approval` comes off `v_gate_passes` (057) and is never
      // recomputed; falsy means the pass owes no signature, which is every
      // pre-workflow pass and every level closed by 058's rollout.
      case 'pending_gate': return isWaitingAtGate(p) && p.awaits_approval !== true;
      case 'pending_approval': return isWaitingAtGate(p) && p.awaits_approval === true;
      default: return reportStatusOf(p) === f.status;
    }
  });
}

export interface ReportOption { id: string; name: string }

/** The Created By and Department selects, built from the LOADED rows rather than
 *  from a directory read: an option that would return an empty report is never
 *  offered. Built from the whole set, not the filtered one — a list that
 *  reshuffles as the admin narrows would drop their own selection. */
export function reportOptions(rows: GatePassView[]): {
  createdBy: ReportOption[];
  departments: ReportOption[];
} {
  const people = new Map<string, string>();
  const depts = new Map<string, string>();
  for (const p of rows) {
    if (p.raised_by) people.set(p.raised_by, p.raised_by_name ?? 'Unknown');
    if (p.department_id) depts.set(p.department_id, p.department_name ?? 'Unassigned');
  }
  const sorted = (m: Map<string, string>) =>
    [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { createdBy: sorted(people), departments: sorted(depts) };
}

// ─── The six figures ─────────────────────────────────────────────────────────

export type ReportKpiKey =
  | 'total' | 'rgp' | 'nrgp' | 'completed' | 'pending' | 'in_progress' | 'cancelled';

export interface ReportKpi {
  key: ReportKpiKey;
  label: string;
  glyph: HodGlyph;
  tone: HodTone;
  value: number;
}

/**
 * The mock's cards, in its own order. Cancelled was pulled from the dashboard
 * (client, 2026-08-23) — `reportStatusOf`/`REPORT_STATUS_LABELS` keep the
 * bucket for the table's row pill and the Status filter; only this card list
 * dropped it.
 *
 * NO CARD CARRIES A SECOND LINE (client, 2026-08-23: "remove the subtext like
 * 'vs yesterday' from all the dashboard cards ... vs last 30 days"). The
 * mock's "↑ 12% vs last 23 days" comparison and the "% of total" share line are
 * both DELETED — the `note`/`trend` fields, the `delta` and `share` helpers and
 * the previous-window read that fed them, so a stale reference is a build error.
 * It is the same call the admin Overview made on 2026-08-19.
 */
export function buildReportKpis(rows: GatePassView[]): ReportKpi[] {
  const count = (set: GatePassView[], s: ReportStatus) =>
    set.filter((p) => reportStatusOf(p) === s).length;
  const rgp = rows.filter((p) => p.type === 'RGP').length;
  const nrgp = rows.filter((p) => p.type === 'NRGP').length;

  return [
    { key: 'total', label: 'Total Passes', glyph: 'document', tone: 'blue', value: rows.length },
    { key: 'rgp', label: 'RGP Passes', glyph: 'exchange', tone: 'green', value: rgp },
    { key: 'nrgp', label: 'NRGP Passes', glyph: 'send', tone: 'orange', value: nrgp },
    { key: 'completed', label: 'Completed', glyph: 'check', tone: 'purple', value: count(rows, 'completed') },
    { key: 'pending', label: REPORT_STATUS_LABELS.pending, glyph: 'clock', tone: 'orange', value: count(rows, 'pending') },
    { key: 'in_progress', label: REPORT_STATUS_LABELS.in_progress, glyph: 'exchange', tone: 'blue', value: count(rows, 'in_progress') },
  ];
}

// ─── Cells ───────────────────────────────────────────────────────────────────

/** The mock's "Purpose / Description" column. The pass's own purpose is what was
 *  authorised; the material summary is the fallback, because a pass raised
 *  before the purpose field existed would otherwise print an empty column. */
export function purposeText(p: Pick<GatePassView, 'purpose' | 'material_summary'>): string {
  return (p.purpose ?? '').trim() || (p.material_summary ?? '').trim() || '—';
}

/** "6 Items" / "1 Item" — a count, not a list. */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'Item' : 'Items'}`;
}

/** An unpriced pass is a dash, never ₹0 — "nothing was declared" is a different
 *  claim from "this is worth nothing" (see formatCurrency's own note). */
export function valueText(total: number | null | undefined): string {
  return total != null && total > 0 ? formatCurrency(total) : '—';
}

/** The export is this table, in a file. `Value of Items` and `Raised By
 *  Department` are columns of both (client, 2026-08-20). A blank cell, never the
 *  dash the screen shows — a dash breaks SUM on the value column. */
export const REPORT_CSV_COLUMNS: CsvColumn<GatePassView>[] = [
  { key: 'pass_number', header: 'Pass Number' },
  { key: 'created_at', header: 'Creation Date', format: (p) => csvDate(p.created_at) },
  { key: 'type', header: 'Pass Type', format: csvCategory },
  { key: 'purpose', header: 'Purpose / Description', format: (p) => csvText(p.purpose ?? p.material_summary) },
  { key: 'item_count', header: 'Total Number of Items' },
  { key: 'total_value', header: 'Total Value of Items', format: (p) => (p.total_value > 0 ? String(Math.round(p.total_value)) : '') },
  { key: 'department_name', header: 'Raised By Department', format: (p) => csvText(p.department_name) },
  { key: 'status', header: 'Status', format: (p) => reportStatusLabel(p) },
  { key: 'raised_by_name', header: 'Created By', format: (p) => csvText(p.raised_by_name) },
];

/** Kept under its old name so `tests/unit/csvExport.test.ts` and any future
 *  export audit still walk this column set — it IS the all-passes export. */
export const ALL_PASSES_CSV_COLUMNS = REPORT_CSV_COLUMNS;

/**
 * The register's CSV columns for a reader who does not get the two people/
 * department columns (2026-08-20 — the HOD's own Reports tab: "remove the
 * Department and Raised By columns for an individual HOD, both from the
 * column header and from the filter section"). An HOD's report is already
 * scoped to their own department by RLS (`gate_passes_select`, migration 046)
 * and to themself as the only raiser it could ever contain in most cases —
 * printing a column that can answer only one way is not information, and
 * naming the OTHER department a mis-provisioned account could see would be
 * worse than useless. `REPORT_CSV_COLUMNS` itself is untouched — the admin's
 * export, and `tests/unit/csvExport.test.ts`, still walk the full set.
 */
export function reportCsvColumns(showPeople: boolean): CsvColumn<GatePassView>[] {
  if (showPeople) return REPORT_CSV_COLUMNS;
  return REPORT_CSV_COLUMNS.filter(
    (c) => c.header !== 'Raised By Department' && c.header !== 'Created By',
  );
}

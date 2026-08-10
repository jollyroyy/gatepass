// ============================================================
// Gate Pass System — all shared types.
//
// IMPORTANT: this app spans TWO Postgres schemas in one Supabase project:
//   - `public`   — SHARED WITH THE VMS PROJECT. profiles, departments, auth.
//                  Read-mostly. Never alter its shape from here.
//   - `gatepass` — owned by this app. gate_passes, verifications, hod_departments.
// ============================================================

// ─── Roles ──────────────────────────────────────────────────────────────────
// The enum lives in VMS's `public.user_role` and is shared. We do not add to it.
// This app only cares about three of its five values:
//   guard → security console · hod → raise passes · admin/super_admin → admin
export type UserRole = 'guard' | 'hod' | 'staff' | 'admin' | 'super_admin';

/** Roles that may use this app at all. `staff` is intentionally excluded. */
export const APP_ROLES = ['guard', 'hod', 'admin', 'super_admin'] as const;

export function hasAppAccess(role: UserRole | null): boolean {
  return role !== null && (APP_ROLES as readonly string[]).includes(role);
}

export function isAdmin(role: UserRole | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

// ─── Gate pass enums (mirror gatepass.* Postgres enums exactly) ─────────────
/**
 * Two types only. IGP/OGP were retired in migration 010 because they conflated
 * two independent facts — OGP and NRGP meant exactly the same thing, and there
 * was no way to express inward-returnable at all.
 *
 *   type      = does it come back?   RGP | NRGP
 *   direction = which way is it going?   in | out
 */
export type PassType = 'RGP' | 'NRGP';
export type PassDirection = 'in' | 'out';

/** `held` (migration 014) is the guard's third answer at the gate: material
 *  stopped, nothing released and nothing alleged. Unlike matched/flagged it is
 *  NOT terminal — `match_pass` and `flag_pass` both accept a held pass. */
export type PassStatus = 'pending' | 'held' | 'matched' | 'flagged' | 'hod_reviewed' | 'cancelled';

/** `partially_returned` (migration 013) exists because returns became per-line.
 *  It still counts as an outstanding obligation — `kpis()` includes it in
 *  `awaitingReturn`, and it keeps a pass in the overdue reckoning. */
export type ReturnStatus =
  | 'not_applicable'
  | 'awaiting_return'
  | 'partially_returned'
  | 'returned';

export type VerifyAction = 'matched' | 'flagged' | 'held' | 'returned' | 'cancelled' | 'hod_reviewed';

/** Due-date urgency, computed in `gatepass.v_gate_passes` and nowhere else.
 *  `is_overdue` remains the binary form of the same fact; this is the graded
 *  one, so a pass can be warned about the day BEFORE it goes overdue. */
export type DueState = 'not_applicable' | 'ok' | 'due_soon' | 'due_today' | 'overdue';

/**
 * Outcomes of `gatepass.lookup_pass()` — one scan attempt at the gate.
 *
 * The RPC RETURNS these rather than raising, because every one of them is a
 * normal thing to happen at a gate and the guard needs to see which. Only
 * `ok` proceeds to verification; the rest are dead ends with distinct messages.
 */
export type ScanOutcome =
  | 'ok'
  | 'not_found'
  | 'expired'
  | 'cancelled'
  | 'already_matched'
  | 'already_flagged';

// ─── public schema (shared with VMS) ───────────────────────────────────────
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department_id: string | null;
  avatar_url?: string | null;
  created_at: string;
  /** Migration 036: set by an admin password reset, cleared only by set_my_password. */
  must_change_password?: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

// ─── gatepass schema (owned by this app) ───────────────────────────────────

/** Which departments an HOD is responsible for. Many-to-many on purpose: the
 *  brief needs one HOD across 2-3 departments, and the shared DB already has
 *  two HODs per department. A join table is the only shape that holds both. */
export interface HodDepartment {
  hod_id: string;
  department_id: string;
  created_at: string;
}

export interface GatePass {
  id: string;
  pass_number: string;
  type: PassType;
  /** Server-enforced: NRGP is always 'out' (gate_passes_nrgp_is_outward). */
  direction: PassDirection;
  status: PassStatus;

  department_id: string;
  raised_by: string;

  // Fields the guard physically checks against the visitor and material.
  //
  // NOTE: material_description / quantity / unit are GONE as of migration 013.
  // A pass carries many material lines now, in gatepass.gate_pass_items — one
  // trolley with a drill, two ladders and a coil of cable is one pass, not
  // three. Read the lines from `GatePassItem[]`, or the `material_summary`
  // roll-up on GatePassView for list rows.
  visitor_name: string;
  visitor_company: string | null;
  vehicle_number: string | null;
  purpose: string;

  // RGP only
  expected_return_date: string | null;
  return_status: ReturnStatus;
  actual_return_date: string | null;

  // Set by security on match / flag
  verified_by: string | null;
  verified_at: string | null;
  flag_reason: string | null;

  /** What the QR code encodes. Opaque and random — never derive it from
   *  `pass_number`, which is sequential and therefore guessable. */
  qr_token: string;

  /** End of the day after it was raised, in the site's timezone. After this the
   *  pass can still be FLAGGED but no longer MATCHED. */
  expires_at: string;

  created_at: string;
  updated_at: string;
}

/** One material line — `gatepass.gate_pass_items` (migration 013).
 *
 *  Written ONLY by `raise_pass`; `returned_qty` moves ONLY through
 *  `apply_item_returns` / `mark_returned`. No client holds INSERT or UPDATE on
 *  this table, for the same reason none holds them on `gate_passes`: a client
 *  that can set `returned_qty` directly can un-return material.
 *
 *  `department_id` and `is_open` are trigger-maintained copies of parent state.
 *  They exist so the "one open pass per material per department" unique index
 *  can be expressed at all — a unique index cannot join to the parent. Treat
 *  them as read-only; never send them. */
export interface GatePassItem {
  id: string;
  gate_pass_id: string;
  line_no: number;
  /** Short name of the thing (e.g. "Drill Machine"). */
  name: string;
  /** Detailed description (e.g. "Bosch GSB 13mm Impact Drill"). */
  description: string;
  /** Individual reason for taking this item out. */
  purpose: string;
  /** Per-item expected return date. */
  expected_return_date: string | null;
  quantity: number;
  unit: string;
  serial_no: string | null;
  approx_value: number | null;
  returned_qty: number;
  /** When THIS line was fully returned (migration 029). Null while any quantity
   *  is still outstanding — including a partially-returned line, which still
   *  owes material and must not read as "came back". Written only by
   *  `apply_item_returns`, never overwritten. */
  returned_at: string | null;
  department_id: string;
  is_open: boolean;
  created_at: string;
}

/** `gatepass.v_gate_pass_items` — a line plus its parent's identity. */
export interface GatePassItemView extends GatePassItem {
  outstanding_qty: number;
  pass_number: string;
  pass_status: PassStatus;
  return_status: ReturnStatus;
}

/** `gatepass.v_gate_passes` — the table plus derived fields. Every list and KPI
 *  query reads this view so `is_overdue`, `is_expired` and `due_state` each
 *  have exactly one definition. Never recompute any of them in TypeScript: a
 *  screen that disagrees with `match_pass` about expiry is a guard arguing with
 *  a driver. */
export interface GatePassView extends GatePass {
  is_overdue: boolean;
  is_expired: boolean;
  due_state: DueState;

  /** When security first flagged this pass (migration 035 — from
   *  `verifications`, not `verified_at`, which the LATEST verification
   *  overwrites). Null on a pass that was never flagged. Cards use it to show
   *  the "Raised → Mismatch → HOD override" timeline. */
  flagged_at: string | null;
  /** When the raising HOD override-approved this pass (035). Null until the
   *  HOD acts. */
  hod_reviewed_at: string | null;

  /** Item roll-ups, computed in the view so a list row needs no second query. */
  item_count: number;
  total_quantity: number;
  returned_quantity: number;
  /** Line descriptions joined with ", " — for list rows, search and CSV. The
   *  detail and print screens read the real rows instead. */
  material_summary: string | null;
  /** Sum of the lines' `approx_value` (migration 038). Defined in the view and
   *  nowhere else — never re-sum item rows in TypeScript, or a card and the
   *  overdue KPI (016's `overdue_value`, summed the same way) can disagree.
   *  0 when no line declared a value: approx_value is optional and approximate,
   *  so "nothing declared" and "declared zero" are deliberately the same here. */
  total_value: number;

  department_name: string;
  department_code: string;
  raised_by_name: string;
  verified_by_name: string | null;
}

/** One row of `gatepass.lookup_pass()`. `pass_id` is null when `outcome` is
 *  `not_found` — there was nothing to point at. `blacklist_match` carries the
 *  blacklist reason text when the pass's company or vehicle is blacklisted. */
export interface ScanResult {
  outcome: ScanOutcome;
  pass_id: string | null;
  blacklist_match: string | null;
}

/** `gatepass.scan_attempts` — every scan, including the failures.
 *  `gatepass.verifications` records what succeeded; this records what was tried.
 *  `blacklist_note` records why a scan triggered a blacklist warning. */
export interface ScanAttempt {
  id: string;
  scanned_code: string;
  gate_pass_id: string | null;
  scanned_by: string;
  outcome: ScanOutcome;
  blacklist_note: string | null;
  created_at: string;
}

/** What the guard ticked before releasing material (migration 014). Stored so
 *  "the guard says they checked the serial" becomes a record rather than a
 *  claim. The UI gates the Match button on these; this is the audit copy. */
export interface VerificationChecks {
  carrier: boolean;
  paperwork: boolean;
  lines: Record<string, { item: boolean; qty: boolean; serial: boolean }>;
}

/** Per-line breakdown of what was actually counted. Audit evidence only — the
 *  authoritative per-line state is `GatePassItem.returned_qty`. */
export interface VerificationLineDetail {
  item_id: string;
  description: string;
  declared_qty: number;
  verified_qty: number;
}

export interface Verification {
  id: string;
  gate_pass_id: string;
  action: VerifyAction;
  security_user_id: string;
  /** The TOTAL counted across every line. Per-line figures are in line_details. */
  verified_quantity: number | null;
  verified_vehicle: string | null;
  remarks: string | null;
  /** Which entrance. A mall has more than one, and "signed off at 23:40" is a
   *  different fact at the loading bay than at the basement ramp. */
  gate_name: string | null;
  device_info: Record<string, unknown> | null;
  line_details: VerificationLineDetail[] | null;
  checks: VerificationChecks | null;
  created_at: string;
}

// ─── Form payloads ─────────────────────────────────────────────────────────

/** One row of the Raise Pass item repeater. Numbers stay as strings while the
 * user is typing — an <input type="number"> mid-edit is legitimately "" or
 * "1." and coercing early turns that into NaN. Parsed once, on submit. */
export interface NewGatePassItem {
  name: string;
  description: string;
  purpose: string;
  expected_return_date: string;
  quantity: string;
  unit: string;
  approx_value: string;
}

export const EMPTY_ITEM: NewGatePassItem = {
  name: '',
  description: '',
  purpose: '',
  expected_return_date: '',
  quantity: '1',
  unit: 'nos',
  approx_value: '',
};

export interface NewGatePass {
  type: PassType;
  direction: PassDirection;
  department_id: string;
  visitor_name: string;
  visitor_phone: string;
  visitor_company: string;
  company_address: string;
  vehicle_number: string;
  purpose: string;
  expected_return_date: string;
  items: NewGatePassItem[];
}

// ─── KPI shape shared by the HOD and admin dashboards ──────────────────────
export interface PassKpis {
  total: number;
  pending: number;
  matched: number;
  flagged: number;
  awaitingReturn: number;
  overdue: number;
  raisedToday: number;
  overdueValue: number;
  flaggedRate: number;
  returnRate: number;
}

export const EMPTY_KPIS: PassKpis = {
  total: 0,
  pending: 0,
  matched: 0,
  flagged: 0,
  awaitingReturn: 0,
  overdue: 0,
  raisedToday: 0,
  overdueValue: 0,
  flaggedRate: 0,
  returnRate: 0,
};

// ─── Vendor profiles ──────────────────────────────────────────────────────
export interface VendorProfile {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  vehicle_number: string | null;
  typical_material: string | null;
  department_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Blacklist ────────────────────────────────────────────────────────────
export type BlacklistType = 'company' | 'vehicle' | 'driver';

export interface BlacklistEntry {
  id: string;
  list_type: BlacklistType;
  list_value: string;
  reason: string;
  blocked_by: string;
  created_at: string;
}

export interface BlacklistMatch {
  list_type: BlacklistType;
  list_value: string;
  reason: string;
}

// ─── Bulk create result ───────────────────────────────────────────────────
export interface BulkCreateResult {
  pass_id: string;
  pass_number: string;
}

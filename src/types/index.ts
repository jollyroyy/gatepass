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
export const USER_ROLES = ['guard', 'hod', 'staff', 'admin', 'super_admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

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
  | 'already_flagged'
  /** Migration 046: the pass is real, but it has not finished climbing the
   *  approval ladder, so RLS hides it from the gate. `lookup_pass` deliberately
   *  returns no `pass_id` with this one — the record is the very thing a guard
   *  may not read — and saying 'not_found' instead would send them hunting for
   *  a typo when the answer is "tell the driver to wait". */
  | 'awaiting_approval';

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
  /**
   * Migration 040: `gatepass.user_status.is_active`, coalesced to true when the
   * person has no row (which is every account nobody has ever suspended).
   *
   * This is the RAW flag, not "can this person use the app" — a `staff` row is
   * flagged active and still reaches nothing. Ask `isAccountActive(role, flag)`
   * in src/lib/userStatus.ts; never read this field alone.
   */
  is_active?: boolean;
  /** Migration 040: when the suspension was recorded. Null while active. */
  deactivated_at?: string | null;
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
  /** Make / Model / Size (migration 045) — the raise mock-up's own column, kept
   *  apart from `description` because `description` is what
   *  `normalize_material` keys the one-open-line-per-material index on. Null on
   *  every line raised before 045. */
  make_model: string | null;
  /** Invoice / Reference No. (045) — the paper the material came in on. */
  invoice_no: string | null;
  /** Free remarks for the line (045). NOT `description`, which is the material
   *  itself and is NOT NULL. */
  remarks: string | null;
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
/** A department the signed-in HOD may raise a pass for. Shared by RaisePass and
 *  its Pass Details section, which draws the department the client asked to see
 *  on the pass rather than only implied by the account. */
export interface DeptOption {
  id: string;
  name: string;
  code: string;
}

/** One line of the raise form's "Item-wise Details" table, drawn to the client's
 *  mock-up (2026-08-19).
 *
 *  WHAT IS NOT HERE, and why. The mock's table has six data columns, and three
 *  fields the old grid collected are absent from all of them:
 *
 *   * `purpose` — asked ONCE now, for the whole pass. `raise_pass` (045) falls
 *     back to the pass purpose for every line, so a record screen still prints a
 *     real reason.
 *   * `unit` — IS BACK, as a dropdown (client, 2026-08-20: "add unit field as
 *     dropdown to select different types of unit while raising the nrgp/rgp
 *     passes"). It was dropped with the 2026-08-19 mock's UOM column, which
 *     meant material counted in bags, drums, kg or litres could not be raised in
 *     its own unit at all. It is the field `isWholeUnit` consults, so it also
 *     decides whether the quantity beside it may carry a fraction.
 *   * `approx_value` — no column on the mock, so no new pass carries a value and
 *     "Total Value" reads "—" on every card and record from here on.
 */
export interface NewGatePassItem {
  /** "Item Description" — the ONE name field on the mock. Written to both
   *  `name` and `description`; the latter is what the open-material index keys
   *  on, so it must be the material itself and nothing else. */
  name: string;
  /** "Make / Model / Size" — required by the form, nullable in the column. */
  make_model: string;
  /** "Serial / Asset Tag" — client, 2026-08-19: "put the serial number against
   *  all the items, in both the passes." */
  serial_no: string;
  /** "Invoice / Reference No." */
  invoice_no: string;
  /** "Remarks" */
  remarks: string;
  quantity: string;
  /** "Unit" — one of `UNIT_OPTIONS` (src/lib/units.ts). Defaults to `nos`, which
   *  is what every line raised between 2026-08-19 and 2026-08-20 carries; the
   *  guard reads it back through the same `unitLabel`, read-only. */
  unit: string;
  /** "Expected Return Date" — client, 2026-08-19: "we would expect a date of
   *  return against each item in the RGP form." Empty on an NRGP, which never
   *  comes back. The PASS's own `expected_return_date` — the column
   *  `v_gate_passes` grades `is_overdue` / `due_state` from — is the EARLIEST of
   *  these, computed at submit (`earliestReturnDate`), so there is one place to
   *  type a date and the pass is due back when its first line is. */
  expected_return_date: string;
}

export const EMPTY_ITEM: NewGatePassItem = {
  name: '',
  make_model: '',
  serial_no: '',
  invoice_no: '',
  remarks: '',
  quantity: '',
  unit: 'nos',
  expected_return_date: '',
};

export interface NewGatePass {
  type: PassType;
  direction: PassDirection;
  department_id: string;
  /** "Person Who Will Carry" on the mock. */
  visitor_name: string;
  /** Mobile number, dial code included — packed into `visitor_company`'s `v`. */
  visitor_phone: string;
  visitor_company: string;
  company_address: string;
  vehicle_number: string;
  /** "Purpose / Description" — ONE reason for the whole pass, max 500 chars. */
  purpose: string;
  /** NO PASS-LEVEL RETURN DATE. It is derived from the item dates at submit —
   *  see `NewGatePassItem.expected_return_date`. The field was here until
   *  2026-08-19; it is deleted rather than left unused so a form that still
   *  writes one is a type error, not a second date silently disagreeing with
   *  the lines. */
  items: NewGatePassItem[];
}

// ─── Vendor profiles ──────────────────────────────────────────────────────
export interface VendorProfile {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  vehicle_number: string | null;
  typical_material: string | null;
  /** Migration 045 — what the mock's "Vendor Address (Auto-filled)" reads. */
  address: string | null;
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

// ─── Whitelist requests (039) ─────────────────────────────────────────────
// An admin cannot take a vendor off the blacklist. They REQUEST it, with a
// mandatory justification, and the designated CEO approves or rejects. The
// entry stays enforced until approval, and approval is what deletes it.
export type WhitelistRequestStatus = 'pending' | 'approved' | 'rejected';

export interface WhitelistRequest {
  id: string;
  /** Null once approved — the entry it referred to has been deleted. */
  blacklist_id: string | null;
  /** Snapshot taken at request time, so the record survives that deletion. */
  list_type: BlacklistType;
  list_value: string;
  blocked_reason: string;
  justification: string;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  status: WhitelistRequestStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface CeoApprover {
  user_id: string;
  full_name: string | null;
  designated_at: string;
}

// ─── Bulk create result ───────────────────────────────────────────────────
export interface BulkCreateResult {
  pass_id: string;
  pass_number: string;
}

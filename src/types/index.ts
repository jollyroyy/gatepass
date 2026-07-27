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
export type PassStatus = 'pending' | 'matched' | 'flagged' | 'cancelled';
export type ReturnStatus = 'not_applicable' | 'awaiting_return' | 'returned';
export type VerifyAction = 'matched' | 'flagged' | 'returned' | 'cancelled';

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
  created_at: string;
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

  // Fields the guard physically checks against the visitor and material
  visitor_name: string;
  visitor_company: string | null;
  material_description: string;
  quantity: number;
  unit: string;
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

  /** Why the raising HOD voided it. Set only by `gatepass.cancel_pass`. */
  cancel_reason: string | null;

  /** What the QR code encodes. Opaque and random — never derive it from
   *  `pass_number`, which is sequential and therefore guessable. */
  qr_token: string;

  /** End of the day after it was raised, in the site's timezone. After this the
   *  pass can still be FLAGGED but no longer MATCHED. */
  expires_at: string;

  created_at: string;
  updated_at: string;
}

/** `gatepass.v_gate_passes` — the table plus derived fields. Every list and KPI
 *  query reads this view so `is_overdue` and `is_expired` each have exactly one
 *  definition. Never recompute either of them in TypeScript: a screen that
 *  disagrees with `match_pass` about expiry is a guard arguing with a driver. */
export interface GatePassView extends GatePass {
  is_overdue: boolean;
  is_expired: boolean;
  department_name: string;
  department_code: string;
  raised_by_name: string;
  verified_by_name: string | null;
}

/** One row of `gatepass.lookup_pass()`. `pass_id` is null when `outcome` is
 *  `not_found` — there was nothing to point at. */
export interface ScanResult {
  outcome: ScanOutcome;
  pass_id: string | null;
}

/** `gatepass.scan_attempts` — every scan, including the failures.
 *  `gatepass.verifications` records what succeeded; this records what was tried. */
export interface ScanAttempt {
  id: string;
  scanned_code: string;
  gate_pass_id: string | null;
  scanned_by: string;
  outcome: ScanOutcome;
  created_at: string;
}

export interface Verification {
  id: string;
  gate_pass_id: string;
  action: VerifyAction;
  security_user_id: string;
  verified_quantity: number | null;
  verified_vehicle: string | null;
  remarks: string | null;
  created_at: string;
}

// ─── Form payloads ─────────────────────────────────────────────────────────
export interface NewGatePass {
  type: PassType;
  direction: PassDirection;
  department_id: string;
  visitor_name: string;
  visitor_company: string;
  material_description: string;
  quantity: string; // kept as string in the form; parsed on submit
  unit: string;
  vehicle_number: string;
  purpose: string;
  expected_return_date: string;
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
}

export const EMPTY_KPIS: PassKpis = {
  total: 0,
  pending: 0,
  matched: 0,
  flagged: 0,
  awaitingReturn: 0,
  overdue: 0,
  raisedToday: 0,
};

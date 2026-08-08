/**
 * Indian vehicle registration numbers — the shape `BlacklistTab` and the
 * database (`gatepass.is_indian_vehicle`, migration 033) both enforce, so
 * they must agree. Mirrors the SQL exactly:
 *
 *   standard  WB 09 AB 1234  → WB09AB1234  ([A-Z]{2} [0-9]{1,2} [A-Z]{1,3} [0-9]{4})
 *   Bharat    22 BH 1234 XY  → 22BH1234XY  ([0-9]{2} BH [0-9]{4} [A-Z]{2})
 */

export const INDIAN_VEHICLE_EXAMPLE = 'WB 09 AB 1234';
export const INDIAN_VEHICLE_HINT =
  'Indian registration number — e.g. WB 09 AB 1234 or 22 BH 1234 XY.';

/** Upper-cases, strips everything but letters and digits, and zero-pads a
 *  single-digit district: `wb 9 ab 1234` → `WB09AB1234`. Mirrors
 *  gatepass.normalize_vehicle (migration 033) exactly — a plate must match
 *  its own blacklist entry however it was typed. */
export function normalizeVehicleNo(raw: string): string {
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n.replace(/^([A-Z]{2})(\d)([A-Z])/, (_m, state, digit, series) => `${state}0${digit}${series}`);
}

export function isValidIndianVehicleNo(raw: string): boolean {
  const n = normalizeVehicleNo(raw);
  if (!n) return false;
  return /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(n) || /^\d{2}BH\d{4}[A-Z]{2}$/.test(n);
}
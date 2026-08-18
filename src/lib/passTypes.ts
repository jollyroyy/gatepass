import type { PassDirection, PassType } from '../types';

export interface PassTypeInfo {
  code: PassType;
  label: string;
  description: string;
  returnable: boolean;
}

export const PASS_TYPES: Record<PassType, PassTypeInfo> = {
  RGP: {
    code: 'RGP',
    label: 'Returnable Gate Pass',
    description: 'Material that must come back — repair, calibration, demo, contractor tools.',
    returnable: true,
  },
  NRGP: {
    code: 'NRGP',
    label: 'Non-Returnable Gate Pass',
    description: 'Material leaving permanently — scrap, sale, disposal, transfer.',
    returnable: false,
  },
};

export const PASS_TYPE_LIST: PassType[] = ['RGP', 'NRGP'];

// A category is type + direction — the axis a guard actually picks at the gate.
// Exactly three combinations are legal, enforced by check constraints in
// migration 010, not by this file: RGP-out, RGP-in, NRGP-out.
//
// There is deliberately no NRGP-in. Permanently INBOUND material is a goods
// receipt, not a gate pass: the gate never had custody, so the gate log must not
// claim it did (`gate_passes_nrgp_is_outward`).
export type PassCategoryKey = 'RGP-out' | 'RGP-in' | 'NRGP-out';

export interface PassCategory {
  key: PassCategoryKey;
  type: PassType;
  direction: PassDirection;
  label: string;
  description: string;
}

export const PASS_CATEGORIES: Record<PassCategoryKey, PassCategory> = {
  'RGP-out': {
    key: 'RGP-out',
    type: 'RGP',
    direction: 'out',
    label: 'RGP Out',
    description: 'Our material leaving, and it must come back.',
  },
  'RGP-in': {
    key: 'RGP-in',
    type: 'RGP',
    direction: 'in',
    label: 'RGP In',
    description: "Someone else's material coming in, and it must leave again — contractor tools, hired equipment.",
  },
  'NRGP-out': {
    key: 'NRGP-out',
    type: 'NRGP',
    direction: 'out',
    // Labelled 'NRGP' with no direction, everywhere it is shown (client,
    // 2026-08-18): NRGP is outward-only by constraint, so "Out" adds nothing
    // and no KPI on either board says it. The KEY keeps the direction — it
    // mirrors `gate_passes_nrgp_is_outward` and the pass_number prefix.
    label: 'NRGP',
    description: 'Material leaving for good. Nothing to track afterwards.',
  },
};

export const PASS_CATEGORY_LIST: PassCategoryKey[] = ['RGP-out', 'RGP-in', 'NRGP-out'];

/** Direct lookup, never string concatenation into the key type. `NRGP-in` is
 *  unrepresentable, so an inbound NRGP — which no constraint permits — still
 *  resolves to a real bucket rather than an undefined map entry. */
export function categoryKey(type: PassType, direction: PassDirection): PassCategoryKey {
  if (type === 'NRGP') return 'NRGP-out';
  return direction === 'in' ? 'RGP-in' : 'RGP-out';
}

export function categoryFor(type: PassType, direction: PassDirection): PassCategory {
  return PASS_CATEGORIES[categoryKey(type, direction)];
}

export function requiresReturnDate(t: PassType): boolean {
  return t === 'RGP';
}

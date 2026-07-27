import type { PassType, PassDirection } from '../types';

export interface PassTypeInfo {
  code: PassType;
  label: string;
  description: string;
  returnable: boolean;
  /** Which directions this type may be raised in. NRGP is outward-only. */
  directions: PassDirection[];
}

/**
 * Direct lookup — never derive pass-type metadata from string matching.
 *
 * `direction` used to live here as a fixed property, because the old IGP/OGP/RGP/
 * NRGP set baked direction into the type. Migration 010 split them: direction is
 * now a column the HOD chooses, so it is no longer a property of the type — only
 * the *permitted* directions are.
 */
export const PASS_TYPES: Record<PassType, PassTypeInfo> = {
  RGP: {
    code: 'RGP',
    label: 'Returnable Gate Pass',
    description: 'Material that must come back — repair, calibration, demo, contractor tools.',
    returnable: true,
    directions: ['out', 'in'],
  },
  NRGP: {
    code: 'NRGP',
    label: 'Non-Returnable Gate Pass',
    description: 'Material leaving permanently — scrap, sale, disposal, transfer.',
    returnable: false,
    // Outward only, mirroring the gate_passes_nrgp_is_outward check constraint.
    // Permanently INBOUND material is a goods receipt, not a gate pass: the gate
    // never had custody of it, so the gate log must not claim it did.
    directions: ['out'],
  },
};

export const PASS_TYPE_LIST: PassType[] = ['RGP', 'NRGP'];

export const PASS_DIRECTIONS: Record<PassDirection, { label: string; short: string; arrow: string }> = {
  in: { label: 'Inward — coming in', short: 'IN', arrow: '→' },
  out: { label: 'Outward — going out', short: 'OUT', arrow: '←' },
};

/**
 * The three combinations the database actually permits. Anything outside this
 * list is rejected by a check constraint, so this is not a UI convenience — it
 * is the full set of legal passes.
 *
 * Used for the gate console filter, where a guard thinks in whole categories
 * ("show me what is coming in on a returnable") rather than in two dimensions.
 */
export type PassCategoryKey = 'RGP-out' | 'RGP-in' | 'NRGP-out';

export interface PassCategory {
  key: PassCategoryKey;
  type: PassType;
  direction: PassDirection;
  /** Short label for chips and filter buttons. */
  label: string;
  /** What a guard should physically expect. */
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
    description: "Someone else's material coming in, and it must go back out.",
  },
  'NRGP-out': {
    key: 'NRGP-out',
    type: 'NRGP',
    direction: 'out',
    label: 'NRGP Out',
    description: 'Material leaving for good. Nothing to track afterwards.',
  },
};

export const PASS_CATEGORY_LIST: PassCategoryKey[] = ['RGP-out', 'RGP-in', 'NRGP-out'];

/** Composite key for a pass. Total, because the DB permits no other combination. */
export function categoryKey(type: PassType, direction: PassDirection): PassCategoryKey {
  return `${type}-${direction}` as PassCategoryKey;
}

export function categoryFor(type: PassType, direction: PassDirection): PassCategory {
  return PASS_CATEGORIES[categoryKey(type, direction)];
}

export function requiresReturnDate(t: PassType): boolean {
  return PASS_TYPES[t].returnable;
}

/** Directions selectable for a type. Selecting NRGP must snap direction to 'out'. */
export function allowedDirections(t: PassType): PassDirection[] {
  return PASS_TYPES[t].directions;
}

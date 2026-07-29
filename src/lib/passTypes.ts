import type { PassType } from '../types';

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

export type PassCategoryKey = 'RGP-out' | 'NRGP-out';

export interface PassCategory {
  key: PassCategoryKey;
  type: PassType;
  label: string;
  description: string;
}

export const PASS_CATEGORIES: Record<PassCategoryKey, PassCategory> = {
  'RGP-out': {
    key: 'RGP-out',
    type: 'RGP',
    label: 'RGP Out',
    description: 'Our material leaving, and it must come back.',
  },
  'NRGP-out': {
    key: 'NRGP-out',
    type: 'NRGP',
    label: 'NRGP Out',
    description: 'Material leaving for good. Nothing to track afterwards.',
  },
};

export const PASS_CATEGORY_LIST: PassCategoryKey[] = ['RGP-out', 'NRGP-out'];

export function categoryKey(type: PassType): PassCategoryKey {
  return `${type}-out` as PassCategoryKey;
}

export function categoryFor(type: PassType): PassCategory {
  return PASS_CATEGORIES[categoryKey(type)];
}

export function requiresReturnDate(t: PassType): boolean {
  return t === 'RGP';
}

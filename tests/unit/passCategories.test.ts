// The gate console filters by CATEGORY (type + direction), not by type. Three
// combinations are legal and enforced by check constraints in migration 010:
// RGP-out, RGP-in, NRGP-out. NRGP-in is not a gate pass at all — permanently
// inbound material is a goods receipt, and the gate never had custody.
//
// `categoryKey` used to take only the type and hardcode `-out`, so an RGP-in
// pass — which Bulk Create can already produce, its direction select allows
// "In" for RGP — was filed under "RGP Out" and could not be filtered for.
import { describe, it, expect } from 'vitest';
import {
  PASS_CATEGORIES,
  PASS_CATEGORY_LIST,
  categoryFor,
  categoryKey,
} from '../../src/lib/passTypes';

describe('pass categories', () => {
  it('offers exactly the three legal combinations, outward first', () => {
    expect(PASS_CATEGORY_LIST).toEqual(['RGP-out', 'RGP-in', 'NRGP-out']);
  });

  it('never offers NRGP-in — that would be a goods receipt, not a gate pass', () => {
    expect(PASS_CATEGORY_LIST).not.toContain('NRGP-in');
    expect(Object.keys(PASS_CATEGORIES)).not.toContain('NRGP-in');
  });

  it('keys off direction, not just type', () => {
    expect(categoryKey('RGP', 'out')).toBe('RGP-out');
    expect(categoryKey('RGP', 'in')).toBe('RGP-in');
    expect(categoryKey('NRGP', 'out')).toBe('NRGP-out');
  });

  it('files an inbound NRGP under NRGP-out rather than inventing an illegal key', () => {
    // The constraint makes this row impossible; if one ever appears, it must
    // still land in a real bucket instead of returning undefined from the map.
    expect(categoryKey('NRGP', 'in')).toBe('NRGP-out');
  });

  it('gives every category a distinct label and description', () => {
    const labels = PASS_CATEGORY_LIST.map((k) => PASS_CATEGORIES[k].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const k of PASS_CATEGORY_LIST) {
      expect(PASS_CATEGORIES[k].description.length).toBeGreaterThan(0);
    }
  });

  it('resolves a category object for each direction', () => {
    expect(categoryFor('RGP', 'in').key).toBe('RGP-in');
    expect(categoryFor('RGP', 'in').type).toBe('RGP');
    expect(categoryFor('RGP', 'out').key).toBe('RGP-out');
  });
});

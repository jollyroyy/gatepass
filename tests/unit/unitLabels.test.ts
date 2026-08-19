import { describe, it, expect } from 'vitest';
import { unitLabel } from '../../src/lib/units';

describe('unitLabel', () => {
  it('spells out the nos code as Numbers', () => {
    expect(unitLabel('nos')).toBe('Numbers');
  });

  it('capitalises every other known code', () => {
    expect(unitLabel('kg')).toBe('Kg');
    expect(unitLabel('box')).toBe('Box');
    expect(unitLabel('roll')).toBe('Roll');
    expect(unitLabel('litre')).toBe('Litre');
    expect(unitLabel('metre')).toBe('Metre');
    expect(unitLabel('set')).toBe('Set');
  });

  // From the client's Pending RGP Return mock-up (2026-08-19) — a gate that
  // counts cement in bags and paint in drums cannot record either as a count.
  it('carries the unit vocabulary the clients mock-up uses', () => {
    expect(unitLabel('bag')).toBe('Bags');
    expect(unitLabel('drum')).toBe('Drums');
    expect(unitLabel('lot')).toBe('Lots');
  });

  it('passes an unknown unit through unchanged', () => {
    expect(unitLabel('pc')).toBe('pc');
  });
});

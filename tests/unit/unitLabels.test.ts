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

  it('passes an unknown unit through unchanged', () => {
    expect(unitLabel('pc')).toBe('pc');
  });
});

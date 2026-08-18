// A unit belongs beside the column name, not in every cell under it
// (client, 2026-08-18). "nos" is never named at all — a count reads as a count.
import { describe, it, expect } from 'vitest';
import { headingUnit, quantityCell, quantityHeading, sharedUnit } from '../../src/lib/units';

describe('quantity heading carries the unit', () => {
  it('names one shared non-default unit in the heading', () => {
    expect(quantityHeading('Quantity', ['kg', 'kg'])).toBe('Quantity (Kg)');
    expect(quantityHeading('Qty', ['litre'])).toBe('Qty (Litre)');
  });

  it('never names nos, in the heading or the cell', () => {
    expect(quantityHeading('Quantity', ['nos', 'nos'])).toBe('Quantity');
    expect(quantityCell(3, 'nos', ['nos'])).toBe('3');
    expect(headingUnit(['nos'])).toBeNull();
  });

  it('leaves the heading bare when the lines disagree', () => {
    expect(quantityHeading('Quantity', ['kg', 'box'])).toBe('Quantity');
    expect(sharedUnit(['kg', 'box'])).toBeNull();
    expect(sharedUnit([])).toBeNull();
  });

  it('drops the unit from the cell once the heading carries it', () => {
    expect(quantityCell(12, 'kg', ['kg', 'kg'])).toBe('12');
  });

  it('keeps the unit in the cell when the heading cannot carry it', () => {
    expect(quantityCell(12, 'kg', ['kg', 'box'])).toBe('12 Kg');
    expect(quantityCell(2, 'nos', ['kg', 'nos'])).toBe('2');
  });
});

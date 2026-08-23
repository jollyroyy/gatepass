// EVERY QUANTITY NAMES ITS OWN UNIT, IN EVERY CELL, ALWAYS (client,
// 2026-08-23: "whatever unit has been selected, you need to show all of them,
// no matter what, no deviation across all the views whenever anybody's trying
// to take the print pass").
//
// This reverses two older rules and the reversal is the point of the file:
//   * `nos` used to print bare — a count of 3 read "3", never "3 Numbers".
//   * a column whose lines all shared one unit printed it in the HEADING
//     ("Quantity (Kg)") and left the cells bare.
// Both hid a unit the HOD had deliberately chosen. `sharedUnit` survives for
// the one place a shared unit still means something — a Total row, which can
// only sum lines that are in the same unit — and `headingUnit` /
// `quantityHeading` are deleted.
import { describe, it, expect } from 'vitest';
import { quantityCell, sharedUnit, unitLabel } from '../../src/lib/units';

describe('every quantity cell carries its unit', () => {
  it('names nos as Numbers, the case the client caught', () => {
    expect(quantityCell(3, 'nos')).toBe('3 Numbers');
    expect(quantityCell(1, 'nos')).toBe('1 Numbers');
  });

  it('names the unit whatever the other lines are in', () => {
    expect(quantityCell(12, 'kg')).toBe('12 Kg');
    expect(quantityCell(2, 'box')).toBe('2 Box');
    expect(quantityCell(800.5, 'litre')).toBe('800.5 Litre');
  });

  it('prints a bare figure only when the line has no unit at all', () => {
    expect(quantityCell(4, null)).toBe('4');
    expect(quantityCell(4, undefined)).toBe('4');
    expect(quantityCell(4, '')).toBe('4');
  });

  it('passes an unknown code through rather than inventing a label', () => {
    expect(quantityCell(5, 'pallet')).toBe('5 pallet');
    expect(unitLabel('pallet')).toBe('pallet');
  });
});

describe('sharedUnit — the one thing a shared unit is still for', () => {
  it('answers with the unit when every line is in it', () => {
    expect(sharedUnit(['kg', 'kg'])).toBe('kg');
    expect(sharedUnit(['nos'])).toBe('nos');
  });

  it('answers null when they disagree or there are none', () => {
    expect(sharedUnit(['kg', 'box'])).toBeNull();
    expect(sharedUnit([])).toBeNull();
    expect(sharedUnit([null, null])).toBeNull();
  });
});

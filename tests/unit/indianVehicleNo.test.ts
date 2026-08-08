// Mirrors gatepass.is_indian_vehicle / normalize_vehicle (migration 033) —
// the client rejects before the RPC does, and a divergence between the two
// would surface as a form that accepts a plate the database then refuses.
import { describe, expect, it } from 'vitest';
import { isValidIndianVehicleNo, normalizeVehicleNo } from '../../src/lib/indianVehicle';

describe('normalizeVehicleNo', () => {
  it('strips spaces, dashes and dots and upper-cases', () => {
    expect(normalizeVehicleNo('wb 09 ab 1234')).toBe('WB09AB1234');
    expect(normalizeVehicleNo('WB-09-AB-1234')).toBe('WB09AB1234');
    expect(normalizeVehicleNo(' wb.09.ab.1234 ')).toBe('WB09AB1234');
    expect(normalizeVehicleNo('22  bh 1234 xy')).toBe('22BH1234XY');
  });

  it('zero-pads a single-digit district so WB 9 and WB 09 are one plate', () => {
    expect(normalizeVehicleNo('WB 9 AB 1234')).toBe('WB09AB1234');
    expect(normalizeVehicleNo('wb-9-ab-1234')).toBe('WB09AB1234');
    expect(normalizeVehicleNo('WB09AB1234')).toBe('WB09AB1234');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeVehicleNo('')).toBe('');
    expect(normalizeVehicleNo('   ')).toBe('');
    expect(normalizeVehicleNo('   ,..   ')).toBe('');
  });
});

describe('isValidIndianVehicleNo', () => {
  const valid = [
    'WB 09 AB 1234',
    'WB09AB1234',
    'wb-09-ab-1234',
    'Wb 9 AB 1234',
    'KL 07 BH 9999',
    'DL 3 C A 5678',
    '22 BH 1234 XY',
    '22BH1234XY',
  ];
  it.each(valid)('accepts the valid plate %j', (plate) => {
    expect(isValidIndianVehicleNo(plate)).toBe(true);
  });

  const invalid = [
    '',
    '   ',
    'thar',
    'Yadav Infotech',
    '12345',
    'WB',
    'WB 09',
    'WXYZ',
    'ABC 1',
    'WB 09 AB',
    'WB09AB12345',
    'WBA9AB1234',
    '99 99 AB 1234',      // state code must be letters
    'WB 999 AB 123',      // district part accepts 1-2 digits, not 3
    'WB 09 ABCD 1234',    // series part accepts 1-3 letters, not 4
    'WB 09 AB 123',       // serial part is exactly four digits
    '1A AA 1234',         // leading letters before a digit series
    '!@#$%^&*(),.',
  ];
  it.each(invalid)('rejects the non-plate %j', (value) => {
    expect(isValidIndianVehicleNo(value)).toBe(false);
  });
});
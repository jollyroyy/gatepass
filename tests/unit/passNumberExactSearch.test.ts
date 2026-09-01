// AN NRGP NUMBER ENDS WITH A WHOLE RGP ONE. `NRGP-IT-0200` contains
// `RGP-IT-0200` as a substring, so every `ilike *term*` / `includes(q)` search
// answered a search for the RGP pass with the NRGP one as well (client,
// 2026-09-01). These are the rules that stop it, everywhere a pass number is
// matched against typed text.
import { describe, expect, it } from 'vitest';
import {
  isPassCodeQuery,
  passNumberMatches,
  passNumberQueryType,
  passTypeOf,
  refinePassResults,
} from '../../src/lib/passTextSearch';

const rgp = { pass_number: 'RGP-IT-0200' };
const nrgp = { pass_number: 'NRGP-IT-0200' };
const rgpOther = { pass_number: 'RGP-IT-0201' };

describe('passTypeOf / passNumberQueryType', () => {
  it('reads the type token at the head of a number', () => {
    expect(passTypeOf('NRGP-IT-0200')).toBe('NRGP');
    expect(passTypeOf('rgp-it-0200')).toBe('RGP');
    expect(passTypeOf('Dell XPS')).toBeNull();
  });

  it('recognises a query that names a type, whole or partial', () => {
    expect(passNumberQueryType('RGP-IT-02')).toBe('RGP');
    expect(passNumberQueryType('nrgp')).toBe('NRGP');
    expect(passNumberQueryType('0200')).toBeNull();
    expect(passNumberQueryType('Dell')).toBeNull();
  });
});

describe('passNumberMatches', () => {
  it('never lets an RGP query match an NRGP pass', () => {
    expect(passNumberMatches('RGP-IT-0200', 'RGP-IT-0200')).toBe(true);
    expect(passNumberMatches('NRGP-IT-0200', 'RGP-IT-0200')).toBe(false);
    expect(passNumberMatches('NRGP-IT-0200', 'NRGP-IT-0200')).toBe(true);
  });

  it('still matches a partial number within its own type', () => {
    expect(passNumberMatches('RGP-IT-0200', 'RGP-IT')).toBe(true);
    expect(passNumberMatches('NRGP-IT-0200', 'RGP-IT')).toBe(false);
  });

  it('leaves a typeless query as a plain contains', () => {
    expect(passNumberMatches('RGP-IT-0200', '0200')).toBe(true);
    expect(passNumberMatches('NRGP-IT-0200', '0200')).toBe(true);
    expect(passNumberMatches('RGP-IT-0200', '')).toBe(true);
  });
});

describe('refinePassResults', () => {
  it('keeps only the exact pass when the query is a whole number', () => {
    expect(refinePassResults([nrgp, rgp, rgpOther], 'RGP-IT-0200')).toEqual([rgp]);
    expect(refinePassResults([nrgp, rgp], 'nrgp-it-0200')).toEqual([nrgp]);
  });

  it('drops the other type when the query only names one', () => {
    expect(refinePassResults([nrgp, rgp, rgpOther], 'RGP-IT-02')).toEqual([rgp, rgpOther]);
  });

  it('leaves a free-text answer alone', () => {
    const rows = [nrgp, rgp];
    expect(refinePassResults(rows, 'Dell')).toEqual(rows);
    expect(refinePassResults(rows, '0200')).toEqual(rows);
  });
});

describe('isPassCodeQuery', () => {
  it('recognises the live TYPE-DEPT-NNNN number (migration 064)', () => {
    expect(isPassCodeQuery('RGP-IT-0200')).toBe(true);
    expect(isPassCodeQuery('NRGP-HK-10000')).toBe(true);
  });

  it('still leaves a partial number and free text to the text search', () => {
    expect(isPassCodeQuery('RGP-IT')).toBe(false);
    expect(isPassCodeQuery('Dell-XPS-13')).toBe(false);
    expect(isPassCodeQuery('Latitude 5440')).toBe(false);
  });
});

// The raise form's mobile field is a dial-code select welded to a number box,
// but the pass stores ONE string — `visitor_company`'s packed `v` — so
// `splitMobile`/`joinMobile` are the join point between the two controls and
// the one stored value. See src/lib/mobileNumber.ts's own header for why the
// parts are not stored separately.
import { describe, it, expect } from 'vitest';
import { DEFAULT_DIAL, DIAL_CODES, joinMobile, splitMobile } from '../../src/lib/mobileNumber';

describe('splitMobile', () => {
  it('splits a recognised dial code and its digits', () => {
    expect(splitMobile('+91 9876543210')).toEqual({ dial: '+91', digits: '9876543210' });
  });

  it('picks the LONGEST matching code — +971 must not be claimed by +91', () => {
    // '+9714445566' starts with '+91' as a plain string, but the real dial
    // code is '+971'. Sorting DIAL_CODES by code length before matching is
    // what stops +91 winning here.
    expect(splitMobile('+9714445566')).toEqual({ dial: '+971', digits: '4445566' });
  });

  it('falls back to the default dial code for an unrecognised prefix, keeping the digits', () => {
    // Every row raised before this form existed has no dial code at all.
    expect(splitMobile('9876543210')).toEqual({ dial: DEFAULT_DIAL, digits: '9876543210' });
  });

  it('returns empty digits and the default dial for an empty or blank value', () => {
    expect(splitMobile('')).toEqual({ dial: DEFAULT_DIAL, digits: '' });
    expect(splitMobile('   ')).toEqual({ dial: DEFAULT_DIAL, digits: '' });
  });

  it('strips non-digit separators out of the digits half', () => {
    expect(splitMobile('+91 98765-43210')).toEqual({ dial: '+91', digits: '9876543210' });
  });

  it('covers every dial code the app offers', () => {
    for (const { code } of DIAL_CODES) {
      expect(splitMobile(`${code} 1234567`).dial).toBe(code);
    }
  });
});

describe('joinMobile', () => {
  it('joins a dial code and digits into one stored string', () => {
    expect(joinMobile('+91', '9876543210')).toBe('+91 9876543210');
  });

  it('strips non-digit characters out of the digits before storing', () => {
    expect(joinMobile('+971', '44-455 66')).toBe('+971 4445566');
  });

  it('returns an EMPTY string when there are no digits, never a bare dial code', () => {
    // packVendor treats a blank phone as "not given" — a dial code alone is
    // not a contact number, and must not read as one.
    expect(joinMobile('+91', '')).toBe('');
    expect(joinMobile('+971', '   ')).toBe('');
  });

  it('falls back to the default dial code when none is given but digits are', () => {
    expect(joinMobile('', '9876543210')).toBe(`${DEFAULT_DIAL} 9876543210`);
  });

  it('round-trips through splitMobile', () => {
    const joined = joinMobile('+971', '4445566');
    expect(splitMobile(joined)).toEqual({ dial: '+971', digits: '4445566' });
  });
});

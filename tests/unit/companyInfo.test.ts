import { describe, it, expect } from 'vitest';
import { parseCompanyInfo } from '../../src/lib/companyInfo';

describe('parseCompanyInfo', () => {
  it('parses the packed JSON format written by RaisePass/BulkRaise', () => {
    expect(parseCompanyInfo('{"n":"Dell","a":"Kolkata","v":"5269874563"}')).toEqual({
      name: 'Dell',
      contact: '',
      address: 'Kolkata',
      phone: '5269874563',
    });
  });

  it('falls back to treating legacy plain-text values as the company name', () => {
    expect(parseCompanyInfo('Acme Corp')).toEqual({
      name: 'Acme Corp',
      contact: '',
      address: '',
      phone: '',
    });
  });

  // The bug this guards: RaisePass writes {"n":"","a":"","v":""} whenever the
  // HOD leaves the optional vendor fields blank. The old parser tested
  // `parsed.n` for truthiness, so an empty name failed the check and the raw
  // JSON blob was returned AS the company name — every pass with no vendor
  // rendered `Vendor {"n":"","a":"","v":""}` on the detail page and the slip.
  it('returns empty fields — never the raw JSON — when the packed values are blank', () => {
    expect(parseCompanyInfo('{"n":"","a":"","v":""}')).toEqual({
      name: '',
      contact: '',
      address: '',
      phone: '',
    });
  });

  it('keeps the address/phone of a packed value whose name alone is blank', () => {
    expect(parseCompanyInfo('{"n":"","a":"Kolkata","v":"9876543210"}')).toEqual({
      name: '',
      contact: '',
      address: 'Kolkata',
      phone: '9876543210',
    });
  });

  it('treats JSON without any of the known keys as legacy plain text too', () => {
    expect(parseCompanyInfo('{"foo":"bar"}')).toEqual({
      name: '{"foo":"bar"}',
      contact: '',
      address: '',
      phone: '',
    });
  });

  it('returns all-empty fields for null/undefined/empty input', () => {
    const empty = { name: '', contact: '', address: '', phone: '' };
    expect(parseCompanyInfo(null)).toEqual(empty);
    expect(parseCompanyInfo(undefined)).toEqual(empty);
    expect(parseCompanyInfo('')).toEqual(empty);
  });
});

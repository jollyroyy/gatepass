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

  it('treats JSON without an "n" key as legacy plain text too', () => {
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

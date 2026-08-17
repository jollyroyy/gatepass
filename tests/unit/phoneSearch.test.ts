import { describe, it, expect } from 'vitest';
import {
  isPhoneQuery,
  phoneDigits,
  phoneMatches,
  phoneSearchPattern,
  passMatchesPhone,
  canVerifyAtGate,
} from '../../src/lib/phoneSearch';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1',
    pass_number: 'RGP-OUT-20260818-0001',
    type: 'RGP',
    direction: 'out',
    status: 'pending',
    department_id: 'd1',
    raised_by: 'u1',
    visitor_name: 'A Kumar',
    visitor_company: JSON.stringify({ n: 'BSC', a: 'Kolkata 700091', v: '+91 98765-43210' }),
    vehicle_number: 'WB01AB1234',
    purpose: 'repair',
    expected_return_date: null,
    return_status: 'not_applicable',
    actual_return_date: null,
    verified_by: null,
    verified_at: null,
    flag_reason: null,
    qr_token: 'tok',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_overdue: false,
    is_expired: false,
    due_state: 'none',
    flagged_at: null,
    hod_reviewed_at: null,
    item_count: 1,
    total_quantity: 1,
    returned_quantity: 0,
    material_summary: 'Drill',
    total_value: 100,
    department_name: 'IT',
    department_code: 'IT',
    raised_by_name: 'HOD',
    verified_by_name: null,
    ...over,
  } as GatePassView;
}

describe('phone search', () => {
  it('keeps digits only', () => {
    expect(phoneDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneDigits(null)).toBe('');
  });

  it('treats a pass number as a pass number, not a phone', () => {
    expect(isPhoneQuery('RGP-OUT-20260726-0001')).toBe(false);
    expect(isPhoneQuery('9876543210')).toBe(true);
    expect(isPhoneQuery('98765 43210')).toBe(true);
    expect(isPhoneQuery('1234')).toBe(false);
  });

  it('narrows on the last four digits, which are contiguous in every format', () => {
    expect(phoneSearchPattern('+91 98765-43210')).toBe('%3210%');
  });

  it('matches across formatting and country codes, in both directions', () => {
    expect(phoneMatches('+91 98765-43210', '9876543210')).toBe(true);
    expect(phoneMatches('9876543210', '+91 98765 43210')).toBe(true);
    expect(phoneMatches('9876543210', '543210')).toBe(true);
    expect(phoneMatches('9876543210', '9876500000')).toBe(false);
    expect(phoneMatches('', '9876543210')).toBe(false);
  });

  it('matches on the pass phone field only, never the whole vendor blob', () => {
    expect(passMatchesPhone(pass(), '9876543210')).toBe(true);
    // The address carries 700091; a query for that must not surface the pass.
    expect(passMatchesPhone(pass(), '700091')).toBe(false);
  });

  it('offers Verify only for what the gate can still act on', () => {
    expect(canVerifyAtGate(pass())).toBe(true);
    expect(canVerifyAtGate(pass({ status: 'hod_reviewed' }))).toBe(true);
    expect(canVerifyAtGate(pass({ status: 'matched' }))).toBe(false);
    expect(canVerifyAtGate(pass({ expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
  });
});

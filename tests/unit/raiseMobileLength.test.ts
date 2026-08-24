// THE DIAL CODE IS NOT PART OF THE NUMBER.
//
// `visitor_phone` is ONE stored string — `joinMobile` welds the dial-code select
// to the number box as `"+91 9876543210"` (src/lib/mobileNumber.ts). The 7–15
// digit rule in `validateRaiseForm` stripped every non-digit from that whole
// string, so the country code was counted as subscriber digits and the rule was
// wrong in BOTH directions:
//
//   * `+91` + six digits → "91123456" → 8 digits → ACCEPTED. Six digits is not
//     a mobile number anywhere, and the form let it through to a permanent pass
//     whose only contact detail is unreachable.
//   * `+971` + a genuine 15-digit number → 18 digits → REJECTED. The comment
//     above the rule says it is deliberately not India-only precisely so a Gulf
//     supplier can be raised against; counting their longer code is what stops
//     them.
//
// The fix reads the digits back through `splitMobile`, the exact inverse of the
// `joinMobile` that produced the string.
import { describe, it, expect } from 'vitest';
import { validateRaiseForm } from '../../src/lib/raisePassForm';
import { joinMobile } from '../../src/lib/mobileNumber';
import type { NewGatePass } from '../../src/types';

const TODAY = '2026-08-24';
const TOMORROW = '2026-08-25';

function form(phone: string): NewGatePass {
  return {
    type: 'RGP',
    visitor_name: 'Test Carrier',
    visitor_company: 'Test Vendor',
    company_address: '',
    visitor_phone: phone,
    purpose: 'Automated validation check',
    vehicle_number: '',
    items: [
      {
        name: 'Widget',
        quantity: '1',
        unit: 'nos',
        value: '',
        make_model: 'Model X',
        serial_no: '',
        invoice_no: '',
        remarks: '',
        expected_return_date: TOMORROW,
      },
    ],
  } as unknown as NewGatePass;
}

const phoneError = (phone: string): string | undefined =>
  validateRaiseForm(form(phone), true, TODAY).visitor_phone;

describe('validateRaiseForm — the mobile length rule counts subscriber digits only', () => {
  it('rejects six digits even though the dial code would pad them to eight', () => {
    expect(phoneError(joinMobile('+91', '123456'))).toBe('Enter a valid mobile number.');
  });

  it('accepts seven digits — the low boundary', () => {
    expect(phoneError(joinMobile('+91', '1234567'))).toBeUndefined();
  });

  it('accepts fifteen digits — the high boundary', () => {
    expect(phoneError(joinMobile('+91', '123456789012345'))).toBeUndefined();
  });

  it('rejects sixteen digits', () => {
    expect(phoneError(joinMobile('+91', '1234567890123456'))).toBe('Enter a valid mobile number.');
  });

  // The regression that motivated the rule's own comment: a Gulf supplier has a
  // longer dial code, and counting it shrank their allowance by two digits.
  it('a three-digit dial code does not shrink the allowance', () => {
    expect(phoneError(joinMobile('+971', '123456789012345'))).toBeUndefined();
    expect(phoneError(joinMobile('+971', '123456'))).toBe('Enter a valid mobile number.');
  });

  // `joinMobile` stores an EMPTY STRING for empty digits, never a bare code, so
  // "required" still reads as required rather than as a too-short number.
  it('an empty number is still reported as missing, not as invalid', () => {
    expect(phoneError(joinMobile('+91', ''))).toBe('Mobile number is required.');
  });

  // A row raised before the dial-code selector existed stores bare digits with
  // no code at all. `splitMobile` falls back to the default code and keeps every
  // digit, so those numbers must grade exactly as they did.
  it('a number stored without any dial code is judged on its own digits', () => {
    expect(phoneError('9876543210')).toBeUndefined();
    expect(phoneError('123456')).toBe('Enter a valid mobile number.');
  });
});

// Material values print EXACTLY, with no K/L abbreviation.
//
// Client's call, 2026-08-17: "you should not mention 3k, 4k. It should be the
// exact number, like 3100, 200, 110." The old formatter rounded ₹3,100 to
// "₹3.1K" and ₹110,000 to "₹1.1L", so a value on a gate pass — the figure the
// pass is *about* — could not be read off the screen at all. Indian digit
// grouping stays (₹1,10,000); it separates digits, it does not lose any.
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../../src/lib/formatCurrency';

describe('formatCurrency', () => {
  it('never abbreviates to K or L', () => {
    for (const n of [1000, 3100, 9999, 10000, 45000, 100000, 110000, 2500000]) {
      const out = formatCurrency(n);
      expect(out).not.toMatch(/[KL]/);
    }
  });

  it('prints the exact figures the client named', () => {
    expect(formatCurrency(110)).toBe('₹110');
    expect(formatCurrency(200)).toBe('₹200');
    expect(formatCurrency(3100)).toBe('₹3,100');
  });

  it('groups larger values the Indian way without losing a digit', () => {
    // Every rupee is still readable: strip the separators and the digits are
    // the number itself.
    for (const n of [45000, 110000, 2500000]) {
      expect(formatCurrency(n).replace(/[₹,]/g, '')).toBe(String(n));
    }
    expect(formatCurrency(110000)).toBe('₹1,10,000');
  });

  it('rounds to whole rupees and handles zero', () => {
    expect(formatCurrency(0)).toBe('₹0');
    expect(formatCurrency(3100.4)).toBe('₹3,100');
  });
});

// WHAT A TYPED QUERY IS, before anything is fetched.
//
// The gate's search used to know two shapes, and the code branch's test was
// "does it contain a letter". That sent every NAME, vendor and model number to
// `gatepass.lookup_pass` — an RPC that logs a scan attempt, fires the blacklist
// alert and answers with one row or `not_found` — so a guard who typed "Dell"
// was told "No pass matches that code" while five Dell passes sat in the
// register (client, 2026-08-24).
//
// These cases pin the routing decision itself, which is the whole of the fix:
// a CODE is a code by its SHAPE, and everything else that is not a phone number
// is free text.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  isPassCodeQuery,
  isTextQuery,
  mergeMatches,
  orFilter,
  sanitizeTerm,
} from '../../src/lib/passTextSearch';

describe('isPassCodeQuery — what still belongs to lookup_pass', () => {
  it('accepts a whole pass number, both the current and the pre-010 shape', () => {
    expect(isPassCodeQuery('RGP-OUT-20260727-0001')).toBe(true);
    expect(isPassCodeQuery('NRGP-OUT-20260727-0012')).toBe(true);
    // Before migration 010 the number carried no direction.
    expect(isPassCodeQuery('RGP-20260819-0001')).toBe(true);
  });

  it('accepts a pass id and the URL a QR code carries', () => {
    expect(isPassCodeQuery('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isPassCodeQuery('https://gatepass.example.com/pass/abc')).toBe(true);
  });

  it('REFUSES a name, a vendor, a make and model and an order number', () => {
    // Every one of these contains a letter, and every one of these was sent to
    // lookup_pass before 2026-08-24.
    expect(isPassCodeQuery('Ravi Kumar')).toBe(false);
    expect(isPassCodeQuery('Dell')).toBe(false);
    expect(isPassCodeQuery('Latitude 5440')).toBe(false);
    expect(isPassCodeQuery('INV-2026/0442')).toBe(false);
  });

  it('refuses a PARTIAL pass number, which the text branch matches with an ilike', () => {
    // "RGP-OUT-2026" is half a number, and half a number is a list of passes,
    // not one row and not a `not_found`.
    expect(isPassCodeQuery('RGP-OUT-2026')).toBe(false);
    expect(isPassCodeQuery('RGP')).toBe(false);
  });

  it('is false for an empty or blank query', () => {
    expect(isPassCodeQuery('')).toBe(false);
    expect(isPassCodeQuery('   ')).toBe(false);
  });
});

describe('sanitizeTerm — PostgREST grammar is not the user’s to write', () => {
  it('strips the comma and parentheses that would be read as more filters', () => {
    // Unstripped, "Dell (India), Pvt" is parsed as three extra filters and the
    // request 400s — the search would fail on an ordinary vendor name.
    expect(sanitizeTerm('Dell (India), Pvt')).toBe('Dell India Pvt');
  });

  it('strips the ilike wildcards, so the box cannot widen its own query', () => {
    expect(sanitizeTerm('%')).toBe('');
    expect(sanitizeTerm('De*ll')).toBe('De ll');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeTerm('  Dell   XPS  ')).toBe('Dell XPS');
  });
});

describe('isTextQuery — long enough, and not already a code', () => {
  it('takes anything two characters or more that is not a code', () => {
    expect(isTextQuery('Dell')).toBe(true);
    expect(isTextQuery('3M')).toBe(true);
  });

  it('refuses one character, and refuses a query that sanitizes to nothing', () => {
    expect(isTextQuery('D')).toBe(false);
    expect(isTextQuery('%%')).toBe(false);
  });

  it('refuses a whole pass number — that is lookup_pass’s', () => {
    expect(isTextQuery('RGP-OUT-20260727-0001')).toBe(false);
  });
});

describe('orFilter — the argument PostgREST is handed', () => {
  it('names every field with the same term, `*`-wrapped', () => {
    expect(orFilter(['visitor_name', 'make_model'], 'Dell')).toBe(
      'visitor_name.ilike.*Dell*,make_model.ilike.*Dell*'
    );
  });
});

describe('mergeMatches — one pass, matched twice, appears once', () => {
  const p = (id: string, created_at: string): GatePassView =>
    ({ id, created_at } as GatePassView);

  it('dedupes by id and orders newest first', () => {
    // "Dell" can match the vendor on the pass row AND the make/model on one of
    // its lines. That is one pass, not two.
    const merged = mergeMatches(
      [p('a', '2026-08-01T00:00:00Z'), p('b', '2026-08-03T00:00:00Z')],
      [p('b', '2026-08-03T00:00:00Z'), p('c', '2026-08-02T00:00:00Z')]
    );
    expect(merged.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('is empty for no sets at all', () => {
    expect(mergeMatches()).toEqual([]);
  });
});

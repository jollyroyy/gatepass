// THE STANDING COPY LIST (migration 078) — the addresses an admin types in
// Admin → Settings that are copied on every gate pass letter.
//
// Client, 2026-09-01: "admin should be able to configure three to four email
// IDs in the setting part and all those emails should be receiving the
// notifications about the gate pass raising and all those status changes …
// gate pass creations and approvals."
//
// The database says all of this too, in `gatepass.notify_cc_is_valid`. These
// cases are what says it FIRST, in front of the person typing — a 23514 reaching
// the browser is not a sentence anybody can act on, and this repo deliberately
// leaves 23514 unmapped in `errors.ts`.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COPY_ROWS,
  MAX_COPY_ADDRESSES,
  copyListNote,
  copyListPayload,
  copyRowsFrom,
  validateCopyList,
} from '../../src/lib/mailRecipients';

describe('the rows the form shows', () => {
  it('offers four blank rows before anything is configured', () => {
    expect(copyRowsFrom(null)).toEqual(['', '', '', '']);
    expect(copyRowsFrom([])).toHaveLength(DEFAULT_COPY_ROWS);
  });

  it('shows what is stored, padded out to four', () => {
    expect(copyRowsFrom(['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com', '', '']);
  });

  it('never shows more rows than the database will store', () => {
    const many = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com', 'g@x.com'];
    expect(copyRowsFrom(many)).toHaveLength(MAX_COPY_ADDRESSES);
  });
});

describe('what gets stored', () => {
  // A row is REMOVED by emptying it — there is no delete button — so the
  // stored array has to be dense however gappy the form is.
  it('drops the blank rows and keeps the order', () => {
    expect(copyListPayload(['a@x.com', '', 'b@x.com', ''])).toEqual(['a@x.com', 'b@x.com']);
  });

  it('trims, because a trailing space is invisible and breaks the address', () => {
    expect(copyListPayload(['  a@x.com  '])).toEqual(['a@x.com']);
  });

  it('stores nothing at all from an untouched form', () => {
    expect(copyListPayload(copyRowsFrom(null))).toEqual([]);
  });
});

describe('what the person typing is told', () => {
  it('accepts a filled, well-formed list', () => {
    expect(validateCopyList(['a@x.com', 'b@y.co.in', '', ''])).toEqual({});
  });

  it('names the row that is not an address, not the whole list', () => {
    const errors = validateCopyList(['a@x.com', 'not-an-address', '', '']);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toMatch(/one email address/i);
  });

  // The same guard `override_to` has had since 052: a comma or a semicolon
  // would turn one entry into a list, and these strings are concatenated into
  // a `cc` array by the sender.
  it('refuses an entry that is secretly two addresses', () => {
    expect(validateCopyList(['a@x.com, b@x.com', '', '', ''])[0]).toBeTruthy();
    expect(validateCopyList(['Ravi <ravi@x.com>', '', '', ''])[0]).toBeTruthy();
  });

  // A settings screen that silently accepts the same person twice is a settings
  // screen that lies about what it will do.
  it('says WHICH earlier row a duplicate repeats, case-insensitively', () => {
    const errors = validateCopyList(['ravi@x.com', 'b@x.com', 'RAVI@X.COM', '']);
    expect(errors[2]).toContain('row 1');
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeUndefined();
  });

  it('is silent about blank rows — they are how you leave a slot unused', () => {
    expect(validateCopyList(['', '', '', ''])).toEqual({});
  });
});

describe('the sentence under the list', () => {
  it('says plainly when nobody is copied', () => {
    expect(copyListNote(0, null)).toMatch(/nobody is copied/i);
  });

  it('counts them, and names what they receive', () => {
    const note = copyListNote(3, null);
    expect(note).toContain('3 addresses');
    expect(note).toMatch(/raised/i);
    expect(note).toMatch(/approv/i);
  });

  // ⚠ THE ONE WAY THIS FEATURE SILENTLY DOES NOTHING. While every letter is
  // redirected to a single inbox, the copies are suppressed with it — correct,
  // because a redirected test letter must not reach live watchers, but a person
  // who typed four addresses and sees no mail deserves to be told on the screen
  // where they typed them rather than discovering it in `email_log`.
  it('warns that the copies are going nowhere while mail is redirected', () => {
    const note = copyListNote(3, 'tester@example.com');
    expect(note).toMatch(/NOT being sent/i);
    expect(note).toContain('tester@example.com');
  });

  it('says nothing about a redirect that is not set', () => {
    expect(copyListNote(3, null)).not.toMatch(/NOT being sent/i);
  });
});

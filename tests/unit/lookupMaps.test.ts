// Project rule: "no fuzzy string matching on enums — use a Record<Enum, T>
// lookup map, never an includes() chain." These specs pin that every enum
// member from src/types/index.ts has an entry in each lookup map, so a new
// enum value added there can't silently render blank in the UI.
import { describe, it, expect } from 'vitest';
import { STATUS_STYLES, RETURN_STYLES } from '../../src/lib/statusStyles';
import { PASS_TYPES, PASS_CATEGORIES, categoryKey } from '../../src/lib/passTypes';
import { formatDateTime, formatTime, formatDuration, relativeAge, formatDateOnly } from '../../src/lib/formatDate';

// Hardcoded from src/types/index.ts — cross-checked against the source union
// on every run via the completeness assertions below, so this list drifting
// out of date would itself fail the suite.
const PASS_STATUS_MEMBERS = ['pending', 'held', 'matched', 'flagged', 'cancelled', 'hod_reviewed'] as const;
const RETURN_STATUS_MEMBERS = ['not_applicable', 'awaiting_return', 'partially_returned', 'returned'] as const;
// Migration 010 retired IGP/OGP: type is now RGP | NRGP, with direction (in/out)
// as its own column. See PASS_CATEGORIES below for the legal type+direction set.
const PASS_TYPE_MEMBERS = ['RGP', 'NRGP'] as const;

describe('STATUS_STYLES covers every PassStatus', () => {
  it('has the exact same keys as the enum, no more, no less', () => {
    expect(Object.keys(STATUS_STYLES).sort()).toEqual([...PASS_STATUS_MEMBERS].sort());
  });

  for (const status of PASS_STATUS_MEMBERS) {
    it(`${status} has no empty style fields`, () => {
      const style = STATUS_STYLES[status];
      expect(style.bg).not.toBe('');
      expect(style.text).not.toBe('');
      expect(style.dot).not.toBe('');
      expect(style.label).not.toBe('');
    });
  }
});

describe('RETURN_STYLES covers every ReturnStatus', () => {
  it('has the exact same keys as the enum, no more, no less', () => {
    expect(Object.keys(RETURN_STYLES).sort()).toEqual([...RETURN_STATUS_MEMBERS].sort());
  });

  for (const status of RETURN_STATUS_MEMBERS) {
    it(`${status} has no empty style fields`, () => {
      const style = RETURN_STYLES[status];
      expect(style.bg).not.toBe('');
      expect(style.text).not.toBe('');
      expect(style.dot).not.toBe('');
      // not_applicable's label is an intentional em-dash, not empty text.
      expect(style.label).not.toBe('');
    });
  }
});

describe('PASS_TYPES covers every PassType', () => {
  it('has the exact same keys as the enum, no more, no less', () => {
    expect(Object.keys(PASS_TYPES).sort()).toEqual([...PASS_TYPE_MEMBERS].sort());
  });

  for (const type of PASS_TYPE_MEMBERS) {
    it(`${type} has no empty descriptive fields`, () => {
      const info = PASS_TYPES[type];
      expect(info.code).toBe(type);
      expect(info.label).not.toBe('');
      expect(info.description).not.toBe('');
      expect(info.directions.length).toBeGreaterThan(0);
      for (const d of info.directions) {
        expect(['in', 'out']).toContain(d);
      }
      expect(typeof info.returnable).toBe('boolean');
    });
  }
});

describe('PASS_CATEGORIES covers every legal type+direction combination', () => {
  it('has exactly the three combinations the DB permits', () => {
    expect(Object.keys(PASS_CATEGORIES).sort()).toEqual(['NRGP-out', 'RGP-in', 'RGP-out'].sort());
  });

  for (const c of Object.values(PASS_CATEGORIES)) {
    it(`${c.key} round-trips through categoryKey`, () => {
      expect(categoryKey(c.type, c.direction)).toBe(c.key);
    });

    it(`${c.key} has non-empty label and description`, () => {
      expect(c.label).not.toBe('');
      expect(c.description).not.toBe('');
    });
  }

  it("NRGP is outward only, mirroring gate_passes_nrgp_is_outward", () => {
    expect(PASS_TYPES.NRGP.directions).toEqual(['out']);
  });
});

describe('formatDate helpers never throw', () => {
  const VALID_ISO = '2026-07-26T10:30:00Z';
  const GARBAGE = 'not-a-date';

  it('formatDateTime handles a valid ISO string', () => {
    expect(typeof formatDateTime(VALID_ISO)).toBe('string');
    expect(formatDateTime(VALID_ISO)).not.toBe('');
  });

  it('formatDateTime handles null/undefined with the placeholder dash', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('formatDateTime does not throw on an unparseable string', () => {
    expect(() => formatDateTime(GARBAGE)).not.toThrow();
    expect(typeof formatDateTime(GARBAGE)).toBe('string');
  });

  it('formatTime handles a valid ISO string, null, and garbage without throwing', () => {
    expect(typeof formatTime(VALID_ISO)).toBe('string');
    expect(formatTime(null)).toBe('—');
    expect(() => formatTime(GARBAGE)).not.toThrow();
  });

  it('formatDuration returns the placeholder for null/undefined', () => {
    expect(formatDuration(null)).toEqual({ text: '—', isOvertime: false });
    expect(formatDuration(undefined)).toEqual({ text: '—', isOvertime: false });
  });

  it('formatDuration never reports a negative duration (clock skew guard)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatDuration(future)).toEqual({ text: '0m', isOvertime: false });
  });

  it('relativeAge reports the largest whole unit and never throws on garbage', () => {
    expect(relativeAge(new Date().toISOString())).toBe('0m');
    expect(() => relativeAge(GARBAGE)).not.toThrow();
  });

  it('formatDateOnly handles a valid ISO string, null, and garbage without throwing', () => {
    expect(typeof formatDateOnly(VALID_ISO)).toBe('string');
    expect(formatDateOnly(null)).toBe('—');
    expect(() => formatDateOnly(GARBAGE)).not.toThrow();
  });
});

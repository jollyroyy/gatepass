// safeErrorMessage translates Postgres/PostgREST codes into friendly text,
// but must let our own RPCs' user-facing RAISE EXCEPTION text through
// unchanged — those messages ("Only security can verify a gate pass.") are
// already written for the end user and rewriting them would lose meaning.
import { describe, it, expect } from 'vitest';
import { safeErrorMessage } from '../../src/lib/errors';

describe('safeErrorMessage — mapped codes', () => {
  it.each([
    ['23505', 'That record already exists.'],
    ['23503', 'This action conflicts with related data.'],
    ['23502', 'A required field is missing.'],
    ['42501', 'You do not have permission to do that.'],
    // The reason this whole module exists: the recursive public.profiles
    // policy surfaces as 42P17 and must never reach a user as raw driver text.
    ['42P17', 'A database security policy is misconfigured. Please contact your administrator.'],
    ['PGRST301', 'Your session has expired. Please sign in again.'],
    ['PGRST116', 'That record could not be found.'],
  ])('code %s -> %s', (code, expected) => {
    expect(safeErrorMessage({ code, message: 'raw driver text' })).toBe(expected);
  });

  it('takes priority over the message text even when a message is present', () => {
    expect(safeErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }))
      .toBe('That record already exists.');
  });
});

describe('safeErrorMessage — constraint-name mapping (checked before the generic SQLSTATE map)', () => {
  it('a 23505 naming gate_passes_one_pending_per_material_idx in `message` returns the specific pending-material message', () => {
    expect(
      safeErrorMessage({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "gate_passes_one_pending_per_material_idx"',
      })
    ).toContain('already exists for this material');
  });

  it('matches the same index name when it arrives via `details` instead of `message`', () => {
    expect(
      safeErrorMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details:
          'Key (department_id, normalize_material(material_description))=(x, 10 dell laptops) ' +
          'already exists. gate_passes_one_pending_per_material_idx',
      })
    ).toContain('already exists for this material');
  });

  it('matches the same index name when it arrives via `constraint` instead of `message`', () => {
    expect(
      safeErrorMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        constraint: 'gate_passes_one_pending_per_material_idx',
      })
    ).toContain('already exists for this material');
  });

  it('a different 23505 (a different index name) still falls back to the generic message', () => {
    expect(
      safeErrorMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint "gate_passes_pass_number_key"',
      })
    ).toBe('That record already exists.');
  });

  it('a bare 23505 with no message/details/constraint at all still returns the generic message, not a throw', () => {
    expect(safeErrorMessage({ code: '23505' })).toBe('That record already exists.');
  });

  it('an RPC-raised message with no code still passes through verbatim (constraintMessage must not swallow it)', () => {
    expect(safeErrorMessage({ message: 'Only the HOD who raised a pass can void it.' })).toBe(
      'Only the HOD who raised a pass can void it.'
    );
  });
});

describe('safeErrorMessage — unmapped codes pass their message through verbatim', () => {
  it('shows an RPC-raised P0001 message unchanged (already written for the end user)', () => {
    expect(safeErrorMessage({ code: 'P0001', message: 'Only security can verify a gate pass.' }))
      .toBe('Only security can verify a gate pass.');
  });

  it('shows a message with no code at all unchanged', () => {
    expect(safeErrorMessage({ message: 'Pass is not pending.' })).toBe('Pass is not pending.');
  });
});

describe('safeErrorMessage — network failures', () => {
  it('turns a "Failed to fetch" Error into the network message', () => {
    expect(safeErrorMessage(new Error('Failed to fetch'))).toBe(
      'Network error. Check your connection and try again.'
    );
  });

  it('recognises NetworkError variants too', () => {
    expect(safeErrorMessage(new Error('NetworkError when attempting to fetch resource'))).toBe(
      'Network error. Check your connection and try again.'
    );
  });
});

describe('safeErrorMessage — edge inputs', () => {
  it('returns the default fallback for null', () => {
    expect(safeErrorMessage(null)).toBe('An unexpected error occurred.');
  });

  it('returns the default fallback for undefined', () => {
    expect(safeErrorMessage(undefined)).toBe('An unexpected error occurred.');
  });

  it('honours a custom fallback', () => {
    expect(safeErrorMessage(null, 'Could not load passes.')).toBe('Could not load passes.');
  });

  it('passes a plain string through unchanged', () => {
    expect(safeErrorMessage('Vehicle number is required.')).toBe('Vehicle number is required.');
  });

  it('returns the fallback for an empty string rather than showing nothing', () => {
    expect(safeErrorMessage('')).toBe('An unexpected error occurred.');
  });

  it('stringifies a non-string message without throwing', () => {
    expect(safeErrorMessage({ message: 42 })).toBe('42');
  });
});

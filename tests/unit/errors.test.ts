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

describe('safeErrorMessage — public.profiles name constraints (VMS-owned, 23514)', () => {
  // A check violation is 23514, which is deliberately NOT in the generic
  // SQLSTATE map — most check constraints are better explained by name than by
  // a catch-all. These three fire on any screen that writes a person's name
  // (the admin Users tab via admin_create_user / admin_update_user, and the
  // profile page via update_my_name) and without a mapping they reach the
  // admin as raw text: 'new row for relation "profiles" violates check
  // constraint "profiles_full_name_charset"'. That names no field the admin
  // recognises and never says which characters are actually allowed.
  //
  // Definitions read live from pg_constraint 2026-08-08:
  //   charset  full_name ~ '^[A-Za-z .''-]+$'   (letters, space, dot, apostrophe, hyphen)
  //   length   2..80 characters
  //   trimmed  full_name = btrim(full_name)
  it('charset: says which characters are allowed, so "Probe 034" is actionable', () => {
    const msg = safeErrorMessage({
      code: '23514',
      message:
        'new row for relation "profiles" violates check constraint "profiles_full_name_charset"',
    });
    expect(msg).toContain('letters');
    expect(msg).not.toContain('profiles_full_name_charset');
  });

  it('length: states the 2–80 bound rather than the constraint name', () => {
    const msg = safeErrorMessage({
      code: '23514',
      message:
        'new row for relation "profiles" violates check constraint "profiles_full_name_length"',
    });
    expect(msg).toContain('2');
    expect(msg).toContain('80');
    expect(msg).not.toContain('profiles_full_name_length');
  });

  it('trimmed: explains the leading/trailing space rather than the constraint name', () => {
    const msg = safeErrorMessage({
      code: '23514',
      message:
        'new row for relation "profiles" violates check constraint "profiles_full_name_trimmed"',
    });
    expect(msg).toMatch(/space/i);
    expect(msg).not.toContain('profiles_full_name_trimmed');
  });

  it('matches when the constraint arrives via `constraint` instead of `message`', () => {
    expect(
      safeErrorMessage({ code: '23514', constraint: 'profiles_full_name_charset' })
    ).toContain('letters');
  });

  it('an UNnamed 23514 still passes its text through — no catch-all that hides which rule failed', () => {
    // e.g. 033's vehicle-format check. A generic "that value is not allowed"
    // would be strictly less informative than the constraint name itself.
    expect(
      safeErrorMessage({
        code: '23514',
        message: 'violates check constraint "gate_passes_vehicle_number_format"',
      })
    ).toContain('gate_passes_vehicle_number_format');
  });
});

describe('safeErrorMessage — GoTrue auth codes', () => {
  // supabase-js surfaces auth failures as AuthApiError, whose `code` is a
  // GoTrue string (not a SQLSTATE). These are server-side conditions the user
  // cannot act on, and GoTrue's own wording ("Database error querying schema")
  // describes the server's internals rather than anything the user can do.
  it.each([
    ['unexpected_failure', /authentication service/i],
    ['over_request_rate_limit', /wait/i],
    ['over_email_send_rate_limit', /hour/i],
    ['email_not_confirmed', /confirmed/i],
  ])('GoTrue code %s is translated', (code, pattern) => {
    expect(safeErrorMessage({ code, message: 'Database error querying schema' })).toMatch(pattern);
  });

  it('invalid_credentials says which two fields to check', () => {
    expect(safeErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }))
      .toMatch(/email or password/i);
  });

  it('an unknown auth code still shows GoTrue\'s own text rather than a fallback', () => {
    expect(safeErrorMessage({ code: 'some_future_code', message: 'Signups not allowed.' })).toBe(
      'Signups not allowed.'
    );
  });
});

describe('safeErrorMessage — never renders an opaque blob at the user', () => {
  // The bug that made 034 so hard to read: a body supabase-js could not turn
  // into a sentence reached the screen as bare punctuation ("{}"), which looks
  // like a UI glitch rather than an error and tells the user nothing at all.
  it.each(['{}', '[]', '[object Object]', 'null', 'undefined'])(
    'a message of %s falls back instead of being shown',
    (blob) => {
      expect(safeErrorMessage({ message: blob }, 'Could not sign in.')).toBe('Could not sign in.');
    }
  );

  it('an object message stringifies to [object Object] and is caught too', () => {
    expect(safeErrorMessage({ message: {} }, 'Could not sign in.')).toBe('Could not sign in.');
  });

  it('an Error whose message is a blob falls back as well', () => {
    expect(safeErrorMessage(new Error('{}'), 'Could not sign in.')).toBe('Could not sign in.');
  });

  it('a mapped code still wins over the blob guard', () => {
    expect(safeErrorMessage({ code: '42501', message: '{}' })).toBe(
      'You do not have permission to do that.'
    );
  });

  it('a legitimate message that merely CONTAINS braces is still shown', () => {
    expect(safeErrorMessage({ message: 'Vendor {n} is blacklisted.' })).toBe(
      'Vendor {n} is blacklisted.'
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

// THE DUPLICATE-MATERIAL RULE IS GONE (migration 073, client 2026-09-01: "make
// sure same material type can be typed in the items multiple times"). The two
// entries that explained `gate_pass_items_one_open_per_material_idx` and its
// pre-037 department-scoped spelling went with the index they described — a
// sentence telling an HOD to "combine them into one line" now contradicts what
// the form allows. What must still hold is that an ordinary 23505 from any
// OTHER unique constraint keeps a sane generic message.
describe('an unrelated 23505 still reads as a duplicate', () => {
  it('leaves it on the generic message', () => {
    const msg = safeErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "some_other_key"',
    });
    expect(msg).toMatch(/already exists/i);
  });
});

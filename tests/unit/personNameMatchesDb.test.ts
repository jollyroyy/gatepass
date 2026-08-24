// A PERSON'S NAME AND A DEPARTMENT'S NAME ARE NOT THE SAME KIND OF STRING, AND
// ONLY ONE OF THEM HAS A DATABASE CONSTRAINT BEHIND IT.
//
// `public.profiles` carries
//
//     profiles_full_name_charset  CHECK (full_name ~ '^[A-Za-z .''-]+$')
//     profiles_full_name_length   CHECK (char_length(full_name) between 2 and 80)
//     profiles_full_name_trimmed  CHECK (full_name = btrim(full_name))
//
// — letters, space, dot, apostrophe, hyphen. NO DIGITS. The Add/Edit User modals
// were validating with `nameError`, whose rule is `^[A-Za-z0-9 ]+$`, so the two
// disagreed in BOTH directions:
//
//   * "John 2" passed the client and was refused by Postgres with SQLSTATE
//     23514, which `src/lib/errors.ts` deliberately leaves unmapped — so the
//     admin read a raw constraint name instead of a sentence.
//   * "J. O'Brien-Smith" was refused by the client although the database would
//     have stored it happily. Dots, apostrophes and hyphens are how a great many
//     real names are spelled.
//
// `public.departments` has NO such constraint — "E2E Test Department" inserts
// fine — so the department rule is left exactly as it was. That is why this is a
// second function and not an edit to the first.
import { describe, it, expect } from 'vitest';
import { personNameError, nameError } from '../../src/lib/nameValidation';

describe('personNameError — the client agrees with profiles_full_name_charset', () => {
  it('accepts the punctuation real names carry', () => {
    for (const ok of ["J. O'Brien-Smith", 'Mary Jane', "D'Souza", 'A. B. Kumar', 'Jo']) {
      expect(personNameError(ok, 'Name'), ok).toBeNull();
    }
  });

  it('refuses a digit, which the database would refuse anyway', () => {
    expect(personNameError('John 2', 'Name')).toBe(
      'Name can only contain letters, spaces, and . \' - characters.',
    );
    expect(personNameError('R2D2', 'Name')).not.toBeNull();
  });

  it('refuses the characters the constraint has no room for', () => {
    for (const bad of ['John@example', 'John_Doe', 'John/Doe', 'John(Doe)', 'Jöhn']) {
      expect(personNameError(bad, 'Name'), bad).not.toBeNull();
    }
  });

  it('holds the length window the database holds — 2 to 80', () => {
    expect(personNameError('J', 'Name')).toBe('Name must be at least 2 characters.');
    expect(personNameError('a'.repeat(80), 'Name')).toBeNull();
    expect(personNameError('a'.repeat(81), 'Name')).toBe('Name cannot be longer than 80 characters.');
  });

  it('refuses untrimmed and doubled spaces, as profiles_full_name_trimmed does', () => {
    expect(personNameError(' John', 'Name')).not.toBeNull();
    expect(personNameError('John ', 'Name')).not.toBeNull();
    expect(personNameError('John  Doe', 'Name')).not.toBeNull();
  });

  it('still reports an empty name as required', () => {
    expect(personNameError('', 'Name')).toBe('Name is required.');
    expect(personNameError('   ', 'Name')).toBe('Name is required.');
  });
});

describe('nameError — the DEPARTMENT rule is untouched', () => {
  // `public.departments` has no charset constraint, and a department called
  // "Zone 2" is ordinary. Narrowing this alongside the person rule would have
  // broken a screen that was never wrong.
  it('a department name may still carry digits', () => {
    expect(nameError('Zone 2', 'Department name')).toBeNull();
  });

  it('and still refuses punctuation it always refused', () => {
    expect(nameError('R&D', 'Department name')).not.toBeNull();
  });
});

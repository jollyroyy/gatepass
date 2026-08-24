/**
 * Client-side validation for admin-entered names (user full names, department
 * names) and department codes. Letters/digits/spaces only — no fuzzy matching,
 * plain anchored regexes.
 */

const NAME_ALLOWED = /^[A-Za-z0-9 ]+$/;
const DOUBLE_SPACE = /  /;
const MAX_NAME_LENGTH = 80;

// A PERSON'S NAME, as `public.profiles` defines it — NOT the department rule.
//
//   profiles_full_name_charset  CHECK (full_name ~ '^[A-Za-z .''-]+$')
//   profiles_full_name_length   CHECK (char_length(full_name) between 2 and 80)
//   profiles_full_name_trimmed  CHECK (full_name = btrim(full_name))
//
// The two rules used to be one, and they disagreed in both directions: the
// client admitted "John 2", which Postgres then refused with SQLSTATE 23514 —
// deliberately unmapped in `src/lib/errors.ts`, so the admin read a constraint
// name — and the client refused "J. O'Brien-Smith", which the database would
// have stored happily. `public.departments` carries no charset constraint at
// all, so "Zone 2" is a perfectly good department and keeps the older rule.
const PERSON_NAME_ALLOWED = /^[A-Za-z .'-]+$/;
const MIN_PERSON_NAME_LENGTH = 2;

const DEPT_CODE_ALLOWED = /^[A-Z0-9]+$/;
const MIN_DEPT_CODE_LENGTH = 2;
const MAX_DEPT_CODE_LENGTH = 10;

/** Letters, digits and single spaces only. */
export function isValidName(value: string): boolean {
  return nameError(value, 'Name') === null;
}

/** null when valid, otherwise a human-readable reason. */
export function nameError(value: string, fieldLabel: string): string | null {
  if (value.trim() === '') return `${fieldLabel} is required.`;
  if (!NAME_ALLOWED.test(value)) {
    return `${fieldLabel} can only contain letters, numbers and spaces.`;
  }
  if (value !== value.trim() || DOUBLE_SPACE.test(value)) {
    return `${fieldLabel} cannot start, end, or contain double spaces.`;
  }
  if (value.length > MAX_NAME_LENGTH) {
    return `${fieldLabel} cannot be longer than 80 characters.`;
  }
  return null;
}

/**
 * A person's full name, judged by the constraints `public.profiles` actually
 * enforces. Used by the Add User and Edit User modals; department names go on
 * using `nameError`.
 *
 * null when valid, otherwise a human-readable reason.
 */
export function personNameError(value: string, fieldLabel: string): string | null {
  if (value.trim() === '') return `${fieldLabel} is required.`;
  if (!PERSON_NAME_ALLOWED.test(value)) {
    return `${fieldLabel} can only contain letters, spaces, and . ' - characters.`;
  }
  if (value !== value.trim() || DOUBLE_SPACE.test(value)) {
    return `${fieldLabel} cannot start, end, or contain double spaces.`;
  }
  if (value.length < MIN_PERSON_NAME_LENGTH) {
    return `${fieldLabel} must be at least ${MIN_PERSON_NAME_LENGTH} characters.`;
  }
  if (value.length > MAX_NAME_LENGTH) {
    return `${fieldLabel} cannot be longer than ${MAX_NAME_LENGTH} characters.`;
  }
  return null;
}

/** Uppercase letters and digits only — department codes are short identifiers. */
export function isValidDeptCode(value: string): boolean {
  return deptCodeError(value) === null;
}

export function deptCodeError(value: string): string | null {
  if (value.trim() === '') return 'Department code is required.';
  if (value.length < MIN_DEPT_CODE_LENGTH || value.length > MAX_DEPT_CODE_LENGTH) {
    return 'Department code must be 2–10 characters.';
  }
  if (!DEPT_CODE_ALLOWED.test(value)) {
    return 'Department code can only contain uppercase letters and numbers.';
  }
  return null;
}

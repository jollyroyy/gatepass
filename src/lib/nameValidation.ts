/**
 * Client-side validation for admin-entered names (user full names, department
 * names) and department codes. Letters/digits/spaces only — no fuzzy matching,
 * plain anchored regexes.
 */

const NAME_ALLOWED = /^[A-Za-z0-9 ]+$/;
const DOUBLE_SPACE = /  /;
const MAX_NAME_LENGTH = 80;

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

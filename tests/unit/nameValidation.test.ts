import { describe, it, expect } from 'vitest';
import { isValidName, nameError, isValidDeptCode, deptCodeError } from '../../src/lib/nameValidation';

describe('isValidName / nameError', () => {
  it('accepts a plain valid name', () => {
    expect(isValidName('Ravi Kumar')).toBe(true);
    expect(nameError('Ravi Kumar', 'Name')).toBeNull();
  });

  it('accepts a valid alphanumeric name', () => {
    expect(isValidName('Gate 2 Team')).toBe(true);
    expect(nameError('Gate 2 Team', 'Name')).toBeNull();
  });

  it('rejects empty', () => {
    expect(isValidName('')).toBe(false);
    expect(nameError('', 'Name')).toBe('Name is required.');
  });

  it('rejects whitespace-only', () => {
    expect(isValidName('   ')).toBe(false);
    expect(nameError('   ', 'Name')).toBe('Name is required.');
  });

  it('rejects leading space', () => {
    expect(isValidName(' Ravi Kumar')).toBe(false);
    expect(nameError(' Ravi Kumar', 'Name')).toBe(
      'Name cannot start, end, or contain double spaces.',
    );
  });

  it('rejects trailing space', () => {
    expect(isValidName('Ravi Kumar ')).toBe(false);
    expect(nameError('Ravi Kumar ', 'Name')).toBe(
      'Name cannot start, end, or contain double spaces.',
    );
  });

  it('rejects double space', () => {
    expect(isValidName('Ravi  Kumar')).toBe(false);
    expect(nameError('Ravi  Kumar', 'Name')).toBe(
      'Name cannot start, end, or contain double spaces.',
    );
  });

  it.each(['@', '#', '$', '%', '&', '*', '/', '\\', '<', '>', "'", '"', '.', ',', '-', '_', '(', ')', '!', '?', ';', ':', '+', '=', '~', '^'])(
    'rejects special character %s',
    (ch) => {
      const value = `Ravi${ch}Kumar`;
      expect(isValidName(value)).toBe(false);
      expect(nameError(value, 'Name')).toBe(
        'Name can only contain letters, numbers and spaces.',
      );
    },
  );

  it('rejects an emoji', () => {
    const value = 'Ravi 😀 Kumar';
    expect(isValidName(value)).toBe(false);
    expect(nameError(value, 'Name')).toBe(
      'Name can only contain letters, numbers and spaces.',
    );
  });

  it('rejects a name longer than 80 characters', () => {
    const value = 'A'.repeat(81);
    expect(isValidName(value)).toBe(false);
    expect(nameError(value, 'Name')).toBe('Name cannot be longer than 80 characters.');
  });

  it('accepts a name exactly 80 characters', () => {
    const value = 'A'.repeat(80);
    expect(isValidName(value)).toBe(true);
    expect(nameError(value, 'Name')).toBeNull();
  });

  it('uses the given field label in messages', () => {
    expect(nameError('', 'Department name')).toBe('Department name is required.');
  });
});

describe('isValidDeptCode / deptCodeError', () => {
  it('accepts a valid code', () => {
    expect(isValidDeptCode('ENG')).toBe(true);
    expect(deptCodeError('ENG')).toBeNull();
  });

  it('rejects empty', () => {
    expect(isValidDeptCode('')).toBe(false);
    expect(deptCodeError('')).toBe('Department code is required.');
  });

  it('rejects lowercase', () => {
    expect(isValidDeptCode('eng')).toBe(false);
    expect(deptCodeError('eng')).toBe(
      'Department code can only contain uppercase letters and numbers.',
    );
  });

  it('rejects a 1-character code', () => {
    expect(isValidDeptCode('E')).toBe(false);
    expect(deptCodeError('E')).toBe('Department code must be 2–10 characters.');
  });

  it('rejects an 11-character code', () => {
    const value = 'A'.repeat(11);
    expect(isValidDeptCode(value)).toBe(false);
    expect(deptCodeError(value)).toBe('Department code must be 2–10 characters.');
  });

  it('accepts a 10-character code', () => {
    const value = 'A'.repeat(10);
    expect(isValidDeptCode(value)).toBe(true);
    expect(deptCodeError(value)).toBeNull();
  });

  it('rejects a code containing a space', () => {
    expect(isValidDeptCode('EN G')).toBe(false);
    expect(deptCodeError('EN G')).toBe(
      'Department code can only contain uppercase letters and numbers.',
    );
  });

  it('rejects a code containing a hyphen', () => {
    expect(isValidDeptCode('EN-G')).toBe(false);
    expect(deptCodeError('EN-G')).toBe(
      'Department code can only contain uppercase letters and numbers.',
    );
  });
});

// Active/inactive is a STATUS, not a role (migration 040). Before that, the
// admin portal recorded a suspension by writing `role = 'staff'`, so the Role
// column read "Inactive" — a word that is not a role — and the person's real
// role was destroyed by the act of suspending them.
//
// This pins the one derivation both the portal and the app gate read, so a
// screen can never disagree with another about whether an account is usable.
import { describe, it, expect } from 'vitest';
import {
  ROLE_LABEL,
  ASSIGNABLE_ROLES,
  isAccountActive,
  accountStatusLabel,
} from '../../src/lib/userStatus';
import { USER_ROLES } from '../../src/types';

describe('role labels', () => {
  it('never labels a role "Inactive" — that is a status', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_LABEL[role]).not.toMatch(/inactive/i);
      expect(ROLE_LABEL[role].trim()).not.toBe('');
    }
  });

  it('names every role in public.user_role, so a VMS role cannot render blank', () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...USER_ROLES].sort());
  });

  it('calls staff "Staff" — it is VMS\'s role for someone who does not use this app', () => {
    expect(ROLE_LABEL.staff).toBe('Staff');
  });
});

describe('assignable roles', () => {
  it('offers guard and HOD only — staff is not this app\'s off switch any more', () => {
    expect(ASSIGNABLE_ROLES.map((r) => r.key)).toEqual(['guard', 'hod']);
  });

  it('offers no admin role: admin_create_user refuses one server-side', () => {
    const keys = ASSIGNABLE_ROLES.map((r) => String(r.key));
    expect(keys).not.toContain('admin');
    expect(keys).not.toContain('super_admin');
  });
});

describe('isAccountActive', () => {
  it('a guard with the flag set is active', () => {
    expect(isAccountActive('guard', true)).toBe(true);
    expect(isAccountActive('hod', true)).toBe(true);
    expect(isAccountActive('admin', true)).toBe(true);
  });

  it('a suspended account is inactive whatever its role', () => {
    expect(isAccountActive('guard', false)).toBe(false);
    expect(isAccountActive('hod', false)).toBe(false);
  });

  // `staff` has no routes (ROLE_ROUTES.staff is []) and no policy grants, so it
  // cannot reach anything whether the flag says active or not. Reporting such a
  // row as Active would be a wrong reading, not a lenient one.
  it('a staff row is inactive even with the flag defaulting to true', () => {
    expect(isAccountActive('staff', true)).toBe(false);
  });

  // 040 writes a user_status row only when someone is actually suspended, so
  // every pre-existing account arrives with the flag absent.
  it('treats an absent flag as active, which is what "no row" means', () => {
    expect(isAccountActive('guard', undefined)).toBe(true);
    expect(isAccountActive('guard', null)).toBe(true);
  });

  it('labels the two states in the words the portal shows', () => {
    expect(accountStatusLabel('guard', true)).toBe('Active');
    expect(accountStatusLabel('guard', false)).toBe('Inactive');
    expect(accountStatusLabel('staff', true)).toBe('Inactive');
  });
});

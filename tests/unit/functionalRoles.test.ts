// The Functional Roles list (client, 2026-08-20: "all the functional role list
// should be mentioned there and what is the purpose").
//
// What matters here is that the list is COMPLETE and HONEST. Every role a
// person can actually hold in this system must be described, and the four
// approval offices must be described the way the database treats them — as one
// seat each, filled on the ladder, not as a headcount.
import { describe, it, expect } from 'vitest';
import {
  FUNCTIONAL_ROLES,
  GRANT_NOTE,
  approvalOfficeRoles,
  roleHeadcount,
} from '../../src/lib/functionalRoles';
import { APPROVAL_LADDER } from '../../src/lib/approvalLadder';
import type { UserRole } from '../../src/types';

const ALL_VMS_ROLES: UserRole[] = ['guard', 'hod', 'staff', 'admin', 'super_admin'];

describe('the list is complete', () => {
  it('describes every VMS role, including the ones this portal cannot grant', () => {
    for (const role of ALL_VMS_ROLES) {
      expect(FUNCTIONAL_ROLES.some((r) => r.key === role)).toBe(true);
    }
  });

  // A fifth office added to the ladder and never described would be a role
  // somebody holds with nothing on screen saying what it is for.
  it('describes every approval office on the ladder', () => {
    for (const { key } of APPROVAL_LADDER) {
      expect(FUNCTIONAL_ROLES.some((r) => r.key === key)).toBe(true);
    }
    expect(approvalOfficeRoles()).toHaveLength(APPROVAL_LADDER.length);
  });

  it('names no role twice', () => {
    const keys = FUNCTIONAL_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every role states a purpose and at least one thing it can do', () => {
    for (const r of FUNCTIONAL_ROLES) {
      expect(r.purpose.trim().length).toBeGreaterThan(20);
      expect(r.can.length).toBeGreaterThan(0);
    }
  });
});

describe('the list is honest about how a role is granted', () => {
  it('an approval office is seated on the ladder, never in the Users role dropdown', () => {
    for (const r of approvalOfficeRoles()) {
      expect(r.grantedBy).toBe('approval_ladder');
    }
  });

  // Migration 021: an admin account needs the server-side key from the command
  // line. A screen offering to create one would be offering something it cannot
  // do.
  it('an admin and a super admin say they cannot be granted from the portal', () => {
    for (const key of ['admin', 'super_admin'] as const) {
      const role = FUNCTIONAL_ROLES.find((r) => r.key === key)!;
      expect(role.grantedBy).toBe('not_from_portal');
      expect(GRANT_NOTE[role.grantedBy]).toMatch(/cannot be granted/i);
    }
  });

  it('`staff` is described as opening nothing on its own', () => {
    const staff = FUNCTIONAL_ROLES.find((r) => r.key === 'staff')!;
    expect(staff.can.join(' ')).toMatch(/nothing in this app/i);
    // …and says the office is carried BESIDE it (046), because every approver
    // on this deployment is a `staff` row.
    expect(staff.can.join(' ')).toMatch(/approval office/i);
  });
});

describe('the ladder is described in order, and linearly', () => {
  it('the offices appear in the order they sign', () => {
    expect(approvalOfficeRoles().map((r) => r.key)).toEqual(APPROVAL_LADDER.map((l) => l.key));
  });

  // Migration 061. The screen must not tell an approver they can see passes
  // routed to their office — they see them only once it is their turn.
  // REWRITTEN 2026-08-22: every office after the first used to say "only
  // after". The CEO now SHARES the last rung with the COO (063) and inherits it
  // on a clock rather than on a signature, so its sentence says "once the COO
  // has not approved it in the escalation window" instead. What every office
  // after the first must still say is that it does not get the pass first.
  it('every office after the first says it waits on the level below', () => {
    for (const r of approvalOfficeRoles().slice(1)) {
      expect(r.can.join(' ')).toMatch(/only after|escalation window/i);
    }
  });
});

describe('roleHeadcount', () => {
  const people = [
    { role: 'guard' as UserRole },
    { role: 'guard' as UserRole, is_active: false },
    { role: 'hod' as UserRole },
  ];

  it('counts active accounts carrying a VMS role', () => {
    expect(roleHeadcount(people, 'guard')).toBe(1);
    expect(roleHeadcount(people, 'hod')).toBe(1);
  });

  // An office has ONE holder by primary key. Counting `staff` rows would say
  // four people are the CEO the moment four approvers exist.
  it('refuses to count an approval office at all', () => {
    expect(roleHeadcount(people, 'ceo')).toBeNull();
  });
});

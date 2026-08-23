// Migration 062 — an approver delegates their own office for a stated period.
//
// Pins the derivation, which is what every screen and both decision paths read
// through: which delegation the status card stands over, what may still be
// revoked, the form rule (which is the RPC's rule stated early), and the exact
// arguments that reach `create_approval_delegation`.
//
// THE TWO THINGS MOST WORTH PINNING ARE THE "OPTIONAL MEANS NULL" PAIR. A blank
// approval limit must reach the database as NULL and never as 0 — `Number('')`
// is 0, and 0 is a ceiling nothing on earth can pass, so the slip would turn
// "no limit" into "approve nothing" silently. The same for a blank reason.
import { describe, it, expect } from 'vitest';
import {
  canRevoke,
  candidateLabel,
  delegateEligibilityNote,
  currentDelegation,
  delegateLabel,
  delegationArgs,
  DELEGATION_STATUS_LABELS,
  DELEGATION_STATUS_NOTES,
  DELEGATION_STATUS_PILL,
  EMPTY_DELEGATION_DRAFT,
  validateDelegation,
  type DelegationRow,
  type DelegationStatus,
} from '../../src/lib/approvalDelegation';

const NOW = new Date('2026-08-22T10:00:00Z');

function row(over: Partial<DelegationRow> = {}): DelegationRow {
  return {
    id: 'd-1',
    role_key: 'coo',
    delegate_id: 'u-1',
    delegate_name: 'Priya Mehta',
    department_name: 'Housekeeping',
    starts_at: '2026-08-25T03:30:00Z',
    ends_at: '2026-08-30T18:29:00Z',
    approval_limit: null,
    reason: 'Official leave',
    status: 'active',
    created_at: '2026-08-22T04:15:00Z',
    revoked_at: null,
    ...over,
  };
}

describe('currentDelegation — the one row the status card stands over', () => {
  it('is the live one when there is one', () => {
    const live = row({ id: 'live', status: 'active' });
    const found = currentDelegation([row({ id: 'old', status: 'expired' }), live]);
    expect(found?.id).toBe('live');
  });

  it('falls back to the earliest scheduled one when nothing is live yet', () => {
    const later = row({ id: 'later', status: 'scheduled', starts_at: '2026-09-10T00:00:00Z' });
    const sooner = row({ id: 'sooner', status: 'scheduled', starts_at: '2026-09-01T00:00:00Z' });
    expect(currentDelegation([later, sooner])?.id).toBe('sooner');
  });

  it('a live one outranks a scheduled one — what is true now beats what is true next week', () => {
    const scheduled = row({ id: 'scheduled', status: 'scheduled' });
    const live = row({ id: 'live', status: 'active' });
    expect(currentDelegation([scheduled, live])?.id).toBe('live');
  });

  // The whole point of the function: a card headed "My Delegation Status"
  // standing over something that grants nobody anything is a reading somebody
  // acts on wrongly. Finished delegations belong in the history table.
  it('stands over NOTHING when every delegation is expired or revoked', () => {
    const rows = [row({ status: 'expired' }), row({ id: 'd-2', status: 'revoked' })];
    expect(currentDelegation(rows)).toBeNull();
    expect(currentDelegation([])).toBeNull();
  });
});

describe('canRevoke', () => {
  it('offers the button only on something that has not already stopped', () => {
    expect(canRevoke(row({ status: 'active' }))).toBe(true);
    expect(canRevoke(row({ status: 'scheduled' }))).toBe(true);
    expect(canRevoke(row({ status: 'expired' }))).toBe(false);
    expect(canRevoke(row({ status: 'revoked' }))).toBe(false);
  });
});

describe('the status maps', () => {
  const ALL: DelegationStatus[] = ['active', 'scheduled', 'expired', 'revoked'];

  it('names, explains and colours every status the database can return', () => {
    for (const s of ALL) {
      expect(DELEGATION_STATUS_LABELS[s]).toBeTruthy();
      expect(DELEGATION_STATUS_NOTES[s]).toBeTruthy();
      expect(DELEGATION_STATUS_PILL[s]).toBeTruthy();
    }
  });

  // NO NEW COLOUR: every badge is one of the guard skin's own pills, which is
  // what keeps `themeAudit` absolute over the delegation components.
  it('paints only with `.gb-pill-*` classes', () => {
    for (const s of ALL) {
      expect(DELEGATION_STATUS_PILL[s]).toMatch(/^gb-pill gb-pill-(green|blue|grey|red)$/);
    }
  });

  // The two ways a delegation stops must not look alike: one of them was
  // somebody's decision, and the history is where that is audited.
  it('tells an expired delegation from a revoked one', () => {
    expect(DELEGATION_STATUS_PILL.expired).not.toBe(DELEGATION_STATUS_PILL.revoked);
    expect(DELEGATION_STATUS_LABELS.expired).not.toBe(DELEGATION_STATUS_LABELS.revoked);
  });
});

describe('validateDelegation — the RPC rule, stated where the reader can act on it', () => {
  const good = {
    delegateId: 'u-1',
    startsAt: '2026-08-25T09:00',
    endsAt: '2026-08-30T23:59',
    approvalLimit: '',
    reason: '',
  };

  it('accepts a complete future window with no limit and no reason', () => {
    expect(validateDelegation(good, NOW)).toEqual({});
  });

  it('an empty draft names every required field', () => {
    const errors = validateDelegation(EMPTY_DELEGATION_DRAFT, NOW);
    expect(errors.delegateId).toBeTruthy();
    expect(errors.startsAt).toBeTruthy();
    expect(errors.endsAt).toBeTruthy();
  });

  it('refuses an end that is not after the start', () => {
    const errors = validateDelegation({ ...good, endsAt: '2026-08-25T09:00' }, NOW);
    expect(errors.endsAt).toMatch(/end after it starts/i);
  });

  // A window already over grants nobody anything and would land in the history
  // reading "Expired" the moment it was written.
  it('refuses a window that is already over', () => {
    const errors = validateDelegation(
      { ...good, startsAt: '2026-08-01T09:00', endsAt: '2026-08-05T09:00' },
      NOW
    );
    expect(errors.endsAt).toMatch(/already over/i);
  });

  // Backdating the START is allowed on purpose: somebody who left this morning
  // and is delegating from the airport must be able to cover the hours already
  // gone. Only the END has to be in the future.
  it('allows a start in the past so long as the window still has time to run', () => {
    const errors = validateDelegation(
      { ...good, startsAt: '2026-08-22T06:00', endsAt: '2026-08-30T23:59' },
      NOW
    );
    expect(errors.startsAt).toBeUndefined();
    expect(errors.endsAt).toBeUndefined();
  });

  it('takes a positive approval limit and refuses zero, a negative and a non-number', () => {
    expect(validateDelegation({ ...good, approvalLimit: '50000' }, NOW).approvalLimit).toBeUndefined();
    expect(validateDelegation({ ...good, approvalLimit: '0' }, NOW).approvalLimit).toBeTruthy();
    expect(validateDelegation({ ...good, approvalLimit: '-5' }, NOW).approvalLimit).toBeTruthy();
    expect(validateDelegation({ ...good, approvalLimit: 'lots' }, NOW).approvalLimit).toBeTruthy();
  });

  it('leaves a BLANK limit alone — it is optional and must stay optional', () => {
    expect(validateDelegation({ ...good, approvalLimit: '' }, NOW).approvalLimit).toBeUndefined();
    expect(validateDelegation({ ...good, approvalLimit: '   ' }, NOW).approvalLimit).toBeUndefined();
  });
});

describe('delegationArgs — exactly what reaches create_approval_delegation', () => {
  const draft = {
    delegateId: 'u-9',
    startsAt: '2026-08-25T09:00',
    endsAt: '2026-08-30T23:59',
    approvalLimit: '50000',
    reason: '  Official leave  ',
  };

  it('sends the delegate, a priced ceiling and a trimmed reason', () => {
    const args = delegationArgs(draft);
    expect(args.p_delegate_id).toBe('u-9');
    expect(args.p_approval_limit).toBe(50000);
    expect(args.p_reason).toBe('Official leave');
  });

  // ⚠ THE SLIP THIS EXISTS TO CATCH. `Number('')` is 0, and a limit of 0 is a
  // ceiling no pass can pass — "no limit" would silently become "approve
  // nothing". The same for a reason: '' is not a stated reason, and the column
  // refuses a blank one anyway.
  it('sends NULL — never 0 and never an empty string — for a blank limit and reason', () => {
    const args = delegationArgs({ ...draft, approvalLimit: '', reason: '   ' });
    expect(args.p_approval_limit).toBeNull();
    expect(args.p_reason).toBeNull();
  });

  // A `datetime-local` value is a wall clock with no zone. Sent as-is to a
  // `timestamptz` column it would be read in the SERVER's zone and the
  // delegation would start hours off.
  it('resolves both wall-clock inputs to absolute instants', () => {
    const args = delegationArgs(draft);
    expect(args.p_starts_at).toBe(new Date('2026-08-25T09:00').toISOString());
    expect(args.p_ends_at).toBe(new Date('2026-08-30T23:59').toISOString());
    expect(args.p_starts_at).toMatch(/Z$/);
  });

  it("caps the reason at the column's own 500 characters", () => {
    const args = delegationArgs({ ...draft, reason: 'x'.repeat(900) });
    expect(args.p_reason).toHaveLength(500);
  });
});

describe('the two name labels', () => {
  it('brackets the department, and never prints "(null)"', () => {
    expect(candidateLabel({ id: 'u', full_name: 'Priya Mehta', department_name: 'IT' }))
      .toBe('Priya Mehta (IT)');
    expect(candidateLabel({ id: 'u', full_name: 'Priya Mehta', department_name: null }))
      .toBe('Priya Mehta');
    expect(delegateLabel(row({ department_name: null }))).toBe('Priya Mehta');
  });

  // A name that failed to resolve out of VMS must not print as blank: an
  // unnamed delegation is still one somebody has to be able to revoke.
  it('names an account VMS gave no name for, rather than rendering nothing', () => {
    expect(delegateLabel(row({ delegate_name: null, department_name: null })))
      .toBe('Unnamed account');
  });
});

describe('delegateEligibilityNote — who this office may hand its rung to', () => {
  it('names the counterpart for the two offices that share the last level (067)', () => {
    // Client, 2026-08-24: "in the COO's delegation he can only delegate it to
    // CEO … and CEO can also give the delegation only to COO". A name missing
    // from a dropdown with no sentence beside it reads as a broken query.
    expect(delegateEligibilityNote('coo')).toContain('CEO');
    expect(delegateEligibilityNote('coo')).not.toContain('Department heads');
    expect(delegateEligibilityNote('ceo')).toContain('COO');
    expect(delegateEligibilityNote('ceo')).not.toContain('Department heads');
  });

  it("keeps 066's department-head sentence for every other office", () => {
    for (const office of ['security_head', 'finance_head'] as const) {
      expect(delegateEligibilityNote(office)).toContain('Department heads only');
    }
    expect(delegateEligibilityNote(null)).toContain('Department heads only');
  });
});

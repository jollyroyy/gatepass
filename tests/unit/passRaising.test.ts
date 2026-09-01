// The HOD's raising authority, as pure data (migration 077).
//
// Every rule below has a matching `raise exception` in `create_pass_raiser`;
// neither copy is redundant. The database is the authority — the RPC is
// reachable over PostgREST by any authenticated caller with a user id they typed
// themselves — and these are what tell the HOD before a round trip rather than
// after. `tests/security/sqlInvariants.test.ts` pins the server half.
import { describe, it, expect } from 'vitest';
import {
  canRevokeRaiser,
  currentRaiser,
  EMPTY_RAISER_DRAFT,
  raiserArgs,
  raiserCandidateLabel,
  raiserLabel,
  validateRaiser,
  type PassRaiserRow,
  type RaiserDraft,
} from '../../src/lib/passRaising';

const NOW = new Date('2026-09-01T10:00:00+05:30');

function row(over: Partial<PassRaiserRow> = {}): PassRaiserRow {
  return {
    id: 'r1',
    raiser_id: 'u1',
    raiser_name: 'Anita Rao',
    department_name: 'Housekeeping',
    starts_at: '2026-09-02T00:00:00Z',
    ends_at: '2026-09-30T00:00:00Z',
    reason: null,
    revoked_at: null,
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function draft(over: Partial<RaiserDraft> = {}): RaiserDraft {
  return {
    raiserId: 'u1',
    startsAt: '2026-09-02T09:00',
    endsAt: '2026-09-30T18:00',
    reason: '',
    ...over,
  };
}

describe('validating an authority before it is written', () => {
  it('accepts a complete draft with a window in the future', () => {
    expect(validateRaiser(draft(), NOW)).toEqual({});
  });

  it('insists somebody is chosen — the dropdown IS the feature', () => {
    expect(validateRaiser(draft({ raiserId: '' }), NOW).raiserId)
      .toBe('Choose somebody in your department.');
  });

  it('insists on both ends of the window', () => {
    expect(validateRaiser(draft({ startsAt: '' }), NOW).startsAt)
      .toBe('Choose when the authority starts.');
    expect(validateRaiser(draft({ endsAt: '' }), NOW).endsAt)
      .toBe('Choose when the authority ends.');
  });

  it('refuses a window that ends before it starts', () => {
    const found = validateRaiser(draft({ startsAt: '2026-09-30T09:00', endsAt: '2026-09-02T09:00' }), NOW);
    expect(found.endsAt).toBe('The authority has to end after it starts.');
  });

  it('refuses a window already over — it would grant nobody anything', () => {
    const found = validateRaiser(
      draft({ startsAt: '2026-08-01T09:00', endsAt: '2026-08-10T18:00' }),
      NOW,
    );
    expect(found.endsAt).toBe('That period is already over. Choose an end in the future.');
  });

  it('is graded against the clock it is given, never the machine\'s', () => {
    // A page left open over lunch must not accept a window that has since
    // passed — and a test must not be a race.
    const d = draft({ startsAt: '2026-09-01T08:00', endsAt: '2026-09-01T09:00' });
    expect(validateRaiser(d, new Date('2026-09-01T07:00:00+05:30'))).toEqual({});
    expect(validateRaiser(d, new Date('2026-09-01T23:00:00+05:30')).endsAt).toBeDefined();
  });

  it('takes an empty draft as an unfilled form, not as a crash', () => {
    const found = validateRaiser(EMPTY_RAISER_DRAFT, NOW);
    expect(Object.keys(found).sort()).toEqual(['endsAt', 'raiserId', 'startsAt']);
  });
});

describe('the arguments the RPC is sent', () => {
  it('sends both times as absolute instants, never a bare wall clock', () => {
    // A `datetime-local` value carries no zone, and a `timestamptz` column
    // handed one reads it in the SERVER's zone — five and a half hours off.
    const args = raiserArgs(draft());
    expect(args.p_starts_at).toBe(new Date('2026-09-02T09:00').toISOString());
    expect(args.p_ends_at).toBe(new Date('2026-09-30T18:00').toISOString());
    expect(args.p_starts_at.endsWith('Z')).toBe(true);
  });

  it('sends a blank reason as NULL, never as an empty string', () => {
    expect(raiserArgs(draft({ reason: '   ' })).p_reason).toBeNull();
    expect(raiserArgs(draft({ reason: ' cover ' })).p_reason).toBe('cover');
  });

  it('truncates a reason to the 500 the column takes', () => {
    expect(raiserArgs(draft({ reason: 'x'.repeat(900) })).p_reason).toHaveLength(500);
  });
});

describe('which authority the card stands over', () => {
  it('prefers the live one', () => {
    const rows = [row({ id: 'b', status: 'scheduled' }), row({ id: 'a', status: 'active' })];
    expect(currentRaiser(rows)?.id).toBe('a');
  });

  it('falls back to the soonest scheduled one', () => {
    const rows = [
      row({ id: 'late', status: 'scheduled', starts_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'soon', status: 'scheduled', starts_at: '2026-09-05T00:00:00Z' }),
    ];
    expect(currentRaiser(rows)?.id).toBe('soon');
  });

  it('stands over nothing when everything is finished', () => {
    // A card headed "Currently Authorised" over something that grants nobody
    // anything is the reading a person acts on wrongly.
    expect(currentRaiser([row({ status: 'expired' }), row({ status: 'revoked' })])).toBeNull();
    expect(currentRaiser([])).toBeNull();
  });
});

describe('what may still be revoked', () => {
  it('offers the button only where pressing it changes something', () => {
    expect(canRevokeRaiser(row({ status: 'active' }))).toBe(true);
    expect(canRevokeRaiser(row({ status: 'scheduled' }))).toBe(true);
    expect(canRevokeRaiser(row({ status: 'expired' }))).toBe(false);
    expect(canRevokeRaiser(row({ status: 'revoked' }))).toBe(false);
  });
});

describe('naming a person', () => {
  it('brackets the department so two of a name can be told apart', () => {
    expect(raiserLabel(row())).toBe('Anita Rao (Housekeeping)');
    expect(raiserCandidateLabel({ id: 'u', full_name: 'Anita Rao', department_name: 'IT' }))
      .toBe('Anita Rao (IT)');
  });

  it('never prints "(null)" when VMS gives back no name or no department', () => {
    expect(raiserLabel(row({ raiser_name: null, department_name: null }))).toBe('Unnamed account');
    expect(raiserLabel(row({ department_name: '  ' }))).toBe('Anita Rao');
    expect(raiserCandidateLabel({ id: 'u', full_name: null, department_name: null }))
      .toBe('Unnamed account');
  });
});

// The timeline is where the history goes, now that the card shows only the
// latest state. Client, 2026-08-11: "When people are clicking on the card for
// more details, in those details you can show the timeline when it was first
// matched."
//
// Two matches exist on a returnable pass — the OUTWARD clearance and the
// return — and both must appear, because the collapsed card no longer says
// either. Defined once here so the compact card, the drill card and the pass
// detail page can never disagree about what happened when.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { passTimeline } from '../../src/lib/passTimeline';

const T = {
  raised: '2026-08-01T04:00:00Z',
  flagged: '2026-08-01T05:00:00Z',
  override: '2026-08-01T06:00:00Z',
  matched: '2026-08-01T07:00:00Z',
  returned: '2026-08-03T07:00:00Z',
};

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    type: 'RGP',
    status: 'matched',
    return_status: 'awaiting_return',
    created_at: T.raised,
    verified_at: null,
    flag_reason: null,
    flagged_at: null,
    hod_reviewed_at: null,
    actual_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const labels = (p: GatePassView) => passTimeline(p).map((m) => m.label);

describe('passTimeline', () => {
  it('always starts with Raised', () => {
    expect(passTimeline(pass({ status: 'pending', return_status: 'not_applicable' }))).toEqual([
      { label: 'Raised', at: T.raised },
    ]);
  });

  it('records the outward clearance as "Cleared Out", not "Matched"', () => {
    const p = pass({ status: 'matched', verified_at: T.matched });
    expect(labels(p)).toEqual(['Raised', 'Cleared Out']);
    expect(passTimeline(p)[1].at).toBe(T.matched);
  });

  it('records the return as its own moment', () => {
    const p = pass({ status: 'matched', verified_at: T.matched, return_status: 'returned', actual_return_date: T.returned });
    expect(labels(p)).toEqual(['Raised', 'Cleared Out', 'Returned']);
    expect(passTimeline(p)[2].at).toBe(T.returned);
  });

  it('records the mismatch and the HOD override in order', () => {
    const p = pass({
      status: 'matched',
      flag_reason: 'Count short by 2',
      flagged_at: T.flagged,
      hod_reviewed_at: T.override,
      verified_at: T.matched,
    });
    expect(labels(p)).toEqual(['Raised', 'Rejected at security gate', 'Override', 'Cleared Out']);
  });

  // The old card only rendered "Override" while `status === 'hod_reviewed'`,
  // so the moment vanished the instant the gate matched the fresh pass — which
  // is exactly when a reader most wants to see that an override happened.
  it('keeps the Override moment after the pass goes on to match', () => {
    const p = pass({ status: 'matched', hod_reviewed_at: T.override, verified_at: T.matched });
    expect(labels(p)).toContain('Override');
  });

  it('omits Cleared Out for a pass still waiting at the gate', () => {
    expect(labels(pass({ status: 'pending', return_status: 'not_applicable', verified_at: null }))).toEqual([
      'Raised',
    ]);
  });

  it('omits Returned while the pass is only partly back', () => {
    const p = pass({ return_status: 'partially_returned', verified_at: T.matched, actual_return_date: null });
    expect(labels(p)).toEqual(['Raised', 'Cleared Out']);
  });
});

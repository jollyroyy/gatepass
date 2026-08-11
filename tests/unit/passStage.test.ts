// ONE badge per pass, and it says where the pass is NOW.
//
// Client complaint, 2026-08-11 (second round): "In the card section if the
// passes are closed, completely returned, just put it closed. Don't show
// matched returned. Only show what is the latest status. Maybe it is matched
// but it has gone out so you don't have to show the match in the main card."
//
// The first round (rgpLifecycle) added a SECOND pill beside the status badge,
// so a closed RGP read "Matched  Closed" and one still outside read
// "Matched  Out — Not Returned". That is two facts where the reader wanted the
// latest one. `passStageStyle` collapses them: the outward match is history
// the moment the return loop starts, and history belongs in the timeline.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { passStageStyle } from '../../src/lib/passStage';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    type: 'RGP',
    status: 'matched',
    return_status: 'awaiting_return',
    is_overdue: false,
    is_expired: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('passStageStyle — the single latest-state badge', () => {
  it('reads "Closed" for a fully returned RGP, never "Matched"', () => {
    expect(passStageStyle(pass({ return_status: 'returned' })).label).toBe('Closed');
  });

  it('reads "Out — Not Returned" for an RGP the gate cleared outward', () => {
    expect(passStageStyle(pass({ return_status: 'awaiting_return' })).label).toBe('Out — Not Returned');
  });

  it('reads "Partly Returned" in between', () => {
    expect(passStageStyle(pass({ return_status: 'partially_returned' })).label).toBe('Partly Returned');
  });

  // An NRGP never comes back, so the outward match IS its final state and
  // "Matched" is the latest thing that happened to it.
  it('keeps "Matched" for an NRGP', () => {
    expect(
      passStageStyle(pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' })).label,
    ).toBe('Matched');
  });

  it('falls back to the status badge before the pass reaches the gate', () => {
    expect(passStageStyle(pass({ status: 'pending', return_status: 'not_applicable' })).label).toBe(
      'Pending Gate Review',
    );
  });

  it('reads "Mismatched" for a flagged pass', () => {
    expect(passStageStyle(pass({ status: 'flagged', return_status: 'not_applicable' })).label).toBe(
      'Mismatched',
    );
  });

  // The precedence that pre-wires the return-leg flag the client asked for:
  // a pass stopped on the way back IN must read as a mismatch, not as the
  // routine "still out" stage it is technically also in.
  it('lets a flag outrank the return loop', () => {
    expect(passStageStyle(pass({ status: 'flagged', return_status: 'awaiting_return' })).label).toBe(
      'Mismatched',
    );
  });

  it('lets a hold outrank the return loop', () => {
    expect(passStageStyle(pass({ status: 'held', return_status: 'partially_returned' })).label).toBe(
      'Held at Gate',
    );
  });

  it('reads "HOD Approved" for an overridden pass still at the gate', () => {
    expect(passStageStyle(pass({ status: 'hod_reviewed', return_status: 'not_applicable' })).label).toBe(
      'HOD Approved',
    );
  });

  // Expiry beats everything: a pending pass whose day ran out cannot be used,
  // and that is the most recent thing to have happened to it.
  it('reads "Expired" for a pending pass past its day', () => {
    expect(passStageStyle(pass({ status: 'pending', return_status: 'not_applicable', is_expired: true })).label)
      .toBe('Expired');
  });

  // Overdue re-TONES an open stage; it never renames it. Several KPI cards and
  // drills are named "Overdue" and exact-text lookups of those must stay
  // unambiguous — the rule PassRow already followed for the status badge.
  it('never renames an overdue pass to "Overdue"', () => {
    const s = passStageStyle(pass({ return_status: 'awaiting_return', is_overdue: true }));
    expect(s.label).toBe('Out — Not Returned');
    expect(s.text).toContain('overdue');
  });

  it('does not tone a closed pass as overdue — the obligation is discharged', () => {
    const s = passStageStyle(pass({ return_status: 'returned', is_overdue: true }));
    expect(s.label).toBe('Closed');
    expect(s.text).not.toContain('overdue');
  });
});

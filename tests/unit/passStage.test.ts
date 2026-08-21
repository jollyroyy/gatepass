// RENAMED 2026-08-21: every assertion in this file that read "Out — Not Returned"
// now reads "In Progress", and "Partly Returned" reads "Partially Returned"
// (client: "for the status of those passes which have not been returned yet,
// just make them from 'not in progress' to 'in progress'. Within 'in progress'
// you can mention it as 'partially returned'"). The labels are the only thing
// that moved — no stage, tone or precedence rule changed with them.
// ONE badge per pass, and it says where the pass is NOW.
//
// Client complaint, 2026-08-11 (second round): "In the card section if the
// passes are closed, completely returned, just put it closed. Don't show
// matched returned. Only show what is the latest status. Maybe it is matched
// but it has gone out so you don't have to show the match in the main card."
//
// The first round (rgpLifecycle) added a SECOND pill beside the status badge,
// so a closed RGP read "Matched  Closed" and one still outside read
// "Matched  In Progress". That is two facts where the reader wanted the
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

  it('reads "In Progress" for an RGP the gate cleared outward', () => {
    expect(passStageStyle(pass({ return_status: 'awaiting_return' })).label).toBe('In Progress');
  });

  it('reads "Partially Returned" in between', () => {
    expect(passStageStyle(pass({ return_status: 'partially_returned' })).label).toBe('Partially Returned');
  });

  // An NRGP never comes back, so the outward match IS its final state — and the
  // word for a finished pass is "Closed" (client, 2026-08-18: nothing reads
  // "Matched"; the match is a moment in the timeline, not a state).
  it('reads "Closed" for a cleared NRGP, never "Matched"', () => {
    expect(
      passStageStyle(pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' })).label,
    ).toBe('Closed');
  });

  it('falls back to the status badge before the pass reaches the gate', () => {
    expect(passStageStyle(pass({ status: 'pending', return_status: 'not_applicable' })).label).toBe(
      'Pending Gate Review',
    );
  });

  // THE LADDER AND THE GATE ARE TWO DIFFERENT DESKS (client, 2026-08-20: "the
  // passes which are pending for approval are showing as pending gate
  // approvals, which should not be okay … after all the approvals, if it is
  // only waiting for the gate approval, then only show the pending for gate
  // approval, across all the views"). A pass still climbing is invisible to the
  // guard by RLS (046), so calling it "Pending Gate Review" named a queue that
  // did not contain it.
  it('reads "Pending Approval" while the pass still owes a signature', () => {
    expect(
      passStageStyle(pass({ status: 'pending', return_status: 'not_applicable', awaits_approval: true })).label,
    ).toBe('Pending Approval');
  });

  it('reads "Pending Gate Review" once the ladder is finished', () => {
    expect(
      passStageStyle(pass({ status: 'pending', return_status: 'not_applicable', awaits_approval: false })).label,
    ).toBe('Pending Gate Review');
  });

  // Falsy is the safe reading, and it is the same one `pendingSplit` takes: a
  // pass with no ladder rows owes nothing, which is exactly every pass raised
  // before the workflow began and every level closed by 058's rollout.
  it('treats a MISSING `awaits_approval` as owing nothing', () => {
    expect(passStageStyle(pass({ status: 'pending', return_status: 'not_applicable' })).label).toBe(
      'Pending Gate Review',
    );
  });

  // Expiry outranks it: a pass whose day ran out cannot be used whoever it is
  // waiting on, and that is the last thing that happened to it.
  it('lets Expired outrank a pass that is still climbing', () => {
    expect(
      passStageStyle(pass({
        status: 'pending', return_status: 'not_applicable', is_expired: true, awaits_approval: true,
      })).label,
    ).toBe('Expired');
  });

  it('reads "Rejected at Security Gate" for a flagged pass', () => {
    expect(passStageStyle(pass({ status: 'flagged', return_status: 'not_applicable' })).label).toBe(
      'Rejected at Security Gate',
    );
  });

  // The precedence that pre-wires the return-leg flag the client asked for:
  // a pass stopped on the way back IN must read as a mismatch, not as the
  // routine "still out" stage it is technically also in.
  it('lets a flag outrank the return loop', () => {
    expect(passStageStyle(pass({ status: 'flagged', return_status: 'awaiting_return' })).label).toBe(
      'Rejected at Security Gate',
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

  // Overdue used to re-TONE an open stage without renaming it, so the fact was
  // carried by colour alone — nothing at all on the mono laser the register
  // prints on, or in the CSV. Client, 2026-08-18: the status must SAY overdue.
  it('renames an overdue open pass to "Overdue"', () => {
    const s = passStageStyle(pass({ return_status: 'awaiting_return', is_overdue: true }));
    expect(s.label).toBe('Overdue');
    expect(s.text).toContain('overdue');
  });

  it('does not tone a closed pass as overdue — the obligation is discharged', () => {
    const s = passStageStyle(pass({ return_status: 'returned', is_overdue: true }));
    expect(s.label).toBe('Closed');
    expect(s.text).not.toContain('overdue');
  });
});

// RENAMED 2026-08-21: every assertion in this file that read "Out — Not Returned"
// now reads "In Progress", and "Partly Returned" reads "Partially Returned"
// (client: "for the status of those passes which have not been returned yet,
// just make them from 'not in progress' to 'in progress'. Within 'in progress'
// you can mention it as 'partially returned'"). The labels are the only thing
// that moved — no stage, tone or precedence rule changed with them.
// The register's Status column names WHERE THE PASS IS, not which enum row it
// sits on. Client, 2026-08-18: "in the reports you are mentioning the status as
// matched — it should be closed, partially returned, overdue, or expired."
//
// `matched` is the outward clearance and freezes there (see passStage.ts), so on
// its own it tells a reader nothing about the material: an NRGP that is finished
// forever and an RGP standing outside the mall both read "Matched". Every
// surface — badge and CSV alike — goes through `passStageStyle` now, so the
// printed sheet says exactly what the screen says.
import { describe, it, expect } from 'vitest';
import { passStageStyle } from '../../src/lib/passStage';
import { csvStatus } from '../../src/lib/csvCells';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    status: 'matched', return_status: 'not_applicable', is_expired: false, is_overdue: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('a pass never reads "Matched"', () => {
  it('calls a cleared NRGP Closed — it is through the gate and never coming back', () => {
    const p = pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' });
    expect(passStageStyle(p).label).toBe('Closed');
    expect(csvStatus(p)).toBe('Closed');
  });

  it('calls a fully returned RGP Closed', () => {
    const p = pass({ status: 'matched', return_status: 'returned' });
    expect(passStageStyle(p).label).toBe('Closed');
    expect(csvStatus(p)).toBe('Closed');
  });

  it('calls a half-returned RGP Partially Returned', () => {
    const p = pass({ status: 'matched', return_status: 'partially_returned' });
    expect(passStageStyle(p).label).toBe('Partially Returned');
    expect(csvStatus(p)).toBe('Partially Returned');
  });

  // `is_overdue` comes off v_gate_passes and is never recomputed here. It used
  // to re-TONE the badge orange while keeping the "In Progress" wording;
  // the colour is not information on a mono laser print, so it names itself now.
  it('calls a late RGP Overdue, not "In Progress"', () => {
    const p = pass({ status: 'matched', return_status: 'awaiting_return', is_overdue: true });
    expect(passStageStyle(p).label).toBe('Overdue');
    expect(csvStatus(p)).toBe('Overdue');
  });

  it('still calls an RGP that is out and on time "In Progress"', () => {
    const p = pass({ status: 'matched', return_status: 'awaiting_return' });
    expect(passStageStyle(p).label).toBe('In Progress');
  });

  it('calls a pending pass past its expiry Expired', () => {
    const p = pass({ status: 'pending', return_status: 'not_applicable', is_expired: true });
    expect(passStageStyle(p).label).toBe('Expired');
    expect(csvStatus(p)).toBe('Expired');
  });

  it('leaves the states that are a decision, not a stage, alone', () => {
    expect(csvStatus(pass({ status: 'flagged' }))).toBe('Rejected at Security Gate');
    expect(csvStatus(pass({ status: 'pending' }))).toBe('Pending Gate Review');
    expect(csvStatus(pass({ status: 'cancelled' }))).toBe('Voided');
  });
});

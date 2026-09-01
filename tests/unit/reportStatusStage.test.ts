// RENAMED THREE TIMES. 2026-08-21 collapsed both open stages onto the SAME
// word, "Partially Returned", and the closed stage read "Closed". 2026-09-01
// undid the collapse (client: "its status should be changed to returned or
// partially returned only when any of its items has been returned"; "once a
// NRGP gate pass is cleared out the status of it should show as out") — a
// pass with nothing back reads "Out — Awaiting Return", a fully returned RGP
// reads "Returned", and a cleared NRGP reads "Out — No Return Due" instead of
// sharing the RGP's own closing word. Only the labels moved; no stage, tone
// or precedence rule changed with them.
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
  it('calls a cleared NRGP Out — No Return Due — it is through the gate and never coming back', () => {
    const p = pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' });
    expect(passStageStyle(p).label).toBe('Out — No Return Due');
    expect(csvStatus(p)).toBe('Out — No Return Due');
  });

  it('calls a fully returned RGP Returned', () => {
    const p = pass({ status: 'matched', return_status: 'returned' });
    expect(passStageStyle(p).label).toBe('Returned');
    expect(csvStatus(p)).toBe('Returned');
  });

  it('calls a half-returned RGP Partially Returned', () => {
    const p = pass({ status: 'matched', return_status: 'partially_returned' });
    expect(passStageStyle(p).label).toBe('Partially Returned');
    expect(csvStatus(p)).toBe('Partially Returned');
  });

  // `is_overdue` comes off v_gate_passes and is never recomputed here. It used
  // to re-TONE the badge orange while keeping the "Partially Returned" wording;
  // the colour is not information on a mono laser print, so it names itself now.
  it('calls a late RGP Overdue, not "Out — Awaiting Return"', () => {
    const p = pass({ status: 'matched', return_status: 'awaiting_return', is_overdue: true });
    expect(passStageStyle(p).label).toBe('Overdue');
    expect(csvStatus(p)).toBe('Overdue');
  });

  it('calls an RGP that is out, on time and has nothing back "Out — Awaiting Return"', () => {
    const p = pass({ status: 'matched', return_status: 'awaiting_return' });
    expect(passStageStyle(p).label).toBe('Out — Awaiting Return');
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

// THE REJECTED FIGURE AND ITS TWO SUB-COUNTS (client, 2026-08-20: "show a
// dashboard KPI card of rejected ... below that put it — rejected at security
// gate, rejected by approver — show exact count").
//
// The load-bearing property is that a VOIDED EXPIRED PASS is in neither bucket.
// It is `cancelled` with no flag reason — byte for byte what an approval
// rejection looks like in `gate_passes` alone — so the ladder's own rows are
// what tell them apart. Nobody rejected a pass that merely ran out of time.
import { describe, expect, it } from 'vitest';
import type { GatePassView } from '../../src/types';
import { rejectionNotes, rejectionSplit, type RejectionApprovalRow } from '../../src/lib/rejectionSplit';

function pass(over: Partial<GatePassView>): GatePassView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id: 'p', status: 'pending', flag_reason: null, ...over } as any;
}

const ROWS: GatePassView[] = [
  // The guard pressed Reject; the HOD has not reviewed it yet.
  pass({ id: 'g1', status: 'flagged', flag_reason: 'Quantity short' }),
  // The guard rejected it and the HOD UPHELD that — same event, one desk.
  pass({ id: 'g2', status: 'cancelled', flag_reason: 'Wrong vehicle' }),
  // An office on the ladder rejected it; it never reached the gate.
  pass({ id: 'a1', status: 'cancelled' }),
  // Ran out of time and the HOD voided it. NOBODY rejected this.
  pass({ id: 'v1', status: 'cancelled' }),
  // Ordinary live passes.
  pass({ id: 'ok', status: 'matched' }),
  pass({ id: 'wait', status: 'pending' }),
];

const APPROVALS: RejectionApprovalRow[] = [
  { gate_pass_id: 'a1', status: 'rejected' },
  // Same pass, an untouched rung below the rejection — must not double-count.
  { gate_pass_id: 'a1', status: 'pending' },
  { gate_pass_id: 'wait', status: 'pending' },
];

describe('rejectionSplit', () => {
  it('counts the guard\'s rejection and the HOD upholding it at the SAME desk', () => {
    const s = rejectionSplit(ROWS, APPROVALS);
    expect(s.atGate.map((p) => p.id)).toEqual(['g1', 'g2']);
  });

  it('counts a ladder rejection against the approver, once', () => {
    const s = rejectionSplit(ROWS, APPROVALS);
    expect(s.byApprover.map((p) => p.id)).toEqual(['a1']);
  });

  it('puts a VOIDED EXPIRED pass in neither bucket — nobody rejected it', () => {
    const s = rejectionSplit(ROWS, APPROVALS);
    expect(s.all.map((p) => p.id)).not.toContain('v1');
  });

  it('the two sub-figures sum to the figure above them, by construction', () => {
    const s = rejectionSplit(ROWS, APPROVALS);
    expect(s.all).toHaveLength(s.atGate.length + s.byApprover.length);
    expect(s.all).toHaveLength(3);
  });

  it('counts nothing on a board with no rejections', () => {
    const s = rejectionSplit([pass({ id: 'ok', status: 'matched' })], []);
    expect(s.all).toHaveLength(0);
  });

  it('prints the client\'s own two lines, pluralised', () => {
    expect(rejectionNotes(rejectionSplit(ROWS, APPROVALS)).map((n) => n.text)).toEqual([
      '2 passes rejected at security gate',
      '1 pass rejected by approver',
    ]);
  });
});

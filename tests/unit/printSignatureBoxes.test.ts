// THE SIGNATURE BOXES ON THE PRINTED SLIP (src/lib/printSignatureBoxes.ts).
//
// Client, 2026-08-22: "go back to the boxes that were there before. Make sure
// for all the approvals if the approval has been given, give a tick box inside
// that box … Also give the approval date when it was approved."
//
// The boxes are derived from the record's OWN `ApprovalStep[]`, so the paper
// and the screen cannot name a different office, person or moment. What this
// file pins is the translation: which rung becomes which kind of box, what the
// box is headed by, and the two rungs that get no box at all.
import { describe, it, expect } from 'vitest';
import {
  buildSignatureBoxes, receiverBoxApplies, returnReceipt, signerName, type ReturnReceipt,
} from '../../src/lib/printSignatureBoxes';
import type { ApprovalStep } from '../../src/lib/passLadderLegs';

function step(over: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    key: 'level-coo',
    office: 'coo',
    label: 'Level 3 Approval',
    who: 'COO (Vikram Singh)',
    detail: 'Operations',
    at: '2026-08-21T05:30:00Z',
    state: 'done',
    ...over,
  };
}

describe('a rung becomes a box', () => {
  it('an approved rung is signed, and keeps its moment', () => {
    const [box] = buildSignatureBoxes([step()]);
    expect(box.state).toBe('signed');
    expect(box.at).toBe('2026-08-21T05:30:00Z');
    expect(box.caption).toBe('Approved in Quest GatePass');
  });

  it('a rejected rung is a cross, not an empty box', () => {
    const [box] = buildSignatureBoxes([step({ state: 'blocked' })]);
    expect(box.state).toBe('rejected');
  });

  // 063: the COO and the CEO share level 3, and one signature closes it.
  it('a skipped rung reads Not required and names NOBODY', () => {
    const [box] = buildSignatureBoxes([step({ state: 'skipped', who: 'CEO', office: 'ceo' })]);
    expect(box.state).toBe('not_required');
    expect(box.caption).toBe('Not required');
    // Nobody pressed anything, so no name goes in the box.
    expect(box.signer).toBeNull();
  });

  it('an undecided rung is awaiting, with nothing inside it', () => {
    const [box] = buildSignatureBoxes([step({ state: 'pending', at: null, who: null })]);
    expect(box.state).toBe('awaiting');
    expect(box.signer).toBeNull();
    expect(box.at).toBeNull();
  });

  // A vacant office and an unsigned one look the same to the person holding the
  // sheet; the record on screen is where a designation gets fixed.
  it('an office nobody holds is awaiting too, not a state of its own', () => {
    const [box] = buildSignatureBoxes([step({ state: 'unset', at: null })]);
    expect(box.state).toBe('awaiting');
  });
});

describe('a box is headed by the office, and holds the person', () => {
  it('heads an approval box with the office title', () => {
    const [box] = buildSignatureBoxes([step()]);
    expect(box.label).toBe('COO');
    // The office is the heading, so the box itself carries the person alone.
    expect(box.signer).toBe('Vikram Singh');
  });

  it('keeps the slip words for the raise and the gate', () => {
    const boxes = buildSignatureBoxes([
      step({ key: 'raised', office: undefined, label: 'Raised By', who: 'HOD One' }),
      step({ key: 'gate', office: undefined, label: 'Cleared by Security', who: 'Guard Sam' }),
    ]);
    expect(boxes.map((b) => b.label).slice(0, 2))
      .toEqual(['Issuing HOD', 'Security Verification']);
  });

  it('leaves a delegated signature as it stands rather than guessing at it', () => {
    expect(signerName('COO (Priya — delegated by Vikram)', 'COO'))
      .toBe('Priya — delegated by Vikram');
    expect(signerName('COO', 'COO')).toBeNull();
    expect(signerName(null, 'COO')).toBeNull();
  });
});

describe('the boxes the slip does and does not draw', () => {
  it('ends with the receiver, and that one is blank by design', () => {
    const boxes = buildSignatureBoxes([step()]);
    const last = boxes[boxes.length - 1];
    expect(last.label).toBe('Receiver Signature');
    expect(last.state).toBe('blank');
    expect(last.caption).toBe('Signature & Stamp');
  });

  it('draws no box for the return leg — a deadline is not a signature', () => {
    const boxes = buildSignatureBoxes([
      step(),
      step({ key: 'return', office: undefined, label: 'To Be Returned', state: 'pending' }),
    ]);
    expect(boxes.map((b) => b.key)).toEqual(['level-coo', 'receiver']);
  });
});

// ─── The receiver's box, once the material is actually back ─────────────────
// Client, 2026-08-23: "make sure you also put the receiver signature as a box,
// same as the other approvals. Once the pass is fully returned — all the items
// fully returned — you make it tick with the date, with the security guard's
// name who did the return."
describe("the receiver's box", () => {
  const RETURNED = { type: 'RGP', return_status: 'returned', actual_return_date: '2026-08-23T11:00:00Z' } as const;
  const EVENT = { action: 'returned', security_name: 'Guard Sam', created_at: '2026-08-23T10:59:00Z' } as const;

  function receiverOf(steps: ApprovalStep[], receipt: ReturnReceipt | null) {
    const boxes = buildSignatureBoxes(steps, receipt);
    return boxes[boxes.length - 1];
  }

  it('is ticked, dated and named once every line is back', () => {
    const receipt = returnReceipt(RETURNED, [EVENT]);
    expect(receipt).toEqual({ who: 'Guard Sam', at: '2026-08-23T11:00:00Z' });
    const box = receiverOf([step()], receipt);
    expect(box.state).toBe('signed');
    expect(box.signer).toBe('Guard Sam');
    expect(box.at).toBe('2026-08-23T11:00:00Z');
    expect(box.caption).toBe('Return received in Quest GatePass');
  });

  it('names the guard who recorded the LAST movement, not the first', () => {
    expect(returnReceipt(RETURNED, [
      { ...EVENT, security_name: 'Guard One', created_at: '2026-08-20T08:00:00Z' },
      { action: 'matched', security_name: 'Guard Two', created_at: '2026-08-21T08:00:00Z' },
      { ...EVENT, security_name: 'Guard Three' },
    ])?.who).toBe('Guard Three');
  });

  // A LEFT JOIN into VMS degrades to a missing name, never to a missing fact:
  // the material is back either way, and the tick states that.
  it('still ticks when no name resolved, and falls back to the pass moment', () => {
    expect(returnReceipt(RETURNED, [])).toEqual({ who: null, at: '2026-08-23T11:00:00Z' });
    expect(returnReceipt(RETURNED, [{ ...EVENT, security_name: null }])).toEqual({
      who: null, at: '2026-08-23T11:00:00Z',
    });
  });

  it('stays blank while anything is still out, and on a pass that never comes back', () => {
    expect(returnReceipt({ ...RETURNED, return_status: 'partially_returned' }, [EVENT])).toBeNull();
    expect(returnReceipt({ ...RETURNED, return_status: 'awaiting_return' }, [])).toBeNull();
    expect(returnReceipt({ ...RETURNED, type: 'NRGP' }, [EVENT])).toBeNull();
    const box = receiverOf([step()], null);
    expect(box.state).toBe('blank');
    expect(box.caption).toBe('Signature & Stamp');
    expect(box.signer).toBeNull();
  });
});

// ─── An NRGP has no receiver ────────────────────────────────────────────────
// Client, 2026-08-31: "for NRGP passes while taking printouts, don't show
// receiver signature in the print page, just show security desk gate clearance
// for out signature, but show both for RGP".
//
// Nothing on an NRGP is coming back, so the box could never be signed by
// anybody: on paper an empty box reads as a signature somebody still owes, and
// this one nobody does. The gate's own box is untouched — that IS the outward
// clearance, and it is drawn from the `gate` rung for both pass types.
describe('the receiver box belongs to the RGP alone', () => {
  it('applies to an RGP and never to an NRGP', () => {
    expect(receiverBoxApplies('RGP')).toBe(true);
    expect(receiverBoxApplies('NRGP')).toBe(false);
  });

  it('is omitted entirely when it does not apply, gate clearance kept', () => {
    const steps = [step({ key: 'gate', office: undefined, label: 'Security Verification' })];
    const boxes = buildSignatureBoxes(steps, null, receiverBoxApplies('NRGP'));
    expect(boxes.map((b) => b.key)).toEqual(['gate']);
    expect(boxes[0].label).toBe('Security Verification');
  });

  it('is still drawn for an RGP that has not come back yet', () => {
    const boxes = buildSignatureBoxes([step()], null, receiverBoxApplies('RGP'));
    expect(boxes.map((b) => b.key)).toEqual(['level-coo', 'receiver']);
  });
});

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
import { buildSignatureBoxes, signerName } from '../../src/lib/printSignatureBoxes';
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

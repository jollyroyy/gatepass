// A SIGNATURE IS A MARK OF ASSENT, AND THE PAPER MAY NOT MAKE ONE UP.
//
// Client, 2026-09-01: "give one option for them to upload their signature in
// one of the left-side panels. Whatever they have uploaded there, the same
// signature will be shown on the print pass page after they approve it.
// Suppose I'm the security head and I have approved one of the passes — once I
// approve it, whatever I uploaded, that signature should show up in the print
// pass. Don't show the signature until and unless I approve."
//
// THE LAST SENTENCE IS THE WHOLE FEATURE. An uploaded signature is a file that
// belongs to a PERSON; a printed signature is a claim about a DECISION. The two
// must never be joined by anything looser than a recorded act on this pass, or
// the slip is a forgery this system committed by itself — worse than no
// signature at all, because it is a plausible one.
//
// The join is made twice, and both are pinned here:
//
//   in the database  `get_pass_signatures` (075) returns a row only where a
//                    person really raised / approved / cleared / received THIS
//                    pass. A pending, rejected or not-required rung: no row.
//   in this module   `buildSignatureBoxes` attaches a URL only to a box whose
//                    state is already `signed`. Even if the RPC were to hand it
//                    a signature for an unsigned slot, the box would refuse it.
//
// The second is not redundant with the first. It is what makes the rule true of
// the ONE function that draws the box, so a future caller passing a different
// map cannot reintroduce the defect.
import { describe, it, expect } from 'vitest';
import type { ApprovalStep } from '../../src/lib/passLadderLegs';
import { buildSignatureBoxes } from '../../src/lib/printSignatureBoxes';

const SIG = 'https://example.supabase.co/storage/v1/object/public/avatars/u1/signature';

function step(over: Partial<ApprovalStep> & Pick<ApprovalStep, 'key' | 'state'>): ApprovalStep {
  return {
    label: 'Level', who: 'Priya Mehta', detail: null, at: '2026-09-01T10:00:00Z', ...over,
  } as ApprovalStep;
}

const approved = step({ key: 'level-security_head', state: 'done', office: 'security_head' });
const rejected = step({ key: 'level-finance_head', state: 'blocked', office: 'finance_head' });
const waiting = step({ key: 'level-coo', state: 'pending', office: 'coo', who: null });
const skipped = step({ key: 'level-ceo', state: 'skipped', office: 'ceo', who: null });

const SIGNATURES = {
  security_head: SIG,
  finance_head: SIG,
  coo: SIG,
  ceo: SIG,
  raised: SIG,
  gate: SIG,
  receiver: SIG,
};

function boxes(steps: ApprovalStep[], sigs = SIGNATURES) {
  return buildSignatureBoxes(steps, null, false, sigs);
}

function boxFor(steps: ApprovalStep[], key: string, sigs = SIGNATURES) {
  return boxes(steps, sigs).find((b) => b.key === key);
}

describe('a signature prints only against a decision that was really made', () => {
  it('prints the approver’s signature once that office has approved', () => {
    expect(boxFor([approved], 'level-security_head')?.signatureUrl).toBe(SIG);
  });

  // The client's sentence is "until and unless I APPROVE". A refusal is a real
  // decision, but a signature under it reads on paper as consent to the very
  // movement that was refused, so the box keeps its ✗ and its name and stays
  // unsigned.
  it('prints nothing for an office that REJECTED it', () => {
    expect(boxFor([rejected], 'level-finance_head')?.signatureUrl).toBeNull();
  });

  it('prints nothing for a rung still waiting', () => {
    expect(boxFor([waiting], 'level-coo')?.signatureUrl).toBeNull();
  });

  // 063: the COO and the CEO share level 3 and one signature closes it. The
  // other office's box reads "Not required" — NOBODY signed it, so a mark in it
  // would be a signature nobody gave, which is the exact failure this file
  // exists to prevent.
  it('prints nothing in a rung closed as not required by the other office', () => {
    expect(boxFor([skipped], 'level-ceo')?.signatureUrl).toBeNull();
  });

  it('leaves every other box exactly as it was — state, signer, date, caption', () => {
    const [withSig] = boxes([approved]);
    const [without] = boxes([approved], {});
    expect(withSig.state).toBe(without.state);
    expect(withSig.signer).toBe(without.signer);
    expect(withSig.at).toBe(without.at);
    expect(withSig.caption).toBe(without.caption);
    expect(without.signatureUrl).toBeNull();
  });

  it('is null everywhere when nobody has uploaded one', () => {
    for (const box of boxes([approved, rejected, waiting, skipped], {})) {
      expect(box.signatureUrl).toBeNull();
    }
  });

  // The raise rung is `done` from the moment the pass exists — raising IS the
  // issuing HOD's act, and there is nobody for them to wait on (2026-08-19).
  it('prints the raiser’s signature, whose act is the pass itself', () => {
    const raised = step({ key: 'raised', state: 'done', boxLabel: 'Issuing HOD' });
    expect(boxFor([raised], 'raised')?.signatureUrl).toBe(SIG);
  });

  it('prints the gate’s signature only once it cleared the material out', () => {
    const cleared = step({ key: 'gate', state: 'done' });
    const atBarrier = step({ key: 'gate', state: 'pending', who: null });
    expect(boxFor([cleared], 'gate')?.signatureUrl).toBe(SIG);
    expect(boxFor([atBarrier], 'gate')?.signatureUrl).toBeNull();
  });

  // The receiver's box is `blank` rather than `awaiting` until the material is
  // back — a different state, and equally unsigned.
  it('prints the receiver’s signature only once every line is back', () => {
    const open = buildSignatureBoxes([], null, true, SIGNATURES);
    expect(open.find((b) => b.key === 'receiver')?.signatureUrl).toBeNull();

    const closed = buildSignatureBoxes(
      [], { who: 'R. Iyer', at: '2026-09-01T12:00:00Z' }, true, SIGNATURES,
    );
    expect(closed.find((b) => b.key === 'receiver')?.signatureUrl).toBe(SIG);
  });

  // Defence in depth against the RPC: the box's own state is the authority, so
  // a signature arriving for a slot nobody signed is discarded here too.
  it('refuses a signature handed to it for an unsigned box', () => {
    const forged = { finance_head: SIG, coo: SIG, ceo: SIG };
    expect(boxFor([rejected], 'level-finance_head', forged)?.signatureUrl).toBeNull();
    expect(boxFor([waiting], 'level-coo', forged)?.signatureUrl).toBeNull();
    expect(boxFor([skipped], 'level-ceo', forged)?.signatureUrl).toBeNull();
  });

  // The map is optional, so every existing caller keeps working and prints the
  // slip it printed yesterday.
  it('defaults to no signatures at all when no map is passed', () => {
    for (const box of buildSignatureBoxes([approved], null, true)) {
      expect(box.signatureUrl).toBeNull();
    }
  });
});

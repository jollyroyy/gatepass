// THE SIGNATURE BOXES ON THE PRINTED SLIP — back, and carrying the digital
// approval inside them.
//
// Client, 2026-08-22: "In the print pass, when we are trying to take the print
// pass, please go back to the boxes that were there before. Make sure for all
// the approvals if the approval has been given, give a tick box inside that
// box … Also give the approval date when it was approved."
//
// THIS REVERSES THE SAME DAY'S REMOVAL OF THE BOXES, and it is not a straight
// revert. `signatureBlocks.ts` drew seven EMPTY boxes with a rule to sign on,
// and it was deleted because the four offices stopped signing paper the day 046
// shipped — a blank box beside a real digital approval invites somebody to sign
// the paper and believe that counted. `PrintApprovalRecord`, the table that
// replaced it, is deleted in turn: the boxes are what a reader of this document
// looks for, and the answer is to put the DECISION inside the box rather than
// to choose between the two.
//
// So a box is now one of four things, and every one of them is a WORD as well
// as a mark, because the slip is read on a cheap mono laser:
//
//   signed        ✓  the office approved it, with who and when inside the box
//   rejected      ✗  the office refused it, with who and when
//   not required  —  the other office on a shared rung signed it (063)
//   awaiting         nothing has happened yet: an empty box, and it says so
//
// IT IS BUILT FROM THE RECORD'S OWN `ApprovalStep[]` — the very steps the pass
// record's timeline draws — so the sheet in a guard's hand and the screen on
// the desk cannot name a different office, person or moment. Change the ladder
// and the paper follows for free.
//
// THE RECEIVER'S BOX IS THE ONE BOX THAT IS STILL BLANK BY DESIGN. Nobody
// receives material in this system — there is no receipt RPC, no column and no
// screen — so it is the one signature the paper still collects, and printing it
// with a tick would be a receipt nobody gave.
import type { ApprovalStep } from './passLadderLegs';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from './approvalLadder';

export type BoxState = 'signed' | 'rejected' | 'not_required' | 'awaiting' | 'blank';

export interface SignatureBoxView {
  key: string;
  /** The office, as a person signing paper reads it — "Security Head", "COO". */
  label: string;
  /** Who signed, without the office repeated: the label above already says it. */
  signer: string | null;
  /** ISO, or null when this system records no moment for the box. */
  at: string | null;
  state: BoxState;
  /** The sentence under the rule. Never colour-dependent. */
  caption: string;
}

/** The rung that is not an approval office and not the gate. It is a deadline,
 *  not a signature, and a box for it would be a box nobody can ever sign. */
const RETURN_KEY = 'return';

const CAPTION: Record<BoxState, string> = {
  signed: 'Approved in Quest GatePass',
  rejected: 'Rejected in Quest GatePass',
  not_required: 'Not required',
  awaiting: 'Awaiting approval',
  blank: 'Signature & Stamp',
};

/** How a rung's state reads as a box. `unset` — an office nobody holds — is
 *  awaiting rather than a state of its own: on paper, "nobody has been
 *  designated" and "nobody has signed" look the same to the reader holding it,
 *  and the record on screen is where a designation gets fixed. */
function boxState(step: ApprovalStep): BoxState {
  switch (step.state) {
    case 'done': return 'signed';
    case 'blocked': return 'rejected';
    case 'skipped': return 'not_required';
    default: return 'awaiting';
  }
}

/** "COO (Priya Mehta)" → "Priya Mehta". The office is the box's own heading, so
 *  repeating it inside the box wastes the only line the name has. Anything that
 *  is not in that shape — a delegated line, a bare name, an office alone — is
 *  returned as it stands rather than guessed at. */
export function signerName(who: string | null, label: string): string | null {
  if (!who) return null;
  const prefix = `${label} (`;
  if (who.startsWith(prefix) && who.endsWith(')')) {
    return who.slice(prefix.length, -1);
  }
  return who === label ? null : who;
}

/** The heading a rung's box carries. An approval rung is headed by its OFFICE,
 *  because that is what the person reading the paper is looking for; the raise
 *  and the gate keep the words the slip has always used. */
function labelOf(step: ApprovalStep): string {
  if (step.key === 'raised') return 'Issuing HOD';
  if (step.key === 'gate') return 'Security Verification';
  if (step.office) {
    return APPROVAL_ROLE_TITLES[step.office as ApprovalRoleKey] ?? step.office;
  }
  return step.label;
}

/**
 * Every box the slip prints, in ladder order, with the receiver's blank one
 * last.
 *
 * The return leg is dropped: it is the only step on the rail that nobody signs.
 */
export function buildSignatureBoxes(steps: ApprovalStep[]): SignatureBoxView[] {
  const boxes: SignatureBoxView[] = steps
    .filter((s) => s.key !== RETURN_KEY)
    .map((step) => {
      const label = labelOf(step);
      const state = boxState(step);
      return {
        key: step.key,
        label,
        signer: state === 'awaiting' || state === 'not_required'
          ? null
          : signerName(step.who, label),
        at: step.at,
        state,
        caption: CAPTION[state],
      };
    });

  boxes.push({
    key: 'receiver',
    label: 'Receiver Signature',
    signer: null,
    at: null,
    state: 'blank',
    caption: CAPTION.blank,
  });

  return boxes;
}

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
// THE RECEIVER'S BOX IS BLANK UNTIL THE MATERIAL IS ACTUALLY BACK. Client,
// 2026-08-23: "put the receiver signature as a box, same as the other
// approvals. Once the pass is fully returned — all the items fully returned —
// you make it tick with the date, with the security guard's name who did the
// return."
//
// So it is the same four-state box as the rest, and the state comes from a
// record this system really keeps: an RGP whose `return_status` is `returned`
// has had every line counted back in over the gate by `apply_item_returns`,
// which stamps `actual_return_date` and writes a `verifications` row naming the
// guard. THAT is the receipt, and `returnReceipt` below is the only place it is
// read. Until then the box prints empty and is signed by hand — a tick before
// the last line is back would be a receipt nobody gave, and an NRGP never earns
// one at all because nothing on it is coming back.
import type { GatePassView, PassType } from '../types';
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
  /** The signer's uploaded signature image, or null (075).
   *
   *  NON-NULL ONLY ON A BOX THAT IS ACTUALLY SIGNED — `signed` for a rung, or a
   *  receiver's box holding a real receipt. See `signatureFor` below: this is
   *  the field the client's "don't show the signature until and unless I
   *  approve" lives in, and it is set in exactly one place. */
  signatureUrl: string | null;
}

/**
 * The signature image for each box on ONE pass, keyed by the slot names
 * `gatepass.get_pass_signatures` (075) returns: 'raised', an office's
 * `role_key`, 'gate', or 'receiver'.
 *
 * A partial record, and usually a very partial one — a person who never
 * uploaded a signature simply has no entry, which is the ordinary case and not
 * a failure.
 */
export type PassSignatures = Record<string, string | undefined>;

/** Which slot a step's box draws its signature from. The step keys are the
 *  ladder's own (`raised`, `level-<role_key>`, `gate`); the slots are the
 *  database's. `office` is what carries the role key on an approval rung —
 *  parsing it back out of `key` would be the fuzzy string matching this repo
 *  forbids on enums. */
function slotOf(step: ApprovalStep): string | null {
  if (step.key === 'raised') return 'raised';
  if (step.key === 'gate') return 'gate';
  return step.office ?? null;
}

/**
 * THE ONE PLACE A SIGNATURE IS ATTACHED TO A BOX, and it refuses every box that
 * is not signed.
 *
 * `get_pass_signatures` already returns a mark only where the database holds a
 * recorded act by that person on this pass, so this is the second of two
 * independent checks. It is not redundant: it makes the rule true of the
 * FUNCTION that draws the box rather than of one query, so a future caller
 * handing in a different map cannot reintroduce a signature under a rejection,
 * a pending rung, or a level-3 rung nobody had to sign (063).
 */
function signatureFor(
  state: BoxState, slot: string | null, signatures: PassSignatures,
): string | null {
  if (state !== 'signed' || !slot) return null;
  return signatures[slot] ?? null;
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

/** The receiver's box says RECEIVED, never APPROVED — it is the material coming
 *  back over the gate, not an office signing off on it leaving. */
const RECEIPT_CAPTION = 'Return received in Quest GatePass';

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
  // THE RAISE BOX IS HEADED BY WHOEVER ACTUALLY RAISED IT (071). `boxLabel` is
  // set by `buildApprovalSteps` and says "Issuing COO" on a pass the COO raised
  // for a department they head none of; "Issuing HOD" is the fall-back and the
  // ordinary case.
  if (step.key === 'raised') return step.boxLabel ?? 'Issuing HOD';
  if (step.key === 'gate') return 'Security Verification';
  if (step.office) {
    return APPROVAL_ROLE_TITLES[step.office as ApprovalRoleKey] ?? step.office;
  }
  return step.label;
}

/** Who took the material back in, and when — or null while the paper still has
 *  to collect that signature by hand. */
export interface ReturnReceipt {
  who: string | null;
  at: string | null;
}

/** The pass facts the receipt is graded on. Narrow on purpose: any surface
 *  holding a row can ask. */
export type ReceiptPass = Pick<GatePassView, 'type' | 'return_status' | 'actual_return_date'>;

/** The `v_verifications` rows this reads. Same subset `activityLog.ts` takes. */
export interface ReceiptEvent {
  action: string;
  security_name?: string | null;
  created_at: string;
}

/**
 * The return receipt, or null when the paper still has to collect one.
 *
 * FULLY RETURNED IS THE ONLY TRIGGER — `return_status === 'returned'`, which
 * `apply_item_returns` sets only when NO line has `returned_qty < quantity`.
 * A partially returned pass gets a blank box: some of the material is still
 * out, and a tick would say it is all back.
 *
 * The moment is the pass's own `actual_return_date` — the stamp that closed it
 * — and the name comes from the LAST `returned` verification, which is the
 * movement that brought the final line in. A row whose name did not resolve out
 * of VMS, or no visible rows at all, still ticks: the material is back either
 * way, and the box degrades to a missing name rather than to a missing fact.
 */
export function returnReceipt(
  pass: ReceiptPass,
  events: ReceiptEvent[],
): ReturnReceipt | null {
  if (pass.type !== 'RGP' || pass.return_status !== 'returned') return null;
  // No `.at(-1)`: the app's TS lib target is below es2022.
  const closed = events.filter((e) => e.action === 'returned');
  const closing = closed.length ? closed[closed.length - 1] : undefined;
  return {
    who: closing?.security_name?.trim() || null,
    at: pass.actual_return_date ?? closing?.created_at ?? null,
  };
}

/**
 * Does this pass owe a receiver's box at all?
 *
 * ONLY AN RGP DOES (client, 2026-08-31: "for NRGP passes while taking
 * printouts, don't show receiver signature in the print page, just show
 * security desk gate clearance for out signature"). Nothing on an NRGP is
 * coming back, so the box is one no person could ever sign — and an empty box
 * on paper reads as a signature somebody still owes. The gate's own box stays
 * on both types: that is the outward clearance, drawn from the `gate` rung.
 */
export function receiverBoxApplies(type: PassType): boolean {
  return type === 'RGP';
}

/**
 * Every box the slip prints, in ladder order, with the receiver's one last —
 * omitted entirely when `withReceiver` is false, which is every NRGP.
 *
 * The return leg is dropped: it is the only step on the rail that nobody signs.
 */
export function buildSignatureBoxes(
  steps: ApprovalStep[],
  receipt: ReturnReceipt | null = null,
  withReceiver = true,
  /** Uploaded signatures for this pass (075). DEFAULTS TO NONE, so every caller
   *  written before signatures existed keeps printing exactly the slip it
   *  printed before — an empty map is the same as no map. */
  signatures: PassSignatures = {},
): SignatureBoxView[] {
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
        signatureUrl: signatureFor(state, slotOf(step), signatures),
      };
    });

  if (!withReceiver) return boxes;

  const receiptState: BoxState = receipt ? 'signed' : 'blank';
  boxes.push({
    key: 'receiver',
    label: 'Receiver Signature',
    signer: receipt?.who ?? null,
    at: receipt?.at ?? null,
    state: receiptState,
    caption: receipt ? RECEIPT_CAPTION : CAPTION.blank,
    // 'blank' is not 'signed', so an open return prints no mark — the same rule
    // the tick already follows, and the reason the receiver's box is `blank`
    // rather than `awaiting` does not matter here: neither is signed.
    signatureUrl: signatureFor(receiptState, 'receiver', signatures),
  });

  return boxes;
}

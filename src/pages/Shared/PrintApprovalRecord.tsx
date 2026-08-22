// THE APPROVAL RECORD AS IT IS PRINTED — the block that replaced the seven
// empty signature boxes on the A5 slip.
//
// Client, 2026-08-22: "when I'm printing the pass from any page it should not
// show the previous boxes for the signature. Show it as per the digital
// approval. It should show all the digital signature timeline and everything in
// a proper format. Remove those boxes for the signs." — and, a moment later,
// "across all the views, for any tabs. Trying to take a printout from any of the
// details page."
//
// The boxes were written when the four offices signed wet ink on the paper that
// travelled with the material. Since migration 046 they do not: an office holder
// signs in the portal, `gatepass.pass_approvals` records WHO pressed it and
// WHEN, and 061 makes the ladder linear. So the boxes had become a second,
// emptier copy of a record the database already holds in full — and a printed
// blank next to a real digital approval invites somebody to sign the paper and
// believe that counts.
//
// IT RENDERS THE RECORD'S OWN `ApprovalStep[]`, NOT A SECOND DERIVATION. That
// is the whole design: `buildApprovalSteps` is what the pass record's timeline
// draws, so the sheet in a guard's hand and the screen on the desk cannot name
// a different office, a different person or a different moment. Change the
// ladder and the paper follows for free.
//
// COLOUR CARRIES NOTHING HERE. The slip is read on a cheap mono laser, so every
// state is a WORD in its own column and the note beside it is the sentence the
// step already carries on screen.
import React from 'react';
import type { ApprovalStep, ApprovalStepState } from '../../lib/approvalLadder';
import { formatDateTime } from '../../lib/formatDate';

/** The state as a printed word. A `Record` over the union, so a fifth state is a
 *  compile error rather than a blank cell on a document that leaves the
 *  building. Deliberately neutral words: the same rail carries approvals, the
 *  gate's own decision and the return deadline, and "Rejected" would be wrong
 *  against material that is merely late. */
const STATE_WORD: Record<ApprovalStepState, string> = {
  done: 'Completed',
  pending: 'Pending',
  blocked: 'Attention',
  unset: 'Not designated',
};

const TH = 'border border-black px-2 py-1 text-black text-left font-bold uppercase tracking-wider';
const TD = 'border border-black px-2 py-1 text-black align-top';

export default function PrintApprovalRecord(
  { steps }: { steps: ApprovalStep[] },
): React.ReactElement {
  return (
    // break-inside-avoid so a page break cannot split a rung from its own row
    // and leave an unlabelled line on the next sheet — the same guard the
    // signature rows carried.
    <div className="pt-2 print:break-inside-avoid">
      <p className="text-[11px] font-bold text-black uppercase tracking-wider mb-1">
        Approval &amp; Verification Record
      </p>
      {/* Load-bearing sentence, not decoration: without it a reader who used to
          sign this sheet has no way of knowing the boxes were removed on
          purpose rather than dropped by a printing fault. */}
      <p className="text-[9px] text-black mb-2 leading-tight">
        Approvals for this gate pass are recorded digitally in Quest GatePass, with the approver
        and the date and time of each decision shown below. No manual signature is required on
        this printout.
      </p>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className={TH}>#</th>
            <th className={TH}>Step</th>
            <th className={TH}>Approver / Office</th>
            <th className={TH}>Status</th>
            <th className={TH}>Date &amp; Time</th>
            <th className={TH}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => (
            <tr key={step.key}>
              <td className={TD}>{i + 1}</td>
              <td className={`${TD} font-bold`}>{step.label}</td>
              <td className={TD}>
                {step.who ?? '—'}
                {step.detail && (
                  <span className="block text-gray-700">{step.detail}</span>
                )}
              </td>
              <td className={TD}>{STATE_WORD[step.state]}</td>
              {/* NO INVENTED MOMENT. A rung this database records no time for
                  prints a dash — the same refusal the on-screen rail makes. */}
              <td className={TD}>{step.at ? formatDateTime(step.at) : '—'}</td>
              <td className={TD}>{step.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

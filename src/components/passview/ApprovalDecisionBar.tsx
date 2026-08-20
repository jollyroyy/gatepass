// APPROVE / REJECT, AT THE FOOT OF THE GATE PASS RECORD (client, 2026-08-19:
// "once I click on the pending approval item it should show the exact same
// thing as it is showing in the guard's view — here make the CTA button, like
// approve or reject, at the bottom in a very proper manner").
//
// THE DECISION MOVED OUT OF THE QUEUE AND ONTO THE RECORD, and that is the
// point of it: an office holder now reads the whole pass — every material line,
// its value, the ladder underneath it — and signs at the end of that reading,
// instead of pressing Approve on a table row that showed them six columns. The
// stacked cards at `/approvals` therefore carry no action at all, exactly as
// every other stacked card in this app carries none.
//
// IT SITS BESIDE THE GUARD'S OWN BAR AND NEVER WITH IT. A guard gets Approve
// OUT while the gate can still act; an office holder gets these two while the
// ladder is still climbing. Migration 046 makes the two mutually exclusive by
// construction — a guard cannot even SEE a pass that still owes a signature —
// so the record never draws both, and neither branch needs to know about the
// other.
//
// WHOSE TURN IT IS COMES FROM `approvalDecision.ts`, the same function the
// queue filters with, so this bar is drawn only where `approve_pass_level`
// would actually accept the press. When the pass is routed to this office but
// waiting on an EARLIER one, the bar still renders — as a sentence naming that
// office and no buttons. An approver who sees nothing cannot tell "not yet
// mine" from "this screen is broken".
import React, { useEffect, useRef, useState } from 'react';
import type { GatePassView } from '../../types';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import type { PassApprovalRow } from '../../lib/passApprovalState';
import { approvePass, rejectPass } from '../../lib/approvalActions';
import {
  canDecideApproval,
  heldByOffice,
  levelLabel,
  myStep,
} from '../../lib/approvalDecision';
import { safeErrorMessage } from '../../lib/errors';
import RejectApprovalModal from '../approver/RejectApprovalModal';

type Props = {
  pass: GatePassView;
  /** This pass's own ladder, from `get_pass_approvals()`. */
  approvals: PassApprovalRow[];
  /** The office the READER holds, or null. Not a role — see approverAccess.ts. */
  office: ApprovalRoleKey | null;
  /** WHICH BUTTON THE READER PRESSED IN THEIR APPROVAL EMAIL (client,
   *  2026-08-20), off `/pass/:id?decide=…`. It is an INTENT and never a
   *  decision: the link is a GET, and GETs are prefetched by mail scanners, so
   *  arriving here approves nothing. `reject` opens the reason modal — a
   *  rejection needs a written reason anyway and the reader already chose it;
   *  `approve` opens nothing at all and leaves the press to the person. */
  decide?: 'approve' | 'reject' | null;
  /** Re-read the record. The pass has changed status and the ladder has moved,
   *  and only the database knows what to. */
  onDecided: () => void;
};

export default function ApprovalDecisionBar({
  pass, approvals, office, decide: intent = null, onDecided,
}: Props): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(intent === 'reject');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  // Somebody who came from a letter is looking for the two buttons, and on a
  // phone they are a whole material table below the fold. Scrolled once, on
  // arrival, and never again — the bar re-renders on every keystroke in the
  // reason box.
  useEffect(() => {
    if (intent) box.current?.scrollIntoView?.({ block: 'center' });
  }, [intent]);

  const mine = myStep(approvals, office);
  // Not routed to me at all, or my rung is already signed: no bar, no sentence.
  // The ladder on the right of the record already says what I decided and when.
  if (!office || !mine || mine.status !== 'pending' || pass.status !== 'pending') return null;

  const title = APPROVAL_ROLE_TITLES[office];
  const level = levelLabel(approvals, mine);

  if (!canDecideApproval(pass.status, approvals, office)) {
    const holder = heldByOffice(approvals, office);
    return (
      <div data-testid="record-approval-actions" className="card p-4">
        <p className="text-sm text-navy-700">
          This pass is routed to you as {title} ({level}), but it is still with the{' '}
          {holder ? APPROVAL_ROLE_TITLES[holder] : 'office below you'}. It reaches you once
          they have signed.
        </p>
      </div>
    );
  }

  async function decide(run: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      onDecided();
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not record that decision.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={box}
      data-testid="record-approval-actions"
      className="card p-4 flex flex-col gap-3"
    >
      {error && <div className="alert-error">{error}</div>}

      {/* SAY WHY THIS SCREEN OPENED. A reader who pressed Approve in their
          inbox and landed on a long record needs to know the press was
          received and that nothing has been signed yet — otherwise they
          reasonably assume it already happened and close the tab. */}
      {intent && (
        <div className="alert-info" data-testid="decide-from-email">
          {intent === 'approve'
            ? 'You opened this from an approval email. Nothing has been signed yet — read the pass and press Approve below.'
            : 'You opened this from an approval email. Give a written reason to reject this pass; nothing has been recorded yet.'}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy-700">
            You are signing as {title} — {level}
          </p>
          <p className="text-sm text-navy-500">
            Approving sends it to the next office, or releases it to the gate if you are the
            last. Rejecting closes this pass permanently and needs a written reason.
          </p>
        </div>

        {/* Reject is the destructive one, so it is the secondary weight and it
            is on the left: the press a reader makes without looking is the one
            under their thumb on the right. */}
        <div className="flex gap-3 shrink-0">
          <button
            type="button"
            className="btn-danger text-base px-6 py-3"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn-primary text-base px-6 py-3"
            disabled={busy}
            onClick={() => void decide(() => approvePass(pass.id))}
          >
            {busy ? 'Working…' : 'Approve'}
          </button>
        </div>
      </div>

      {rejecting && (
        <RejectApprovalModal
          passNumber={pass.pass_number}
          onClose={() => setRejecting(false)}
          onSubmit={async (reason) => {
            await rejectPass(pass.id, reason);
            setRejecting(false);
            onDecided();
          }}
        />
      )}
    </div>
  );
}

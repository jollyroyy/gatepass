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
import { APPROVAL_ROLE_TITLES } from '../../lib/approvalLadder';
import type { PassApprovalRow } from '../../lib/passApprovalState';
import { approvePass, rejectPass } from '../../lib/approvalActions';
import {
  canDecideApproval,
  heldByOffice,
  isHeldForEscalation,
  levelLabel,
  myStep,
  type ActingOffices,
} from '../../lib/approvalDecision';
import { safeErrorMessage } from '../../lib/errors';
import RejectApprovalModal from '../approver/RejectApprovalModal';
import { useNotifications } from '../../lib/notifications';

type Props = {
  pass: GatePassView;
  /** This pass's own ladder, from `get_pass_approvals()`. */
  approvals: PassApprovalRow[];
  /** EVERY office the reader may act for, or none. Not a role — see
   *  approverAccess.ts. It is a list because a live COO -> CEO delegation
   *  leaves one person able to sign for both halves of the shared level-3 rung
   *  (072), and the bar has to offer the one the RPC will actually accept. */
  offices: ActingOffices;
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
  pass, approvals, offices, decide: intent = null, onDecided,
}: Props): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(intent === 'reject');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  // The bell's pending-approval count is a live queue: a pass signed here has
  // to leave it now, not on the next mount. Read BEFORE the early returns
  // below — a hook after a conditional return is a different hook order on the
  // next render.
  const { dismissPass } = useNotifications();

  // Somebody who came from a letter is looking for the two buttons, and on a
  // phone they are a whole material table below the fold. Scrolled once, on
  // arrival, and never again — the bar re-renders on every keystroke in the
  // reason box.
  useEffect(() => {
    if (intent) box.current?.scrollIntoView?.({ block: 'center' });
  }, [intent]);

  const mine = myStep(approvals, offices);
  // Not routed to me at all, or my rung is already signed: no bar, no sentence.
  // The ladder on the right of the record already says what I decided and when.
  if (!mine || mine.status !== 'pending' || pass.status !== 'pending') return null;

  // THE OFFICE THE RUNG BELONGS TO, not the one the reader IS. A CEO covering
  // an absent COO signs the COO's row, and the bar says so — `myStep` chose
  // that row by the same rule `gatepass.my_acting_role` (072) uses server-side.
  const title = APPROVAL_ROLE_TITLES[mine.role_key];
  const level = levelLabel(approvals, mine);

  if (!canDecideApproval(pass.status, approvals, offices)) {
    const holder = heldByOffice(approvals, offices);
    const held = isHeldForEscalation(mine);
    return (
      <div data-testid="record-approval-actions" className="card p-4">
        <p className="text-sm text-navy-700">
          {/* A SHARED RUNG IS NOT AN EARLIER LEVEL, and must not read like one
              (063). The CEO is on the same rung as the COO and is waiting for a
              clock, not for a signature below them — so the sentence names the
              moment rather than saying "once they have signed", which would be
              false the day the window runs out with the COO still silent. */}
          {held && mine.escalates_at
            ? `This pass is routed to you as ${title} (${level}), and it is with the `
              + `${holder ? APPROVAL_ROLE_TITLES[holder] : 'office beside you'} until `
              + `${new Date(mine.escalates_at).toLocaleString('en-IN')}. `
              + 'You can sign it after that if they have not decided it.'
            : `This pass is routed to you as ${title} (${level}), but it is still with the `
              + `${holder ? APPROVAL_ROLE_TITLES[holder] : 'office below you'}. `
              + 'It reaches you once they have signed.'}
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
      dismissPass(pass.id);
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
            className="btn-approve text-base px-6 py-3"
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
            dismissPass(pass.id);
            setRejecting(false);
            onDecided();
          }}
        />
      )}
    </div>
  );
}

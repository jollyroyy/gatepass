// GATE PASS DETAILS — the one record format in this app, drawn to the client's
// mock-up (2026-08-19).
//
// Everything that opens a single pass renders THIS: `/pass/:id`, the gate
// search, every stacked list, every KPI drill, the notification bell, and — as
// of the same day — the guard's own Approve OUT and Verify Return actions. A
// pass therefore reads exactly one way, and a change lands everywhere at once.
//
// FOUR PARTS, IN THE MOCK'S ORDER: the title row with the pass's live badge and
// Print Pass; the fact strip; the material table (which is also where a return
// is entered) with ONE timeline down its right — the approval ladder and the
// gate's own activity on a single rail (client, 2026-08-19) — and the guard's
// action bar at the FOOT of all of it. NOTHING ELSE — the explanatory strip under the
// table saying the four signatures are collected on paper was deleted at the
// client's word (2026-08-19: "don't put any extra words other than the ones I
// gave you"). The ladder's own states are the statement.
//
// THE ACTION IS SINGULAR AND ROLE-SHAPED. A guard standing at the barrier gets
// Approve OUT while the gate can still act (`canVerifyAtGate`, the rule
// `match_pass` enforces) — it opens `/verify/:id`, which offers the two
// decisions a guard has: Approve and Reject (client, 2026-08-20). It sits at
// the BOTTOM of the record, where
// the reading ends (client). Everyone else gets Print Pass alone. There
// is no "Mark as Returned" button: a return is per line and per quantity now,
// and it is entered on the table itself.
//
// EXPORT PDF AND SHARE FROM THE MOCK ARE DELIBERATELY ABSENT. Print Pass is
// this app's PDF (the browser's own print dialogue, on a slip laid out for A5
// and a mono laser), and there is no share mechanism to put behind a Share
// button — a control that does nothing is worse than no control.
import React from 'react';
import { Link } from 'react-router-dom';
import type { UserRole } from '../../types';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';
import type { GatePassRecord } from '../../lib/useGatePassRecord';
import { passStageStyle } from '../../lib/passStage';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { buildApprovalSteps, canRecordReturns } from '../../lib/approvalLadder';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import { usePassApprovals } from '../../lib/usePassApprovals';
import { useEscalationHours } from '../../lib/useEscalationHours';
import { withEscalation } from '../../lib/approvalDecision';
import { usePassEmergencyRelease } from '../../lib/usePassEmergencyRelease';
import { formatDateTime } from '../../lib/formatDate';
import { buildReturnTimeline } from '../../lib/returnTimeline';
import { EMPTY_DRAFT, type ReturnDraft } from '../../lib/returnDraft';
import PassRecordHeader from './PassRecordHeader';
import PassRecordSummary from './PassRecordSummary';
import PassRecordReturns from './PassRecordReturns';
import PassTimeline from './PassTimeline';
import ApprovalDecisionBar from './ApprovalDecisionBar';
import EmergencyReleaseBar from './EmergencyReleaseBar';

type Props = {
  record: GatePassRecord;
  /** Decides which action the record offers. Null renders none — a reader whose
   *  role has not resolved yet is never shown a button that will fail. */
  role?: UserRole | null;
  /** Which of the four approval offices the READER holds, or null (046). It is
   *  not a role — see approverAccess.ts — so it travels beside one, and it is
   *  what decides whether the Approve / Reject bar is drawn at the foot. */
  office?: ApprovalRoleKey | null;
  /** EVERY office the reader may act for — two while a COO/CEO delegation is
   *  live (072). `office` above is who they ARE, and decides how a vacant rung
   *  reads and whether the emergency door is theirs; this decides what the
   *  Approve / Reject bar may sign. */
  offices?: ApprovalRoleKey[];
  /** The decision an approval email asked for, off `?decide=`. Threaded
   *  straight to the decision bar — see `ApprovalDecisionBar`. */
  decide?: 'approve' | 'reject' | null;
  /** Re-read the record after a return lands, or after an approval decision. */
  onRecorded?: () => void;
  onClear?: () => void;
};


export default function PassRecordView({
  record, role = null, office = null, offices, decide = null, onRecorded, onClear,
}: Props): React.ReactElement {
  const { pass, items, activity } = record;
  const { roles } = useApprovalRoles();
  // What THIS pass actually owes, and who has decided (046). A pass raised
  // before any office was designated carries none, and the ladder falls back to
  // grading the org chart — see approvalLadder.ts.
  const rawApprovals = usePassApprovals(pass.id);
  // WHEN A SHARED RUNG BECOMES THE SECOND OFFICE'S TO SIGN (063). Derived here,
  // once, so the ladder's note and the Approve / Reject bar underneath it read
  // the same clock — `approve_pass_level` enforces the same window itself, and
  // this is only what stops a button being drawn on a press it would refuse.
  const escalationHours = useEscalationHours();
  const approvals = React.useMemo(
    () => withEscalation(rawApprovals, pass.created_at, escalationHours),
    [rawApprovals, pass.created_at, escalationHours],
  );
  // A release happens on this very screen, so the banner needs re-reading
  // without a navigation — hence the nonce. See usePassEmergencyRelease.
  const [releaseNonce, setReleaseNonce] = React.useState(0);
  // THE STAGED RETURN LIVES HERE, ABOVE BOTH HALVES OF THE SCREEN (client,
  // 2026-08-22: "as and when the guard enters the numbers it should reflect in
  // the timeline also"). The table used to own it, and the rail on the other
  // side could not see it; one object read by both is what makes them move
  // together, rather than a copy in each that has to be kept in step.
  const [draft, setDraft] = React.useState<ReturnDraft>(EMPTY_DRAFT);
  const released = usePassEmergencyRelease(pass.id, releaseNonce);

  // The reader's role decides how a vacant office reads on a pass with no
  // ladder of its own: for a guard the signed slip is in hand, so all four
  // levels are approved (client). A real pending row outranks that.
  //
  // AN OFFICE HOLDER IS NEVER THE GATE AND NEVER THE RAISING DESK, whatever
  // their VMS role says (client, 2026-08-22: "I do see that the security head
  // is able to do all the returns. This is a flag flag completely"). Migration
  // 043 lets the Security Head be a `guard` account, so this record was handing
  // them Approve OUT and the line-by-line return entry on the very passes they
  // sign — one pair of hands on both halves of the decision. Their tabs are
  // gone (see roleRoutes.ts), but this record stays reachable from their queue,
  // so the rule has to be restated HERE too rather than relied on from the
  // sidebar. Reading the pass in full is exactly what an approver came for;
  // acting on it at the barrier is not.
  const readerRole = office ? null : role;
  const steps = buildApprovalSteps(pass, roles, readerRole, approvals);
  const canRecord = canRecordReturns(pass, readerRole);
  const canApprove = readerRole === 'guard' && canVerifyAtGate(pass);
  const stage = passStageStyle(pass);
  // The rail's own line list — empty on an NRGP and on a refused pass, which
  // `buildReturnTimeline` decides. It reads the DRAFT, so it is the same
  // figures the table above is showing while the guard types.
  const returnLines = buildReturnTimeline(items, pass, draft);
  // FORWARD TO THE VENDOR ON WHATSAPP — the raising side only (client,
  // 2026-08-22). Whether the pass carries a usable number is the button's own
  // question ("if it is available" is the client's condition, and a control
  // that opens an empty chat is worse than none); this decides only WHO is
  // offered it.
  const canShare = readerRole === 'hod';

  // The entrance the guard named when they cleared it. Nothing invents one:
  // there is no gate entity in this schema, so an unnamed exit shows no fact.
  const gateName = [...activity].reverse().find((v) => v.gate_name)?.gate_name ?? null;

  return (
    <section data-testid="pass-record" className="flex flex-col gap-5">
      <PassRecordHeader
        pass={pass}
        stage={stage}
        canShare={canShare}
        onClear={onClear}
      />

      {/* THE OVERRIDE IS STATED ON THE FACE OF THE PASS, permanently and to
          every reader of it — the raising HOD, the offices that were skipped,
          the guard at the barrier and every admin. An emergency release that
          only an admin screen knows about is not a control, it is a bypass
          with paperwork. The reason is printed verbatim because it is the
          whole justification, and whether a second admin has reviewed it yet
          is the other half of the story. */}
      {released && (
        <div data-testid="emergency-banner" className="alert-error">
          <p className="font-semibold">
            Released under emergency on {formatDateTime(released.released_at)} — the approvals this
            pass still owed were cleared without them.
          </p>
          <p className="mt-1">{released.reason}</p>
          <p className="mt-1 text-xs">
            {released.reviewed_at
              ? `Reviewed by an admin on ${formatDateTime(released.reviewed_at)}.`
              : 'Not yet reviewed. An admin other than the one who released it has to review this.'}
          </p>
        </div>
      )}

      <PassRecordSummary pass={pass} gateName={gateName} />

      {/* THE OFFICE HOLDER'S OWN PRESS SITS RIGHT BELOW THE PASS, not at the
          foot of the record (client, 2026-08-23: "just below the pass, show
          that approve or reject button — don't show it at the bottom"). An
          approver lands here from their queue to sign, not to read every
          material line first; the ladder and the table are still below for
          whoever wants the full reading, but the decision no longer waits at
          the end of it. */}
      <ApprovalDecisionBar
        pass={pass}
        approvals={approvals}
        offices={offices ?? (office ? [office] : [])}
        decide={decide}
        onDecided={() => onRecorded?.()}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 flex flex-col gap-5">
          <PassRecordReturns
            pass={pass}
            items={items}
            canRecord={canRecord}
            draft={draft}
            onDraftChange={setDraft}
            onRecorded={() => {
              setDraft(EMPTY_DRAFT);
              onRecorded?.();
            }}
          />
        </div>

        <div className="flex flex-col gap-5">
          <PassTimeline
            steps={steps}
            activity={activity}
            returnLines={returnLines}
            closesAtGate={pass.type !== 'RGP'}
          />
        </div>
      </div>

      {/* THE GUARD'S ACTION STAYS AT THE FOOT OF THE RECORD (client,
          2026-08-19: "show approve pass at the bottom of the pass details for
          better visibility"). A guard reads the pass downward — the facts,
          then every material line, then the ladder — and the press belongs
          where that reading ends. The office holder's own press moved above,
          beside the summary (client, 2026-08-23); the two still never appear
          together — 046 hides a pass that still owes a signature from the
          gate entirely, so the two conditions are mutually exclusive in the
          database, not merely in this component. */}
      {/* BREAK GLASS — a super admin, and since 067 the sitting COO or CEO over
          a pass nobody has approved inside the escalation window; only ever
          while the ladder is still owed something (055). It sits BELOW the
          office's own Approve/Reject so that signing properly is always the
          first thing offered. */}
      <EmergencyReleaseBar
        pass={pass}
        approvals={approvals}
        role={role}
        office={office}
        onReleased={() => {
          setReleaseNonce((n) => n + 1);
          onRecorded?.();
        }}
      />

      {canApprove && (
        <div
          data-testid="record-actions"
          className="card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <p className="text-sm text-navy-700">
            Everything on this pass checked? Clear it out at the gate.
          </p>
          <Link to={`/verify/${pass.id}`} className="btn-primary text-base px-6 py-3">
            Approve OUT
          </Link>
        </div>
      )}
    </section>
  );
}

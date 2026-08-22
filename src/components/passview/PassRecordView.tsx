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
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { buildApprovalSteps, canRecordReturns } from '../../lib/approvalLadder';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import { usePassApprovals } from '../../lib/usePassApprovals';
import { useEscalationHours } from '../../lib/useEscalationHours';
import { withEscalation } from '../../lib/approvalDecision';
import { usePassEmergencyRelease } from '../../lib/usePassEmergencyRelease';
import { formatDateTime } from '../../lib/formatDate';
import { buildReturnTimeline } from '../../lib/returnTimeline';
import { vendorWhatsappLink } from '../../lib/whatsappShare';
import { EMPTY_DRAFT, type ReturnDraft } from '../../lib/returnDraft';
import Badge from '../Badge';
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
  /** The decision an approval email asked for, off `?decide=`. Threaded
   *  straight to the decision bar — see `ApprovalDecisionBar`. */
  decide?: 'approve' | 'reject' | null;
  /** Re-read the record after a return lands, or after an approval decision. */
  onRecorded?: () => void;
  onClear?: () => void;
};

const PrinterGlyph = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.25V3.75h10.5v4.5M6.75 17.25h10.5v3h-10.5v-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 17.25H4.5a1.5 1.5 0 01-1.5-1.5v-4.5a1.5 1.5 0 011.5-1.5h15a1.5 1.5 0 011.5 1.5v4.5a1.5 1.5 0 01-1.5 1.5h-2.25" />
  </svg>
);

const WhatsappGlyph = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.9 9.9 0 004.84 1.24h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0012.04 2zm0 18.02h-.01a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.09.81.82-3.01-.2-.31a8.24 8.24 0 01-1.26-4.22c0-4.55 3.7-8.25 8.25-8.25 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 012.41 5.83c0 4.55-3.7 8.26-8.26 8.26zm4.53-6.18c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23a7.5 7.5 0 01-1.38-1.72c-.15-.25-.02-.38.11-.5.12-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.1 3.63.58.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29z" />
  </svg>
);

export default function PassRecordView({
  record, role = null, office = null, decide = null, onRecorded, onClear,
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
  // 2026-08-22), and only when the pass actually carries a usable number.
  // Null draws nothing: "if it is available" is the client's own condition, and
  // a button that opens an empty chat is worse than no button.
  const whatsapp = readerRole === 'hod' ? vendorWhatsappLink(pass, items) : null;

  // The entrance the guard named when they cleared it. Nothing invents one:
  // there is no gate entity in this schema, so an unnamed exit shows no fact.
  const gateName = [...activity].reverse().find((v) => v.gate_name)?.gate_name ?? null;

  return (
    <section data-testid="pass-record" className="flex flex-col gap-5">
      {/* THE BELL IS FIXED TO THE VIEWPORT'S TOP-RIGHT CORNER, so a header row
          with buttons on its right edge sits underneath it — Print Pass was
          printing under the bell on every wide screen (client, 2026-08-19).
          76px is the same reservation `.page-header` and the guard skin's
          `.gb-page-head` already make; this row is not a `.page-header` (it
          carries its own spacing inside the record's flex column), so it makes
          the reservation itself. */}
      <div className="flex flex-wrap items-start justify-between gap-3 pr-[76px]">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title !mb-0">{pass.type} Gate Pass Details</h1>
            <Badge style={stage} />
            {/* ONE "Overdue", never two (client, 2026-08-20). `passStageStyle`
                already RENAMES a late open pass to Overdue, so this pill is
                drawn only when the stage badge says something else — a
                MISMATCHED pass that is also late still carries both facts. */}
            {pass.is_overdue && stage.label !== OVERDUE_STYLE.label && (
              <Badge style={OVERDUE_STYLE} />
            )}
          </div>
          <p className="page-subtitle !mb-0 mt-1">
            {pass.type === 'RGP'
              ? 'View details of this Returnable Gate Pass'
              : 'View details of this Non-Returnable Gate Pass'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* IT OPENS WHATSAPP WITH THE TEXT PREPARED; IT DOES NOT SEND
              ANYTHING. The HOD picks the chat and presses send themselves —
              this app has no WhatsApp account and delivers no message on
              anybody's behalf. `noopener` because it leaves the app. */}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="share-whatsapp"
              className="btn-secondary inline-flex items-center gap-2"
            >
              {WhatsappGlyph}
              Send to Vendor
            </a>
          )}
          <Link to={`/pass/${pass.id}/print`} className="btn-secondary inline-flex items-center gap-2">
            {PrinterGlyph}
            Print Pass
          </Link>
          {onClear && (
            <button type="button" className="btn-ghost" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

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
          <PassTimeline steps={steps} activity={activity} returnLines={returnLines} />
        </div>
      </div>

      {/* THE ACTION IS AT THE FOOT OF THE RECORD (client, 2026-08-19: "show
          approve pass at the bottom of the pass details for better
          visibility"). A guard reads the pass downward — the facts, then every
          material line, then the ladder — and the press belongs where that
          reading ends, at full width, not as a small button above the fold.
          There is exactly ONE of it: a second copy in the header is how a
          reader ends up pressing the stale one. */}
      {/* AN OFFICE HOLDER'S OWN PRESS, in the same place and for the same
          reason (client, 2026-08-19). It can never appear beside the guard's
          bar above: 046 hides a pass that still owes a signature from the gate
          entirely, so the two conditions are mutually exclusive in the
          database, not merely in this component. */}
      <ApprovalDecisionBar
        pass={pass}
        approvals={approvals}
        office={office}
        decide={decide}
        onDecided={() => onRecorded?.()}
      />

      {/* BREAK GLASS — a super admin only, and only while the ladder is still
          owed something (055). It sits BELOW the office's own Approve/Reject so
          that signing properly is always the first thing offered. */}
      <EmergencyReleaseBar
        pass={pass}
        approvals={approvals}
        role={role}
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

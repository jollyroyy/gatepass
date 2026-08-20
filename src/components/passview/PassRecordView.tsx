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
// `match_pass` enforces) — it opens `/verify/:id`, which offers Match, Flag and
// Hold, because naming one of three outcomes on the button would teach a guard
// the wrong model of their own job. It sits at the BOTTOM of the record, where
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
import Badge from '../Badge';
import PassRecordSummary from './PassRecordSummary';
import PassRecordReturns from './PassRecordReturns';
import PassTimeline from './PassTimeline';
import ApprovalDecisionBar from './ApprovalDecisionBar';

type Props = {
  record: GatePassRecord;
  /** Decides which action the record offers. Null renders none — a reader whose
   *  role has not resolved yet is never shown a button that will fail. */
  role?: UserRole | null;
  /** Which of the four approval offices the READER holds, or null (046). It is
   *  not a role — see approverAccess.ts — so it travels beside one, and it is
   *  what decides whether the Approve / Reject bar is drawn at the foot. */
  office?: ApprovalRoleKey | null;
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

export default function PassRecordView({
  record, role = null, office = null, onRecorded, onClear,
}: Props): React.ReactElement {
  const { pass, items, activity } = record;
  const roles = useApprovalRoles();
  // What THIS pass actually owes, and who has decided (046). A pass raised
  // before any office was designated carries none, and the ladder falls back to
  // grading the org chart — see approvalLadder.ts.
  const approvals = usePassApprovals(pass.id);

  // The reader's role decides how a vacant office reads on a pass with no
  // ladder of its own: for a guard the signed slip is in hand, so all four
  // levels are approved (client). A real pending row outranks that.
  const steps = buildApprovalSteps(pass, roles, role, approvals);
  const canRecord = canRecordReturns(pass, role);
  const canApprove = role === 'guard' && canVerifyAtGate(pass);
  const stage = passStageStyle(pass);

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

      <PassRecordSummary pass={pass} gateName={gateName} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 flex flex-col gap-5">
          <PassRecordReturns
            pass={pass}
            items={items}
            canRecord={canRecord}
            onRecorded={() => onRecorded?.()}
          />
        </div>

        <div className="flex flex-col gap-5">
          <PassTimeline steps={steps} activity={activity} />
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
        onDecided={() => onRecorded?.()}
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

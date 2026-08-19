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
import type { GatePassRecord } from '../../lib/useGatePassRecord';
import { passStageStyle } from '../../lib/passStage';
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { buildApprovalSteps, canRecordReturns } from '../../lib/approvalLadder';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import Badge from '../Badge';
import PassRecordSummary from './PassRecordSummary';
import PassRecordReturns from './PassRecordReturns';
import PassTimeline from './PassTimeline';

type Props = {
  record: GatePassRecord;
  /** Decides which action the record offers. Null renders none — a reader whose
   *  role has not resolved yet is never shown a button that will fail. */
  role?: UserRole | null;
  /** Re-read the record after a return lands. */
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
  record, role = null, onRecorded, onClear,
}: Props): React.ReactElement {
  const { pass, items, activity } = record;
  const roles = useApprovalRoles();

  // The reader's role decides how a vacant office reads: for a guard the
  // signed slip is in hand, so all four levels are approved (client).
  const steps = buildApprovalSteps(pass, roles, role);
  const canRecord = canRecordReturns(pass, role);
  const canApprove = role === 'guard' && canVerifyAtGate(pass);

  // The entrance the guard named when they cleared it. Nothing invents one:
  // there is no gate entity in this schema, so an unnamed exit shows no fact.
  const gateName = [...activity].reverse().find((v) => v.gate_name)?.gate_name ?? null;

  return (
    <section data-testid="pass-record" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title !mb-0">{pass.type} Gate Pass Details</h1>
            <Badge style={passStageStyle(pass)} />
            {pass.is_overdue && <Badge style={OVERDUE_STYLE} />}
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

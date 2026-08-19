// APPROVAL TIMELINE — the ladder down the right of a gate pass record.
//
// It prints the printed slip's own chain (Issuing HOD → Security Head → COO →
// CEO → Finance HOD → the gate → the return), so a guard holding the paper and
// a reader holding the tablet see the same five offices in the same order. The
// steps themselves are built in `src/lib/approvalLadder.ts`; this file is the
// rail, the dots and the wording of a vacant office.
//
// TWO THINGS IT REFUSES TO DO:
//   * invent a time. Four of the offices sign on paper and this database
//     records no moment for it, so those rungs carry a name and no date. Only
//     the raise and the gate clearance print one.
//   * imply an approval nobody gave. A vacant office is drawn hollow, in the
//     pending hue, and says "Not designated yet" — an admin has to name
//     somebody before it can read as signed.
//
// Colour is never the only carrier: every state also has its own words, because
// this screen is read on a mono print and by readers who do not separate red
// from orange.
import React from 'react';
import type { ApprovalStep, ApprovalStepState } from '../../lib/approvalLadder';
import { formatDateTime } from '../../lib/formatDate';

/** Dot fill and the ink of the step's own note. The keys are the union, so a
 *  fifth state is a compile error rather than an unstyled rung. */
const DOT: Record<ApprovalStepState, string> = {
  done: 'bg-matched-500 border-matched-500',
  pending: 'bg-transparent border-navy-300',
  blocked: 'bg-flagged-500 border-flagged-500',
  unset: 'bg-transparent border-pending-400',
};

const NOTE_INK: Record<ApprovalStepState, string> = {
  done: 'text-navy-500',
  pending: 'text-navy-500',
  blocked: 'text-flagged-700 font-semibold',
  unset: 'text-pending-700',
};

function Tick({ state }: { state: ApprovalStepState }): React.ReactElement {
  if (state === 'done') {
    return (
      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4.5 4.5L19 7" />
      </svg>
    );
  }
  if (state === 'blocked') {
    return (
      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4} aria-hidden="true">
        <path strokeLinecap="round" d="M12 6v8M12 18h.01" />
      </svg>
    );
  }
  return <span className="sr-only">Not yet</span>;
}

type Props = { steps: ApprovalStep[] };

export default function PassApprovalTimeline({ steps }: Props): React.ReactElement {
  return (
    <aside className="card p-5" data-testid="approval-timeline">
      <h2 className="card-title mb-4">Approval Timeline</h2>

      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <li key={step.key} className="flex gap-3">
            <span className="flex flex-col items-center shrink-0">
              <span
                className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${DOT[step.state]}`}
              >
                <Tick state={step.state} />
              </span>
              {/* The rail stops at the last rung — a tail hanging below the
                  final dot reads as a step nobody drew. */}
              {i < steps.length - 1 && <span className="w-px flex-1 bg-surface-300 my-1" />}
            </span>

            <div className="min-w-0 pb-5">
              <p className="text-sm font-semibold text-navy-900">{step.label}</p>
              {step.who && <p className="text-sm text-navy-700 break-words">{step.who}</p>}
              {step.detail && <p className="text-xs text-navy-500 break-words">{step.detail}</p>}
              {step.at && <p className="text-xs text-navy-500 tabular">{formatDateTime(step.at)}</p>}
              {step.note && (
                <p className={`text-xs mt-0.5 break-words ${NOTE_INK[step.state]}`}>{step.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

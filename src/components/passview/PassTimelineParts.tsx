// THE PIECES THE APPROVAL RAIL IS DRAWN FROM — the dot, the line between two
// dots, the indent every written line hangs in, and the one step's prose.
//
// SPLIT OUT OF `PassTimeline` on 2026-08-23, when the rail crossed the repo's
// 300-line cap. Nothing here decides anything: the state of a rung is settled
// by `buildApprovalSteps`, and these only paint it. The `Record<Union, ...>`
// maps stay maps on purpose — a fifth state is a compile error, never an
// unstyled rung.
import React from 'react';
import type { ApprovalStep, ApprovalStepState } from '../../lib/approvalLadder';
import type { VerifyAction } from '../../types';
import { formatDateTime } from '../../lib/formatDate';

/** Dot fill and the ink of the step's own note. The keys are the union, so a
 *  fifth state is a compile error rather than an unstyled rung. */
export const DOT: Record<ApprovalStepState, string> = {
  done: 'bg-matched-500 border-matched-500',
  pending: 'bg-transparent border-navy-300',
  blocked: 'bg-flagged-500 border-flagged-500',
  unset: 'bg-transparent border-pending-400',
  // A rung the other office on this level closed (063). Filled neutral, never
  // green: nobody signed it, and a green dot is what "approved" looks like.
  skipped: 'bg-navy-300 border-navy-300',
};

export const NOTE_INK: Record<ApprovalStepState, string> = {
  done: 'text-navy-500',
  pending: 'text-navy-500',
  blocked: 'text-flagged-700 font-semibold',
  unset: 'text-pending-700',
  skipped: 'text-navy-500',
};

export const ACTION_DOT: Record<VerifyAction, string> = {
  matched: 'bg-matched-500 border-matched-500',
  flagged: 'bg-flagged-500 border-flagged-500',
  returned: 'bg-accent-600 border-accent-600',
  held: 'bg-pending-500 border-pending-500',
  hod_reviewed: 'bg-accent-500 border-accent-500',
  cancelled: 'bg-navy-500 border-navy-500',
};

export const ACTION_TITLE: Record<VerifyAction, string> = {
  matched: 'Cleared out at the gate',
  // A FLAG IS NOT A REJECTION (client, 2026-08-23). The rail carries the
  // moment, the guard's name and their written reason underneath this line,
  // which is the whole of "what time he flagged it and who flagged it".
  flagged: 'Flagged to the requester at the gate',
  returned: 'Material marked returned',
  held: 'Held at the gate',
  hod_reviewed: 'Requester cleared the flag — back to the gate',
  cancelled: 'Voided by the HOD',
};

export function Tick({ state }: { state: ApprovalStepState }): React.ReactElement {
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

/** The dot and the length of rail under it. `last` is what stops a tail hanging
 *  below the final rung, which reads as a step nobody drew. */
export function Rail({
  dot, last, children,
}: {
  dot: React.ReactNode;
  last: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex gap-3">
      <span className="flex flex-col items-center shrink-0">
        {dot}
        {!last && <span className="w-px flex-1 bg-surface-300 my-1" />}
      </span>
      <div className="min-w-0 pb-5">{children}</div>
    </li>
  );
}

/** The indented block every entry hangs its written lines from. Set in from the
 *  rail so the headings above them stay the thing a reader scans down. */
export function StepDetail({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="pl-4 mt-0.5" data-testid="timeline-detail">{children}</div>
  );
}

/** The lines under a ladder rung. Both the ladder and the closing return step
 *  render it, so the two cannot drift apart. */
export function StepLines({ step }: { step: ApprovalStep }): React.ReactElement {
  return (
    <StepDetail>
      {step.who && <p className="text-sm text-navy-700 break-words">{step.who}</p>}
      {step.detail && <p className="text-xs text-navy-500 break-words">{step.detail}</p>}
      {step.at && <p className="text-xs text-navy-500 tabular">{formatDateTime(step.at)}</p>}
      {step.note && (
        <p className={`text-xs mt-0.5 break-words ${NOTE_INK[step.state]}`}>{step.note}</p>
      )}
    </StepDetail>
  );
}

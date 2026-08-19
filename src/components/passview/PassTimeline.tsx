// THE PASS TIMELINE — one rail down the right of a gate pass record, carrying
// the approval ladder AND the gate's own activity (client, 2026-08-19: "merge
// Activity timeline and approval timeline together for all passes").
//
// They were two cards side by side, and they are one story: who signed the
// paper, then what happened when the material reached the barrier. Reading it
// took holding two columns in your head and matching timestamps between them.
// Now the ladder's rungs come first, in slip order, and the gate's recorded
// events continue the SAME rail underneath, oldest first — so the card reads
// down in time from the raise to the last movement.
//
// The ladder prints the printed slip's own chain (Issuing HOD → Security Head →
// COO → CEO → Finance HOD → the gate → the return), so a guard holding the
// paper and a reader holding the tablet see the same five offices in the same
// order. The steps themselves are built in `src/lib/approvalLadder.ts`; this
// file is the rail, the dots and the wording of a vacant office.
//
// TWO THINGS THE LADDER HALF REFUSES TO DO:
//   * invent a time. Four of the offices sign on paper and this database
//     records no moment for it, so those rungs carry a name and no date. Only
//     the raise and the gate clearance print one.
//   * imply an approval nobody gave. A vacant office is drawn hollow, in the
//     pending hue, and says "Not designated yet" — an admin has to name
//     somebody before it can read as signed.
//
// THE ACTIVITY HALF IS `gatepass.v_verifications`, EXACTLY AS RECORDED, and it
// carries every gate event — matched, flagged, returned, HOD override, void —
// not just returns. Its wording comes from a Record<VerifyAction, …>, never a
// string match, so a new label on the Postgres enum is a type error rather than
// a blank line. It reads OLDEST FIRST here, unlike the standalone rail it
// replaces: on a shared rail the direction has to be the ladder's, or the card
// changes its mind about which way time runs half way down.
//
// Colour is never the only carrier: every state also has its own words, because
// this screen is read on a mono print and by readers who do not separate red
// from orange.
import React from 'react';
import type { ApprovalStep, ApprovalStepState } from '../../lib/approvalLadder';
import type { VerifyAction, Verification } from '../../types';
import { formatDateTime, formatTime, formatDateOnly } from '../../lib/formatDate';

/** One row of `v_verifications`, with the security officer's name resolved. */
export interface ActivityEntry extends Verification {
  security_name: string;
}

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

const ACTION_DOT: Record<VerifyAction, string> = {
  matched: 'bg-matched-500 border-matched-500',
  flagged: 'bg-flagged-500 border-flagged-500',
  returned: 'bg-accent-600 border-accent-600',
  held: 'bg-pending-500 border-pending-500',
  hod_reviewed: 'bg-accent-500 border-accent-500',
  cancelled: 'bg-navy-500 border-navy-500',
};

const ACTION_TITLE: Record<VerifyAction, string> = {
  matched: 'Cleared out at the gate',
  flagged: 'Mismatch raised at the gate',
  returned: 'Material marked returned',
  held: 'Held at the gate',
  hod_reviewed: 'HOD approved the override',
  cancelled: 'Voided by the HOD',
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

/** The dot and the length of rail under it. `last` is what stops a tail hanging
 *  below the final rung, which reads as a step nobody drew. */
function Rail({
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

type Props = { steps: ApprovalStep[]; activity: ActivityEntry[] };

export default function PassTimeline({ steps, activity }: Props): React.ReactElement {
  return (
    <aside className="card p-5" data-testid="pass-timeline">
      <h2 className="card-title mb-4">Approval &amp; Activity Timeline</h2>

      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <Rail
            key={step.key}
            last={i === steps.length - 1 && activity.length === 0}
            dot={
              <span className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${DOT[step.state]}`}>
                <Tick state={step.state} />
              </span>
            }
          >
            <p className="text-sm font-semibold text-navy-900">{step.label}</p>
            {step.who && <p className="text-sm text-navy-700 break-words">{step.who}</p>}
            {step.detail && <p className="text-xs text-navy-500 break-words">{step.detail}</p>}
            {step.at && <p className="text-xs text-navy-500 tabular">{formatDateTime(step.at)}</p>}
            {step.note && (
              <p className={`text-xs mt-0.5 break-words ${NOTE_INK[step.state]}`}>{step.note}</p>
            )}
          </Rail>
        ))}

        {activity.map((v, i) => (
          <Rail
            key={v.id}
            last={i === activity.length - 1}
            dot={<span className={`mt-1.5 h-2.5 w-2.5 ml-[5px] mr-[5px] rounded-full border-2 shrink-0 ${ACTION_DOT[v.action]}`} />}
          >
            <p className="text-xs text-navy-500">
              {formatTime(v.created_at)} · {formatDateOnly(v.created_at)}
            </p>
            <p className="text-sm font-semibold text-navy-900">{ACTION_TITLE[v.action]}</p>
            <p className="text-xs text-navy-500">by {v.security_name || 'security'}</p>
            {v.remarks && <p className="text-xs text-navy-700 mt-0.5 break-words">{v.remarks}</p>}
          </Rail>
        ))}
      </ol>

      {activity.length === 0 && (
        <p className="empty-state !py-4">Nothing recorded at the gate yet.</p>
      )}
    </aside>
  );
}

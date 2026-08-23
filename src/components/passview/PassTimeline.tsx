// THE PASS TIMELINE — one rail down the right of a gate pass record, carrying
// the approval ladder AND the gate's own activity (client, 2026-08-19: "merge
// Activity timeline and approval timeline together for all passes").
//
// They were two cards side by side, and they are one story: who signed the
// paper, then what happened when the material reached the barrier. Reading it
// took holding two columns in your head and matching timestamps between them.
// Now the ladder's rungs come first, in slip order, and the gate's recorded
// events continue the SAME rail underneath, oldest first — so the card reads
// down in time from the raise to the last movement. The RETURN leg is the one
// rung that leaves the ladder's own order: it closes the rail, below the gate's
// events, because material is due back only after it has gone out (client,
// 2026-08-19).
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
//
// THE WRITTEN DETAIL OF A RUNG IS SET IN FROM THE RAIL (client, 2026-08-20:
// "whatever individual written items you show are … a little to the right side
// of the main timeline straight line, just to show them distinguished from the
// normal flow"). The HEADING stays where the dot is — it is the step, and a
// step that does not line up with its own dot is a rail nobody can scan.
// Everything written UNDER it — the person, the department, the moment, the
// note, the guard's remark — hangs off that heading in one indented block, so
// the chain of steps reads down the left and the prose hangs to the right of
// it. It is one `<div>` per entry, `StepDetail`, so no line can drift out of
// the indent by being added in the wrong place.
import React from 'react';
import type { ApprovalStep } from '../../lib/approvalLadder';
import type { ReturnTimelineLine } from '../../lib/returnTimeline';
import { outstandingLineNote } from '../../lib/returnTimeline';
import type { LineState } from '../../lib/returnDraft';
import type { Verification } from '../../types';
import { formatTime, formatDateOnly } from '../../lib/formatDate';

/** One row of `v_verifications`, with the security officer's name resolved. */
export interface ActivityEntry extends Verification {
  security_name: string;
}

import {
  DOT, ACTION_DOT, ACTION_TITLE, Tick, Rail, StepDetail, StepLines,
} from './PassTimelineParts';


type Props = {
  steps: ApprovalStep[];
  activity: ActivityEntry[];
  /** EVERY MATERIAL LINE OF AN RGP AND HOW FAR IT HAS COME BACK (client,
   *  2026-08-22). Empty on an NRGP and on a refused pass — see
   *  `buildReturnTimeline`, which decides that, not this component. The
   *  quantities include what the guard has STAGED but not yet recorded, which
   *  is what makes the rail move as they type. */
  returnLines?: ReturnTimelineLine[];
  /** THE GATE IS THE END OF THIS PASS — an NRGP, which never comes back
   *  (client, 2026-08-23). The rail already names the clearance a rung above,
   *  on the ladder's own gate step, so the recorded gate event underneath it
   *  said the same thing twice. On a pass that closes there it says what the
   *  ladder cannot: the pass is CLOSED. An RGP is not — its material is still
   *  out — so it keeps the plain wording and closes on its return rung. */
  closesAtGate?: boolean;
};

/** The one rung that ends the pass, in the rail's own green and heavier than
 *  the steps above it (client, 2026-08-23: "the same green that you are doing
 *  for the other timeline milestones … make the closed bold"). `matched-700`
 *  inverts with the theme; the small tinted pills under the return lines do
 *  not, which is why this is the heading's own ink and not one of those. */
const CLOSED_HEADING = 'text-sm font-bold text-matched-700';
const STEP_HEADING = 'text-sm font-semibold text-navy-900';

/** THE SAME THREE HUES THE ITEM TABLE PAINTS A LINE IN (`ITEM_RETURN_STYLES`),
 *  in the house theme this card is drawn in — the rail and the table are read
 *  side by side and a line must not be one colour on one and another on the
 *  other. House tokens, not the guard skin's `.gb-pill-*`: those paint from
 *  `--gb-*` custom properties, and the timeline carries no such island.
 *  Keyed on the union, so a fourth state is a compile error. */
const LINE_INK: Record<LineState, string> = {
  returned: 'bg-matched-50 text-matched-700',
  partial: 'bg-accent-50 text-accent-700',
  pending: 'bg-pending-50 text-pending-700',
};

/** The line list that hangs under the return rung. Short on purpose: a state
 *  and two numbers per line, in a rail one column wide. The name of the line
 *  is what a reader matches against the table on the other side of the screen;
 *  everything else about it lives there. */
function ReturnLines({ lines }: { lines: ReturnTimelineLine[] }): React.ReactElement {
  const note = outstandingLineNote(lines);
  return (
    <div className="mt-2" data-testid="timeline-return-lines">
      {note && <p className="text-xs font-semibold text-navy-700 mb-1">{note}</p>}
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.id} className="min-w-0">
            <p className="text-xs text-navy-700 break-words">{`${l.lineNo}. ${l.name}`}</p>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${LINE_INK[l.state]}`}>
              {l.short}
            </span>
            {/* A STAGED FIGURE IS NOT A RECORDED ONE. `apply_item_returns` has
                no undo, so the rail must never let "looks done" read as
                "is done" — the same rule the table's tinted row follows. */}
            {l.staged && <span className="ml-1 text-[11px] text-pending-700">Not recorded yet</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** THE RETURN LEG CLOSES THE RAIL, UNDER THE GATE'S OWN EVENTS (client,
 *  2026-08-19: "Cleared out at the gate should be just before the return …
 *  To Be Returned should be after Cleared out at the gate").
 *
 *  `buildApprovalSteps` is the printed SLIP's order and keeps it — there the
 *  return is simply the last box. On the merged rail the recorded gate events
 *  come after the ladder, so leaving the return step among them put "To Be
 *  Returned" ABOVE "Cleared out at the gate": the card said the material was
 *  due back before it had left. It is split off here, in the rail, because
 *  this is a rendering order, not a change to the ladder itself. */
const RETURN_STEP_KEY = 'return';

export default function PassTimeline({
  steps, activity, returnLines = [], closesAtGate = false,
}: Props): React.ReactElement {
  const ladder = steps.filter((s) => s.key !== RETURN_STEP_KEY);
  const closing = steps.filter((s) => s.key === RETURN_STEP_KEY);

  return (
    <aside className="card p-5" data-testid="pass-timeline">
      <h2 className="card-title mb-4">Approval &amp; Activity Timeline</h2>

      <ol className="flex flex-col">
        {ladder.map((step, i) => (
          <Rail
            key={step.key}
            last={i === ladder.length - 1 && activity.length === 0 && closing.length === 0}
            dot={
              <span className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${DOT[step.state]}`}>
                <Tick state={step.state} />
              </span>
            }
          >
            <p className={STEP_HEADING}>{step.label}</p>
            <StepLines step={step} />
          </Rail>
        ))}

        {activity.map((v, i) => (
          <Rail
            key={v.id}
            last={i === activity.length - 1 && closing.length === 0}
            dot={<span className={`mt-1.5 h-2.5 w-2.5 ml-[5px] mr-[5px] rounded-full border-2 shrink-0 ${ACTION_DOT[v.action]}`} />}
          >
            <p className="text-xs text-navy-500">
              {formatTime(v.created_at)} · {formatDateOnly(v.created_at)}
            </p>
            {(() => {
              const closes = closesAtGate && v.action === 'matched';
              return (
                <p className={closes ? CLOSED_HEADING : STEP_HEADING}>
                  {closes ? 'Closed' : ACTION_TITLE[v.action]}
                </p>
              );
            })()}
            <StepDetail>
              <p className="text-xs text-navy-500">by {v.security_name || 'security'}</p>
              {v.remarks && <p className="text-xs text-navy-700 mt-0.5 break-words">{v.remarks}</p>}
            </StepDetail>
          </Rail>
        ))}

        {closing.map((step) => (
          <Rail
            key={step.key}
            last
            dot={
              <span className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${DOT[step.state]}`}>
                <Tick state={step.state} />
              </span>
            }
          >
            <p className={step.state === 'done' ? CLOSED_HEADING : STEP_HEADING}>{step.label}</p>
            <StepLines step={step} />
            {returnLines.length > 0 && (
              <StepDetail>
                <ReturnLines lines={returnLines} />
              </StepDetail>
            )}
          </Rail>
        ))}
      </ol>

      {activity.length === 0 && (
        <p className="empty-state !py-4">Nothing recorded at the gate yet.</p>
      )}
    </aside>
  );
}

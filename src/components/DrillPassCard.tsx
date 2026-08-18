// One pass in a dashboard KPI drill, as the shadcn Card the client asked for.
//
// Client feedback, 2026-08-11: "I like the gate console's card view — make the
// stacked cards under the HOD dashboard like that, but compact." This is the
// HOD/admin sibling of src/pages/Security/GuardDrillCard.tsx: the same
// `PassRow variant="drill"` idiom — CardHeader of identity + state, CardContent
// of labelled facts (PassRowBody), CardFooter for actions — at `dense`
// spacing, and with no return-recording controls, because closing an RGP is a
// guard action and neither of these boards can perform it.
//
// The card SHELL (ring + contact shadow layered over `.card`) is copied from
// GuardDrillCard rather than shared: that component's ring is load-bearing for
// its own test, which locates it via `.closest('.card')`, and coupling the two
// would mean a purely visual tweak on one board silently changing the other.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../types';
import PassRow from './PassRow';

type Props = {
  pass: GatePassView;
  /** 1-based position in the stack — see PassOrdinal. */
  index?: number;
  /** The HOD board passes false — they raised the pass, so their own name back
   *  at them is noise. The admin board oversees every department and keeps it. */
  showRaisedBy?: boolean;
};

export default function DrillPassCard({ pass, showRaisedBy = true, index }: Props): React.ReactElement {
  // The footer is a single route to the record. A drill card is for reading a
  // list at a glance; anything that MUTATES the pass lives on the pass itself.
  const detail = (
    <Link to={`/pass/${pass.id}`} className="text-xs font-semibold text-accent-600 hover:underline">
      Full details →
    </Link>
  );

  // Overdue keeps its own ring colour instead of stacking two rings.
  const ringClass = pass.is_overdue
    ? 'ring-overdue-500/40'
    : 'ring-black/[0.06] dark:ring-white/[0.07]';

  return (
    <div
      className={`card overflow-hidden ring-1 ${ringClass} shadow-xs
                  transition-all duration-200 hover:ring-black/[0.10] dark:hover:ring-white/[0.12]`}
    >
      <PassRow
        pass={pass}
        variant="drill"
        defaultOpen
        dense
        index={index}
        showRaisedBy={showRaisedBy}
        detail={detail}
      />
    </div>
  );
}

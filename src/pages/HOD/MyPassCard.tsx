// One pass in the HOD's own register (/my-passes), as a glass card.
//
// Client, 2026-08-11: "The My Passes cards are not properly showing it. Can you
// make it like the card format of the dashboard but with a little less
// information? Premium looking glass morphic design."
//
// So this is DrillPassCard's sibling — the same `PassRow variant="drill"`
// idiom (identity header, one status pill, labelled-fact body, footer link) —
// with three deliberate differences:
//
//   1. It is COLLAPSED by default. A dashboard drill is a short answer to a
//      KPI click and opens expanded; My Passes is a scrollable register, and
//      a stack of open cards is the "too much information" the client was
//      complaining about.
//   2. Because it is collapsed, the header carries a subtitle — material and
//      value — so a column of pass numbers is still scannable. Those two
//      facts are what the previous compact card led with, and the client did
//      not object to them.
//   3. `slim` trims the opened body to vendor / material / items / vehicle /
//      expected return. An HOD reading their own register already knows the
//      department and who raised it.
//
// The card SHELL is `.card-glass` (a lighter, blurrier surface than `.card`)
// rather than a copy of DrillPassCard's `.card` shell: the client asked for
// glass specifically here, and keeping the two shells separate means a visual
// tweak to one board never silently changes the other — the same reasoning
// DrillPassCard's own comment gives for keeping its shell local rather than
// shared.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';
import { formatCurrency } from '../../lib/formatCurrency';

type Props = {
  /** 1-based position in the register's stack — see PassOrdinal. */
  index?: number;
  pass: GatePassView;
  /** Extra chips beside the subtitle (e.g. the item-count pill). */
  badge?: React.ReactNode;
};

export default function MyPassCard({ pass, badge, index }: Props): React.ReactElement {
  // Always visible, because the body is not. Material first — it is what the
  // HOD is looking for — then value, which they asked to read as primary.
  const subtitle = (
    <div className="flex items-center gap-2 min-w-0 text-caption">
      <span className="truncate text-navy-600">{pass.material_summary ?? '—'}</span>
      {pass.total_value > 0 && (
        <>
          <span className="w-1 h-1 rounded-full bg-navy-300 shrink-0" />
          <span className="font-semibold text-navy-800 tabular-nums shrink-0">
            {formatCurrency(pass.total_value)}
          </span>
        </>
      )}
      {badge}
    </div>
  );

  const detail = (
    <Link to={`/pass/${pass.id}`} className="text-xs font-semibold text-accent-600 hover:underline">
      Full details →
    </Link>
  );

  // Overdue keeps its own ring colour instead of stacking two rings.
  const ringClass = pass.is_overdue
    ? 'ring-overdue-500/40'
    : 'ring-black/[0.05] dark:ring-white/[0.06]';

  return (
    <div
      className={`card-glass overflow-hidden ring-1 ${ringClass} shadow-xs
                  transition-all duration-200 hover:-translate-y-px
                  hover:ring-black/[0.10] dark:hover:ring-white/[0.12]`}
    >
      <PassRow pass={pass} variant="drill" dense slim index={index} showRaisedBy={false} subtitle={subtitle} detail={detail} />
    </div>
  );
}

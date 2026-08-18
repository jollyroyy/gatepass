// One pass, fully described, as the payload of a dashboard KPI drill.
//
// The 2026-08-10 card rule (client feedback — "I see the vendor name on top
// AND in the body"): this is a shadcn-idiom Card. `PassRow` in `variant="drill"`
// owns the CardHeader (identity + status only) and the CardContent (every
// other fact, exactly once, via `PassRowBody`); this component supplies only
// the CardFooter — the actions — as `detail`, on its own muted surface.
//
// THE CARD NO LONGER RECORDS RETURNS (2026-08-18). Awaiting Return and Overdue
// stopped being in-place drills: the guard board's two return figures now
// navigate to `/returns` and `/overdue`, which list MATERIAL LINES and record
// them through `apply_item_returns`. Every drill still rendered as a card is
// read-only for RETURNS. It does still carry Verify at Gate: the Pending Queue
// left the Search Pass screen on the same day, so the board's own "Pending for
// Gate Approval" drill is where a guard picks a waiting pass off a list.
// `canVerifyAtGate` is the same rule `match_pass` enforces — a button that
// always fails is worse than no button.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';
import { canVerifyAtGate } from '../../lib/phoneSearch';

type Props = {
  pass: GatePassView;
  /** 1-based position in the drill's stack — see PassOrdinal. */
  index?: number;
};

export default function GuardDrillCard({ pass, index }: Props): React.ReactElement {
  const detail = (
    <div className="flex items-center justify-between gap-3">
      <Link to={`/pass/${pass.id}`} className="text-xs font-semibold text-accent-600 hover:underline shrink-0">
        Full details →
      </Link>
      {canVerifyAtGate(pass) && (
        <Link to={`/verify/${pass.id}`} className="btn-secondary">
          Verify at Gate
        </Link>
      )}
    </div>
  );

  // Crisp inset ring + a near-flat contact shadow, layered ON TOP of the
  // app-wide `.card` class rather than replacing it: drill tests locate this
  // exact card via `.closest('.card')`, and this component is the ONLY place
  // that class is produced for a drill card. `.card`'s ambient `shadow-card-premium` still cascades from
  // `@layer components`, but `shadow-xs`/`ring-1` are Tailwind utilities
  // (`@layer utilities`, generated after components) and win the box-shadow
  // property at equal specificity — the RENDERED edge is the crisp ring the
  // client asked for; `.card`'s own hairline border is what remains under it.
  // Overdue keeps its own ring colour instead of stacking two rings.
  const ringClass = pass.is_overdue
    ? 'ring-overdue-500/40'
    : 'ring-black/[0.06] dark:ring-white/[0.07]';

  return (
    <div
      className={`card overflow-hidden ring-1 ${ringClass} shadow-xs
                  transition-all duration-200 hover:ring-black/[0.10] dark:hover:ring-white/[0.12]`}
    >
      {/* `dense`, like every other stacked card since 2026-08-18: the roomy
          variant crowded a guard's screen with three cards and no more. */}
      <PassRow pass={pass} variant="drill" defaultOpen dense index={index} detail={detail} />
    </div>
  );
}
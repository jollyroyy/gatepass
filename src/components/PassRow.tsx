// One gate pass as a LINE, in the two lists that still read that way: the
// guard's phone-number search results (the default row — identity, a few
// inline facts, the timeline strip, the status badge) and the HOD's two
// single-pass review screens (`compact` — three facts collapsed, the rest
// revealed in place).
//
// THE STACKED CARD IS NOT HERE ANY MORE. Every stacked list — the HOD and
// admin KPI drills — draws `PassStackCard`, the guard's own
// plate, and navigates to `/pass/:id` (client, 2026-08-19: "all the cards …
// should mimic the exact same stacked card style of the guard's view"). The
// `drill` variant, `PassRowBody` and `PassItemLines` went with that change,
// deleted rather than left unreachable; the facts they carried — every
// material line, its value and the pass's total — are on the record the card
// now opens.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../types';
import { TypeChip } from './Badge';
import PassOrdinal from './PassOrdinal';
import PassRowCompact from './PassRowCompact';
import { formatDateOnly } from '../lib/formatDate';
import { parseCompanyInfo } from '../lib/companyInfo';
import { passStageStyle } from '../lib/passStage';
import PassTimelineStrip from './PassTimelineStrip';

/** One tiny fact: "Vehicle WB01AB1234". `emphasize` bumps the value's weight
 *  only (never colour) for the facts the client asked to read as primary. */
function Fact({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }): React.ReactElement {
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">{label}</span>
      <span className={`text-sm truncate ${emphasize ? 'font-bold text-navy-900' : 'font-medium text-navy-800'}`}>
        {value}
      </span>
    </span>
  );
}

type Props = {
  pass: GatePassView;
  /** Clicking the row navigates here (e.g. `/verify/${id}` or `/pass/${id}`). */
  to?: string;
  /** Clicking the row calls this instead (dashboard KPI drills). */
  onOpen?: (id: string) => void;
  /** Extra chips at the right edge, before the status badge (e.g. a wait pill
   *  or a return badge). Row variant only. */
  badge?: React.ReactNode;
  /** The head of a queue gets the gold ring. */
  isOldest?: boolean;
  /** Expanded content — a free-form detail block under the row. */
  detail?: React.ReactNode;
  /** The stack presentation used by the HOD's two review screens: collapsed it
   *  shows exactly three facts — Item, Value, Reason — plus identity and
   *  status; clicking reveals the rest inline (PassRowCompact), with `to` /
   *  `onOpen` surviving as a "View full pass" affordance inside. */
  compact?: boolean;
  /** 1-based position in the stack, shown as a small ordinal beside the pass
   *  number (client, 2026-08-18). The LIST assigns it — the same pass is #3 in
   *  one drill and #1 in another. Omitted for a card that stands alone. */
  index?: number;
};

export default function PassRow({
  pass: p,
  to,
  onOpen,
  badge,
  isOldest,
  detail,
  compact = false,
  index,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const company = parseCompanyInfo(p.visitor_company);
  // ONE pill, naming the LATEST state — never "Matched  Closed" (client,
  // 2026-08-11). The outward match it supersedes is not lost: it is a moment
  // in `passTimeline`, rendered by the expanded body below and by PassDetail.
  const badgeStyle = passStageStyle(p);
  const expandable = compact || (Boolean(detail) && !to);
  const isRgp = p.type === 'RGP';

  const content = (
    <>
      {/* Steady-state row: the main details, one line. */}
      {index !== undefined && <PassOrdinal index={index} />}
      <span className="font-normal text-navy-950 text-base font-display tracking-tight truncate shrink-0">
        {p.pass_number}
      </span>
      <TypeChip type={p.type} />
      {company.name ? (
        <span className="text-sm font-semibold text-brand-700 truncate">{company.name}</span>
      ) : (
        <span className="text-sm text-navy-800 truncate">{p.visitor_name}</span>
      )}
      <span className="hidden lg:inline-flex items-baseline gap-1.5 min-w-0 max-w-56">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">Material</span>
        <span className="text-sm text-navy-600 truncate">{p.material_summary ?? '—'}</span>
      </span>
      {p.vehicle_number && <Fact label="Vehicle" value={p.vehicle_number} />}
      {p.department_code && <Fact label="Dept" value={p.department_code} />}
      <Fact label="Raised By" value={p.raised_by_name} emphasize />
      {isRgp && p.expected_return_date && (
        <Fact label="Return" value={formatDateOnly(p.expected_return_date)} emphasize />
      )}

      {/* Timeline: the dates the boss asked to see on every card — and, since
          the badge names only the latest state, the only place the outward
          "Cleared Out" match and the "Returned" moment still appear. */}
      <PassTimelineStrip pass={p} className="ms-auto flex items-center gap-3 shrink-0">
        {badge}
        <span className={`status-badge ${badgeStyle.bg} ${badgeStyle.text}`}>
          {badgeStyle.label}
        </span>
      </PassTimelineStrip>

      {/* Flag reason trails under the row so the accusation is never lost. */}
      {p.flag_reason && (
        <span className="w-full flex items-center gap-2 text-xs text-flagged-600 font-medium truncate">
          <span className="w-1 h-1 rounded-full bg-flagged-500 shrink-0" />
          {p.flag_reason}
        </span>
      )}
    </>
  );

  const chevron = expandable && (
    <svg
      className={`w-4 h-4 text-navy-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );

  const rootClass =
    'flex flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 rounded-xl border transition-all duration-200 ' +
    (isOldest ? 'ring-1 ring-brand-500/40 ' : '') +
    (p.is_overdue ? 'ring-1 ring-overdue-500/40 ' : '') +
    (expandable ? ' cursor-pointer' : '');

  // Detail sits inside a container that swallows its own clicks, so buttons
  // inside it (Record Returns, Return All) never bubble up and collapse the
  // row under their own hands.
  const detailBlock = open && expandable && detail ? (
    <div className="w-full mt-3 pt-3 border-t border-surface-200/60" onClick={(e) => e.stopPropagation()}>
      {detail}
    </div>
  ) : null;

  // Stack card (board drills, HOD flagged review): collapsed = three facts only;
  // the click expands inline rather than navigating — the "View full pass"
  // affordance inside the opened card preserves the old navigation path.
  if (compact) {
    return (
      <div onClick={() => setOpen(!open)} className={rootClass}>
        {index !== undefined && <PassOrdinal index={index} />}
        <PassRowCompact
          pass={p}
          open={open}
          badge={badge}
          statusBadge={
            <span className={`status-badge ${badgeStyle.bg} ${badgeStyle.text}`}>{badgeStyle.label}</span>
          }
          detailUrl={to}
          onViewDetail={onOpen}
        />
        {chevron}
      </div>
    );
  }

  if (to) {
    return (
      <Link to={to} className={rootClass}>
        {content}
        {chevron}
      </Link>
    );
  }

  if (onOpen) {
    return (
      <button type="button" onClick={() => onOpen(p.id)} className={`text-left ${rootClass}`}>
        {content}
        {chevron}
        {detailBlock}
      </button>
    );
  }

  return (
    <div onClick={expandable ? () => setOpen(!open) : undefined} className={rootClass}>
      {content}
      {chevron}
      {detailBlock}
    </div>
  );
}

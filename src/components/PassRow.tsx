// One gate pass as a horizontal row card, shared by every role.
//
// The 2026-08-08 rule: EVERY pass card in the app is a compact horizontal row
// with the main details on one line, and drilling/expanding it reveals the
// full detail. The visual language is defined once here instead of in five
// near-copies (QueueCard, GuardDrillCard, FlaggedReviewCard, drill list rows,
// reports rows).
//
// What stays in the steady row: pass number, type, vendor, visitor, material
// (truncated), vehicle, department, the "Raised → Mismatch → Override"
// timeline dates, and the status badge. Everything else — the field grid,
// flag reason, return actions, line items — lives in `detail`, which the row
// reveals when it is expanded.
//
// The row itself may be:
//   - a Link (when `to` is given — e.g. the gate console rows drill straight
//     into /verify/:id, report rows into /pass/:id),
//   - a focused button (when `onOpen` is given — dashboard KPI drills keep
//     the click on the page and hand the id to the caller), or
//   - a plain expander (when only `detail` is given).
//
// The status badge is deliberately STATUS-only: EXPIRED_STYLE for an
// expired-pending pass, otherwise `STATUS_STYLES[status]`. An overdue pass
// earns the overdue RING, not an 'Overdue' badge label — every drill row that
// is in a list whose KPI is named "Overdue"/"Expired" must not repeat that
// exact word inside the card (several tests and one a11y name depend on
// exact-text lookups of the KPI's own label).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { isToday } from 'date-fns';
import type { GatePassView } from '../types';
import { TypeChip } from './Badge';
import { formatDateOnly, formatTime } from '../lib/formatDate';
import { parseCompanyInfo } from '../lib/companyInfo';
import { EXPIRED_STYLE, STATUS_STYLES, isExpiredPending } from '../lib/statusStyles';

/** One moment in the timeline: "Mismatch 10:02" (time today, date otherwise). */
function TimelineItem({ label, at }: { label: string; at: string | null }): React.ReactElement | null {
  if (!at) return null;
  const shown = isToday(new Date(at)) ? formatTime(at) : formatDateOnly(at);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-navy-500 whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-navy-300" />
      <span className="uppercase tracking-wider text-navy-400 text-[10px] font-semibold">{label}</span>
      {shown}
    </span>
  );
}

/** One tiny fact: "Vehicle WB01AB1234". */
function Fact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">{label}</span>
      <span className="text-sm font-medium text-navy-800 truncate">{value}</span>
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
   *  or a return badge). */
  badge?: React.ReactNode;
  /** The head of a queue gets the gold ring. */
  isOldest?: boolean;
  /** Expanded content: field grid, flag reason, return actions, line items. */
  detail?: React.ReactNode;
  /** Start expanded (e.g. a drill card, whose whole point is the detail). */
  defaultOpen?: boolean;
};

export default function PassRow({
  pass: p,
  to,
  onOpen,
  badge,
  isOldest,
  detail,
  defaultOpen = false,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const company = parseCompanyInfo(p.visitor_company);
  const badgeStyle = isExpiredPending(p) ? EXPIRED_STYLE : STATUS_STYLES[p.status];
  const expandable = Boolean(detail) && !to;

  const content = (
    <>
      {/* Steady-state row: the main details, one line. */}
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">Material</span>
        <span className="text-sm text-navy-600 truncate">{p.material_summary ?? '—'}</span>
      </span>
      {p.vehicle_number && <Fact label="Vehicle" value={p.vehicle_number} />}
      {p.department_code && <Fact label="Dept" value={p.department_code} />}

      {/* Timeline: the dates the boss asked to see on every card. */}
      <span className="ms-auto flex items-center gap-3 shrink-0">
        <TimelineItem label="Raised" at={p.created_at} />
        <TimelineItem label="Mismatch" at={p.flag_reason ? (p.flagged_at ?? p.verified_at) : null} />
        <TimelineItem
          label="Override"
          at={p.status === 'hod_reviewed' ? (p.hod_reviewed_at ?? p.verified_at) : null}
        />
        {badge}
        <span className={`status-badge ${badgeStyle.bg} ${badgeStyle.text}`}>
          {badgeStyle.label}
        </span>
      </span>

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
      className={`w-4 h-4 text-navy-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );

  const rootClass =
    'flex flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 rounded-xl border transition-all duration-200 ' +
    (isOldest ? 'ring-1 ring-brand-500/40 ' : '') +
    (p.is_overdue ? 'ring-1 ring-overdue-500/40 ' : '') +
    (expandable ? ' cursor-pointer' : '');

  // Detail sits inside a container that swallows its own clicks, so buttons
  // inside it (Record Returns, Return All) never bubble up and collapse the
  // row under their own hands.
  const detailBlock = open && expandable ? (
    <div className="w-full mt-3 pt-3 border-t border-surface-200/60" onClick={(e) => e.stopPropagation()}>
      {detail}
    </div>
  ) : null;

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
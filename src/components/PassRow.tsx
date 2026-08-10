// One gate pass, shared by every role. Two presentations:
//
//   variant="row" (default) — a compact horizontal line: identity, a few
//   inline facts, the timeline, the status badge. Used by QueueCard,
//   FlaggedReviewCard, MyPassesTable and DrillList (the HOD drills) — none of
//   these render a second "expanded" copy of the same facts, so nothing here
//   duplicates.
//
//   variant="drill" — the shadcn Card idiom (client feedback 2026-08-10): a
//   CardHeader that is IDENTITY + STATE ONLY (pass number, type chip, status
//   pill — no vendor/visitor/material/vehicle/department), a CardContent body
//   (PassRowBody) carrying every other fact EXACTLY ONCE, and an optional
//   CardFooter (`detail`) on a distinct muted surface for actions. This is
//   what GuardDrillCard uses; the old version showed every fact in the header
//   AND again in its own detail grid, which was the client's actual
//   complaint ("I see the vendor name on top and also in the body").
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { isToday } from 'date-fns';
import type { GatePassView } from '../types';
import { TypeChip } from './Badge';
import PassRowBody from './PassRowBody';
import PassRowCompact from './PassRowCompact';
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
      <span className="uppercase tracking-wider text-navy-500 text-[10px] font-semibold">{label}</span>
      {shown}
    </span>
  );
}

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
  /** Expanded content. Row variant: a free-form detail block. Drill variant:
   *  the CardFooter — actions on their own muted surface, below the
   *  auto-rendered CardContent body. */
  detail?: React.ReactNode;
  /** Start expanded (e.g. a drill card, whose whole point is the detail). */
  defaultOpen?: boolean;
  /** "row" (default): compact single-line card, used in every list. "drill":
   *  the shadcn Card idiom — identity-only header, PassRowBody content, a
   *  muted-surface footer for `detail`. */
  variant?: 'row' | 'drill';
  /** Row variant only: the stack presentation (My Passes, HOD flagged review).
   *  Collapsed it shows exactly three facts — Item, Value, Reason — plus
   *  identity and status; clicking reveals the rest inline (PassRowCompact),
   *  with `to` / `onOpen` surviving as a "View full pass" affordance inside. */
  compact?: boolean;
};

export default function PassRow({
  pass: p,
  to,
  onOpen,
  badge,
  isOldest,
  detail,
  defaultOpen = false,
  variant = 'row',
  compact = false,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const company = parseCompanyInfo(p.visitor_company);
  const badgeStyle = isExpiredPending(p) ? EXPIRED_STYLE : STATUS_STYLES[p.status];
  const expandable = compact || (Boolean(detail || variant === 'drill') && !to);
  const isRgp = p.type === 'RGP';

  if (variant === 'drill') {
    // CardHeader: identity + state, nothing else. `justify-between` is the
    // shadcn header grid's stand-in for CardAction pinning the status pill
    // top-right without absolute positioning.
    // The header is the ONLY toggle control — its accessible name is just the
    // pass number, chip and status. Putting role="button" on the whole card
    // instead would give it an accessible name equal to its ENTIRE text
    // content (including footer button labels), which broke `getByRole` name
    // matching on 'Return All' during testing and would read just as badly to
    // a screen reader.
    const header = (
      <div
        className="flex items-center justify-between gap-3 px-5 pt-5 cursor-pointer"
        data-testid="pass-card-header"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-h3 font-semibold tabular-nums tracking-tight text-navy-900 truncate">
            {p.pass_number}
          </span>
          <TypeChip type={p.type} />
        </div>
        <span className={`status-badge shrink-0 ${badgeStyle.bg} ${badgeStyle.text}`}>{badgeStyle.label}</span>
      </div>
    );

    const content = open ? (
      <div>
        {/* CardContent */}
        <div className="px-5 pb-5 pt-4" data-testid="pass-card-body">
          <PassRowBody pass={p} />
        </div>
        {/* CardFooter — a distinct muted band, never the same surface as the
            body, or the card flattens back into an unstructured box. */}
        {detail && (
          <div className="bg-surface-100/60 border-t border-surface-200 px-5 py-4" data-testid="pass-card-footer">
            {detail}
          </div>
        )}
      </div>
    ) : null;

    return (
      <div>
        {header}
        {content}
      </div>
    );
  }

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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">Material</span>
        <span className="text-sm text-navy-600 truncate">{p.material_summary ?? '—'}</span>
      </span>
      {p.vehicle_number && <Fact label="Vehicle" value={p.vehicle_number} />}
      {p.department_code && <Fact label="Dept" value={p.department_code} />}
      <Fact label="Raised By" value={p.raised_by_name} emphasize />
      {isRgp && p.expected_return_date && (
        <Fact label="Return" value={formatDateOnly(p.expected_return_date)} emphasize />
      )}

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
    'flex flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 rounded-xl border transition-all duration-200 ' +
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

  // Stack card (My Passes, HOD flagged review): collapsed = three facts only;
  // the click expands inline rather than navigating — the "View full pass"
  // affordance inside the opened card preserves the old navigation path.
  if (compact) {
    return (
      <div onClick={() => setOpen(!open)} className={rootClass}>
        <PassRowCompact
          pass={p}
          open={open}
          badge={badge}
          statusBadge={<span className={`status-badge ${badgeStyle.bg} ${badgeStyle.text}`}>{badgeStyle.label}</span>}
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

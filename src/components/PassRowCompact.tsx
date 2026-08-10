// The COMPACT pass card for stack views (My Passes, the HOD's flagged review):
// the HOD asked for three facts on the collapsed card — ITEM, VALUE, REASON —
// with everything else revealed on click. This component renders JUST those
// (plus identity + status), and, when `open`, the remaining facts on a second
// line: vendor/visitor, vehicle, department, who raised it, the expected return
// date and the Raised → Mismatch → Override timeline.
//
// Deliberately a sibling of PassRowBody (the drill card's full body): the two
// expanded presentations serve different row shapes (single-line row vs
// shadcn Card), and sharing one would force one of them to render facts it was
// asked not to. Duplication here is a few small labelled spans — the cost of
// keeping each card precisely what its consumer asked for.
import React from 'react';
import { Link } from 'react-router-dom';
import { isToday } from 'date-fns';
import type { GatePassView } from '../types';
import { TypeChip } from './Badge';
import { formatCurrency } from '../lib/formatCurrency';
import { formatDateOnly, formatTime } from '../lib/formatDate';
import { parseCompanyInfo } from '../lib/companyInfo';

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

/** One tiny fact: "Item Drill Machine". `emphasize` bumps the value's weight
 *  only (never colour) for the two facts the HOD asked to read as primary. */
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
  /** The collapsed card is open, so the second line of facts is visible. */
  open: boolean;
  /** Extra chips at the right edge (e.g. the item count / return badge). */
  badge?: React.ReactNode;
  /** Pre-rendered status pill — PassRow owns the EXPIRED-vs-status decision. */
  statusBadge: React.ReactNode;
  /** Detail destination, if the consumer navigates via Link (MyPassesTable). */
  detailUrl?: string;
  /** Detail opener, if the consumer navigates via callback (flagged review). */
  onViewDetail?: (id: string) => void;
};

export default function PassRowCompact({
  pass: p,
  open,
  badge,
  statusBadge,
  detailUrl,
  onViewDetail,
}: Props): React.ReactElement {
  const company = parseCompanyInfo(p.visitor_company);
  const isRgp = p.type === 'RGP';
  const reason = p.purpose && p.purpose.trim() ? p.purpose : '—';

  const detail = detailUrl ? (
    <Link to={detailUrl} className="text-xs font-semibold text-accent-600 hover:underline">
      View full pass →
    </Link>
  ) : onViewDetail ? (
    <button
      type="button"
      onClick={() => onViewDetail(p.id)}
      className="text-xs font-semibold text-accent-600 hover:underline"
    >
      View full pass →
    </button>
  ) : null;

  return (
    <>
      <span className="font-normal text-navy-950 text-base font-display tracking-tight truncate shrink-0">
        {p.pass_number}
      </span>
      <TypeChip type={p.type} />
      <Fact label="Item" value={p.material_summary ?? '—'} emphasize />
      <Fact label="Value" value={p.total_value > 0 ? formatCurrency(p.total_value) : '—'} emphasize />
      <Fact label="Reason" value={reason} />
      <span className="ms-auto flex items-center gap-3 shrink-0">
        {badge}
        {statusBadge}
      </span>

      {/* The accusation is never lost: the flag reason trails under every card,
          collapsed or not — it is the one fact a reviewer must see unopened. */}
      {p.flag_reason && (
        <span className="w-full flex items-center gap-2 text-xs text-flagged-600 font-medium truncate">
          <span className="w-1 h-1 rounded-full bg-flagged-500 shrink-0" />
          {p.flag_reason}
        </span>
      )}

      {open && (
        // stopPropagation so the "View full pass" link/button never also
        // collapses the card it sits on.
        <span
          className="w-full mt-3 pt-3 border-t border-surface-200/60 flex flex-wrap items-center gap-x-4 gap-y-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {company.name ? (
            <span className="text-sm font-semibold text-brand-700 truncate">{company.name}</span>
          ) : (
            <span className="text-sm text-navy-800 truncate">{p.visitor_name}</span>
          )}
          <Fact label="Vehicle" value={p.vehicle_number || '—'} />
          <Fact label="Dept" value={p.department_code || '—'} />
          <Fact label="Raised By" value={p.raised_by_name} emphasize />
          {isRgp && p.expected_return_date && (
            <Fact label="Return" value={formatDateOnly(p.expected_return_date)} emphasize />
          )}
          <span className="ms-auto flex items-center gap-3 shrink-0">
            <TimelineItem label="Raised" at={p.created_at} />
            <TimelineItem label="Mismatch" at={p.flag_reason ? (p.flagged_at ?? p.verified_at) : null} />
            <TimelineItem
              label="Override"
              at={p.status === 'hod_reviewed' ? (p.hod_reviewed_at ?? p.verified_at) : null}
            />
            {detail}
          </span>
        </span>
      )}
    </>
  );
}
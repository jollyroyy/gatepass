// The tinted glyph on each KPI tile.
//
// Icons live here rather than on `BOARD_KPIS` so `src/lib/boardKpis.ts` stays a
// plain `.ts` module of predicates and labels — importable by a test that has no
// DOM, and by anything that wants the numbers without dragging React in.
//
// TWO LOOKUPS, BOTH `Record`s, NEVER STRING CHAINS. `GLYPH_OF` maps every KPI to
// one of a small set of drawings, so a fourteenth card without an icon is a TYPE
// ERROR rather than a blank square nobody notices until it is on the client's
// screen. Several cards share a glyph on purpose: "Pending Approvals" and "NRGP
// Awaiting Clearance" are the same clock because they are the same kind of fact,
// and inventing a distinct drawing for each would make the row harder to scan,
// not easier.
import React from 'react';
import type { BoardKpiKey } from '../../lib/boardKpis';
import type { Tone } from '../KpiCard';

const SVG = {
  className: 'w-[18px] h-[18px]',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
} as const;

const GLYPHS = {
  // Document with a tick — paperwork awaiting a decision.
  doc: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75h9L19.5 7.5v12a.75.75 0 01-.75.75H5.25a.75.75 0 01-.75-.75V4.5a.75.75 0 01.75-.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 13.5l2 2 4-4.5" />
    </svg>
  ),
  // Van — material on the move through the gate.
  truck: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.75 6.75h10.5v8.5H2.75zM13.25 9.75h3.5l2.5 3v2.5h-6z" />
      <circle cx="6.5" cy="17.25" r="1.6" />
      <circle cx="15.75" cy="17.25" r="1.6" />
    </svg>
  ),
  // Arrow curving back into a box — the return leg.
  returned: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5v8.25a.75.75 0 00.75.75h13.5a.75.75 0 00.75-.75V10.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V6.75m0 0L8.75 10M12 6.75L15.25 10" />
    </svg>
  ),
  // Closed crate — material physically off site.
  box: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 8.25L12 4.5l8.25 3.75v7.5L12 19.5l-8.25-3.75v-7.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 8.25L12 12m0 0l8.25-3.75M12 12v7.5" />
    </svg>
  ),
  // Calendar — a date the reader is being held to.
  calendar: (
    <svg {...SVG}>
      <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
      <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
    </svg>
  ),
  // Warning triangle — the only tone that is an accusation.
  alert: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5l8.25 14.25H3.75L12 4.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v3.5M12 16.25h.01" />
    </svg>
  ),
  // Tick in a circle — verified at the barrier.
  check: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.75 12.25l2.25 2.25 4.25-4.5" />
    </svg>
  ),
  // Flag on a pole — the guard stopped this one. Deliberately NOT the `alert`
  // triangle: overdue and mismatched are both red-toned and sit two tiles apart
  // in the same row, and one drawing for both would make the row unreadable at
  // a glance, which is the only way anyone reads a KPI row.
  flag: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 20.25V3.75" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 4.5h10.5l-2.25 3.75 2.25 3.75H5.25z" />
    </svg>
  ),
  // Clock — something is waiting on a person.
  clock: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 1.75" />
    </svg>
  ),
} as const;

type GlyphName = keyof typeof GLYPHS;

const GLYPH_OF: Record<BoardKpiKey, GlyphName> = {
  rgpRequests: 'doc',
  rgpOut: 'truck',
  rgpReturned: 'returned',
  rgpMismatch: 'flag',
  rgpOutside: 'box',
  rgpDueToday: 'calendar',
  rgpOverdue: 'alert',
  nrgpOut: 'truck',
  nrgpCleared: 'check',
  nrgpMismatch: 'flag',
  nrgpPending: 'clock',
  totalRaised: 'doc',
  totalCleared: 'check',
  pendingApprovals: 'clock',
  overdueReturns: 'alert',
  materialOutside: 'box',
};

/** Tinted plate behind the glyph. Tint + dark ink, never a solid saturated fill:
 *  a solid status fill is reserved for the gate's own decision buttons, and
 *  fourteen of them across a board would drown the one card that needs to
 *  shout. */
const PLATE: Record<Tone, string> = {
  neutral: 'bg-surface-100 text-navy-600',
  accent: 'bg-accent-50 text-accent-600',
  brand: 'bg-brand-50 text-brand-700',
  pending: 'bg-pending-50 text-pending-700',
  matched: 'bg-matched-50 text-matched-700',
  flagged: 'bg-flagged-50 text-flagged-700',
  overdue: 'bg-overdue-50 text-overdue-700',
};

export default function BoardKpiIcon({ kpi, tone }: { kpi: BoardKpiKey; tone: Tone }): React.ReactElement {
  return (
    <span
      className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${PLATE[tone]}`}
      aria-hidden="true"
    >
      {GLYPHS[GLYPH_OF[kpi]]}
    </span>
  );
}

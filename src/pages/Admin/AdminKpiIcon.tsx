// The tinted glyph on each admin KPI card.
//
// Icons live here rather than on `ADMIN_KPIS` so `src/lib/adminDrills.ts` stays
// a plain `.ts` module of predicates and labels — importable by a test that has
// no DOM, and by anything that wants the numbers without dragging React in.
//
// A `Record<AdminKpiKey, …>` lookup, never a string-matching chain: adding a
// sixth KPI without an icon is then a TYPE ERROR rather than a blank square
// nobody notices until it is on the client's screen.
import React from 'react';
import type { AdminKpiKey } from '../../lib/adminDrills';
import type { Tone } from '../../components/KpiCard';

const SVG = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.8 } as const;

const GLYPHS: Record<AdminKpiKey, React.ReactElement> = {
  // Outbound tray — material leaving on paperwork.
  raised: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75h9L19.5 7.5v12a.75.75 0 01-.75.75H5.25a.75.75 0 01-.75-.75v-12L7.5 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 13.5h4l1.5 2h4l1.5-2h4" />
    </svg>
  ),
  // Tick in a circle — verified at the barrier.
  cleared: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.75 12.25l2.25 2.25 4.25-4.5" />
    </svg>
  ),
  // Clock — something is waiting on a person.
  pending: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 1.75" />
    </svg>
  ),
  // Box with an outbound arrow — material physically off site.
  outside: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 8.25L12 4.5l8.25 3.75v7.5L12 19.5l-8.25-3.75v-7.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 8.25L12 12m0 0l8.25-3.75M12 12v7.5" />
    </svg>
  ),
  // Warning triangle — the only KPI that is an accusation.
  overdue: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5l8.25 14.25H3.75L12 4.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v3.5M12 16.25h.01" />
    </svg>
  ),
};

/** Tinted plate behind the glyph. Tint + dark ink, never a solid saturated
 *  fill: a solid status fill is reserved for the gate's own decision buttons,
 *  and five of them across the top of a board would drown the one card that
 *  actually needs to shout. */
const PLATE: Record<Tone, string> = {
  neutral: 'bg-surface-100 text-navy-600',
  accent: 'bg-accent-50 text-accent-600',
  brand: 'bg-brand-50 text-brand-700',
  pending: 'bg-pending-50 text-pending-700',
  matched: 'bg-matched-50 text-matched-700',
  flagged: 'bg-flagged-50 text-flagged-700',
  overdue: 'bg-overdue-50 text-overdue-700',
};

export default function AdminKpiIcon({ kpi, tone }: { kpi: AdminKpiKey; tone: Tone }): React.ReactElement {
  return (
    <span className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${PLATE[tone]}`} aria-hidden="true">
      {GLYPHS[kpi]}
    </span>
  );
}

// The tinted glyph on the guard board's cards and panels.
//
// Same device as `BoardKpiIcon` on the admin board — a tint plate with dark ink,
// never a solid saturated fill: a solid status fill is reserved for the gate's
// own decision buttons, and a page of them drowns the one card that needs to
// shout. The glyph set is its own because this board has its own vocabulary
// (out, back, scan) and a `Record<GuardGlyph, …>` here is what makes an icon
// nobody drew a type error rather than a blank square.
import React from 'react';
import type { Tone } from '../KpiCard';

const SVG = {
  className: 'w-[18px] h-[18px]',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
} as const;

export type GuardGlyph = 'truck' | 'returned' | 'scan' | 'calendar' | 'alert';

const GLYPHS: Record<GuardGlyph, React.ReactElement> = {
  // Van — material on the move through the gate.
  truck: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.75 6.75h10.5v8.5H2.75zM13.25 9.75h3.5l2.5 3v2.5h-6z" />
      <circle cx="6.5" cy="17.25" r="1.6" />
      <circle cx="15.75" cy="17.25" r="1.6" />
    </svg>
  ),
  // Arrow curving back — the return leg.
  returned: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5v8.25a.75.75 0 00.75.75h13.5a.75.75 0 00.75-.75V10.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V6.75m0 0L8.75 10M12 6.75L15.25 10" />
    </svg>
  ),
  // Viewfinder — the camera and the search box.
  scan: (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5V5.5a1.5 1.5 0 011.5-1.5h3M20 8.5V5.5A1.5 1.5 0 0018.5 4h-3M4 15.5v3A1.5 1.5 0 005.5 20h3M20 15.5v3a1.5 1.5 0 01-1.5 1.5h-3" />
      <path strokeLinecap="round" d="M7.5 12h9" />
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
};

const PLATE: Record<Tone, string> = {
  neutral: 'bg-surface-100 text-navy-600',
  accent: 'bg-accent-50 text-accent-600',
  brand: 'bg-brand-50 text-brand-700',
  pending: 'bg-pending-50 text-pending-700',
  matched: 'bg-matched-50 text-matched-700',
  flagged: 'bg-flagged-50 text-flagged-700',
  overdue: 'bg-overdue-50 text-overdue-700',
};

type Props = {
  glyph: GuardGlyph;
  tone: Tone;
  /** The bigger plate the two summary cards use. */
  large?: boolean;
};

export default function GuardIcon({ glyph, tone, large }: Props): React.ReactElement {
  const size = large ? 'h-12 w-12' : 'h-9 w-9';
  return (
    <span
      className={`${size} rounded-2xl flex items-center justify-center shrink-0 ${PLATE[tone]}`}
      aria-hidden="true"
    >
      {GLYPHS[glyph]}
    </span>
  );
}

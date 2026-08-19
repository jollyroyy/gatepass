// The HOD dashboard's glyphs, drawn to the client's mock-up (2026-08-19).
//
// This board is painted in the mock-up's own palette, not the house theme — see
// the `.gb-*` block in src/index.css for why — so the tint plates and inks here
// are `.gb-tint-*` / `.gb-ink-*` class names and NOT literal hex. Same
// containment rule `chartPalette.ts` follows: no `.tsx` in this repo carries a
// colour literal, which is what keeps `tests/unit/themeAudit.test.ts` absolute.
//
// A `Record<HodGlyph, …>` is what makes an icon nobody drew a type error rather
// than a blank square.
import React from 'react';
import type { HodGlyph, HodTone } from './hodIconTypes';

const SVG = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GLYPHS: Record<HodGlyph, React.ReactElement> = {
  document: (
    <svg {...SVG}>
      <path d="M13.5 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M8.75 12.5h6.5M8.75 16h4.5" />
    </svg>
  ),
  send: (
    <svg {...SVG}>
      <path d="M20.5 3.5L3.5 10.25l6.75 2.75 2.75 6.75z" />
      <path d="M20.5 3.5l-10.25 9.5" />
    </svg>
  ),
  exchange: (
    <svg {...SVG}>
      <path d="M4.5 9.5a7.5 7.5 0 0112.6-3.3l2.4 2.3" />
      <path d="M19.5 4.5v4h-4" />
      <path d="M19.5 14.5a7.5 7.5 0 01-12.6 3.3l-2.4-2.3" />
      <path d="M4.5 19.5v-4h4" />
    </svg>
  ),
  clock: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.75V12l2.75 1.75" />
    </svg>
  ),
  documentAdd: (
    <svg {...SVG}>
      <path d="M13.5 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M12 12v5M9.5 14.5h5" />
    </svg>
  ),
  exchangeAdd: (
    <svg {...SVG}>
      <path d="M4.5 9.5a7.5 7.5 0 0112.6-3.3l2.4 2.3" />
      <path d="M19.5 4.5v4h-4" />
      <path d="M12 13v5M9.5 15.5h5" />
    </svg>
  ),
  hourglass: (
    <svg {...SVG}>
      <path d="M7 3.75h10M7 20.25h10" />
      <path d="M8 3.75v3.1c0 1.4 1.2 2.6 2.6 3.4L12 11l1.4-.75c1.4-.8 2.6-2 2.6-3.4V3.75" />
      <path d="M8 20.25v-3.1c0-1.4 1.2-2.6 2.6-3.4L12 13l1.4.75c1.4.8 2.6 2 2.6 3.4v3.1" />
    </svg>
  ),
  people: (
    <svg {...SVG}>
      <circle cx="9.25" cy="8.5" r="3" />
      <path d="M3.75 19.25a5.5 5.5 0 0111 0" />
      <path d="M16 6a3 3 0 010 5.5M16.75 19.25a5.5 5.5 0 00-2.1-4.3" />
    </svg>
  ),
  shield: (
    <svg {...SVG}>
      <path d="M12 3.25l6.75 2.4v5.1c0 4-2.75 7.6-6.75 8.9-4-1.3-6.75-4.9-6.75-8.9v-5.1z" />
      <path d="M9.5 11.75l1.75 1.75 3.25-3.5" />
    </svg>
  ),
  wallet: (
    <svg {...SVG}>
      <path d="M4 7.5A1.5 1.5 0 015.5 6h11A1.5 1.5 0 0118 7.5v1.25" />
      <path d="M4 7.5v9A1.5 1.5 0 005.5 18h13a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5h-13" />
      <circle cx="16.25" cy="13.5" r="1" />
    </svg>
  ),
};

const TINT: Record<HodTone, string> = {
  blue: 'gb-tint-blue',
  green: 'gb-tint-green',
  purple: 'gb-tint-purple',
  orange: 'gb-tint-orange',
  red: 'gb-tint-red',
};

/** Tone as INK — the small coloured dot beside a KPI note. */
export const DOT: Record<HodTone, string> = {
  blue: 'gb-dot-blue',
  green: 'gb-dot-green',
  purple: 'gb-dot-purple',
  orange: 'gb-dot-orange',
  red: 'gb-dot-red',
};

type Props = {
  glyph: HodGlyph;
  tone: HodTone;
  /** `card` is the KPI card's tinted square; `tile` the bigger, saturated
   *  quick-action plate; `chip` the small round plate on an approval slot. */
  shape?: 'card' | 'tile' | 'chip';
};

/** The quick-action plates are the one place on this board the mock-up fills a
 *  colour SOLID and puts the glyph in white. Everything else is a pale tint with
 *  the glyph inked in the same hue. */
const SOLID: Record<HodTone, string> = {
  blue: 'gb-solid-blue',
  green: 'gb-solid-green',
  purple: 'gb-solid-purple',
  orange: 'gb-solid-orange',
  red: 'gb-solid-red',
};

const SHAPE: Record<NonNullable<Props['shape']>, string> = {
  card: 'gb-kpi-plate',
  tile: 'gb-raise-plate',
  chip: 'gb-approval-plate',
};

export default function HodIcon({ glyph, tone, shape = 'card' }: Props): React.ReactElement {
  const paint = shape === 'tile' ? SOLID[tone] : TINT[tone];
  return (
    <span className={`${SHAPE[shape]} ${paint}`} aria-hidden="true">
      {GLYPHS[glyph]}
    </span>
  );
}

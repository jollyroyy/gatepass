// The guard board's glyphs, redrawn to the client's mock-up (2026-08-19).
//
// This board is the one screen in the app that is NOT painted in the house
// theme — see the `.gb-*` block in src/index.css for why — so its icons take
// the mock-up's tones (orange for the OUT queue, blue for the return queue,
// green and purple on the quick actions) rather than the `Tone` ramp every
// other board uses. `GuardTone` is its own union for exactly that reason: the
// two vocabularies must not be able to leak into each other by accident.
//
// A `Record<GuardGlyph, …>` is what makes an icon nobody drew a type error
// rather than a blank square.
import React from 'react';

const SVG = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export type GuardGlyph = 'truck' | 'returned' | 'exchange' | 'scan' | 'clock' | 'alert' | 'check' | 'cross';
export type GuardTone = 'orange' | 'blue' | 'green' | 'purple' | 'red';

const GLYPHS: Record<GuardGlyph, React.ReactElement> = {
  // Delivery truck — material leaving through the gate. The mock-up's lead
  // icon, and the biggest thing on the board after the numbers themselves.
  truck: (
    <svg {...SVG}>
      <path d="M2.5 6.75A1.25 1.25 0 013.75 5.5h8.5a1.25 1.25 0 011.25 1.25v9.25H2.5z" />
      <path d="M13.5 9.5h3.19a1.5 1.5 0 011.2.6l2.16 2.88a1.5 1.5 0 01.3.9V16h-6.85z" />
      <circle cx="6.75" cy="18" r="1.85" />
      <circle cx="16.5" cy="18" r="1.85" />
      <path d="M8.6 18h5.75" />
    </svg>
  ),
  // The return leg: an arrow that curves back on itself, pointing home.
  returned: (
    <svg {...SVG}>
      <path d="M9 7.25H15.5a4.25 4.25 0 010 8.5H7.5" />
      <path d="M11.75 4.5L9 7.25l2.75 2.75" />
    </svg>
  ),
  // Two arrows passing — material out, material back. The return panel's head.
  exchange: (
    <svg {...SVG}>
      <path d="M4 8.5h13l-2.75-2.75" />
      <path d="M20 15.5H7l2.75 2.75" />
    </svg>
  ),
  // Viewfinder — the camera and the search box.
  scan: (
    <svg {...SVG}>
      <path d="M4 8.75V5.75A1.75 1.75 0 015.75 4h3M20 8.75V5.75A1.75 1.75 0 0018.25 4h-3M4 15.25v3A1.75 1.75 0 005.75 20h3M20 15.25v3A1.75 1.75 0 0118.25 20h-3" />
      <path d="M7.5 12h9" />
    </svg>
  ),
  // A clock face — a date the reader is being held to today.
  clock: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.75V12l2.75 1.75" />
    </svg>
  ),
  // A tick — a decision this reader already gave. The approver's board.
  check: (
    <svg {...SVG}>
      <path d="M4.75 12.5l4.5 4.5 10-10" />
    </svg>
  ),
  // A cross, drawn to the same weight as the tick beside it: the two figures
  // sit on one row and must read as a pair.
  cross: (
    <svg {...SVG}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  ),
  // The one glyph drawn as a solid disc, exactly as the mock-up draws it:
  // overdue is the only tile on this board that is an accusation.
  alert: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.75a9.25 9.25 0 100 18.5 9.25 9.25 0 000-18.5zM12 6.9a1 1 0 011 1v4.6a1 1 0 11-2 0V7.9a1 1 0 011-1zm0 8.35a1.15 1.15 0 100 2.3 1.15 1.15 0 000-2.3z"
      />
    </svg>
  ),
};

const INK: Record<GuardTone, string> = {
  orange: 'gb-ink-orange',
  blue: 'gb-ink-blue',
  green: 'gb-ink-green',
  purple: 'gb-ink-purple',
  red: 'gb-ink-red',
};

const TINT: Record<GuardTone, string> = {
  orange: 'gb-tint-orange',
  blue: 'gb-tint-blue',
  green: 'gb-tint-green',
  purple: 'gb-tint-purple',
  red: 'gb-tint-red',
};

/** The bare glyph, inked in a tone — a panel heading's icon. */
export function GuardGlyphIcon({ glyph, tone }: { glyph: GuardGlyph; tone: GuardTone }): React.ReactElement {
  return <span className={INK[tone]} aria-hidden="true">{GLYPHS[glyph]}</span>;
}

type Props = {
  glyph: GuardGlyph;
  tone: GuardTone;
  /** `round` is the summary cards' big disc; `square` the quick-action tiles. */
  shape?: 'round' | 'square';
};

export default function GuardIcon({ glyph, tone, shape = 'round' }: Props): React.ReactElement {
  const plate = shape === 'round' ? 'gb-plate' : 'gb-tile-plate';
  return (
    <span className={`${plate} ${TINT[tone]}`} aria-hidden="true">
      {GLYPHS[glyph]}
    </span>
  );
}

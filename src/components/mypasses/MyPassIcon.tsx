// The My Passes list's glyphs, drawn to the client's mock-up (2026-08-20).
//
// Same containment rule as `HodIcon`: this file carries no colour at all — the
// stroke is `currentColor` and the tint plate is a `.gb-tint-*` class chosen by
// the caller — which is what keeps `themeAudit.test.ts` absolute over every
// `.tsx` in the repo.
//
// A `Record<MyPassGlyph, …>` makes an icon nobody drew a type error rather than
// a blank square.
import React from 'react';

export type MyPassGlyph =
  | 'arrow'
  | 'exit'
  | 'calendar'
  | 'building'
  | 'box'
  | 'rupee'
  | 'chevron';

const SVG = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GLYPHS: Record<MyPassGlyph, React.ReactElement> = {
  // RGP — it goes out and it comes back, so a plain movement arrow.
  arrow: (
    <svg {...SVG}>
      <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
    </svg>
  ),
  // NRGP — an arrow leaving a box; material that is not coming back.
  exit: (
    <svg {...SVG}>
      <path d="M13.5 4.5H6A1.5 1.5 0 004.5 6v12A1.5 1.5 0 006 19.5h7.5" />
      <path d="M10.5 12h9M15.5 8.25L19.5 12l-4 3.75" />
    </svg>
  ),
  calendar: (
    <svg {...SVG}>
      <rect x="3.75" y="5.25" width="16.5" height="15" rx="2" />
      <path d="M3.75 9.75h16.5M8.25 3.5v3.5M15.75 3.5v3.5" />
    </svg>
  ),
  building: (
    <svg {...SVG}>
      <path d="M4.5 20.25V5.5A1.5 1.5 0 016 4h6a1.5 1.5 0 011.5 1.5v14.75" />
      <path d="M13.5 9.5h4A1.5 1.5 0 0119 11v9.25M3 20.25h18" />
      <path d="M7.25 7.75h3M7.25 11h3M7.25 14.25h3M16 13h.01M16 16.25h.01" />
    </svg>
  ),
  box: (
    <svg {...SVG}>
      <path d="M20.25 8.25L12 4.25 3.75 8.25v7.5L12 19.75l8.25-4V8.25z" />
      <path d="M3.75 8.25L12 12.25l8.25-4M12 12.25v7.5" />
    </svg>
  ),
  // The declared value of the material. A rupee sign in a circle, not the
  // glyph from a font — this app prints ₹ exactly, and the icon must not be
  // the only place a currency is implied by something that could fail to load.
  rupee: (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M9.5 8.25h5M9.5 11h5M13.25 8.25c1.4 0 2 .9 2 1.9s-.6 1.9-2 1.9H9.5l4 4" />
    </svg>
  ),
  chevron: (
    <svg {...SVG}>
      <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  ),
};

export default function MyPassIcon({ glyph }: { glyph: MyPassGlyph }): React.ReactElement {
  return <>{GLYPHS[glyph]}</>;
}

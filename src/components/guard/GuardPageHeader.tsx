// The head of both guard list pages: the coloured glyph and title, a line
// saying what the page is for, and the date stamp top right (client mock-up,
// 2026-08-19).
//
// The stamp is taken ONCE, by the page, at mount. A ticking clock would
// re-render a hundred-row table every second for a fact that changes by the
// minute. The 60px right pad on `.gb-page-head` is not decoration either: the
// notification bell is `fixed top-4 right-4`, and a stamp flush to the content
// edge sits underneath it.
import React from 'react';
import { formatDateTime } from '../../lib/formatDate';
import { GuardGlyphIcon, type GuardGlyph, type GuardTone } from './GuardIcon';

type Props = {
  title: string;
  subtitle: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  /** ISO stamp, taken once at mount by the page. */
  stamp: string;
};

export default function GuardPageHeader({
  title,
  subtitle,
  glyph,
  tone,
  stamp,
}: Props): React.ReactElement {
  return (
    <div className="gb-page-head">
      <div className="min-w-0">
        <h1 className="gb-page-title">
          <GuardGlyphIcon glyph={glyph} tone={tone} />
          {title}
        </h1>
        <p className="gb-sub">{subtitle}</p>
      </div>
      <span className="gb-stamp">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
          <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
        </svg>
        {formatDateTime(stamp)}
      </span>
    </div>
  );
}

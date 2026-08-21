// "Passes by Status" — the ring, its legend, and the Total row under it.
//
// THE CENTRE TOTAL IS THE "TOTAL GATE PASSES" CARD, by construction: both are
// the same windowed array, so the ring can never say 1,240 while the card above
// it says 1,248. The legend's Total row restates it because the mock draws it,
// and because a five-line legend of counts invites the reader to add them up.
//
// EVERY NON-EMPTY ARC IS DRILLABLE, from the rows the slice carries. A zero
// slice is listed but not clickable — there is no list behind it, and a button
// that opens an empty panel is a dead end the reader has to back out of.
//
// THE COLOURS ARE THE MOCK'S, NOT THE HOUSE STATUS HUES, and that is a
// deliberate departure from "a chart bucket must be the same colour as the badge
// beside it". This board is the `.gb-*` island — it has its own palette, drawn
// from the client's own mock-ups, and it renders no status badges of its own for
// an arc to disagree with. The stacked list a click opens is house-themed and
// badges each pass properly. No literal hex: every value is a `--gb-*` var.
import React from 'react';
import type { Slice } from '../../lib/adminOverview';
import type { OverviewStatus } from '../../lib/adminOverview';
import { percentOf, ringSegments } from '../../lib/chartGeometry';

const SIZE = 190;
const RADIUS = 72;
const STROKE = 30;

/** A `Record<OverviewStatus, …>` on purpose: a sixth bucket is a type error
 *  here rather than an arc drawn in the fallback grey nobody notices. */
const COLOR: Record<OverviewStatus, string> = {
  approved: 'var(--gb-blue)',
  pending: 'var(--gb-orange)',
  rejected: 'var(--gb-purple)',
  returned: 'var(--gb-green)',
  overdue: 'var(--gb-red)',
};

const paint = (key: string): string => COLOR[key as OverviewStatus] ?? 'var(--gb-muted)';

type Props = {
  slices: Slice[];
  activeKey: string | null;
  onSelect: (slice: Slice) => void;
};

export function sliceKey(slice: Slice): string {
  return `status-${slice.key}`;
}

export default function OverviewStatus({ slices, activeKey, onSelect }: Props): React.ReactElement {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const segments = ringSegments(slices, RADIUS);
  const circumference = 2 * Math.PI * RADIUS;

  return (
    <div className="gb-ov-status">
      <div className="gb-ov-ring" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Passes by status: ${total} in total`}
          // -90° so the ring starts at twelve o'clock. SVG dashes begin at three
          // o'clock, which reads as an arbitrary starting point.
          // `print-keep`: a chart is DATA, not an icon, so it opts back into the
          // printed sheet (see @media print in index.css).
          className="print-keep -rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="gb-ov-ring-track"
          />
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={paint(seg.key)}
              strokeWidth={activeKey === `status-${seg.key}` ? STROKE + 6 : STROKE}
              strokeDasharray={`${seg.length} ${circumference - seg.length}`}
              strokeDashoffset={-seg.offset}
              className="transition-all duration-200"
            />
          ))}
        </svg>
        <div className="gb-ov-ring-centre">
          <span className="gb-ov-ring-value">{total.toLocaleString('en-IN')}</span>
          <span className="gb-ov-ring-label">Total</span>
        </div>
      </div>

      <ul className="gb-ov-legend">
        {slices.map((slice) => {
          const share = percentOf(slice.value, total);
          const row = (
            <>
              <span className="gb-ov-swatch" style={{ background: paint(slice.key) }} aria-hidden="true" />
              <span className="gb-ov-legend-name">{slice.label}</span>
              <span className="gb-ov-legend-value">{slice.value.toLocaleString('en-IN')}</span>
              <span className="gb-ov-legend-share">({share}%)</span>
            </>
          );
          if (slice.value === 0) {
            return <li key={slice.key} className="gb-ov-legend-static">{row}</li>;
          }
          return (
            <li key={slice.key}>
              <button
                type="button"
                onClick={() => onSelect(slice)}
                aria-pressed={activeKey === sliceKey(slice)}
                // Spelled out, because the visible text concatenates to
                // "Returned230(18.4%)" — three facts with no gaps, which a screen
                // reader runs together into one meaningless token.
                aria-label={`${slice.label}: ${slice.value} ${slice.value === 1 ? 'pass' : 'passes'}, ${share}%`}
                className={`gb-ov-legend-btn${activeKey === sliceKey(slice) ? ' is-open' : ''}`}
              >
                {row}
              </button>
            </li>
          );
        })}
        <li className="gb-ov-legend-total">
          <span className="gb-ov-legend-name">Total</span>
          <span className="gb-ov-legend-value">{total.toLocaleString('en-IN')}</span>
          <span className="gb-ov-legend-share">(100%)</span>
        </li>
      </ul>
    </div>
  );
}

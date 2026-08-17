// A donut plus its legend — the "Gate Pass Overview" and "Returnable Status"
// cards. Pure presentation: it is handed slices that already carry their rows
// (see adminAnalytics.ts) and hands a whole slice back on click, so the number
// in the legend and the list the click opens are the same array.
//
// Drawn as dashed <circle>s rather than <path> arcs — see chartGeometry.ts for
// why (the 100%-single-slice case, which is the normal state of a quiet day).
import React from 'react';
import type { Slice } from '../../lib/adminAnalytics';
import { ringSegments, percentOf } from '../../lib/chartGeometry';
import { NEUTRAL_SERIES } from './chartPalette';

// Sized for a one-third-width card on a laptop, which is the narrowest place
// this donut has to sit beside its own legend. 176px looked better in isolation
// and left the legend ~200px, which is not enough for "Awaiting Return  2
// (33.33%)" without truncating the label.
const SIZE = 150;
const RADIUS = 58;
const STROKE = 22;

type Props = {
  slices: Slice[];
  colors: Record<string, string>;
  /** Word under the number in the middle — "Total Passes", "Total". */
  centerLabel: string;
  /** Which slice is currently driving the drill list, if any. */
  activeKey?: string | null;
  onSelect?: (slice: Slice) => void;
  /** Drop empty buckets from the legend. Off by default: for a fixed taxonomy
   *  like the pass categories, "RGP In: 0" is a fact worth stating. On for the
   *  status ring, where rare terminal states would otherwise sit at zero
   *  forever and bury the lines that actually move. */
  hideEmpty?: boolean;
};

export default function DonutChart({
  slices,
  colors,
  centerLabel,
  activeKey,
  onSelect,
  hideEmpty,
}: Props): React.ReactElement {
  // The centre total is over EVERY slice, including any the legend hides — the
  // ring is a whole, and a hidden zero contributes nothing to it anyway.
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const segments = ringSegments(slices, RADIUS);
  const legend = hideEmpty ? slices.filter((s) => s.value > 0) : slices;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${centerLabel}: ${total}`}
          // -90° so the ring starts at twelve o'clock. SVG dashes begin at
          // three o'clock, which reads as an arbitrary starting point.
          className="-rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-surface-200"
          />
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={colors[seg.key] ?? NEUTRAL_SERIES}
              strokeWidth={activeKey === seg.key ? STROKE + 6 : STROKE}
              strokeDasharray={`${seg.length} ${ringCircumference() - seg.length}`}
              strokeDashoffset={-seg.offset}
              className="transition-all duration-200"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-h2 font-extrabold tabular text-navy-900 leading-none">{total}</span>
          <span className="text-micro text-navy-500 uppercase mt-1.5 text-center px-4">{centerLabel}</span>
        </div>
      </div>

      <ul className="flex-1 w-full min-w-0 flex flex-col gap-1">
        {legend.map((slice) => {
          const share = percentOf(slice.value, total);
          const row = (
            <>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: colors[slice.key] ?? NEUTRAL_SERIES }}
                aria-hidden="true"
              />
              <span className="text-body text-navy-700 truncate flex-1 min-w-0">{slice.label}</span>
              <span className="text-body font-bold tabular text-navy-900 shrink-0">{slice.value}</span>
              <span className="text-caption tabular text-navy-500 shrink-0 w-[4rem] text-right">({share}%)</span>
            </>
          );

          // A zero slice is listed but not clickable: there is no list behind
          // it, and a button that opens an empty panel is a dead end the reader
          // has to back out of.
          if (!onSelect || slice.value === 0) {
            return (
              <li key={slice.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
                {row}
              </li>
            );
          }
          return (
            <li key={slice.key}>
              <button
                type="button"
                onClick={() => onSelect(slice)}
                aria-pressed={activeKey === slice.key}
                // Spelled out, because the visible text concatenates to
                // "Returned1(33.33%)" — three facts with no gaps, which a
                // screen reader runs together into one meaningless token.
                aria-label={`${slice.label}: ${slice.value} ${slice.value === 1 ? 'pass' : 'passes'}, ${share}%`}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors duration-150 hover:bg-surface-100${
                  activeKey === slice.key ? ' bg-surface-100 ring-1 ring-brand-500/40' : ''
                }`}
              >
                {row}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ringCircumference(): number {
  return 2 * Math.PI * RADIUS;
}

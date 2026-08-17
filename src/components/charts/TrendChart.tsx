// "Daily Movement Trend" — RGP Out, RGP Return and NRGP Out per day.
//
// Three things here are load-bearing rather than decorative:
//
//   * EVERY DAY IS DRILLABLE. A trend line a reader cannot interrogate would be
//     the one chart on this board that is pure decoration; clicking a day opens
//     the passes that moved that day, from the very array the points were plotted
//     from.
//   * THE FIGURES ARE PRINTED, NOT ONLY HOVERED. A tooltip is a promise that the
//     reader has a mouse, and this board is also read on a tablet at a gate
//     office. Each series prints its latest value at the right-hand end (as the
//     client's reference does) and the y-axis is labelled, so the chart is
//     readable without touching it.
//   * THE PLOT AREA HAS ROOM RESERVED FOR THOSE LABELS. `viewBox` is wider than
//     the plot by `LABEL_GUTTER`, so a two-digit figure at the right edge is
//     inside the box rather than clipped by it.
import React from 'react';
import type { MovementBucket, MovementKey } from '../../lib/boardAnalytics';
import { linePoints, pathFrom, areaFrom, niceMax, axisTicks } from '../../lib/chartGeometry';

const W = 620;
const H = 180;
const TICKS = 4;
/** Room at the right for each series' end-of-line value. */
const LABEL_GUTTER = 34;
/** Room at the top for nothing to be clipped when a series peaks at the axis. */
const HEAD_ROOM = 14;

export interface TrendSeries {
  key: MovementKey;
  label: string;
  color: string;
  /** Dashed, so two series that cross are still tellable apart in a print-out or
   *  by a reader who cannot separate the two hues. */
  dashed?: boolean;
}

type Props = {
  buckets: MovementBucket[];
  series: readonly TrendSeries[];
  activeKey?: string | null;
  onSelect?: (bucket: MovementBucket) => void;
};

export default function TrendChart({ buckets, series, activeKey, onSelect }: Props): React.ReactElement {
  const peak = Math.max(0, ...series.flatMap((s) => buckets.map((b) => b.counts[s.key])));
  const max = niceMax(peak, TICKS);
  const plotted = series.map((s) => ({
    ...s,
    points: linePoints(buckets.map((b) => b.counts[s.key]), max, W, H),
  }));

  // Fewer x labels than points once the window is long, so "1 Aug 2 Aug 3 Aug…"
  // does not collapse into an unreadable smear on a narrow card.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const lane = W / Math.max(buckets.length, 1);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-caption text-navy-600">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      {/* The chart scrolls inside its own card on a narrow screen. The page body
          must never scroll sideways because one panel is wide. */}
      <div className="overflow-x-auto">
        <div className="min-w-[520px] flex gap-2">
          <div className="flex flex-col justify-between text-micro text-navy-500 tabular py-[2px] shrink-0">
            {axisTicks(max, TICKS).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <svg
            viewBox={`0 ${-HEAD_ROOM} ${W + LABEL_GUTTER} ${H + HEAD_ROOM + 8}`}
            className="w-full h-[210px]"
            role="img"
            aria-label={`Movements per day: ${series.map((s) => s.label).join(', ')}`}
          >
            {axisTicks(max, TICKS).map((t) => {
              const y = H - (t / max) * H;
              return <line key={t} x1={0} x2={W} y1={y} y2={y} className="stroke-surface-200" strokeWidth={1} />;
            })}

            {/* The first series gets a soft wash so the chart has a baseline the
                eye can rest on; three filled areas would hide each other. */}
            {plotted[0] && <path d={areaFrom(plotted[0].points, H)} fill={plotted[0].color} opacity={0.1} />}

            {plotted.map((s) => (
              <path
                key={s.key}
                d={pathFrom(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
              />
            ))}

            {buckets.map((bucket, i) => {
              const selected = activeKey === bucketKey(bucket);
              return (
                <g key={bucket.start}>
                  {selected && (
                    <line
                      x1={i * (W / Math.max(buckets.length - 1, 1))}
                      x2={i * (W / Math.max(buckets.length - 1, 1))}
                      y1={-HEAD_ROOM}
                      y2={H}
                      className="stroke-brand-500"
                      strokeWidth={1.5}
                    />
                  )}
                  {plotted.map((s) => {
                    const p = s.points[i];
                    if (!p) return null;
                    return <circle key={s.key} cx={p.x} cy={p.y} r={selected ? 4.5 : 3} fill={s.color} />;
                  })}
                  {onSelect && (
                    // A full-height hit strip, not the 3px dot — nobody hits a
                    // 3px dot, least of all on a tablet at a gate office.
                    <rect
                      x={i * (W / Math.max(buckets.length - 1, 1)) - lane / 2}
                      y={-HEAD_ROOM}
                      width={lane}
                      height={H + HEAD_ROOM}
                      fill="transparent"
                      className="cursor-pointer"
                      role="button"
                      aria-label={`${bucket.label}: ${bucket.total} ${bucket.total === 1 ? 'movement' : 'movements'}`}
                      onClick={() => onSelect(bucket)}
                    />
                  )}
                </g>
              );
            })}

            {/* Latest value per series, at the right-hand end — the figures the
                client asked to be readable without hovering. */}
            {plotted.map((s) => {
              const last = s.points[s.points.length - 1];
              if (!last) return null;
              return (
                <text
                  key={`v-${s.key}`}
                  x={W + 6}
                  y={last.y + 4}
                  fill={s.color}
                  className="text-[11px] font-bold"
                >
                  {buckets[buckets.length - 1]?.counts[s.key] ?? 0}
                </text>
              );
            })}
          </svg>
        </div>

        <div className="min-w-[520px] flex justify-between text-micro text-navy-500 pl-8 pr-8 mt-1">
          {buckets.map((b, i) => (
            <span key={b.start} className={i % labelEvery === 0 ? '' : 'invisible'}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function bucketKey(bucket: MovementBucket): string {
  return `day-${bucket.start}`;
}

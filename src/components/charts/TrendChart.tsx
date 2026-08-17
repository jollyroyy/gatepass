// The "Passes Trend" line chart — RGP and NRGP raised per day.
//
// Two things here are load-bearing rather than decorative:
//
//   * EVERY BUCKET IS DRILLABLE. A trend line that a reader cannot interrogate
//     is the one chart on this board that would be pure decoration; clicking a
//     day opens the passes raised that day, from the very array the point was
//     plotted from.
//   * THE FIGURES ARE PRINTED, NOT ONLY HOVERED. The client asked for "all the
//     graphs properly showing the exact figures". A tooltip is a promise that
//     the reader has a mouse — this board is also read on a tablet — so each
//     day's total sits above its point and the y-axis is labelled.
import React from 'react';
import type { TrendBucket } from '../../lib/boardAnalytics';
import { linePoints, pathFrom, areaFrom, niceMax, axisTicks } from '../../lib/chartGeometry';
import { SERIES_COLORS } from './chartPalette';

const W = 640;
const H = 190;
const TICKS = 4;

type Props = {
  buckets: TrendBucket[];
  activeKey?: string | null;
  onSelect?: (bucket: TrendBucket) => void;
};

export default function TrendChart({ buckets, activeKey, onSelect }: Props): React.ReactElement {
  const peak = Math.max(...buckets.map((b) => Math.max(b.rgp, b.nrgp)), 0);
  const max = niceMax(peak, TICKS);
  const rgpPts = linePoints(buckets.map((b) => b.rgp), max, W, H);
  const nrgpPts = linePoints(buckets.map((b) => b.nrgp), max, W, H);

  // Fewer x labels than points once the window is long, so "1 Aug 2 Aug 3 Aug…"
  // does not collapse into an unreadable smear on a narrow card.
  const labelEvery = Math.ceil(buckets.length / 8);

  return (
    <div>
      <div className="flex items-center gap-5 mb-3">
        <Legend color={SERIES_COLORS.brand} label="RGP" />
        <Legend color={SERIES_COLORS.slate} label="NRGP" />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[520px] flex gap-2">
          <div className="flex flex-col justify-between text-micro text-navy-500 tabular py-[2px] shrink-0">
            {axisTicks(max, TICKS).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <svg
            viewBox={`0 -14 ${W} ${H + 34}`}
            className="w-full h-[220px]"
            role="img"
            aria-label="Passes raised per day, RGP and NRGP"
            preserveAspectRatio="none"
          >
            {axisTicks(max, TICKS).map((t) => {
              const y = H - (t / max) * H;
              return <line key={t} x1={0} x2={W} y1={y} y2={y} className="stroke-surface-200" strokeWidth={1} />;
            })}

            <path d={areaFrom(rgpPts, H)} fill={SERIES_COLORS.brand} opacity={0.12} />
            <path d={pathFrom(rgpPts)} fill="none" stroke={SERIES_COLORS.brand} strokeWidth={2.5} strokeLinejoin="round" />
            <path d={pathFrom(nrgpPts)} fill="none" stroke={SERIES_COLORS.slate} strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="5 4" />

            {buckets.map((bucket, i) => {
              const p = rgpPts[i];
              const q = nrgpPts[i];
              if (!p) return null;
              const selected = activeKey === bucketKey(bucket);
              return (
                <g key={bucket.start}>
                  {selected && <line x1={p.x} x2={p.x} y1={-14} y2={H} className="stroke-brand-500" strokeWidth={1.5} />}
                  {bucket.total > 0 && (
                    <text
                      x={p.x}
                      y={Math.min(p.y, q?.y ?? p.y) - 8}
                      textAnchor="middle"
                      className="fill-navy-600 text-[11px] font-semibold"
                    >
                      {bucket.total}
                    </text>
                  )}
                  <circle cx={q?.x ?? p.x} cy={q?.y ?? p.y} r={selected ? 5 : 3.5} fill={SERIES_COLORS.slate} />
                  <circle cx={p.x} cy={p.y} r={selected ? 5 : 3.5} fill={SERIES_COLORS.brand} />
                  {onSelect && (
                    // A full-height hit strip, not the 3.5px dot — nobody hits a
                    // 3.5px dot, least of all on a tablet at a gate office.
                    <rect
                      x={p.x - W / Math.max(buckets.length, 1) / 2}
                      y={-14}
                      width={W / Math.max(buckets.length, 1)}
                      height={H + 14}
                      fill="transparent"
                      className="cursor-pointer"
                      role="button"
                      aria-label={`${bucket.label}: ${bucket.total} passes`}
                      onClick={() => onSelect(bucket)}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="min-w-[520px] flex justify-between text-micro text-navy-500 pl-8 mt-1">
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

export function bucketKey(bucket: TrendBucket): string {
  return `day-${bucket.start}`;
}

function Legend({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-2 text-caption text-navy-600">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

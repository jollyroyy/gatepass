// "Gate Pass Trend" — RGP and NRGP raised per day, over the board's window.
//
// It plots PASSES RAISED, on `created_at`, which is what makes the two lines sum
// to the RGP and NRGP cards directly above them (see `trendDays`). The board
// this replaced plotted gate EVENTS instead; that was right for a card titled
// "Daily Movement Trend" and wrong for one sitting under a row of raise counts.
//
// THREE THINGS HERE ARE LOAD-BEARING RATHER THAN DECORATIVE:
//   * EVERY DAY IS DRILLABLE, from the very array the points were plotted from.
//     A hit strip spans the full plot height — nobody hits a 3px dot, least of
//     all on a tablet.
//   * THE AXIS IS LABELLED and the legend prints under the plot, so the chart is
//     readable without a mouse. A tooltip is a promise that the reader has one.
//   * NO LITERAL HEX. The two series take `var(--gb-blue)` / `var(--gb-green)`
//     off `.gb-board`, the same containment rule every `.gb-*` component follows,
//     which is what keeps `themeAudit.test.ts` absolute over every `.tsx`.
import React from 'react';
import type { TrendDay } from '../../lib/adminOverview';
import { axisTicks, linePoints, niceMax, pathFrom } from '../../lib/chartGeometry';

const W = 620;
const H = 190;
const TICKS = 5;
/** Room at the top so a series peaking at the axis is not clipped. */
const HEAD_ROOM = 10;

const SERIES = [
  { key: 'rgp' as const, label: 'RGP', color: 'var(--gb-blue)' },
  { key: 'nrgp' as const, label: 'NRGP', color: 'var(--gb-green)' },
];

type Props = {
  days: TrendDay[];
  activeKey: string | null;
  onSelect: (day: TrendDay) => void;
};

export function dayKey(day: TrendDay): string {
  return `day-${day.start}`;
}

export default function OverviewTrend({ days, activeKey, onSelect }: Props): React.ReactElement {
  const peak = Math.max(0, ...days.flatMap((d) => [d.rgp, d.nrgp]));
  const max = niceMax(peak, TICKS);
  const plotted = SERIES.map((s) => ({
    ...s,
    points: linePoints(days.map((d) => d[s.key]), max, W, H),
  }));

  // Fewer x labels than points once the window is long, so "1 Aug 2 Aug 3 Aug…"
  // does not collapse into an unreadable smear on a 90-day window.
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const lane = W / Math.max(days.length, 1);
  const step = W / Math.max(days.length - 1, 1);

  return (
    <div>
      <div className="gb-scroll">
        <div className="min-w-[520px] flex gap-2">
          <div className="gb-ov-axis">
            {axisTicks(max, TICKS).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <svg
            viewBox={`0 ${-HEAD_ROOM} ${W} ${H + HEAD_ROOM + 6}`}
            className="w-full h-[230px]"
            role="img"
            aria-label={`Gate passes raised per day: ${SERIES.map((s) => s.label).join(', ')}`}
          >
            {axisTicks(max, TICKS).map((t) => {
              const y = H - (t / max) * H;
              return <line key={t} x1={0} x2={W} y1={y} y2={y} className="gb-ov-gridline" strokeWidth={1} />;
            })}

            {plotted.map((s) => (
              <path
                key={s.key}
                d={pathFrom(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeLinejoin="round"
              />
            ))}

            {days.map((day, i) => {
              const selected = activeKey === dayKey(day);
              return (
                <g key={day.start}>
                  {selected && (
                    <line
                      x1={i * step}
                      x2={i * step}
                      y1={-HEAD_ROOM}
                      y2={H}
                      className="gb-ov-marker"
                      strokeWidth={1.5}
                    />
                  )}
                  {plotted.map((s) => {
                    const p = s.points[i];
                    if (!p) return null;
                    return (
                      <circle
                        key={s.key}
                        cx={p.x}
                        cy={p.y}
                        r={selected ? 5 : 3.5}
                        fill="var(--gb-paper)"
                        stroke={s.color}
                        strokeWidth={2}
                      />
                    );
                  })}
                  <rect
                    x={i * step - lane / 2}
                    y={-HEAD_ROOM}
                    width={lane}
                    height={H + HEAD_ROOM}
                    fill="transparent"
                    className="cursor-pointer"
                    role="button"
                    aria-label={`${day.label}: ${day.rows.length} ${day.rows.length === 1 ? 'pass' : 'passes'} raised`}
                    onClick={() => onSelect(day)}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="min-w-[520px] flex justify-between gb-ov-xaxis">
          {days.map((d, i) => (
            <span key={d.start} className={i % labelEvery === 0 ? '' : 'invisible'}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* The legend sits UNDER the plot, centred, exactly as the mock draws it. */}
      <div className="gb-ov-legend-row">
        {SERIES.map((s) => (
          <span key={s.key} className="gb-ov-legend-item">
            <span className="gb-ov-legend-line" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

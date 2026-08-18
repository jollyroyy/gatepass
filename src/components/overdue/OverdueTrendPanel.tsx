// "Overdue trend" — how much of the CURRENT backlog was already past its date
// on each of the last seven days — and, under it, the escalation card.
//
// WHAT THE BARS ARE, EXACTLY: this is the age of what is outstanding NOW, not
// an archive of past lateness. Nothing in this database records "how many lines
// were overdue last Tuesday" — a line that came back on Wednesday leaves no
// trace of the two days it was late — so a bar counts today's rows whose date
// had already passed on that day. `overdueTrend` says the same in code.
//
// THE BARS TAKE THE OVERDUE STATUS HUE, not a series colour. The rule in
// chartPalette.ts: a chart bucket must be the same colour as the badge beside
// it, and every badge in the table under this panel is either overdue orange or
// critical red.
import React from 'react';
import { STATUS_COLORS } from '../charts/chartPalette';
import { niceMax, axisTicks } from '../../lib/chartGeometry';
import { CRITICAL_DAYS, type TrendBar } from '../../lib/overdueItems';

const W = 260;
const H = 130;
const TICKS = 4;

type Props = {
  bars: TrendBar[];
  critical: number;
  /** Narrows the table to the critical band — the same filter the select sets,
   *  so the button and the control can never disagree. */
  onReviewCritical: () => void;
};

export default function OverdueTrendPanel({ bars, critical, onReviewCritical }: Props): React.ReactElement {
  const max = niceMax(Math.max(0, ...bars.map((b) => b.count)), TICKS);
  const lane = W / Math.max(bars.length, 1);
  const barWidth = Math.min(22, lane * 0.55);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <h2 className="card-title mb-3">Overdue trend</h2>

        <div className="flex gap-2">
          {/* The axis is PRINTED, not hovered: this page is read on a tablet at
              a gate office, where a tooltip is a promise of a mouse. */}
          <div className="flex flex-col justify-between text-[10px] text-navy-500 tabular py-1" aria-hidden="true">
            {axisTicks(max, TICKS)
              .slice()
              .reverse()
              .map((t) => (
                <span key={t}>{t}</span>
              ))}
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Overdue items per day">
            {axisTicks(max, TICKS).map((t) => {
              const y = H - (t / max) * H;
              return <line key={t} x1={0} x2={W} y1={y} y2={y} stroke="currentColor" className="text-surface-200" strokeWidth={1} />;
            })}
            {bars.map((b, i) => {
              const h = max === 0 ? 0 : (b.count / max) * H;
              return (
                <rect
                  key={b.day}
                  x={i * lane + (lane - barWidth) / 2}
                  y={H - h}
                  width={barWidth}
                  height={h}
                  rx={3}
                  fill={STATUS_COLORS.overdue}
                >
                  <title>{`${b.label}: ${b.count}`}</title>
                </rect>
              );
            })}
          </svg>
        </div>

        <div className="flex justify-between mt-1.5 pl-5 text-[10px] text-navy-500 tabular">
          {bars.map((b) => (
            <span key={b.day} className="text-center leading-tight">{b.label}</span>
          ))}
        </div>
      </div>

      {/* Only when there is something to escalate — an empty alarm card teaches
          a reader to ignore the alarm. */}
      {critical > 0 && (
        <div className="card p-4 border-flagged-100 bg-flagged-50/60">
          <div className="flex items-start gap-2.5">
            <span className="text-flagged-600 shrink-0 mt-0.5" aria-hidden="true">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.14 4.6a1 1 0 011.72 0l7.1 12.4a1 1 0 01-.86 1.5H4.9a1 1 0 01-.86-1.5l7.1-12.4z" />
                <path strokeLinecap="round" d="M12 9.75v3.5M12 16.25h.01" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-navy-900">
                {critical} {critical === 1 ? 'item needs' : 'items need'} escalation
              </p>
              <p className="text-sm text-navy-600 mt-0.5">
                Out for {CRITICAL_DAYS} days or more past the expected return date.
              </p>
            </div>
          </div>
          <button type="button" className="btn-primary w-full mt-3" onClick={onReviewCritical}>
            Review critical items
          </button>
        </div>
      )}
    </div>
  );
}

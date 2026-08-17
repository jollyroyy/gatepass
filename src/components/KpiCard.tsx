import React from 'react';
import { Link } from 'react-router-dom';

export type Tone = 'neutral' | 'pending' | 'matched' | 'flagged' | 'overdue' | 'brand' | 'accent';

type Props = {
  label: string;
  value: number | string;
  tone?: Tone;
  delta?: string;
  to?: string;
  onClick?: () => void;
  loading?: boolean;
  /** Marks a clickable KPI as the one currently driving the view below it.
   *  Only meaningful with `onClick` — a `to` card navigates away instead. */
  active?: boolean;
};

/** Direct lookup — never derive the value colour from string matching on tone.
 *  Exported so the admin board's richer `BoardKpiCard` renders its number in
 *  exactly the same colour as the guard's and HOD's plain cards, rather than
 *  keeping a second copy that drifts. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-navy-900',
  pending: 'text-pending-600',
  matched: 'text-matched-600',
  flagged: 'text-flagged-600',
  overdue: 'text-overdue-600',
  brand: 'text-brand-600',
  accent: 'text-accent-600',
};

export default function KpiCard({ label, value, tone = 'neutral', delta, to, onClick, loading, active }: Props): React.ReactElement {
  // A KPI that flashes a spinner on every refresh is worse than one that shows
  // the last known number, so `loading` renders a dash, never a spinner.
  const displayValue = loading ? '—' : value;

  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${TONE_TEXT[tone]}`}>{displayValue}</span>
      {delta && <span className="kpi-delta">{delta}</span>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="kpi-card card-hover">
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`kpi-card card-hover text-left w-full cursor-pointer${active ? ' ring-2 ring-brand-500/60' : ''}`}
      >
        {body}
      </button>
    );
  }

  return <div className="kpi-card">{body}</div>;
}

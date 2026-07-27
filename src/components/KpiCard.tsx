import React from 'react';
import { Link } from 'react-router-dom';

export type Tone = 'neutral' | 'pending' | 'matched' | 'flagged' | 'overdue' | 'brand';

type Props = {
  label: string;
  value: number | string;
  tone?: Tone;
  delta?: string;
  to?: string;
  loading?: boolean;
};

/** Direct lookup — never derive the value colour from string matching on tone. */
const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-navy-900',
  pending: 'text-pending-600',
  matched: 'text-matched-600',
  flagged: 'text-flagged-600',
  overdue: 'text-overdue-600',
  brand: 'text-brand-600',
};

export default function KpiCard({ label, value, tone = 'neutral', delta, to, loading }: Props): React.ReactElement {
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

  return <div className="kpi-card">{body}</div>;
}

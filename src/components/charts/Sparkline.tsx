// The thumbnail trend on a KPI card. Deliberately unlabelled and
// `aria-hidden` — it carries SHAPE, not figures, and the figure it would
// announce (the KPI's own value) is already the largest thing on the card. A
// second, quieter voice reading the same number out is noise to a screen
// reader, not redundancy.
//
// It is normalised against its own peak, so two sparklines on the same row are
// NOT comparable to each other. That is why it never gets an axis: an axis
// would invite exactly the cross-card comparison the scaling cannot support.
import React from 'react';
import { linePoints, pathFrom, areaFrom } from '../../lib/chartGeometry';

const W = 96;
const H = 30;

export default function Sparkline({ values, color }: { values: number[]; color: string }): React.ReactElement | null {
  if (values.length < 2) return null;
  const peak = Math.max(...values, 0);
  const pts = linePoints(values, peak, W, H);

  return (
    // Width comes from the parent, not from `W` — `W`/`H` are only the
    // coordinate space. A fixed 96px svg beside a four-digit KPI is what pushes
    // a card 5-across into overflow on a laptop; this one gives way instead.
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="w-full h-[30px] overflow-visible" preserveAspectRatio="none">
      <path d={areaFrom(pts, H)} fill={color} opacity={0.14} />
      <path d={pathFrom(pts)} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

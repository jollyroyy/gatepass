// The strip under the return table naming what each colour means (client
// mock-up, 2026-08-19).
//
// It exists because this screen is the one place in the app where four states
// sit in the same table, and a guard reads it standing up, at a distance, on a
// terminal whose colours are whatever the terminal's colours are. Every badge
// on the rows above ALSO carries its own word — the legend is a second reading
// of the same facts, never the only one, so losing the colour loses nothing.
import React from 'react';

const KEYS = [
  { tint: 'gb-tint-green', label: 'Returned' },
  { tint: 'gb-tint-orange', label: 'Partially Returned' },
  { tint: 'gb-tint-grey', label: 'Not Returned' },
  { tint: 'gb-tint-red', label: 'Overdue' },
] as const;

export default function ReturnLegend(): React.ReactElement {
  return (
    <div className="gb-legend">
      Legend:
      {KEYS.map((k) => (
        <span key={k.label} className="gb-legend-item">
          <span className={`gb-legend-dot ${k.tint}`} aria-hidden="true" />
          {k.label}
        </span>
      ))}
    </div>
  );
}

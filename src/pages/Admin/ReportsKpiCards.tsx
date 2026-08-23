// The report's six figures, drawn to the client's mock-up (2026-08-20): a tinted
// square plate, the card's name in small grey Inter and the figure in big
// near-black. NO SECOND LINE (client, 2026-08-23): the mock's "vs last 30 days"
// comparison and the "% of total" share line are both gone from
// `buildReportKpis`, so there is no note left to draw.
//
// NONE OF THEM IS A CONTROL. The mock draws no affordance on these cards and
// there is nothing for one to open — the very rows they count are in the table
// directly underneath, already narrowed by the same filters. That is deliberately
// unlike the admin Overview's `.gb-ov` row, where every card IS a drill; two rows
// of cards that look alike and behave differently is the confusion worth avoiding.
//
// The figures still agree with the table by construction: `buildReportKpis` is
// handed the same array the table renders, so no aggregate and no second
// predicate exists to drift.
import React from 'react';
import type { ReportKpi } from '../../lib/gatePassReport';
import HodIcon from '../../components/hod/HodIcon';

type Props = {
  cards: ReportKpi[];
  /** A figure that flashes a spinner on every reload is worse than one showing a
   *  placeholder — the same rule every KPI on every board here follows. */
  loading: boolean;
};

export default function ReportsKpiCards({ cards, loading }: Props): React.ReactElement {
  return (
    <div className="gb-rep-grid" role="group" aria-label="Report figures">
      {cards.map((c) => (
        <div key={c.key} className="gb-card gb-rep-kpi">
          <span className="gb-rep-kpi-head">
            <HodIcon glyph={c.glyph} tone={c.tone} shape="card" />
            <span className="min-w-0">
              <span className="gb-rep-kpi-label">{c.label}</span>
              <span className="gb-rep-kpi-figure">
                {loading ? '—' : c.value.toLocaleString('en-IN')}
              </span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

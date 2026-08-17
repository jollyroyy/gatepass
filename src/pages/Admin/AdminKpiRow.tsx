// The five headline cards across the top of the admin board.
//
// Three different row sets meet here, and keeping them straight is the whole
// job of this component:
//
//   scoped    — passes inside the selected period. THE NUMBER ON THE CARD, and
//               the list its click opens. Same array, always.
//   previous  — the adjacent window of equal length, for the delta only. Never
//               shown as a figure and never drilled into; it exists so "+12%"
//               means something.
//   all       — every pass, for the sparkline, which is always the last 7 days
//               regardless of the period. That is deliberate: on the default
//               "Today" period a period-scoped sparkline would be a single
//               point, which is not a trend, it is a dot.
import React from 'react';
import type { GatePassView } from '../../types';
import { ADMIN_KPIS, ADMIN_KPI_ORDER, kpiDrill, type AdminDrill, type AdminKpiKey } from '../../lib/adminDrills';
import { countsPerDay, deltaPercent } from '../../lib/adminAnalytics';
import AdminKpiCard from './AdminKpiCard';

const SPARK_DAYS = 7;

type Props = {
  scoped: GatePassView[];
  previous: GatePassView[];
  all: GatePassView[];
  loading: boolean;
  comparisonLabel: string;
  activeKey: string | null;
  onSelect: (drill: AdminDrill) => void;
};

export default function AdminKpiRow({
  scoped, previous, all, loading, comparisonLabel, activeKey, onSelect,
}: Props): React.ReactElement {
  return (
    // 2 across on a phone, 3 on a tablet, all 5 from `xl` — never squeezed into
    // five columns on a laptop, which is where a card this dense starts
    // clipping its own label.
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {ADMIN_KPI_ORDER.map((key: AdminKpiKey) => {
        const kpi = ADMIN_KPIS[key];
        const rows = scoped.filter(kpi.match);
        const drill = kpiDrill(key, rows);
        return (
          <AdminKpiCard
            key={key}
            kpi={kpi}
            value={rows.length}
            delta={deltaPercent(rows.length, previous.filter(kpi.match).length)}
            deltaLabel={comparisonLabel}
            trend={countsPerDay(all.filter(kpi.match), SPARK_DAYS)}
            loading={loading}
            active={activeKey === drill.key}
            onClick={() => onSelect(drill)}
          />
        );
      })}
    </div>
  );
}

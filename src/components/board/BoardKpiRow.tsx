// The five headline cards across the top of the admin board.
//
// Two row sets meet here, and keeping them apart is the whole job of this
// component:
//
//   scoped    — passes inside the selected period. THE NUMBER ON THE CARD, and
//               the list its click opens. Same array, always.
//   previous  — the adjacent window of equal length, for the delta only. Never
//               shown as a figure and never drilled into; it exists so "+12%"
//               means something.
//
// There used to be a third, `all`, feeding a 7-day sparkline on every card.
// The chart is gone (client, 2026-08-17 — see BoardKpiCard), so the prop went
// with it rather than being left plumbed through for nothing.
import React from 'react';
import type { GatePassView } from '../../types';
import { BOARD_KPIS, BOARD_KPI_ORDER, kpiDrill, type BoardDrill, type BoardKpiKey } from '../../lib/boardDrills';
import { deltaPercent } from '../../lib/boardAnalytics';
import BoardKpiCard from './BoardKpiCard';

type Props = {
  scoped: GatePassView[];
  previous: GatePassView[];
  loading: boolean;
  comparisonLabel: string;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function BoardKpiRow({
  scoped, previous, loading, comparisonLabel, activeKey, onSelect,
}: Props): React.ReactElement {
  return (
    // 2 across on a phone, 3 on a tablet, all 5 from `xl` — never squeezed into
    // five columns on a laptop, which is where a card this dense starts
    // clipping its own label.
    // Named as a group: the status donut below carries slices with the same
    // words on them ("Cleared at Gate", "Pending"), so without this a reader
    // arriving by keyboard — and any test — has no way to say which "Cleared at
    // Gate" they mean.
    <div
      role="group"
      aria-label="Headline figures"
      className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4"
    >
      {BOARD_KPI_ORDER.map((key: BoardKpiKey) => {
        const kpi = BOARD_KPIS[key];
        const rows = scoped.filter(kpi.match);
        const drill = kpiDrill(key, rows);
        return (
          <BoardKpiCard
            key={key}
            kpi={kpi}
            value={rows.length}
            delta={deltaPercent(rows.length, previous.filter(kpi.match).length)}
            deltaLabel={comparisonLabel}
            loading={loading}
            active={activeKey === drill.key}
            onClick={() => onSelect(drill)}
          />
        );
      })}
    </div>
  );
}

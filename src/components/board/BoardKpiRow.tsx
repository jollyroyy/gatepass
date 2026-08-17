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
import { BOARD_KPIS, boardKpiOrder, kpiDrill, type BoardDrill, type BoardKpiKey } from '../../lib/boardDrills';
import type { BoardCategory } from '../../lib/boardCategory';
import { deltaPercent } from '../../lib/boardAnalytics';
import BoardKpiCard from './BoardKpiCard';

type Props = {
  scoped: GatePassView[];
  previous: GatePassView[];
  loading: boolean;
  comparisonLabel: string;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
  /** WHICH CARDS EXIST, not merely which rows they count — the row is chosen by
   *  the board's category toggle. See `boardKpiOrder`. */
  category: BoardCategory;
};

/** Tailwind cannot see a class built by interpolation, so the widths are a
 *  lookup rather than `xl:grid-cols-${n}`. Six cards go 3-across on two rows,
 *  never 6-across — a card this dense clips its own label below ~200px. */
const XL_COLUMNS: Record<number, string> = {
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-3',
};

export default function BoardKpiRow({
  scoped, previous, loading, comparisonLabel, activeKey, onSelect, category,
}: Props): React.ReactElement {
  const order = boardKpiOrder(category);
  return (
    // 2 across on a phone, 3 on a tablet, and from `xl` however many the
    // selected category asks for — see XL_COLUMNS.
    // Named as a group: the status donut below carries slices with the same
    // words on them ("Cleared at Gate", "Pending"), so without this a reader
    // arriving by keyboard — and any test — has no way to say which "Cleared at
    // Gate" they mean.
    <div
      role="group"
      aria-label="Headline figures"
      className={`grid grid-cols-2 md:grid-cols-3 gap-4 ${XL_COLUMNS[order.length] ?? 'xl:grid-cols-5'}`}
    >
      {order.map((key: BoardKpiKey) => {
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

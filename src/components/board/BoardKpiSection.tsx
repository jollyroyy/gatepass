// One titled band of KPI tiles — "RGP Overview", "NRGP Overview", "Quick
// Summary".
//
// The section is what makes the reference board readable: the same tile means a
// different thing under a different heading, and grouping by category is what
// lets the RGP row carry a return leg while the NRGP row does not. It also
// replaced the board's old category TOGGLE, which asked the reader to press a
// button to see the other half of the traffic.
//
// EVERY FIGURE HERE IS `rows.length` OF THE VERY LIST ITS CLICK OPENS. The rows
// are selected once, by `rowsFor`, from the windows the board built once — there
// is no `count: 'exact'` query on this board and no predicate re-applied against
// a second array. Do not "optimise" this into aggregate queries.
import React from 'react';
import { BOARD_KPIS, type BoardKpiKey } from '../../lib/boardKpis';
import { kpiLabel, rowsFor, kpiDrill, type BoardWindows } from '../../lib/boardWindows';
import type { BoardDrill } from '../../lib/boardDrills';
import BoardKpiTile from './BoardKpiTile';

type Props = {
  title: string;
  /** One line on the right of the heading — the scope, never a restatement of
   *  the title. */
  hint?: string;
  keys: BoardKpiKey[];
  windows: BoardWindows;
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

/** Tailwind cannot see a class built by interpolation, so the widths are a lookup
 *  rather than `xl:grid-cols-${n}`. Two across on a phone in every case: one
 *  column would push the summary row three screens long, and three would clip
 *  the number.
 *
 *  Nothing goes wider than 5 across even when a section has 7 tiles: past that
 *  a tile is narrower than the words on it, and this board's own rule is that
 *  no label is ever truncated. Seven at four across is 4 + 3, which reads as one
 *  block; seven at seven across is seven slivers. */
const COLUMNS: Record<number, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
  5: 'sm:grid-cols-3 xl:grid-cols-5',
  6: 'sm:grid-cols-3 xl:grid-cols-6',
  7: 'sm:grid-cols-3 xl:grid-cols-4',
};

export default function BoardKpiSection({
  title, hint, keys, windows, loading, activeKey, onSelect,
}: Props): React.ReactElement {
  return (
    <section aria-label={title} className="border border-surface-200 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-micro text-navy-500 uppercase">{title}</h2>
        {hint && <span className="text-caption text-navy-500 shrink-0">{hint}</span>}
      </div>

      {/* Named as a group: several tiles carry words that also appear on the
          panels below ("Overdue", "Pending"), so without this neither a keyboard
          reader nor a test can say which one they mean. */}
      <div
        role="group"
        aria-label={`${title} figures`}
        className={`grid grid-cols-2 gap-3 ${COLUMNS[keys.length] ?? 'sm:grid-cols-3'}`}
      >
        {keys.map((key) => {
          const kpi = BOARD_KPIS[key];
          const rows = rowsFor(kpi, windows);
          const drill = kpiDrill(key, rows);
          return (
            <BoardKpiTile
              key={key}
              kpi={kpi}
              label={kpiLabel(kpi)}
              value={rows.length}
              loading={loading}
              active={activeKey === drill.key}
              onClick={() => onSelect(drill)}
            />
          );
        })}
      </div>
    </section>
  );
}

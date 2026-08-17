// "Department Wise Outstanding RGP" — who is holding material off site right now,
// ranked.
//
// IT COUNTS ONLY OPEN OBLIGATIONS, not all traffic. A department that raised
// forty passes and closed all forty is not "outstanding"; the panel exists to
// name the ones with material still out, which is the list an operations reader
// chases.
//
// ON A SINGLE-DEPARTMENT BOARD IT RANKS MATERIALS INSTEAD. An HOD sees only their
// own department (RLS, `gate_passes_select`) and holds at most one since `032`, so
// a department ranking there could only ever draw one bar at 100% naming the
// reader's own department. Same panel, same shape, a question that has an answer.
import React, { useMemo } from 'react';
import type { GatePassView, GatePassItemView } from '../../types';
import { departmentSlices, topMaterials, type Slice } from '../../lib/boardAnalytics';
import type { BoardDrill } from '../../lib/boardDrills';
import BarList from '../charts/BarList';
import BoardCard from './BoardCard';

/** The client's "keep only the top items": a ranking is a shape, and a
 *  twelve-row list is a table pretending to be one. */
const TOP = 5;

export type OutstandingMode = 'department' | 'material';

type Props = {
  /** The still-out passes — the caller has already narrowed to open returns, so
   *  this panel cannot disagree with the figure that sent the reader here. */
  rows: GatePassView[];
  items: GatePassItemView[];
  mode: OutstandingMode;
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function BoardOutstanding({
  rows, items, mode, loading, activeKey, onSelect,
}: Props): React.ReactElement {
  const slices = useMemo(
    () => (mode === 'department' ? departmentSlices(rows).slice(0, TOP) : topMaterials(items, rows, TOP)),
    [mode, rows, items],
  );

  const open = (slice: Slice): void => {
    onSelect({
      key: `outstanding-${slice.key}`,
      heading: `${slice.label} — still out`,
      empty: 'Nothing is still out here.',
      rows: slice.rows,
    });
  };

  return (
    <BoardCard
      title={mode === 'department' ? 'Department Wise Outstanding RGP' : 'Material Wise Outstanding RGP'}
      subtitle={`Passes with material still out — top ${TOP}.`}
      loading={loading}
      skeletonHeight="h-56"
    >
      <BarList
        slices={slices}
        valueMode="count"
        // The denominator is the whole outstanding set, not the top five, or the
        // shares would add to 100% of a subset and overstate every bar.
        total={rows.length}
        emptyMessage="Nothing is outstanding."
        activeKey={activeKey?.startsWith('outstanding-') ? activeKey.slice('outstanding-'.length) : null}
        onSelect={open}
      />
    </BoardCard>
  );
}

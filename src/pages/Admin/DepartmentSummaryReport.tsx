// "Department Summary" report view — per-department counts for the date range.
// Reuses computeDeptBreakdown/DeptBreakdownTable so the counting stays
// identical to the all-time table on the Admin Dashboard.
import React, { useEffect, useMemo } from 'react';
import type { GatePassView } from '../../types';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import DeptBreakdownTable, { computeDeptBreakdown } from './DeptBreakdownTable';

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'name', header: 'Department' },
  { key: 'pending', header: 'Pending for Gate Approval' },
  { key: 'matched', header: 'Matched' },
  { key: 'flagged', header: 'Mismatched' },
];

type Props = {
  rows: GatePassView[];
  onRowsChanged: (count: number) => void;
};

export default function DepartmentSummaryReport({ rows, onRowsChanged }: Props): React.ReactElement {
  const breakdown = useMemo(() => computeDeptBreakdown(rows), [rows]);

  useEffect(() => {
    onRowsChanged(breakdown.length);
  }, [breakdown.length, onRowsChanged]);

  function handleExport() {
    downloadCsv('department-summary.csv', breakdown as unknown as Record<string, unknown>[], CSV_COLUMNS);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end no-print">
        <button type="button" className="btn-secondary text-sm" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      {breakdown.length === 0 ? (
        <div className="table-wrap empty-state">No passes in this range.</div>
      ) : (
        <div>
          <DeptBreakdownTable rows={breakdown} />
        </div>
      )}
    </div>
  );
}

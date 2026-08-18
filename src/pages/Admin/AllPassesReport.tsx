// "All Passes" report view — the org-wide register. Date range, department and
// pass type are all decided by the parent ReportsPage and arrive pre-applied in
// `rows`, so this view owns only what is specific to a register: free-text
// search and CSV export. The KPI board and status counts live on the Admin
// Dashboard.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import Badge, { TypeChip } from '../../components/Badge';
import { passStageStyle } from '../../lib/passStage';
import { formatDateTime } from '../../lib/formatDate';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import { csvCategory, csvDateTime, csvStatus, csvText } from '../../lib/csvCells';

// The export is this table, in a file. Every column whose stored value is not
// what the row above renders carries a `format` — see `csvCells.ts`.
export const ALL_PASSES_CSV_COLUMNS: CsvColumn<GatePassView>[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type', format: csvCategory },
  { key: 'department_name', header: 'Department', format: (p) => csvText(p.department_name) },
  { key: 'visitor_name', header: "Authorized Person's Name" },
  { key: 'material_summary', header: 'Material', format: (p) => csvText(p.material_summary) },
  { key: 'item_count', header: 'Items' },
  { key: 'total_quantity', header: 'Total Qty' },
  { key: 'status', header: 'Status', format: csvStatus },
  { key: 'raised_by_name', header: 'Raised By', format: (p) => csvText(p.raised_by_name) },
  { key: 'created_at', header: 'Raised At', format: (p) => csvDateTime(p.created_at) },
];

type Props = {
  rows: GatePassView[];
  onRowsChanged: (count: number) => void;
};

export default function AllPassesReport({ rows, onRowsChanged }: Props): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      rows.filter((p) => {
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const hit =
            p.pass_number.toLowerCase().includes(q) ||
            p.visitor_name.toLowerCase().includes(q) ||
            (p.vehicle_number ?? '').toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      }),
    [rows, search],
  );

  // Report the filtered count up so the print header's entry count tracks the
  // current view and filters, not the raw date-ranged set.
  React.useEffect(() => {
    onRowsChanged(filtered.length);
  }, [filtered.length, onRowsChanged]);

  function handleExport() {
    downloadCsv('all-passes.csv', filtered, ALL_PASSES_CSV_COLUMNS);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center no-print">
        <input
          className="input w-auto min-w-[220px]"
          placeholder="Search pass no / visitor / vehicle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <button type="button" className="btn-secondary text-sm" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="table-wrap empty-state">No passes match these filters.</div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table-base report-table">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Department</th>
                <th>Authorized Person's Name</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Raised By</th>
                <th>Raised At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
                  <td className="font-semibold text-navy-900">{p.pass_number}</td>
                  <td>
                    <TypeChip type={p.type} />
                  </td>
                  <td>{p.department_name}</td>
                  <td>{p.visitor_name}</td>
                  <td className="max-w-[220px] truncate">{p.material_summary ?? ''}</td>
                  <td className="tabular">{p.item_count} item(s)</td>
                  <td>
                    <Badge style={passStageStyle(p)} />
                  </td>
                  <td>{p.raised_by_name}</td>
                  <td className="tabular whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

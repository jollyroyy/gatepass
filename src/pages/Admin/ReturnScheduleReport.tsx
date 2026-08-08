// "Return Schedule" report view — RGP passes only, with the two return-date
// facts the mall needs to chase: the EXPECTED return (what the HOD promised
// when the pass was raised, per gate_passes.expected_return_date) and the
// ACTUAL return (when the last line came back and apply_item_returns closed
// the pass). Both come straight off the view — never recomputed in TS.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import Badge, { TypeChip } from '../../components/Badge';
import { EXPIRED_STYLE, RETURN_STYLES, STATUS_STYLES, isExpiredPending } from '../../lib/statusStyles';
import { formatDateOnly } from '../../lib/formatDate';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';

export const RETURN_SCHEDULE_CSV_COLUMNS: CsvColumn[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type' },
  { key: 'department_name', header: 'Department' },
  { key: 'visitor_name', header: 'Visitor' },
  { key: 'material_summary', header: 'Material' },
  { key: 'item_count', header: 'Items' },
  { key: 'expected_return_date', header: 'Expected Return' },
  { key: 'actual_return_date', header: 'Actual Return' },
  { key: 'return_status', header: 'Return Status' },
  { key: 'status', header: 'Status' },
];

type Props = {
  rows: GatePassView[];
  onRowsChanged: (count: number) => void;
};

export default function ReturnScheduleReport({ rows, onRowsChanged }: Props): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      rows
        .filter((p) => p.type === 'RGP')
        .filter((p) => {
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          return (
            p.pass_number.toLowerCase().includes(q) ||
            p.visitor_name.toLowerCase().includes(q) ||
            (p.visitor_company ?? '').toLowerCase().includes(q)
          );
        }),
    [rows, search],
  );

  useEffect(() => {
    onRowsChanged(filtered.length);
  }, [filtered.length, onRowsChanged]);

  function handleExport() {
    downloadCsv('rgp-return-schedule.csv', filtered as unknown as Record<string, unknown>[], RETURN_SCHEDULE_CSV_COLUMNS);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center no-print">
        <input
          className="input w-auto min-w-[220px]"
          placeholder="Search pass no / visitor / company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-secondary text-sm" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="table-wrap empty-state">No RGP passes in this range.</div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table-base report-table">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Department</th>
                <th>Visitor</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Expected Return</th>
                <th>Actual Return</th>
                <th>Return Status</th>
                <th>Status</th>
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
                  <td className="tabular whitespace-nowrap">{formatDateOnly(p.expected_return_date)}</td>
                  <td className="tabular whitespace-nowrap">{formatDateOnly(p.actual_return_date)}</td>
                  <td>
                    <Badge style={RETURN_STYLES[p.return_status]} />
                  </td>
                  <td>
                    <Badge style={isExpiredPending(p) ? EXPIRED_STYLE : STATUS_STYLES[p.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

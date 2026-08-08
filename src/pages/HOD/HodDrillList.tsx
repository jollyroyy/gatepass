// The list a clicked HOD dashboard KPI reveals — same rows the card counted,
// rendered as a table so it slots under the KPI grid without a page nav.
// Mirrors the shape of the old "Recent Passes" table this replaced.
import React from 'react';
import type { GatePassView } from '../../types';
import Badge, { TypeChip } from '../../components/Badge';
import { EXPIRED_STYLE, STATUS_STYLES, isExpiredPending } from '../../lib/statusStyles';
import type { DrillDef } from '../../lib/hodDrills';

const SKELETON_ROWS = 6;

type Props = {
  def: DrillDef;
  rows: GatePassView[];
  loading: boolean;
  onOpen: (id: string) => void;
};

export default function HodDrillList({ def, rows, loading, onOpen }: Props): React.ReactElement {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="section-title mb-0">{def.heading}</h2>
        <span className="text-xs font-medium text-navy-400 tabular">
          {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
        </span>
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="table-wrap empty-state">{def.empty}</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Visitor</th>
                <th>Material</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                  <td className="font-semibold text-navy-900">{p.pass_number}</td>
                  <td>
                    <TypeChip type={p.type} />
                  </td>
                  <td>{p.visitor_name}</td>
                  <td className="max-w-[220px] truncate">{p.material_summary ?? ''}</td>
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

// "Mismatches needing review" card on the HOD dashboard. The guard's mismatch
// reason is the single most important input to the HOD's approve/leave-flagged
// decision, so it is rendered as the visual focus of each row — not a footnote.
import React from 'react';
import type { GatePassView } from '../../types';
import { TypeChip } from '../../components/Badge';

export default function FlaggedReviewCard({
  rows,
  onOpen,
}: {
  rows: GatePassView[];
  onOpen: (id: string) => void;
}): React.ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <div className="card border border-flagged-500/30 bg-flagged-50/40 p-5 mb-8">
      <h2 className="section-title text-flagged-700 mb-3">Mismatches needing review</h2>
      <div className="flex flex-col gap-3">
        {rows.map((p) => (
          <div
            key={p.id}
            className="list-item cursor-pointer rounded-xl hover:bg-flagged-100/40 items-start"
            onClick={() => onOpen(p.id)}
          >
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-navy-900 text-sm">{p.pass_number}</span>
                <TypeChip type={p.type} />
                <span className="text-sm text-navy-600">{p.visitor_name}</span>
              </div>
              <p className="text-xs text-navy-400 truncate">{p.material_summary ?? ''}</p>
              <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-3 py-2">
                <p className="text-xs font-bold text-flagged-700 uppercase tracking-wider mb-1">
                  Security flagged this:
                </p>
                <p className="text-sm font-semibold text-flagged-700 whitespace-pre-wrap break-words">
                  {p.flag_reason ?? 'No reason recorded'}
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold text-flagged-600 shrink-0 self-center whitespace-nowrap">
              Review →
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

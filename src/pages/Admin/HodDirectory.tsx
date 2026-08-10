// Who the HODs are and what each one heads — the person→department view.
//
// The Departments list answers "who heads Engineering?". This answers "what does
// Asha head?", which the department cards cannot show without the reader holding
// three cards in their head at once. VMS's single `profiles.department_id` cannot
// express the department→HOD direction (several HODs per department), which is
// why gatepass.hod_departments exists — one row per person since migration 032.
import React from 'react';
import type { Department, Profile } from '../../types';

export interface HodEntry {
  hod: Profile;
  departments: Department[];
}

type Props = {
  entries: HodEntry[];
};

export default function HodDirectory({ entries }: Props): React.ReactElement {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'rgb(var(--glass-bg) / 0.45)',
        backdropFilter: 'blur(22px) saturate(155%)',
        WebkitBackdropFilter: 'blur(22px) saturate(155%)',
        border: '1px solid rgb(var(--c-surface-200) / 0.6)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="card-title mb-0">Heads of Department</h3>
        <span className="text-xs font-medium text-navy-400 tabular">
          {entries.length} {entries.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-navy-400 italic">No HOD accounts yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(({ hod, departments }) => (
            <div
              key={hod.id}
              data-testid="hod-row"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-100/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy-900 truncate">{hod.full_name}</p>
                <p className="text-[11px] text-navy-400 truncate">{hod.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {departments.length === 0 ? (
                  <span className="text-xs text-flagged-600 italic">No department assigned</span>
                ) : (
                  departments.map((d) => (
                    <span key={d.id} className="type-chip" title={d.name}>
                      {d.code}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

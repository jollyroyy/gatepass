// The activity rail beside a gate-pass record — the verification trail,
// newest first, exactly as `gatepass.v_verifications` recorded it.
//
// It is headed "Activity timeline", not "Return activity": the rail carries
// every gate event (matched, flagged, HOD override, void), not just returns,
// and since 2026-08-18 it is also the timeline `/pass/:id` shows.
//
// Wording comes from a Record<VerifyAction, …>, never a string match, so a new
// label on the Postgres enum is a type error rather than a blank line.
import React from 'react';
import type { VerifyAction, Verification } from '../../types';
import { formatTime, formatDateOnly } from '../../lib/formatDate';

export interface ActivityEntry extends Verification {
  security_name: string;
}

const ACTION_DOT: Record<VerifyAction, string> = {
  matched: 'bg-matched-500',
  flagged: 'bg-flagged-500',
  returned: 'bg-accent-600',
  held: 'bg-pending-500',
  hod_reviewed: 'bg-accent-500',
  cancelled: 'bg-navy-500',
};

const ACTION_TITLE: Record<VerifyAction, string> = {
  matched: 'Cleared out at the gate',
  flagged: 'Mismatch raised at the gate',
  returned: 'Material marked returned',
  held: 'Held at the gate',
  hod_reviewed: 'HOD approved the override',
  cancelled: 'Voided by the HOD',
};

type Props = { entries: ActivityEntry[] };

export default function PassRecordActivity({ entries }: Props): React.ReactElement {
  // `v_verifications` is read oldest-first for the detail timeline; this rail
  // reads the other way — the last thing that happened is the thing a guard
  // standing at the barrier needs first.
  const newestFirst = [...entries].reverse();

  return (
    <aside className="card p-5">
      <h2 className="card-title mb-4">Activity timeline</h2>

      {newestFirst.length === 0 ? (
        <p className="empty-state !py-6">Nothing recorded at the gate yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {newestFirst.map((v) => (
            <li key={v.id} className="flex gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${ACTION_DOT[v.action]}`} />
              <div className="min-w-0">
                <p className="text-xs text-navy-500">
                  {formatTime(v.created_at)} · {formatDateOnly(v.created_at)}
                </p>
                <p className="text-sm font-semibold text-navy-900">{ACTION_TITLE[v.action]}</p>
                <p className="text-xs text-navy-500">by {v.security_name || 'security'}</p>
                {v.remarks && <p className="text-xs text-navy-700 mt-0.5 break-words">{v.remarks}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

// /returns — the material expected back TODAY, one row per line.
//
// This is where the boards' "due today" figures land: the guard's Awaiting
// Return tile and the admin's / HOD's "RGP Due Today" tile both navigate here
// rather than drilling in place, so one screen owns the list and the action on
// it (client, 2026-08-18).
//
// TODAY IS THE DATABASE'S TODAY. `due_state` is computed in
// `gatepass.v_gate_passes` against `site_tz()` (Asia/Kolkata); comparing
// `expected_return_date` to the browser clock would make the gate's screen
// disagree with the database for every pass after 18:30 IST. Never recompute it
// here.
//
// SCOPE, per role, the same three as Overdue Items: the guard and the admin see
// what RLS gives them, an HOD sees their own passes (`raised_by`, server-side).
// Only the gate can record — `apply_item_returns` refuses anyone else.
import React from 'react';
import type { UserRole } from '../../types';
import { useOpenReturns } from '../../lib/useOpenReturns';
import ScheduledReturns from '../../components/returns/ScheduledReturns';

type Props = { role: UserRole | null };

export default function ReturnsDueTodayPage({ role }: Props): React.ReactElement {
  const isGuard = role === 'guard';
  const { passes, items, loading, error, reload } = useOpenReturns(role === 'hod');
  const dueToday = passes.filter((p) => p.due_state === 'due_today');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Returns Due Today</h1>
        <p className="page-subtitle">
          {isGuard
            ? 'Material expected back at the gate today. Anything already past its date is under Overdue Items.'
            : 'Material expected back today. Anything already past its date is under Overdue Items.'}
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {loading ? (
        <div className="skeleton h-64 w-full" />
      ) : (
        <ScheduledReturns
          passes={dueToday}
          items={items}
          canRecord={isGuard}
          onRecorded={() => void reload()}
          empty="Nothing is expected back today."
        />
      )}
    </div>
  );
}

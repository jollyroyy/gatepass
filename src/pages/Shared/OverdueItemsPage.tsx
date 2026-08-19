// /overdue — Overdue, for all three roles. SCOPE AND ROUTING, NOTHING ELSE.
//
// TWO PAGES BEHIND ONE ROUTE, and the split is by what the reader does:
//
//   guard  `GuardOverdueBoard` — one count of overdue PASSES, opening into a
//          stack of them, each card a link to the pass's own record (client,
//          2026-08-19). A guard chases a slip at the barrier: they need which
//          five passes, and the four actions on each. They do not need the
//          department chart or the seven-day trend, and both were asked for by
//          name to go.
//   HOD    `OverdueBoard` — the item-level board, own passes only. Department
//          scope is RLS's; person scope is `.eq('raised_by', …)` inside
//          useOpenReturns — server-side, the same rule the HOD board applies.
//   admin  `OverdueBoard`, site-wide. RLS gives an admin every department.
//
// THE TWO COUNT THE SAME BACKLOG. `buildOverduePasses` groups exactly the rows
// `buildOverdueRows` produces, so the guard's "5 passes" and the admin's "12
// items" are two readings of one set and cannot contradict each other. There is
// no day cut on either: it was deleted on 2026-08-19 after this page read
// "Total overdue 0" while the return queue showed a late pass.
//
// ONLY THE GUARD CAN RECORD A RETURN, which is the database's rule, not a
// courtesy: `apply_item_returns` refuses anyone else.
import React from 'react';
import type { UserRole } from '../../types';
import { useOpenReturns } from '../../lib/useOpenReturns';
import OverdueBoard from '../../components/overdue/OverdueBoard';
import GuardOverdueBoard from '../../components/guard/GuardOverdueBoard';

const SUBTITLES: Record<'hod' | 'admin', string> = {
  hod: 'Material you sent out that has passed its expected return date — all time.',
  admin: 'Material that has passed its expected return date, across every department — all time.',
};

type Props = { role: UserRole | null };

export default function OverdueItemsPage({ role }: Props): React.ReactElement {
  const isGuard = role === 'guard';
  const isHod = role === 'hod';
  const { passes, items, loading, error, reload } = useOpenReturns(isHod);

  if (isGuard) {
    return <GuardOverdueBoard passes={passes} items={items} loading={loading} error={error} />;
  }

  return (
    <OverdueBoard
      subtitle={SUBTITLES[isHod ? 'hod' : 'admin']}
      passes={passes}
      items={items}
      canRecord={false}
      showDepartments={!isHod}
      showTrend
      loading={loading}
      error={error}
      onRecorded={() => void reload()}
    />
  );
}

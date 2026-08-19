// /overdue — Overdue Items, for all three roles.
//
// This file is SCOPE AND NOTHING ELSE; the page itself is
// `src/components/overdue/OverdueBoard.tsx`, so the guard's screen and the
// admin's cannot drift apart in layout.
//
//   guard  all time, site-wide. The day cut this page used to apply — only what
//          went late in the last 24 hours — was deleted on 2026-08-19: it read
//          "Total overdue 0" while the return queue showed a late pass.
//   HOD    all time, own passes only. Department scope is RLS's; person scope is
//          `.eq('raised_by', …)` inside useOpenReturns — server-side, the same
//          rule the HOD board applies.
//   admin  all time, site-wide. RLS gives an admin every department.
//
// ONLY THE GUARD CAN RECORD A RETURN here, which is the database's rule, not a
// courtesy: `apply_item_returns` refuses anyone else.
import React from 'react';
import type { UserRole } from '../../types';
import { useOpenReturns } from '../../lib/useOpenReturns';
import OverdueBoard from '../../components/overdue/OverdueBoard';

const SUBTITLES: Record<'guard' | 'hod' | 'admin', string> = {
  guard: 'Material that has passed its expected return date and is still outside — chase it at the gate.',
  hod: 'Material you sent out that has passed its expected return date — all time.',
  admin: 'Material that has passed its expected return date, across every department — all time.',
};

type Props = { role: UserRole | null };

export default function OverdueItemsPage({ role }: Props): React.ReactElement {
  const isGuard = role === 'guard';
  const isHod = role === 'hod';
  const { passes, items, loading, error, reload } = useOpenReturns(isHod);

  return (
    <OverdueBoard
      subtitle={SUBTITLES[isGuard ? 'guard' : isHod ? 'hod' : 'admin']}
      passes={passes}
      items={items}
      canRecord={isGuard}
      showDepartments={!isGuard && !isHod}
      showTrend={!isGuard}
      loading={loading}
      error={error}
      onRecorded={() => void reload()}
    />
  );
}

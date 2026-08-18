// /overdue — Overdue Items, for all three roles.
//
// This file is SCOPE AND NOTHING ELSE; the page itself is
// `src/components/overdue/OverdueBoard.tsx`, so the guard's screen and the
// admin's cannot drift apart in layout.
//
//   guard  today's — lines that went overdue TODAY (expected back yesterday).
//                    A shift board: what to chase at the barrier now. Everything
//                    older is the admin's backlog.
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
  guard: 'Material that passed its expected return time today — chase it at the gate.',
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
      scope={isGuard ? 'today' : 'all'}
      canRecord={isGuard}
      loading={loading}
      error={error}
      onRecorded={() => void reload()}
    />
  );
}

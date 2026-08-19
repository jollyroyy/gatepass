// /overdue — Overdue RGP Gate Passes, ONE screen for all three roles (client,
// 2026-08-19).
//
// This used to fork: a guard got a single count-and-stack card, the HOD and
// the admin got an item-level board with a filter bar, a department chart and
// a seven-day trend. The client asked for the card-stack screen everywhere —
// "make the overdue page the same for everyone, the card view" — so the older
// board is gone and `OverduePassBoard` is what every role renders now.
//
// SCOPE IS STILL THREE DIFFERENT THINGS, and that has not changed: HOD is
// their own raised passes (`.eq('raised_by', …)`, inside `useOpenReturns`,
// server-side), guard and admin are site-wide (RLS gives an admin every
// department). This page's only job is to pick the right `subtitle` — which
// states the scope in words, since the board no longer carries a filter bar
// that would otherwise say it — and to decide `canProcessReturn`: true for a
// guard alone, because `apply_item_returns` refuses anyone else.
import React from 'react';
import type { UserRole } from '../../types';
import { useOpenReturns } from '../../lib/useOpenReturns';
import OverduePassBoard from '../../components/overdue/OverduePassBoard';

// A `Record<UserRole, …>`, not an includes() chain — a fifth role would be a
// type error here rather than a silent fallback to the guard's wording.
// `staff` never reaches this page (no route access) but must still be total.
const SUBTITLES: Record<UserRole, string> = {
  guard: 'RGP gate passes that are past their return deadline.',
  hod: "Your department's RGP gate passes that are past their return deadline — the passes you raised.",
  admin: 'RGP gate passes past their return deadline, across every department.',
  super_admin: 'RGP gate passes past their return deadline, across every department.',
  staff: 'RGP gate passes that are past their return deadline.',
};

type Props = { role: UserRole | null };

export default function OverdueItemsPage({ role }: Props): React.ReactElement {
  const isHod = role === 'hod';
  const { passes, items, loading, error } = useOpenReturns(isHod);

  return (
    <OverduePassBoard
      passes={passes}
      items={items}
      loading={loading}
      error={error}
      subtitle={SUBTITLES[role ?? 'guard']}
      canProcessReturn={role === 'guard'}
    />
  );
}

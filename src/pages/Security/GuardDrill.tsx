// `/guard-dashboard/:key` — the list ONE guard figure opens (client,
// 2026-08-23: "whenever we are drilling down on any of the KPI cards in HOD or
// in the guards view, don't show the table on the same page … show it on a new
// page for all the KPI cards", the way the Overdue figure already did).
//
// THE TWO LISTS WERE PAGES BEFORE, AND THIS IS NOT A RETURN TO THAT. Pending OUT
// and Pending RGP Return had routes and SIDEBAR TABS of their own until
// 2026-08-22, and the tabs are what the client removed — a queue you can open
// without pressing the number that counts it is a second way in that can
// disagree with the figure. These pages have no tab: the only route to one is
// the figure itself, and the panel is handed the very array that figure counted,
// rebuilt here from the same `useGuardQueues` read.
//
// AN UNKNOWN KEY GOES BACK TO THE BOARD. `:key` is user-typed and untrusted.
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import DrillPageShell from '../../components/DrillPageShell';
import PendingOutPanel from '../../components/guard/PendingOutPanel';
import PendingReturnsPanel from '../../components/guard/PendingReturnsPanel';
import { pendingOutOf, pendingReturnsOf, typeSplit } from '../../lib/guardBoard';
import { useGuardQueues } from '../../lib/useGuardQueues';

/** The three figures on the board, and what each page is called. A `Record`, not
 *  a fuzzy match: a fourth figure cannot be drilled without somebody deciding
 *  what its page says. */
const TITLES: Record<string, { title: string; subtitle: string }> = {
  RGP: {
    title: 'Pending OUT · RGP',
    subtitle: 'Returnable material waiting for your approval at the gate.',
  },
  NRGP: {
    title: 'Pending OUT · NRGP',
    subtitle: 'Non-returnable material waiting for your approval at the gate.',
  },
  returns: {
    title: 'Pending RGP Return',
    subtitle: 'Material that went out on an RGP and has not come back yet.',
  },
};

export default function GuardDrill(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const { queue, openReturns, loading, error, reload } = useGuardQueues('both');

  const head = key ? TITLES[key] : undefined;
  if (!head) return <Navigate to="/guard-dashboard" replace />;

  const pendingOut = pendingOutOf(queue);
  const pendingReturns = pendingReturnsOf(openReturns);
  // The same split the board's two figures are, so the count beside the title
  // is the number that was pressed to get here.
  const count = key === 'returns' ? pendingReturns.length : typeSplit(pendingOut)[key as 'RGP' | 'NRGP'];

  return (
    <DrillPageShell
      backTo="/guard-dashboard"
      backLabel="Back to dashboard"
      title={head.title}
      subtitle={head.subtitle}
      count={loading ? undefined : count}
      error={error}
    >
      {key === 'returns' ? (
        <PendingReturnsPanel rows={pendingReturns} loading={loading} onRecorded={reload} />
      ) : (
        // KEYED ON THE URL's OWN SEGMENT: React Router keeps this element
        // mounted when only `:key` changes, and `initialTab` is initial state —
        // so without the key, going straight from /RGP to /NRGP would land on
        // the tab the previous page was reading.
        <PendingOutPanel
          key={key}
          rows={pendingOut}
          loading={loading}
          initialTab={key as 'RGP' | 'NRGP'}
        />
      )}
    </DrillPageShell>
  );
}

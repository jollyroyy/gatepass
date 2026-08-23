// `/dashboard/:key` — the page ONE HOD KPI card opens (client, 2026-08-23:
// "instead of showing it on the same page in the dashboard, show it on a new
// page for all the KPI cards").
//
// IT REBUILDS THE BOARD RATHER THAN BEING HANDED IT. `useHodBoardData` is the
// same hook the dashboard reads — same two scopes, department by RLS and person
// by `.eq('raised_by', …)`, both server-side — and `buildHodKpis` is the same
// derivation. So the list here is literally the array the pressed figure
// counted, rebuilt from the same query rather than carried across a navigation
// in router state, which would break on a refresh or a shared link.
//
// A DESK LINE IS A KEY HERE TOO — the two sub-lines under each pass-type card
// carry their own rows and their own page, so pressing one opens what IT
// counted rather than the card's list of everything raised today. `drillFor`
// resolves either kind of key.
//
// AN UNKNOWN KEY GOES HOME. `:key` is user-typed and untrusted; a card that no
// longer exists must land the reader on the board, not on an empty page that
// looks like a failed load. Overdue never reaches here — its card is a link to
// `/overdue`, the item-level page.
import React, { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import DrillList from '../../components/DrillList';
import DrillPageShell from '../../components/DrillPageShell';
import { drillDefOf, drillFor } from '../../lib/boardDrills';
import { buildHodKpis } from '../../lib/hodBoard';
import { useHodBoardData } from './useHodBoardData';

export default function DashboardDrill(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const { rows, loading, error } = useHodBoardData();
  // Stamped ONCE, as on the board: "today" must not move under a reader who
  // opened this page a minute before midnight.
  const [stamp] = useState(() => Date.now());
  const cards = useMemo(() => buildHodKpis(rows, stamp), [rows, stamp]);
  const drill = drillFor(cards, key);

  if (!loading && !drill) return <Navigate to="/dashboard" replace />;

  return (
    <DrillPageShell
      backTo="/dashboard"
      backLabel="Back to dashboard"
      title={drill?.heading ?? 'Passes'}
      subtitle={drill?.scopeNote}
      count={loading ? undefined : drill?.rows.length ?? 0}
      error={error}
    >
      {/* `showRaisedBy={false}`: the reader raised every pass on this board, so
          their own name back at them is noise. `showHeading={false}`: the page
          title above IS the heading, and the count sits beside it. */}
      <DrillList
        def={drillDefOf(drill ?? { key: key ?? '', heading: '', empty: '', rows: [] })}
        rows={drill?.rows ?? []}
        loading={loading}
        showRaisedBy={false}
        showHeading={false}
      />
    </DrillPageShell>
  );
}

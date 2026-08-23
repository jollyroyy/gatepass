// `/admin-dashboard/:key` — the page ONE Overview figure opens, for the admin
// and the super admin alike (client, 2026-08-23: "instead of showing it on the
// same page in the dashboard, show it on a new page for all the KPI cards").
//
// ONE PAGE FOR BOTH BOARDS, because both boards are one derivation: `/admin-
// dashboard` renders the Overview mock-up and a super admin gets the guard-
// styled `SuperAdminDashboard`, but each reads `v_gate_passes` once and hands it
// to the SAME `buildOverviewCards`. So this page rebuilds that row the same way
// and renders the very array the pressed figure counted — no second query, no
// second predicate, and nothing carried across the navigation in router state
// (which a refresh or a shared link would lose).
//
// THE WINDOW RIDES ON THE URL. The figures are windowed and the board's chip is
// a real choice, so `?days=` is part of what the reader pressed. An absent or
// junk value falls back to the board's own default rather than showing a
// different window under the same title.
//
// AN UNKNOWN KEY GOES BACK TO THE BOARD. `:key` is user-typed and untrusted;
// Overdue Returns never reaches here — its card links to `/overdue`.
import React, { useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import DrillList from '../../components/DrillList';
import DrillPageShell from '../../components/DrillPageShell';
import { drillDefOf } from '../../lib/boardDrills';
import {
  buildOverviewCards, OVERVIEW_WINDOWS, rangeLabel, windowBounds,
} from '../../lib/adminOverview';

/** The board's own default window — what both dashboards open on, so a link
 *  that lost its parameter shows the same days the figure was counting. */
const DEFAULT_DAYS = 7;

/** The `?days=` value, graded against the very list the board's chip offers —
 *  never `Number(param)`, which would accept 3650 and draw a window no figure
 *  on the board can produce. */
function daysOf(raw: string | null): number {
  return OVERVIEW_WINDOWS.some((w) => w.value === raw) ? Number(raw) : DEFAULT_DAYS;
}

export default function DashboardDrill(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Stamped ONCE: the window boundary must not move under a reader who opened
  // this page a minute before midnight.
  const [stamp] = useState(() => Date.now());
  const days = daysOf(params.get('days'));

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await gp().from('v_gate_passes').select('*');
        if (res.error) throw res.error;
        if (!cancelled) setRows((res.data as GatePassView[] | null) ?? []);
      } catch (err) {
        if (!cancelled) setError(safeErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cards = useMemo(() => buildOverviewCards(rows, days, stamp), [rows, days, stamp]);
  const span = useMemo(() => rangeLabel(windowBounds(days, stamp)), [days, stamp]);
  const card = cards.find((c) => c.key === key);

  if (!loading && (!card || !card.drill)) return <Navigate to="/admin-dashboard" replace />;

  const drill = card?.drill;

  return (
    <DrillPageShell
      backTo="/admin-dashboard"
      backLabel="Back to dashboard"
      title={drill?.heading ?? 'Passes'}
      subtitle={span}
      count={loading ? undefined : drill?.rows.length ?? 0}
      error={error}
    >
      {/* `showHeading={false}`: the page title above IS the heading, with the
          count beside it. */}
      <DrillList
        def={drillDefOf(drill ?? { key: key ?? '', heading: '', empty: '', rows: [] })}
        rows={drill?.rows ?? []}
        loading={loading}
        showHeading={false}
      />
    </DrillPageShell>
  );
}

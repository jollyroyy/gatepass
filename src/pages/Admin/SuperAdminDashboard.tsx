// THE SUPER ADMIN'S DASHBOARD — the guard's board, carrying the admin's figures
// (client, 2026-08-20: "follow the same dashboard look and feel of guard except
// the functionalities … for superadmin dashboard").
//
// WHAT IS THE GUARD'S: the greeting and the date stamp, the two big tinted
// summary cards with their figures side by side, and the row of Quick Action
// tiles under them. Every class is a `.gb-*` from the same scoped, fixed-light
// island `GuardDashboard` is drawn in, so this page introduces NO colour of its
// own and `themeAudit` stays absolute.
//
// WHAT IS THE ADMIN'S: the numbers. This reads `v_gate_passes` ONCE, exactly as
// `AdminDashboard` does, and hands the rows to the SAME `buildOverviewCards` —
// so the five figures here and the five on `/admin-dashboard` are the same five
// counts and cannot drift. `superAdminGroups` only decides which card each one
// sits on; it counts nothing.
//
// THE BOARD INVARIANT SURVIVES THE RESTYLE. Pressing a figure opens the very
// rows it counted, in the stacked list underneath — no aggregate, no
// `count: 'exact'`, no predicate re-applied against a second array. The guard's
// figures are links to pages; these are buttons that drill in place, because
// the admin has no per-figure list pages and inventing five would be five more
// places for a filter to disagree with a count. See `SuperSummaryCards`.
//
// `gb-main` RIDES ALONGSIDE `gb-board`, exactly as it does on the admin
// Overview: `DrillList` and the pass cards under it are HOUSE components, and
// without it a dark card would land on this white ground for every reader on
// the shipped dark default.
//
// THE SECOND QUERY IS THE ONE THING THIS PAGE HAS THAT THE OVERVIEW DOES NOT —
// `fetchEmergencyReleases`, for the Quick Action tile's count. It is a super
// admin's own queue (055) and it is admin-gated in the database, so it is read
// here rather than folded into a shared hook every role would call.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import DrillList from '../../components/DrillList';
import SuperSummaryCards from '../../components/superadmin/SuperSummaryCards';
import SuperQuickActions from '../../components/superadmin/SuperQuickActions';
import { superAdminGroups, type SuperGroup } from '../../lib/superAdminBoard';
import { buildOverviewCards, OVERVIEW_WINDOWS, type OverviewWindow } from '../../lib/adminOverview';
import { drillDefOf, type BoardDrill } from '../../lib/boardDrills';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import { fetchEmergencyReleases } from '../../lib/emergencyRelease';
import { fetchMyProfile } from '../../lib/profiles';
import { firstNameOf } from '../../lib/guardBoard';
import { formatDateTime } from '../../lib/formatDate';

export default function SuperAdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [unreviewed, setUnreviewed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState<OverviewWindow>('7');
  const [drill, setDrill] = useState<(BoardDrill & { figureKey: string }) | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Stamped ONCE, at mount. A ticking clock would re-render two cards and a
  // stack every second for a boundary that moves at midnight.
  const [stamp] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared UP FRONT, never on the success path — a refresh resolving in the
    // same microtask queue as a failed action would otherwise wipe the banner
    // before it ever rendered.
    setError(null);
    try {
      const res = await gp().from('v_gate_passes').select('*');
      if (res.error) throw res.error;
      setRows((res.data as GatePassView[] | null) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The override queue's figure. It has NO error surface of its own on purpose:
  // a failed read here must not put a banner over a board whose five figures
  // loaded perfectly well, so the tile simply shows nothing.
  useEffect(() => {
    let cancelled = false;
    fetchEmergencyReleases()
      .then((list) => {
        if (!cancelled) setUnreviewed(list.filter((r) => !r.reviewed_at).length);
      })
      .catch(() => {
        /* the tile draws without a figure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The greeting only. A profile that never resolves leaves "Hello, Admin",
  // which is what the header said before anyone was named.
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (!cancelled) setName(p?.full_name ?? null);
      })
      .catch(() => {
        /* the greeting falls back */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const days = Number(window);
  const cards = useMemo(() => buildOverviewCards(rows, days, stamp), [rows, days, stamp]);
  const groups = useMemo(
    () => superAdminGroups(cards),
    [cards],
  );
  const drillRef = useScrollIntoViewOnChange<HTMLDivElement>(drill?.figureKey ?? null);

  const onDrill = (group: SuperGroup, index: number): void => {
    const figure = group.figures[index];
    // The Overdue figure has no list of its own — it is a `<Link>` to
    // `/overdue` and never reaches this handler.
    if (!figure.drill) return;
    const def = figure.drill;
    // Pressing the open figure closes it — the same toggle every drillable
    // board in this app uses.
    setDrill((cur) => (cur?.figureKey === figure.key ? null : { ...def, figureKey: figure.key }));
  };

  return (
    <div className="gb-board gb-main">
      <div className="gb-head-row">
        <div className="min-w-0">
          <h1 className="gb-hello">Hello, {firstNameOf(name, 'Admin')}</h1>
          <p className="gb-sub">Everything across the site — approvals, the register and the people who use it.</p>
        </div>
        <div className="gb-head-tools">
          <span className="gb-stamp">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
              <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
            </svg>
            {formatDateTime(new Date(stamp).toISOString())}
          </span>
          <label className="sr-only" htmlFor="super-window">Window</label>
          <select
            id="super-window"
            className="gb-select"
            value={window}
            onChange={(e) => {
              setWindow(e.target.value as OverviewWindow);
              // The open list was built from the old window and would go on
              // saying so under a figure that had changed underneath it.
              setDrill(null);
            }}
          >
            {OVERVIEW_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      <SuperSummaryCards
        groups={groups}
        openKey={drill?.figureKey ?? null}
        onDrill={onDrill}
        loading={loading}
      />

      {/* The list a pressed figure opens, brought into view: a reader who
          pressed a figure should not have to hunt for where the answer
          appeared. */}
      {drill && (
        <div ref={drillRef} className="mt-6" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} />
        </div>
      )}

      <SuperQuickActions unreviewed={unreviewed} loading={loading} />
    </div>
  );
}

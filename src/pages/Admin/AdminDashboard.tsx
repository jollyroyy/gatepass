// THE ADMIN DASHBOARD — the client's "Overview" mock-up, box for box
// (2026-08-19): a title and a date-range chip, the figures, a Gate Pass Trend,
// and a Passes by Status ring. Three cards are left of the mock's six — Total
// went on 2026-08-23, and both pending desks became sub-lines of RGP and NRGP
// the same day.
//
// IT IS NO LONGER `GateBoard`. The client asked for the whole page to be
// replaced ("remove whatever is there in the admin dashboard currently and
// replace those with the attached one"), so `src/components/board/*` and the
// libraries only it used are DELETED rather than flagged off — a stale reference
// is a build error, not a second admin board nobody notices. What went with it:
// the two KPI sections, the Daily Movement Trend, the RGP Status Breakdown, the
// Return Watch table, Top Items Today, the attention strip and the department
// column chart.
//
// KNOWN COSTS, FLAGGED TO THE CLIENT:
//   * THE DEPARTMENT COLUMN CHART is gone. No screen ranks departments now.
//   * THE RETURN WATCH TABLE is gone — the "due today / due in 7 / due later"
//     breakdown of open obligations. `/overdue` still lists the backlog itself,
//     and the Overdue Returns card here opens the same rows.
//   * TOP ITEMS TODAY is gone. Nothing ranks materials any more, which is why
//     this page no longer reads `v_gate_pass_items` at all — ONE query now.
//   * THE MISMATCH ATTENTION STRIP is gone; a flagged pass is inside the ring's
//     "Rejected" arc and in the register.
//
// THE BOARD INVARIANT SURVIVES. Every clickable figure — a card, an arc, a day
// on the trend — carries the very rows it counted on a `BoardDrill`, and the
// stacked list renders exactly that array: on `/admin-dashboard/<key>` for the
// three cards since 2026-08-23, and in place below for the trend and the ring.
// No aggregate query, no `count: 'exact'`, no predicate re-applied against a
// second array.
//
// THE SKIN IS THE MOCK-UP'S, NOT THE HOUSE THEME — the same `.gb-board`
// /`gb-main` island the guard's and the HOD's boards are. `gb-main` rides
// alongside so the one HOUSE component this page still renders (`DrillList` and
// the pass cards under it) takes its LIGHT half instead of the shipped dark
// default; without it a dark pass card would land on a white ground.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import DrillList from '../../components/DrillList';
import WaitingWith from '../../components/dashboard/WaitingWith';
import OverviewCards from '../../components/admin/OverviewCards';
import OverviewStatus, { sliceKey } from '../../components/admin/OverviewStatus';
import OverviewTrend, { dayKey } from '../../components/admin/OverviewTrend';
import { drillDefOf, type BoardDrill } from '../../lib/boardDrills';
import { useWaitingWith } from '../../lib/useWaitingWith';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import {
  buildOverviewCards,
  OVERVIEW_WINDOWS,
  rangeLabel,
  statusSlices,
  trendDays,
  windowBounds,
  type OverviewWindow,
} from '../../lib/adminOverview';

export default function AdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState<OverviewWindow>('7');
  const [drill, setDrill] = useState<BoardDrill | null>(null);
  // Stamped ONCE, at mount. A ticking clock would re-render five cards and two
  // charts every second for a boundary that moves at midnight.
  const [stamp] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared UP FRONT, never on the success path: a refresh that resolves in
    // the same microtask queue as a failed action would otherwise wipe the
    // banner before it ever rendered (the 2026-08-13 BlacklistTab bug).
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

  const days = Number(window);
  const cards = useMemo(() => buildOverviewCards(rows, days, stamp), [rows, days, stamp]);
  const trend = useMemo(() => trendDays(rows, days, stamp), [rows, days, stamp]);
  const slices = useMemo(() => statusSlices(rows, days, stamp), [rows, days, stamp]);
  const span = useMemo(() => rangeLabel(windowBounds(days, stamp)), [days, stamp]);
  // THE FOOT OF THE PAGE, AND IT IS EVERY PENDING PASS WHATEVER THE WINDOW SAYS
  // (client, 2026-08-21: "it should not be only the passes which were raised
  // today, but all the passes which are pending for all those approvals
  // accordingly"). It reads the SAME `rows` every figure above it does and
  // narrows them to the ones still waiting — so the window chip cannot move it,
  // and it agrees with the running pending desk lines on the cards above.
  const { waiting } = useWaitingWith(rows);

  // Toggling: pressing the thing already open closes it. Compared by `key`, not
  // by object identity — every render builds fresh drill objects.
  const select = useCallback((next: BoardDrill) => {
    setDrill((cur) => (cur?.key === next.key ? null : next));
  }, []);

  const activeKey = drill?.key ?? null;
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(activeKey);

  return (
    <div className="gb-board gb-main">
      <div className="gb-head-row">
        <h1 className="gb-hello">Overview</h1>
        {/* The mock draws a chevron here, and unlike the HOD board's date stamp
            this one earns it: the window is a real choice, and it governs the
            whole page. The trend card carries the SAME control bound to the
            SAME state, so the two can never disagree about what is on screen. */}
        <label className="gb-ov-range">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
            <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
          </svg>
          <span className="gb-ov-range-text">{span}</span>
          <select
            className="gb-ov-range-select"
            aria-label="Date range"
            value={window}
            onChange={(e) => setWindow(e.target.value as OverviewWindow)}
          >
            {OVERVIEW_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      {/* EVERY CARD IS A LINK now — `/admin-dashboard/<key>?days=N`, or
          `/overdue` (client, 2026-08-23). The trend and the ring below still
          drill IN PLACE: they are not KPI cards, and a bar or an arc has no
          stable key to put in a URL. */}
      <OverviewCards cards={cards} days={days} loading={loading} />

      {/* The drill panel sits directly under the figures rather than at the foot
          of the page: it is opened from anywhere on the board, and a reader who
          clicked an arc at the bottom should not have to hunt for where the
          answer appeared. `useScrollIntoViewOnChange` brings it into view. */}
      {drill && (
        <div ref={resultsRef} className="mt-6" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} />
        </div>
      )}

      <div className="gb-ov-panels">
        <section className="gb-card gb-ov-panel">
          <div className="gb-ov-panel-head">
            <h2 className="gb-ov-panel-title">Gate Pass Trend</h2>
            <select
              className="gb-select"
              aria-label="Trend window"
              value={window}
              onChange={(e) => setWindow(e.target.value as OverviewWindow)}
            >
              {OVERVIEW_WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>
          {loading ? (
            <div className="gb-ov-loading">Loading…</div>
          ) : (
            <OverviewTrend
              days={trend}
              activeKey={activeKey}
              onSelect={(d) => select({
                key: dayKey(d),
                heading: `Passes raised on ${d.label}`,
                empty: 'No pass was raised that day.',
                rows: d.rows,
              })}
            />
          )}
        </section>

        <section className="gb-card gb-ov-panel">
          <div className="gb-ov-panel-head">
            <h2 className="gb-ov-panel-title">Passes by Status</h2>
          </div>
          {loading ? (
            <div className="gb-ov-loading">Loading…</div>
          ) : (
            <OverviewStatus
              slices={slices}
              activeKey={activeKey}
              onSelect={(s) => select({
                key: sliceKey(s),
                heading: `${s.label} — passes in this window`,
                empty: 'Nothing in this bucket.',
                rows: s.rows,
              })}
            />
          )}
        </section>
      </div>

      <WaitingWith rows={waiting} scopeNote="all departments" />
    </div>
  );
}

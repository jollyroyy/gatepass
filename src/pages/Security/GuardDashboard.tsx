// The guard's Dashboard — TWO LISTS AND A GREETING (client mock-up, 2026-08-19).
//
// It was seven drill KPIs over a stack of pass cards; it is now the two things
// a person standing at a barrier acts on:
//
//   Pending OUT (Needs Approval)            — the gate queue, RGP and NRGP
//   Pending RGP Return (Needs Verification) — due back today, and every missed date
//
// The figures that went — today's raises, today's mismatches, today's closures —
// are not lost: they are the admin's board and Reports, which is where a
// whole-site count belongs. What a guard needs is the rows they will physically
// act on this shift, with the number sitting on top of the list it counts.
//
// IT IS NOT PAINTED IN THE HOUSE THEME. The client asked (2026-08-19) for this
// one screen to match their mock-up exactly — Inter headings in near-black,
// orange for the OUT queue, blue for the return queue, on a white ground — so
// every class below is a `.gb-*` from the scoped, fixed-light skin at the foot
// of src/index.css. Nothing else in the app uses those classes, and the gold
// heading ladder is untouched everywhere else.
//
// TWO QUERIES, AND EVERY FIGURE IS `rows.length` OF ONE OF THEM. No aggregate,
// no `count: 'exact'`, no second predicate: `src/lib/guardBoard.ts` filters the
// two arrays and the cards count what the panels render.
import React, { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import GuardPanel from '../../components/guard/GuardPanel';
import GuardSummaryCards from '../../components/guard/GuardSummaryCards';
import PendingOutTable from '../../components/guard/PendingOutTable';
import PendingReturnTable from '../../components/guard/PendingReturnTable';
import QuickActions from '../../components/guard/QuickActions';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/formatDate';
import { firstNameOf, pendingOutOf, pendingReturnsOf, previewOf, typeSplit } from '../../lib/guardBoard';
import { fetchMyProfile } from '../../lib/profiles';

export default function GuardDashboard(): React.ReactElement {
  const [queue, setQueue] = useState<GatePassView[]>([]);
  const [openReturns, setOpenReturns] = useState<GatePassView[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outExpanded, setOutExpanded] = useState(false);
  const [returnsExpanded, setReturnsExpanded] = useState(false);
  // Stamped once, at mount: a clock that ticks on a board nobody is watching
  // re-renders two tables every second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const base = () => gp().from('v_gate_passes').select('*');
      const nowIso = new Date().toISOString();
      const [queued, open] = await Promise.all([
        // The gate queue: both states the gate can still act on, and only while
        // the pass's own expiry has not passed. `is_expired` covers `pending`
        // alone; filtering `expires_at` covers both states uniformly and never
        // needs recomputing on the client.
        base()
          .in('status', ['pending', 'hod_reviewed'])
          .gte('expires_at', nowIso)
          .order('created_at', { ascending: true }),
        // BOTH open return states, unfiltered by date — `needsReturnVerification`
        // cuts it to what is due. `partially_returned` is not optional here: the
        // moment a guard records one line of a three-line RGP, an
        // `.eq('return_status','awaiting_return')` query would drop the pass off
        // this board with two lines still outside.
        base()
          .in('return_status', ['awaiting_return', 'partially_returned'])
          .order('expected_return_date', { ascending: true }),
      ]);

      for (const res of [queued, open]) {
        if (res.error) throw res.error;
      }

      setQueue((queued.data as GatePassView[] | null) ?? []);
      setOpenReturns((open.data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The greeting only. A profile that never resolves leaves "Hello, Guard",
  // which is what the board said before anyone was named — so this read has no
  // error surface of its own.
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (!cancelled) setName(p?.full_name ?? null);
      })
      .catch(() => {
        /* the greeting falls back to "Guard" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime: refresh silently so the numbers never flash a skeleton mid-shift.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('guard-dashboard-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          load(true);
        })
        .subscribe();
    } catch {
      // No realtime available — the initial load still populated the page.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [load]);

  const pendingOut = pendingOutOf(queue);
  const pendingReturns = pendingReturnsOf(openReturns);

  return (
    <div className="gb-board">
      <div className="gb-head-row">
        <div className="min-w-0">
          <h1 className="gb-hello">Hello, {firstNameOf(name)}</h1>
          <p className="gb-sub">
            Approve OUT for materials leaving and verify returns for RGP.
          </p>
        </div>
        <span className="gb-stamp">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
            <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
          </svg>
          {formatDateTime(stamp)}
        </span>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      <GuardSummaryCards
        split={typeSplit(pendingOut)}
        returnsDue={pendingReturns.length}
        loading={loading}
      />

      <div className="gb-grid-2">
        <GuardPanel
          title="Pending OUT (Needs Approval)"
          glyph="truck"
          tone="orange"
          total={pendingOut.length}
          expanded={outExpanded}
          onToggle={() => setOutExpanded((v) => !v)}
          loading={loading}
          empty="Queue clear — nothing is waiting at the gate."
        >
          <PendingOutTable rows={previewOf(pendingOut, outExpanded)} />
        </GuardPanel>

        <GuardPanel
          title="Pending RGP Return (Needs Verification)"
          glyph="exchange"
          tone="blue"
          total={pendingReturns.length}
          expanded={returnsExpanded}
          onToggle={() => setReturnsExpanded((v) => !v)}
          loading={loading}
          empty="Nothing is due back today, and nothing is late."
        >
          <PendingReturnTable rows={previewOf(pendingReturns, returnsExpanded)} />
        </GuardPanel>
      </div>

      <QuickActions />
    </div>
  );
}

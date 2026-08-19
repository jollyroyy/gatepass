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
// TWO QUERIES, AND EVERY FIGURE IS `rows.length` OF ONE OF THEM. No aggregate,
// no `count: 'exact'`, no second predicate: `src/lib/guardBoard.ts` filters the
// two arrays and the cards count what the panels render.
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  const outRef = useRef<HTMLDivElement>(null);
  const returnsRef = useRef<HTMLDivElement>(null);

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

  // `scrollIntoView` is absent in jsdom and on older mobile browsers; the
  // optional call is what keeps a chevron from throwing there.
  const scrollTo = (ref: React.RefObject<HTMLDivElement>): void => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Hello, {firstNameOf(name)} 👋</h1>
          <p className="page-subtitle">
            Clear material leaving the gate, and verify RGP material coming back.
          </p>
        </div>
        <span className="flex items-center gap-2 text-caption text-navy-500 tabular shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
            <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
          </svg>
          {formatDateTime(stamp)}
        </span>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <GuardSummaryCards
        split={typeSplit(pendingOut)}
        returnsDue={pendingReturns.length}
        loading={loading}
        onOpenOut={() => scrollTo(outRef)}
        onOpenReturns={() => scrollTo(returnsRef)}
      />

      <div className="grid gap-4 xl:grid-cols-2 mb-8">
        <div ref={outRef}>
          <GuardPanel
            title="Pending OUT (Needs Approval)"
            glyph="truck"
            tone="pending"
            total={pendingOut.length}
            expanded={outExpanded}
            onToggle={() => setOutExpanded((v) => !v)}
            loading={loading}
            empty="Queue clear — nothing is waiting at the gate."
          >
            <PendingOutTable rows={previewOf(pendingOut, outExpanded)} />
          </GuardPanel>
        </div>

        <div ref={returnsRef}>
          <GuardPanel
            title="Pending RGP Return (Needs Verification)"
            glyph="returned"
            tone="accent"
            total={pendingReturns.length}
            expanded={returnsExpanded}
            onToggle={() => setReturnsExpanded((v) => !v)}
            loading={loading}
            empty="Nothing is due back today, and nothing is late."
          >
            <PendingReturnTable rows={previewOf(pendingReturns, returnsExpanded)} />
          </GuardPanel>
        </div>
      </div>

      <QuickActions />
    </div>
  );
}

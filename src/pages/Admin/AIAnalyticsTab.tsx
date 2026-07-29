// AI-driven analytics — trend detection, anomaly flags, and operational metrics
// computed client-side from gate pass data. No ML pipeline; just statistical
// heuristics that surface patterns an admin would need a spreadsheet to see.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';

const DAYS = 30;

interface DailyBucket { date: string; total: number; pending: number; matched: number; flagged: number; }
interface DeptRow { name: string; total: number; flagged: number; flagRate: number; }
interface HourBucket { hour: string; count: number; pct: number; }
interface Insight { type: 'positive' | 'warning' | 'info'; title: string; description: string; }

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function dateKey(iso: string): string { return iso.slice(0, 10); }

function computeDaily(passes: GatePassView[]): DailyBucket[] {
  const map = new Map<string, DailyBucket>();
  for (const p of passes) {
    const key = dateKey(p.created_at);
    const b = map.get(key) ?? { date: key, total: 0, pending: 0, matched: 0, flagged: 0 };
    b.total++;
    if (p.status === 'pending') b.pending++;
    else if (p.status === 'matched') b.matched++;
    else if (p.status === 'flagged') b.flagged++;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function computeDepts(passes: GatePassView[]): DeptRow[] {
  const map = new Map<string, DeptRow>();
  for (const p of passes) {
    const name = p.department_name || 'Unknown';
    const r = map.get(name) ?? { name, total: 0, flagged: 0, flagRate: 0 };
    r.total++;
    if (p.status === 'flagged') r.flagged++;
    map.set(name, r);
  }
  return [...map.values()]
    .map((r) => ({ ...r, flagRate: r.total > 0 ? Math.round((r.flagged / r.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

function computeHours(passes: GatePassView[]): HourBucket[] {
  const counts = new Array(24).fill(0);
  for (const p of passes) {
    counts[new Date(p.created_at).getHours()]++;
  }
  const max = Math.max(...counts, 1);
  return counts.map((count, i) => ({
    hour: `${i.toString().padStart(2, '0')}:00`,
    count,
    pct: Math.round((count / max) * 100),
  }));
}

function computeInsights(passes: GatePassView[], depts: DeptRow[], hours: HourBucket[]): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();
  const DAY_MS = 86400000;

  const last7 = passes.filter((p) => new Date(p.created_at).getTime() >= now - 7 * DAY_MS).length;
  const prev7 = passes.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= now - 14 * DAY_MS && t < now - 7 * DAY_MS;
  }).length;

  if (prev7 > 0 || last7 > 0) {
    if (prev7 === 0) {
      insights.push({ type: 'info', title: `${last7} passes this week`, description: 'New activity detected — not enough prior data for trend comparison.' });
    } else {
      const change = Math.round(((last7 - prev7) / prev7) * 100);
      insights.push({
        type: change > 20 ? 'warning' : change > 0 ? 'info' : 'positive',
        title: change > 0 ? `Volume up ${change}% this week` : `Volume down ${Math.abs(change)}% this week`,
        description: change > 0 ? `${last7} passes vs ${prev7} — consider gate staffing.` : `${last7} passes vs ${prev7} — reduced gate traffic.`,
      });
    }
  }

  const resolvedCount = passes.filter((p) => p.status !== 'pending').length;
  const flaggedCount = passes.filter((p) => p.status === 'flagged').length;
  const flagRate = resolvedCount > 0 ? Math.round((flaggedCount / resolvedCount) * 100) : 0;

  if (resolvedCount > 0) {
    insights.push({
      type: flagRate > 15 ? 'warning' : 'positive',
      title: flagRate > 15 ? `Flag rate ${flagRate}% — above normal` : `Flag rate ${flagRate}% — within range`,
      description: flagRate > 15
        ? `${flaggedCount} of ${resolvedCount} resolved passes flagged. Review procedures.`
        : `No unusual flagging patterns detected across ${resolvedCount} resolved passes.`,
    });
  }

  const peak = hours.reduce((best, h) => (h.count > best.count ? h : best), { hour: '', count: 0, pct: 0 });
  if (peak.count > 0) {
    insights.push({
      type: 'info',
      title: `Peak at ${peak.hour} (${peak.count} passes)`,
      description: `Schedule guard shifts to cover the ${peak.hour} window.`,
    });
  }

  if (depts.length > 0) {
    const worst = depts.reduce((a, b) => (a.flagRate > b.flagRate ? a : b));
    if (worst.flagRate > 20) {
      insights.push({
        type: 'warning',
        title: `${worst.name} highest flag rate (${worst.flagRate}%)`,
        description: `Consider a process review for ${worst.name}.`,
      });
    }
  }

  const rgp = passes.filter((p) => p.type === 'RGP');
  const returned = rgp.filter((p) => p.return_status === 'returned').length;
  if (rgp.length > 0) {
    const retRate = Math.round((returned / rgp.length) * 100);
    insights.push({
      type: retRate < 60 ? 'warning' : retRate < 90 ? 'info' : 'positive',
      title: `RGP return rate: ${retRate}%`,
      description: `${returned} of ${rgp.length} returnable passes returned.`,
    });
  }

  return insights;
}

// ─── Mini bar ────────────────────────────────────────────────────────────────

function MiniBar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-navy-400 w-10 text-right tabular shrink-0">{label}</span>}
      <div className="flex-1 h-4 bg-surface-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-navy-600 w-6 text-right tabular shrink-0">{value}</span>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div>
      <div className="page-header"><div className="skeleton h-8 w-48 mb-2" /><div className="skeleton h-4 w-72" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full rounded-xl" />)}
      </div>
      <div className="card p-5 mb-6"><div className="skeleton h-4 w-40 mb-4" />{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-5 w-full mb-2" />)}</div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function AIAnalyticsTab(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passes, setPasses] = useState<GatePassView[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - DAYS * 86400000).toISOString();
      const { data, error: err } = await gp()
        .from('v_gate_passes')
        .select('created_at, status, type, direction, return_status, department_name')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      if (err) throw err;
      setPasses((data as GatePassView[]) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const daily = useMemo(() => computeDaily(passes), [passes]);
  const depts = useMemo(() => computeDepts(passes), [passes]);
  const hours = useMemo(() => computeHours(passes), [passes]);
  const insights = useMemo(() => computeInsights(passes, depts, hours), [passes, depts, hours]);
  const maxDaily = useMemo(() => Math.max(...daily.map((d) => d.total), 1), [daily]);
  const maxDept = useMemo(() => Math.max(...depts.map((d) => d.total), 1), [depts]);
  const peakHourMax = useMemo(() => Math.max(...hours.map((h) => h.count), 1), [hours]);

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">AI Analytics</h1>
        <p className="page-subtitle">
          Insights and trends from {passes.length} passes over the last {DAYS} days
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {passes.length === 0 && !error ? (
        <div className="empty-state">
          <p className="text-base font-semibold text-navy-500 mb-1">No data yet</p>
          <p className="text-sm">Passes raised in the last {DAYS} days will appear here.</p>
        </div>
      ) : (
        <>
          {/* ── Insight cards ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
            {insights.map((ins, i) => {
              const colorMap = {
                warning: { border: 'border-l-flagged-500', bg: 'bg-flagged-50/30', label: 'text-flagged-600', tag: 'Anomaly' },
                positive: { border: 'border-l-matched-500', bg: 'bg-matched-50/30', label: 'text-matched-600', tag: 'On Track' },
                info: { border: 'border-l-brand-500', bg: 'bg-brand-50/30', label: 'text-brand-600', tag: 'Insight' },
              };
              const c = colorMap[ins.type];
              return (
                <div key={i} className={`card p-4 border-l-4 ${c.border} ${c.bg}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${c.label}`}>{c.tag}</span>
                  <p className="text-sm font-semibold text-navy-900 mt-1">{ins.title}</p>
                  <p className="text-xs text-navy-500 mt-0.5">{ins.description}</p>
                </div>
              );
            })}
          </div>

          {/* ── Section: Daily trend ────────────────────────────────────── */}
          <div className="card p-5 mb-6">
            <h2 className="section-title mb-4">Daily Throughput (Last {DAYS} Days)</h2>
            <div className="flex flex-col gap-1">
              {daily.map((d) => {
                const wPending = maxDaily > 0 ? (d.pending / maxDaily) * 100 : 0;
                const wMatched = maxDaily > 0 ? (d.matched / maxDaily) * 100 : 0;
                const wFlagged = maxDaily > 0 ? (d.flagged / maxDaily) * 100 : 0;
                return (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="text-navy-400 w-20 shrink-0 tabular">{d.date.slice(5)}</span>
                    <div className="flex-1 h-5 bg-surface-100 rounded-full overflow-hidden flex">
                      {d.pending > 0 && <div className="h-full bg-pending-400 transition-all duration-500" style={{ width: `${wPending}%` }} title={`${d.pending} pending`} />}
                      {d.matched > 0 && <div className="h-full bg-matched-500 transition-all duration-500" style={{ width: `${wMatched}%` }} title={`${d.matched} matched`} />}
                      {d.flagged > 0 && <div className="h-full bg-flagged-500 transition-all duration-500" style={{ width: `${wFlagged}%` }} title={`${d.flagged} flagged`} />}
                    </div>
                    <span className="text-navy-600 w-6 text-right tabular shrink-0">{d.total}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-navy-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-pending-400" /> Pending</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-matched-500" /> Matched</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-flagged-500" /> Mismatched</span>
            </div>
          </div>

          {/* ── Two-column section ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="card p-5">
              <h2 className="section-title mb-4">Department Activity</h2>
              {depts.length === 0 ? (
                <div className="empty-state py-8">No department data available.</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {depts.map((d) => (
                    <div key={d.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-navy-700">{d.name}</span>
                        <span className="text-navy-400 tabular">{d.total} passes · {d.flagRate}% mismatched</span>
                      </div>
                      <MiniBar
                        value={d.total}
                        max={maxDept}
                        color={d.flagRate > 20 ? 'bg-flagged-500' : d.flagRate > 10 ? 'bg-pending-400' : 'bg-brand-500'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <h2 className="section-title mb-4">Peak Hours</h2>
              {hours.every((h) => h.count === 0) ? (
                <div className="empty-state py-8">No hourly data.</div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
                  {hours.filter((h) => h.count > 0).map((h) => (
                    <MiniBar key={h.hour} value={h.count} max={peakHourMax} label={h.hour} color="bg-accent-500" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

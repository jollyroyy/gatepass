// "Scheduled returns" — what the Awaiting Return drill opens. It loads the
// MATERIAL LINES of the passes the drill counted and lists them one per row,
// because a guard at the barrier is handed items, not passes.
//
// NOTHING IS SAVED BY A TAP. "Mark returned" only ticks the row; the guard
// presses Record for it to reach the database. That is the settled rule for
// every return control in this app (see ItemReturnList) and it is not a style
// choice: `apply_item_returns` has no undo — `returned_qty` only ever grows and
// `returned_at` is written through `coalesce` — so a one-tap commit at a gate
// is a mistake nobody can take back.
//
// THE PASS CLOSES ITSELF. The RPC rolls the lines up in the same statement, so
// after Record this component re-reads and tells the dashboard to re-read too;
// it never decides "all lines are back" on its own.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { buildScheduledReturns, pageOf } from '../../lib/scheduledReturns';
import { returnProgress } from '../../lib/passRecordView';
import ScheduledReturnsTable from './ScheduledReturnsTable';

/** The mock-up's page size, and roughly what fits above the fold on the tablet
 *  at the gate. */
const PAGE_SIZE = 5;

type Props = {
  /** The drill's passes — this component never decides which are in scope. */
  passes: GatePassView[];
  /** A return landed; the dashboard must re-read, since the database may have
   *  just closed a pass. */
  onRecorded: () => void;
};

export default function ScheduledReturns({ passes, onRecorded }: Props): React.ReactElement {
  const [items, setItems] = useState<GatePassItemView[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ids = passes.map((p) => p.id).join(',');

  const load = useCallback(async () => {
    const passIds = ids ? ids.split(',') : [];
    if (passIds.length === 0) {
      setItems([]);
      return;
    }
    try {
      const { data, error: err } = await gp()
        .from('v_gate_pass_items')
        .select('*')
        .in('gate_pass_id', passIds)
        .order('line_no');
      if (err) throw err;
      setItems((data ?? []) as GatePassItemView[]);
      // Driven by the database's answer from here on, never by the old ticks.
      setPicked(new Set());
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
      setItems([]);
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => buildScheduledReturns(passes, items ?? []), [passes, items]);
  const progress = returnProgress(rows.map((r) => r.item), 'RGP');
  const view = pageOf(rows, page, PAGE_SIZE);
  const chosen = rows.filter((r) => picked.has(r.item.id));

  function toggle(itemId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function record() {
    setBusy(true);
    setError(null);
    try {
      // One call per pass: `apply_item_returns` takes a pass and its own lines,
      // and a drill's ticks can span several passes.
      const byPass = new Map<string, typeof chosen>();
      for (const row of chosen) {
        byPass.set(row.pass.id, [...(byPass.get(row.pass.id) ?? []), row]);
      }
      for (const [passId, lines] of byPass) {
        const { error: err } = await gp().rpc('apply_item_returns', {
          p_pass_id: passId,
          p_lines: lines.map((l) => ({ item_id: l.item.id, qty: l.item.outstanding_qty })),
          p_remarks: `Returned ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}: ${lines
            .map((l) => `#${l.item.line_no} ${l.item.name}`)
            .join(', ')}`,
        });
        if (err) throw err;
      }
      await load();
      onRecorded();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return <div className="skeleton h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="alert-error">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title mb-0">Scheduled returns</h2>
        {progress.total > 0 && (
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-navy-500 whitespace-nowrap">
              <span className="font-semibold text-matched-600 tabular">{progress.returned}</span> of{' '}
              {progress.total} returned
            </span>
            <span className="h-2 w-32 sm:w-48 rounded-full bg-surface-200 overflow-hidden">
              <span className="block h-full rounded-full bg-matched-500" style={{ width: `${progress.percent}%` }} />
            </span>
            <span className="text-sm font-semibold text-navy-900 tabular">{progress.percent}%</span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card empty-state">
          <p>Nothing is expected back today.</p>
        </div>
      ) : (
        <>
          <ScheduledReturnsTable
            page={view}
            units={rows.map((r) => r.item.unit)}
            picked={picked}
            onToggle={toggle}
            onPage={setPage}
            busy={busy}
          />

          {/* Appears only once something is ticked — the commit step the tap
              deliberately is not. */}
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 card px-5 py-3">
              <p className="text-sm text-navy-700">
                <span className="font-semibold">{chosen.length}</span>{' '}
                {chosen.length === 1 ? 'line' : 'lines'} marked returned — not saved yet. A recorded
                return cannot be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setPicked(new Set())} disabled={busy}>
                  Clear
                </button>
                <button type="button" data-testid="record-scheduled-returns" className="btn-primary" onClick={() => void record()} disabled={busy}>
                  {busy ? 'Recording…' : `Record ${chosen.length} ${chosen.length === 1 ? 'return' : 'returns'}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

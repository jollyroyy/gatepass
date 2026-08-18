// "Scheduled returns" — the material lines expected back, one row per LINE,
// because whoever is at the barrier is handed items, not passes.
//
// SHARED BY THREE ROLES (2026-08-18). It began as the guard dashboard's
// Awaiting Return drill; the drill is now a link to `/returns`, and this renders
// that page for the guard, the HOD and the admin alike. Only the rows differ —
// scope is the page's, never this component's — and only the gate can record.
//
// NOTHING IS SAVED BY A TAP. "Mark returned" only ticks the row; Record is what
// reaches the database. That is the settled rule for every return control in
// this app and it is not a style choice: `apply_item_returns` has no undo —
// `returned_qty` only ever grows and `returned_at` is written through
// `coalesce` — so a one-tap commit at a gate is a mistake nobody can take back.
//
// THE PASS CLOSES ITSELF. The RPC rolls the lines up in the same statement, so
// after Record this asks its page to re-read; it never decides "all lines are
// back" on its own.
import React, { useMemo, useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { buildScheduledReturns, pageOf } from '../../lib/scheduledReturns';
import { returnProgress } from '../../lib/passRecordView';
import { recordItemReturns } from '../../lib/recordReturns';
import ScheduledReturnsTable from './ScheduledReturnsTable';

/** The mock-up's page size, and roughly what fits above the fold on the tablet
 *  at the gate. */
const PAGE_SIZE = 5;

type Props = {
  /** The passes in scope — this component never decides which those are. */
  passes: GatePassView[];
  /** Their lines. A line whose parent is not in `passes` is dropped by
   *  `buildScheduledReturns`, so nothing can widen here. */
  items: GatePassItemView[];
  /** Only the gate records a return; `apply_item_returns` refuses anyone else. */
  canRecord: boolean;
  /** A return landed; the page must re-read, since the database may have just
   *  closed a pass. */
  onRecorded: () => void;
  /** Shown instead of the table when there is nothing in scope. */
  empty: string;
};

export default function ScheduledReturns({
  passes, items, canRecord, onRecorded, empty,
}: Props): React.ReactElement {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => buildScheduledReturns(passes, items), [passes, items]);
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
      await recordItemReturns(chosen);
      // Driven by the database's answer from here on, never by the old ticks.
      setPicked(new Set());
      onRecorded();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
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
          <p>{empty}</p>
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
            readOnly={!canRecord}
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

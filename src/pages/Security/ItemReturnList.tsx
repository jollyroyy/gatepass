// Line-by-line returns at the gate — a tick box per item, then one Record.
//
// A trolley goes out with a drill, two ladders and a coil of cable; they do not
// come back together. The only return action a guard could once reach was Mark
// Returned, which closes every line at once — so a partial return had to be
// recorded as a lie in one direction or the other.
//
// `apply_item_returns` has taken [{item_id, qty}] since migration 013 and had
// no caller until 029, which also added `returned_at`, stamped per line.
//
// WHY TICK BOXES AND NOT A PER-LINE BUTTON (2026-08-17, client's call): the old
// button committed the instant it was pressed. There is NO UNDO in the database
// — `apply_item_returns` only ever adds to `returned_qty` (a qty <= 0 is skipped
// outright) and `returned_at` is written through `coalesce`, so it can never be
// moved once set. At a barrier, one-tap-is-final is the wrong shape. A tick is a
// decision the guard can take back right up until they press Record.
//
// A line ALREADY recorded shows a checked, DISABLED box for the same reason:
// un-ticking it would have to decrement a quantity and clear a stamp that no RPC
// touches, and a control that always failed is worse than no control.
//
// THE PASS CLOSES ITSELF. `apply_item_returns` rolls the lines up in the same
// statement that moves the quantities, so when the last outstanding line lands
// the parent becomes `returned` in the database. This component never decides
// that — it re-reads it. Never compute "all items are back" here and act on it.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassItemView } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import ItemOrdinal from '../../components/ItemOrdinal';

type Props = {
  passId: string;
  /** Called after a return is recorded, so the caller can re-read the pass —
   *  including a `return_status` the database may just have closed. */
  onReturned: () => void;
};

export default function ItemReturnList({ passId, onReturned }: Props): React.ReactElement {
  const [items, setItems] = useState<GatePassItemView[] | null>(null);
  // Ticked but NOT yet recorded. Cleared on every re-read, because after a
  // successful Record those lines come back from the view as genuinely returned
  // and must be driven by the database's answer, not by this set.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await gp()
        .from('v_gate_pass_items')
        .select('*')
        .eq('gate_pass_id', passId)
        .order('line_no');
      if (err) throw err;
      setItems((data ?? []) as GatePassItemView[]);
      setPicked(new Set());
    } catch (err) {
      setError(safeErrorMessage(err));
      setItems([]);
    }
  }, [passId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function record(lines: GatePassItemView[]) {
    setBusy(true);
    setError(null);
    try {
      // Only the ticked lines, and only what each still owes. Sending a computed
      // total across lines is how one guard's tap closes material they never saw.
      const { error: err } = await gp().rpc('apply_item_returns', {
        p_pass_id: passId,
        p_lines: lines.map((i) => ({ item_id: i.id, qty: i.outstanding_qty })),
        p_remarks: `Returned ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}: ${lines
          .map((i) => `#${i.line_no} ${i.name}`)
          .join(', ')}`,
      });
      if (err) throw err;
      await load();
      onReturned();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return <div className="skeleton h-20 rounded-xl" />;
  }

  const open = items.filter((i) => i.outstanding_qty > 0);
  const chosen = open.filter((i) => picked.has(i.id));

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs font-semibold text-flagged-600">{error}</p>}

      {items.length === 0 && (
        <p className="text-sm text-navy-500">No material lines on this pass.</p>
      )}

      {items.map((item, i) => {
        const done = item.outstanding_qty <= 0;
        const ticked = done || picked.has(item.id);
        return (
          <label
            key={item.id}
            htmlFor={`tick-${item.id}`}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors duration-150 ${
              done
                ? 'border-matched-500/30 bg-matched-500/5'
                : ticked
                  ? 'border-matched-500/40 bg-matched-500/10 cursor-pointer'
                  : 'border-surface-200/60 bg-surface-50/40 cursor-pointer hover:border-surface-300'
            }`}
          >
            <input
              id={`tick-${item.id}`}
              type="checkbox"
              data-testid={`tick-item-${item.id}`}
              checked={ticked}
              // Already recorded: there is no undo in the database, so the box
              // reports the fact rather than offering to change it.
              disabled={done || busy}
              onChange={() => toggle(item.id)}
              aria-label={
                done
                  ? `${item.name} — already returned`
                  : `Mark ${item.name} returned`
              }
              className="h-5 w-5 shrink-0 accent-matched-600 cursor-pointer disabled:cursor-default"
            />

            <div className="min-w-0 flex-1 flex items-center gap-2.5">
              <ItemOrdinal index={i + 1} total={items.length} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900 truncate">{item.name}</p>
                <p className="text-xs text-navy-500">
                  {done
                    ? `${item.quantity} ${item.unit} · returned`
                    : `${item.outstanding_qty} of ${item.quantity} ${item.unit} still out`}
                </p>
                {/* Date AND time: two returns on the same day are otherwise
                    indistinguishable in the record. */}
                {done && item.returned_at && (
                  <p
                    data-testid={`returned-at-${item.id}`}
                    className="text-xs font-medium text-matched-700 mt-0.5"
                  >
                    Returned {formatDateTime(item.returned_at)}
                  </p>
                )}
              </div>
            </div>

            {/* Three distinct words, never two: "Returned" is a fact in the
                database, "Marked returned" is only this guard's unsaved tick,
                and "Pending" is neither. Collapsing the middle one into
                "Returned" would show a line as closed before anything was. */}
            <span
              data-testid={`item-state-${item.id}`}
              className={`text-[10px] font-bold uppercase tracking-wider shrink-0 text-right ${
                done ? 'text-matched-600' : ticked ? 'text-matched-700' : 'text-navy-500'
              }`}
            >
              {done ? '✓ Returned' : ticked ? 'Marked returned' : 'Pending'}
            </span>
          </label>
        );
      })}

      {open.length > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            data-testid="tick-all"
            className="text-xs font-semibold text-accent-600 hover:underline"
            // Ticks only what is still out — a line already back is not this
            // control's to touch.
            onClick={() =>
              setPicked((prev) =>
                open.every((i) => prev.has(i.id)) ? new Set() : new Set(open.map((i) => i.id)),
              )
            }
            disabled={busy}
          >
            {open.every((i) => picked.has(i.id)) ? 'Clear all' : 'Tick all still out'}
          </button>

          <button
            type="button"
            data-testid="record-returns"
            className="btn-secondary text-xs px-3 py-1.5"
            onClick={() => void record(chosen)}
            disabled={busy || chosen.length === 0}
          >
            {busy
              ? 'Recording…'
              : `Record ${chosen.length || ''} ${chosen.length === 1 ? 'return' : 'returns'}`.replace(/\s+/g, ' ')}
          </button>
        </div>
      )}
    </div>
  );
}

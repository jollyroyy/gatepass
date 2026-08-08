// Line-by-line returns at the gate.
//
// A trolley goes out with a drill, two ladders and a coil of cable; they do not
// come back together. The only return action a guard could previously reach was
// Mark Returned, which closes every line at once — so a partial return had to
// be recorded as a lie in one direction or the other.
//
// `apply_item_returns` has taken [{item_id, qty}] since migration 013 and had
// no caller until now. 029 added `returned_at`, stamped per line as it closes.
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

type Props = {
  passId: string;
  /** Called after a line is recorded, so the caller can re-read the pass —
   *  including a `return_status` the database may just have closed. */
  onReturned: () => void;
};

export default function ItemReturnList({ passId, onReturned }: Props): React.ReactElement {
  const [items, setItems] = useState<GatePassItemView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
    } catch (err) {
      setError(safeErrorMessage(err));
      setItems([]);
    }
  }, [passId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function returnLine(item: GatePassItemView) {
    setBusyId(item.id);
    setError(null);
    try {
      // Only this line, and only what it still owes. Sending a computed total
      // across lines is how one guard's tap closes material they never saw.
      const { error: err } = await gp().rpc('apply_item_returns', {
        p_pass_id: passId,
        p_lines: [{ item_id: item.id, qty: item.outstanding_qty }],
        p_remarks: `Returned line ${item.line_no}: ${item.name}`,
      });
      if (err) throw err;
      await load();
      onReturned();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) {
    return <div className="skeleton h-20 rounded-xl" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs font-semibold text-flagged-600">{error}</p>}

      {items.length === 0 && (
        <p className="text-sm text-navy-500">No material lines on this pass.</p>
      )}

      {items.map((item) => {
        const done = item.outstanding_qty <= 0;
        return (
          <div
            key={item.id}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border ${
              done
                ? 'border-matched-500/30 bg-matched-500/5'
                : 'border-surface-200/60 bg-surface-50/40'
            }`}
          >
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

            {done ? (
              <span className="text-xs font-bold uppercase tracking-wider text-matched-600 shrink-0">
                ✓ Back
              </span>
            ) : (
              <button
                type="button"
                data-testid={`return-item-${item.id}`}
                className="btn-secondary shrink-0 text-xs px-3 py-1.5"
                onClick={() => void returnLine(item)}
                disabled={busyId !== null}
              >
                {busyId === item.id ? 'Recording…' : 'Mark Returned'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

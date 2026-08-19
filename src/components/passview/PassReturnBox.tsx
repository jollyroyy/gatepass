// "Add Return (Steel Rods)" for ONE material line, on the gate pass record.
//
// The same box the guard's return queue uses (`guard/AddReturnBox.tsx`) and the
// same rules, drawn in the HOUSE theme instead of the fixed-light `.gb-*` skin:
// this record renders on every role's dark or light surface, and the guard skin
// has no `dark:` half by design. The logic is shared — `checkReturnQty` is the
// one place a quantity is judged — but the markup cannot be.
//
// IT IS A SIDE BOX, NOT A MODAL: the row stays readable underneath while the
// figure is typed, nothing behind it is disabled, and closing it is Cancel or
// Escape.
//
// "CONFIRM RETURN" DOES NOT REACH THE DATABASE. It stages the line; the Record
// bar at the foot of the table is the commit. `apply_item_returns` has no undo,
// so a tap must never be irreversible.
//
// THE INPUT CARRIES NO `min`/`max` ON PURPOSE — the browser would block
// submission with its own native tooltip and this app's message would never be
// reached, putting the rule in two places.
import React, { useEffect, useRef, useState } from 'react';
import type { GatePassItemView } from '../../types';
import { checkReturnQty, formatQty, type DraftLine } from '../../lib/returnDraft';
import { unitLabel } from '../../lib/units';
import { useEscapeKey } from '../../lib/useEscapeKey';

type Props = {
  item: GatePassItemView;
  /** Already recorded PLUS anything staged on other visits to this box. */
  alreadyReturned: number;
  /** What this line can still take — the ceiling on the entry. */
  outstanding: number;
  existing?: DraftLine;
  onConfirm: (line: DraftLine) => void;
  onCancel: () => void;
};

export default function PassReturnBox({
  item, alreadyReturned, outstanding, existing, onConfirm, onCancel,
}: Props): React.ReactElement {
  const [qty, setQty] = useState(existing ? String(existing.qty) : '');
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [error, setError] = useState<string | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEscapeKey(onCancel);

  // The box exists to take one number — put the cursor in it.
  useEffect(() => {
    qtyRef.current?.focus();
  }, []);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const checked = checkReturnQty(qty, outstanding);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    onConfirm({ qty: checked.qty, remarks });
  }

  const unit = unitLabel(item.unit);

  return (
    <form
      className="card p-4 fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] shadow-xl"
      onSubmit={submit}
      role="dialog"
      aria-label={`Add Return (${item.name})`}
    >
      <h3 className="card-title mb-1">Add Return ({item.name})</h3>
      <p className="text-xs text-navy-500 mb-3">
        Expected: {formatQty(item.quantity)} {unit} · Already Returned: {formatQty(alreadyReturned)} {unit}
      </p>

      <label className="label" htmlFor="pass-return-qty">Return Now*</label>
      <div className="flex items-stretch gap-2">
        <input
          id="pass-return-qty"
          ref={qtyRef}
          className="input"
          type="number"
          inputMode="decimal"
          step="any"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setError(null);
          }}
          placeholder={formatQty(outstanding)}
        />
        {/* The unit is stated, never chosen: a line's unit is what the pass was
          * raised with, and letting the gate change it would make the returned
          * quantity and the issued quantity two different things. */}
        <span className="flex items-center px-3 rounded-lg bg-surface-200 text-sm font-semibold text-navy-700 whitespace-nowrap">
          {unit}
        </span>
      </div>
      {error && <p className="field-error">{error}</p>}

      <label className="label mt-3" htmlFor="pass-return-remarks">Remarks (optional)</label>
      <input
        id="pass-return-remarks"
        className="input"
        type="text"
        maxLength={200}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="e.g., returned today"
      />

      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">Confirm Return</button>
      </div>
    </form>
  );
}

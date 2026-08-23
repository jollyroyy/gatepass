// "Add Return (Steel Rods)" — the small box a guard fills in for ONE material
// line, fixed to the bottom-right corner of the screen (client mock-up,
// 2026-08-19).
//
// IT IS A SIDE BOX, NOT A MODAL, and that is the client's own call: a guard
// reads the line's row while typing the figure into it, so the table must stay
// visible and usable underneath. Nothing behind it is disabled, and there is no
// overlay — closing it is Cancel or Escape.
//
// PRESSING "Confirm Return" DOES NOT REACH THE DATABASE. It stages the line on
// the open pass; the Record bar at the foot of that pass is the commit, because
// `apply_item_returns` has no undo and a screen where a tap is irreversible is
// the wrong screen to stand at a barrier with. The two words are the mock's.
//
// THE CEILING IS THE LINE'S OUTSTANDING QUANTITY, checked here by
// `checkReturnQty` — the same rule the database enforces, so a guard is told
// "only 250 is still outstanding" before the press rather than by an exception
// after it. The input deliberately carries NO `min`/`max` attribute: a browser
// would then block submission with its own native tooltip and this message
// would never be reached, so the rule would live in two places and the guard
// would read whichever one fired first.
import React, { useEffect, useRef, useState } from 'react';
import type { GatePassItemView } from '../../types';
import { checkReturnQty, formatQty, type DraftLine } from '../../lib/returnDraft';
import { isWholeUnit, unitLabel } from '../../lib/units';
import { useEscapeKey } from '../../lib/useEscapeKey';

type Props = {
  item: GatePassItemView;
  /** Already recorded PLUS anything staged on other visits to this box. */
  alreadyReturned: number;
  /** What this line can still take — the ceiling on the entry. */
  outstanding: number;
  /** The staged line being corrected, if the guard is re-opening one. */
  existing?: DraftLine;
  onConfirm: (line: DraftLine) => void;
  onCancel: () => void;
};

export default function AddReturnBox({
  item,
  alreadyReturned,
  outstanding,
  existing,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  const [qty, setQty] = useState(existing ? String(existing.qty) : '');
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [error, setError] = useState<string | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEscapeKey(onCancel);

  // The box exists to take one number — put the cursor in it. A guard has one
  // free hand and a truck waiting.
  useEffect(() => {
    qtyRef.current?.focus();
  }, []);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const checked = checkReturnQty(qty, outstanding, item.unit);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    onConfirm({ qty: checked.qty, remarks });
  }

  const unit = unitLabel(item.unit);
  // A counted unit takes no fraction, so the keypad is the numeric one. `step`
  // stays "any" even then: `step="1"` would make the BROWSER refuse the submit
  // with its own tooltip and this app's message — which names the two whole
  // numbers either side — would never be reached.
  const whole = isWholeUnit(item.unit);

  return (
    <form
      className="gb-returnbox"
      onSubmit={submit}
      role="dialog"
      aria-label={`Add Return (${item.name})`}
    >
      <div className="gb-returnbox-title">Add Return ({item.name})</div>
      {/* MAKE / MODEL / BRAND (client, 2026-08-23) — the box names one item and
          the guard is holding the thing itself; the model number is what
          confirms they opened the right line. Absent on every line raised
          before migration 045, and then simply not drawn. */}
      {item.make_model && <div className="gb-returnbox-note">{item.make_model}</div>}
      <div className="gb-returnbox-note">
        Expected: {formatQty(item.quantity)} {unit} · Already Returned:{' '}
        {formatQty(alreadyReturned)} {unit}
      </div>

      <div className="gb-field">
        <label className="gb-field-label" htmlFor="gb-return-qty">
          Return Now*
        </label>
        <div className="gb-qty-row">
          <input
            id="gb-return-qty"
            ref={qtyRef}
            className="gb-input"
            type="number"
            inputMode={whole ? 'numeric' : 'decimal'}
            step="any"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setError(null);
            }}
            placeholder={formatQty(outstanding)}
          />
          {/* The unit is stated, never chosen: a line's unit is what the pass
            * was raised with, and letting the gate change it would make the
            * returned quantity and the issued quantity two different things. */}
          <span className="gb-unit-box">{unit}</span>
        </div>
        {error && <p className="gb-field-error">{error}</p>}
      </div>

      <div className="gb-field">
        <label className="gb-field-label" htmlFor="gb-return-remarks">
          Remarks (optional)
        </label>
        <input
          id="gb-return-remarks"
          className="gb-input"
          type="text"
          maxLength={200}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g., returned today"
        />
      </div>

      <div className="gb-returnbox-foot">
        <button type="button" className="gb-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="gb-btn-primary">
          Confirm Return
        </button>
      </div>
    </form>
  );
}

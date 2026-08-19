// One row of the Pending Approvals table, and the panel its chevron opens
// (client mock-up, 2026-08-19, migration 046).
//
// APPROVING WITHOUT SEEING WHAT IS ON THE PASS IS A SIGNATURE ON A BLANK
// PAGE — the chevron opens the pass's own material lines, its vehicle number
// and its expected return date, loaded on demand exactly the way Pending
// OUT's row does (`usePassItems`, one row open at a time).
//
// Approve is a single press; Reject opens `RejectApprovalModal`. Both are
// disabled while THIS row's own call is in flight, so a second press cannot
// fire a second RPC for the same pass.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { formatCurrency } from '../../lib/formatCurrency';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import { safeErrorMessage } from '../../lib/errors';
import { unitLabel } from '../../lib/units';
import { usePassItems } from '../../lib/usePassItems';

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Every cell in the row, chevron and actions included, so the detail row
 *  spans the whole table rather than leaving a ragged edge. */
export const APPROVAL_ROW_COLUMNS = 8;

type Props = {
  pass: GatePassView;
  open: boolean;
  onToggle: () => void;
  onApprove: (id: string) => Promise<void>;
  /** Opens the reject modal, rendered by the TABLE rather than by this row —
   *  a `<tr>` inside `<tbody>` cannot host a modal's own markup without
   *  producing invalid DOM nesting (a `<div>` child of `<tbody>`). */
  onRequestReject: () => void;
};

export default function PendingApprovalRow({
  pass,
  open,
  onToggle,
  onApprove,
  onRequestReject,
}: Props): React.ReactElement {
  const { items, error: itemsError } = usePassItems(open ? pass.id : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await onApprove(pass.id);
    } catch (err) {
      setActionError(safeErrorMessage(err, 'Could not approve that request.'));
      setBusy(false);
    }
    // No `finally` clearing `busy` on success: the parent re-reads the whole
    // list, and this row's pass usually leaves it entirely — a `setBusy(false)`
    // after that would run on an unmounted row.
  }

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="gb-expand"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? `Hide items in ${pass.pass_number}` : `Show items in ${pass.pass_number}`}
          >
            <Chevron open={open} />
          </button>
        </td>
        <td>
          <Link to={`/pass/${pass.id}`} className={`gb-pill ${TYPE_PILL[pass.type]}`}>
            {pass.pass_number}
          </Link>
        </td>
        <td>
          <span className={`gb-pill ${TYPE_PILL[pass.type]}`}>{pass.type}</span>
        </td>
        <td className="gb-truncate">{partyOf(pass)}</td>
        <td className="gb-truncate">{pass.purpose || 'Not stated'}</td>
        <td className="gb-truncate">
          <div>{pass.raised_by_name}</div>
          <div className="text-xs text-navy-500">{pass.department_name}</div>
        </td>
        <td>
          <div>{formatDateOnly(pass.created_at)}</div>
          <div className="text-xs text-navy-500">{formatDateTime(pass.created_at).split(', ').pop()}</div>
        </td>
        <td>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-matched-600 hover:bg-matched-700 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={() => void approve()}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded-lg bg-flagged-600 hover:bg-flagged-700 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={onRequestReject}
              disabled={busy}
            >
              Reject
            </button>
          </div>
          {actionError && <div className="text-xs text-flagged-600 mt-1">{actionError}</div>}
        </td>
      </tr>

      {open && (
        <tr>
          <td className="gb-detail-cell" colSpan={APPROVAL_ROW_COLUMNS}>
            <div className="gb-detail">
              <div className="gb-detail-box">
                <div className="gb-detail-title">Items in this Pass ({pass.item_count})</div>
                {itemsError ? (
                  <div className="gb-empty">{itemsError}</div>
                ) : items === undefined ? (
                  <div className="gb-empty">
                    <div className="gb-skeleton" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="gb-empty">This pass lists no material lines.</div>
                ) : (
                  <div className="gb-scroll">
                    <table className="gb-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Item Name</th>
                          <th>Quantity</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={item.id}>
                            <td>{i + 1}</td>
                            <td>{item.name}</td>
                            <td>
                              {item.quantity} <span className="gb-unit">{unitLabel(item.unit)}</span>
                            </td>
                            <td>{item.approx_value != null ? formatCurrency(item.approx_value) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="gb-detail-box">
                <div className="gb-meta">
                  <div className="gb-meta-row">
                    <span className="min-w-0">
                      <span className="gb-meta-label">Vehicle No.</span>
                      <span className="gb-meta-value">{pass.vehicle_number ?? 'Not recorded'}</span>
                    </span>
                  </div>
                  <div className="gb-meta-row">
                    <span className="min-w-0">
                      <span className="gb-meta-label">Expected Return</span>
                      <span className="gb-meta-value">
                        {pass.type === 'RGP' && pass.expected_return_date
                          ? formatDateOnly(pass.expected_return_date)
                          : 'Not applicable'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

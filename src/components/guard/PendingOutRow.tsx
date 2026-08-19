// One row of the Pending OUT page, and the panel it opens.
//
// The mock-up's row is a summary and a disclosure: the chevron opens the pass's
// own material lines beside a small block of validity, purpose and authorisation
// — everything a guard needs to decide before pressing Approve OUT, without
// leaving the queue and losing their place in it.
//
// TWO COLUMNS OF THE MOCK-UP ARE THIS APP'S OWN. Its GATE is DEPARTMENT (there
// is no gate entity in this schema — a pass belongs to a department), and its
// UOM column is gone, because a unit that every line shares is named once in
// the quantity heading and `nos` is never named at all (`src/lib/units.ts`, a
// settled client call). Same rule the record view follows: a column this app
// cannot fill is given the fact it does have, never an em dash top to bottom.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateTime, formatTime } from '../../lib/formatDate';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import { itemsLabel } from '../../lib/pendingOutFilters';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { quantityCell, quantityHeading } from '../../lib/units';
import { usePassItems } from '../../lib/usePassItems';
import ApproveOutAction from './ApproveOutAction';

/** Every cell in the row, chevron included, so the detail row spans the
 *  whole table rather than leaving a ragged edge. */
export const PENDING_OUT_COLUMNS = 11;

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

const MetaGlyphs = {
  clock: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" d="M12 7.75V12l2.75 1.75" />
    </svg>
  ),
  purpose: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V20.25H7z" />
      <path strokeLinecap="round" d="M14.5 3.75V8.25H19M9.75 12.75h4.5M9.75 15.75h4.5" />
    </svg>
  ),
  person: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M4.75 19.5a7.25 7.25 0 0114.5 0" />
    </svg>
  ),
} as const;

function Meta({
  glyph,
  label,
  value,
}: {
  glyph: keyof typeof MetaGlyphs;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="gb-meta-row">
      {MetaGlyphs[glyph]}
      <span className="min-w-0">
        <span className="gb-meta-label">{label}</span>
        <span className="gb-meta-value">{value}</span>
      </span>
    </div>
  );
}

type Props = {
  pass: GatePassView;
  open: boolean;
  onToggle: () => void;
};

export default function PendingOutRow({ pass, open, onToggle }: Props): React.ReactElement {
  // Loaded only while the row is open — the id goes null on close, which is
  // what throws the lines away.
  const { items, error } = usePassItems(open ? pass.id : null);
  const units = (items ?? []).map((i) => i.unit);

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
        <td>
          <button type="button" className="gb-link" onClick={onToggle}>
            {itemsLabel(pass.item_count)}
          </button>
        </td>
        <td>{pass.total_quantity}</td>
        <td>{pass.vehicle_number ?? '—'}</td>
        <td className="gb-truncate">{pass.department_name}</td>
        <td className="gb-truncate">{pass.raised_by_name}</td>
        <td>{formatTime(pass.created_at)}</td>
        <td>
          {canVerifyAtGate(pass) ? (
            <ApproveOutAction id={pass.id} />
          ) : (
            <Link to={`/pass/${pass.id}`} className="gb-link">
              View pass
            </Link>
          )}
        </td>
      </tr>

      {open && (
        <tr>
          <td className="gb-detail-cell" colSpan={PENDING_OUT_COLUMNS}>
            <div className="gb-detail">
              <div className="gb-detail-box">
                <div className="gb-detail-title">Items in this Pass ({pass.item_count})</div>
                {error ? (
                  <div className="gb-empty">{error}</div>
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
                          <th>Description</th>
                          <th>{quantityHeading('Quantity', units)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={item.id}>
                            <td>{i + 1}</td>
                            <td>{item.name}</td>
                            <td className="gb-truncate" title={item.description || undefined}>
                              {item.description || '—'}
                            </td>
                            <td>{quantityCell(item.quantity, item.unit, units)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="gb-detail-box">
                <div className="gb-meta">
                  <Meta
                    glyph="clock"
                    label="Pass Validity"
                    value={`${formatDateTime(pass.created_at)} — ${formatDateTime(pass.expires_at)}`}
                  />
                  <Meta glyph="purpose" label="Purpose" value={pass.purpose || 'Not stated'} />
                  <Meta glyph="person" label="Authorised By" value={pass.raised_by_name} />
                  <Meta glyph="person" label="Carried By" value={pass.visitor_name} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

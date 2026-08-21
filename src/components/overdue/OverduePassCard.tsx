// One overdue pass, as a card in the stack the count opens (client,
// 2026-08-19: "once it is clicked all the cards will be stacked").
//
// THE WHOLE CARD IS THE LINK. That is the client's instruction — "each and
// every stack will be clickable ... it will be opened up in the details page" —
// and it is why the menu beside it no longer carries View Pass Details.
//
// THE LINK AND THE MENU ARE SIBLINGS, NOT NESTED. A button inside an anchor is
// invalid HTML and behaves differently in every browser; here the anchor is the
// card's face and the tools sit beside it, so pressing the three dots never
// also navigates. Same reason the status pill is outside the link: it is a
// label, not a target.
import React from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/formatCurrency';
import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { partyOf } from '../../lib/guardBoard';
import { formatOverdueBy, pendingItemsLabel, type OverduePassRow } from '../../lib/overduePasses';
import OverdueCardMenu from './OverdueCardMenu';

type Props = {
  row: OverduePassRow;
  /** True for a guard alone — passed through to the menu, which is where it
   *  decides whether "Process RGP Return" exists at all. */
  canProcessReturn: boolean;
};

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'late' }): React.ReactElement {
  return (
    <div className="gpo-fact">
      <span className="gpo-fact-label">{label}</span>
      <span className={tone === 'late' ? 'gpo-fact-value gpo-fact-late' : 'gpo-fact-value'}>{value}</span>
    </div>
  );
}

export default function OverduePassCard({ row, canProcessReturn }: Props): React.ReactElement {
  const { pass } = row;
  const party = partyOf(pass);

  return (
    <li className="gpo-card">
      <Link to={`/pass/${pass.id}`} className="gpo-card-face">
        <span className="gpo-card-id">
          <span className="gpo-pass-no">{pass.pass_number}</span>
          <span className="gpo-late-pill">{formatOverdueBy(row.daysLate)} Overdue</span>
        </span>

        <div className="gpo-facts">
          <Fact label="Requested By" value={pass.raised_by_name || '—'} />
          <Fact label="Vendor / Person" value={party} />
          <Fact
            label="Gate Exit"
            value={pass.verified_at ? formatDateTime(pass.verified_at) : 'Not recorded'}
          />
          <Fact label="Expected Return Date" value={formatDateOnly(pass.expected_return_date)} tone="late" />
          <Fact label="Overdue By" value={formatOverdueBy(row.daysLate)} tone="late" />
          {/* WHAT IS STILL OUTSIDE, IN MONEY (client, 2026-08-21: "whatever is
              showing in the stacked card, they should have a value column").
              `v_gate_passes.total_value`, never re-summed from the lines — the
              rule this board's own count already lives by. An unpriced pass is
              a dash, never ₹0. */}
          <Fact
            label="Total Value"
            value={pass.total_value > 0 ? formatCurrency(pass.total_value) : '—'}
          />
          <Fact label="Pending Items" value={pendingItemsLabel(row.pendingItems)} />
        </div>
      </Link>

      <div className="gpo-card-tools">
        <span className={`gb-pill ${row.severity === 'critical' ? 'gb-pill-red' : 'gb-pill-orange'}`}>
          {row.severity === 'critical' ? 'Critical' : 'Overdue'}
        </span>
        <OverdueCardMenu
          passId={pass.id}
          passNumber={pass.pass_number}
          partyName={party}
          canProcessReturn={canProcessReturn}
        />
      </div>
    </li>
  );
}

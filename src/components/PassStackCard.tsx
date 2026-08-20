// ONE STACKED PASS CARD, FOR EVERY ROLE (client, 2026-08-19: "all the cards
// across all the admin, whether admin or HOD level, should mimic the exact same
// stacked card style of the guard's view … upon clicking on those cards it
// should show up the exact details as guard, but HOD and admin cannot perform
// any action — they can just see the return status").
//
// This is the guard's overdue card (`OverduePassCard`, `.gpo-*` in index.css)
// generalised to any pass: a white plate with a coloured left edge, a pass
// number, a grid of labelled facts and the stage pill. The two boards that used
// to draw their own idiom — `DrillPassCard` (the HOD and admin KPI drills) and
// `MyPassCard` (the HOD's register) — are DELETED, so a stale reference is a
// build error rather than a third card style nobody notices.
//
// THE WHOLE CARD IS A LINK TO `/pass/:id`, and it expands nothing. The card
// used to open in place and show the pass's facts and material lines inside
// itself; now it goes where the guard's cards go — to the ONE gate pass record,
// which carries the full item table with each line's value, the total, the
// approval-and-activity rail and the return status. Nothing was lost by the
// move, and there is now one place where a pass is read.
//
// IT OFFERS NO ACTION UNLESS THE LIST HANDS IT ONE. Not a role check — there
// is simply no control on the card by default: the guard's own mutations
// (Approve OUT, recording a return) live on the record and are drawn there for
// a guard alone, by the rules `match_pass` and `apply_item_returns` enforce in
// the database.
//
// The ONE exception, added 2026-08-20 at the client's instruction, is the
// approver's queue: `/approvals` passes `actions` so each card carries Approve
// and Reject on its right-hand side. The prop is a node the LIST supplies, so
// this card knows nothing about approvals and every other stack in the app is
// still action-free by construction. See `ApprovalCardActions.tsx`.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../types';
import { formatDateOnly } from '../lib/formatDate';
import { formatCurrency } from '../lib/formatCurrency';
import { parseCompanyInfo } from '../lib/companyInfo';
import { passStageStyle } from '../lib/passStage';
import { TYPE_PILL } from '../lib/guardBoard';
import { stageTone, type GbTone } from '../lib/passStackCard';

/** The left edge follows the pill, so a stack can be read by its margin alone
 *  before a single word of it is. */
const EDGE: Record<GbTone, string> = {
  blue: 'gpo-card-blue',
  green: 'gpo-card-green',
  red: 'gpo-card-red',
  orange: '',
  grey: 'gpo-card-grey',
};

function Fact({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: 'late';
}): React.ReactElement {
  return (
    <div className="gpo-fact">
      <span className="gpo-fact-label">{label}</span>
      <span className={tone === 'late' ? 'gpo-fact-value gpo-fact-late' : 'gpo-fact-value'}>
        {value}
      </span>
    </div>
  );
}

type Props = {
  pass: GatePassView;
  /** 1-based position in the stack. The LIST assigns it — the same pass is #3
   *  in one drill and #1 in another. */
  index?: number;
  /** The HOD's own register and dashboard pass false: their own name back at
   *  them is noise. The admin oversees every department and keeps it. */
  showRaisedBy?: boolean;
  /** Controls drawn under the stage pill, on the right. Supplied by the LIST —
   *  only the approver's queue supplies any. */
  actions?: React.ReactNode;
};

export default function PassStackCard({
  pass, index, showRaisedBy = true, actions,
}: Props): React.ReactElement {
  const company = parseCompanyInfo(pass.visitor_company);
  const stage = passStageStyle(pass);
  const tone = stageTone(pass);
  const isRgp = pass.type === 'RGP';

  return (
    <li className={`gpo-card ${EDGE[tone]}`} data-testid="pass-stack-card">
      <Link to={`/pass/${pass.id}`} className="gpo-card-face">
        <span className="gpo-card-id">
          <span className="gpo-pass-no">
            {index !== undefined && (
              <span className="gpo-ordinal" data-testid="pass-ordinal">{index}</span>
            )}
            {pass.pass_number}
          </span>
          {/* RGP blue, NRGP green — `TYPE_PILL`, the very map the guard's
              three screens colour their type chip with (client: "whenever we
              are saying the NRGP and RGP in the guard's view, we make it exactly
              [that] for the stacked card in the admin across all the tabs").
              A `Record<PassType, string>`, so a third type is a compile error
              rather than an uncoloured chip. */}
          <span className={`gb-pill ${TYPE_PILL[pass.type]}`}>{pass.type}</span>
        </span>

        <div className="gpo-facts">
          {showRaisedBy && <Fact label="Requested By" value={pass.raised_by_name || '—'} />}
          <Fact label="Vendor / Person" value={company.name || pass.visitor_name} />
          <Fact label="Material" value={pass.material_summary ?? '—'} />
          <Fact label="Items" value={String(pass.item_count)} />
          {/* The money the client asked to see on every card. An unpriced pass
              shows a dash, never ₹0 — the same rule the item table follows. */}
          <Fact
            label="Total Value"
            value={pass.total_value > 0 ? formatCurrency(pass.total_value) : '—'}
          />
          {/* An NRGP is not coming back, so it carries the moment it left
              instead of a deadline it can never miss. */}
          {isRgp ? (
            <Fact
              label="Return Before"
              value={pass.expected_return_date ? formatDateOnly(pass.expected_return_date) : '—'}
              tone={pass.is_overdue ? 'late' : undefined}
            />
          ) : (
            <Fact
              label="Cleared"
              value={pass.verified_at ? formatDateOnly(pass.verified_at) : 'Not yet'}
            />
          )}
        </div>
      </Link>

      {/* THE RETURN STATUS — and, for the approver's queue alone, the two
          buttons the list handed down. Both sit OUTSIDE the link: a control
          nested inside an anchor is a control that also navigates. */}
      <div className={actions ? 'gpo-card-tools gpo-card-tools-stacked' : 'gpo-card-tools'}>
        <span className={`gb-pill gb-pill-${tone}`}>{stage.label}</span>
        {actions}
      </div>
    </li>
  );
}

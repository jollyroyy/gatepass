// ONE ROW OF THE MY PASSES LIST — the client's mock-up (2026-08-20), card for
// card: a tinted type plate, the pass number with its type chip and the purpose
// under it, then the labelled facts (Date & Time · Department · Items · Value ·
// Status) and a chevron.
//
// THE DEPARTMENT IS THE ADMIN'S FACT ALONE (client, 2026-08-20: "for the HODs
// there is no need to show the department because he already knows about the
// department"). An HOD's register is their own department by RLS, so the column
// repeated one word down the whole page; an admin reads across departments and
// needs it. `showDepartment` is the ONE switch — the mock draws the column, and
// this is the deliberate departure from it.
//
// THE VALUE IS `total_value` OFF THE VIEW (migration 038), never re-summed from
// the item rows here — the same rule the overdue KPI follows, so a card and a
// board cannot disagree about what a pass is worth. `0` reads as a dash: the
// column is optional and approximate, so "nothing declared" is not "₹0".
//
// TWO THINGS A CARD DOES, AND THEY ARE SEPARATE CONTROLS. The face is a link to
// `/pass/:id` (the full record); the chevron is a disclosure that unfolds the
// pass's own material lines in place (client: "upon clicking on it they might
// be able to see the exact items also in the stacked card"). The button sits
// BESIDE the link, never inside it — a button nested in an anchor is invalid and
// behaves differently in every browser, which is why `.gpo-card` is built the
// same way.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { formatCurrency } from '../../lib/formatCurrency';
import { reportStatusLabel, reportStatusPill } from '../../lib/gatePassReport';
import {
  itemsLabel,
  MY_PASS_TYPE_GLYPH,
  MY_PASS_TYPE_PILL,
  MY_PASS_TYPE_PLATE,
} from '../../lib/myPassesList';
import MyPassIcon, { type MyPassGlyph } from './MyPassIcon';
import MyPassItems from './MyPassItems';

function Fact({
  label,
  glyph,
  children,
}: {
  label: string;
  glyph?: MyPassGlyph;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mp-fact">
      <span className="mp-fact-label">{label}</span>
      <span className="mp-fact-value">
        {glyph && (
          <span className="mp-fact-glyph" aria-hidden="true">
            <MyPassIcon glyph={glyph} />
          </span>
        )}
        <span className="gb-truncate">{children}</span>
      </span>
    </div>
  );
}

type Props = {
  pass: GatePassView;
  /** Admin only — see the header. */
  showDepartment: boolean;
  open: boolean;
  onToggle: () => void;
};

export default function MyPassCard({ pass, showDepartment, open, onToggle }: Props): React.ReactElement {
  return (
    <li className={open ? 'mp-row mp-row-open' : 'mp-row'}>
      <div className="mp-face-row">
        <Link to={`/pass/${pass.id}`} className="mp-face">
          <span className={`mp-plate ${MY_PASS_TYPE_PLATE[pass.type]}`} aria-hidden="true">
            <MyPassIcon glyph={MY_PASS_TYPE_GLYPH[pass.type]} />
          </span>

          <div className="mp-id">
            <span className="mp-id-top">
              <span className="mp-no">{pass.pass_number}</span>
              <span className={`gb-pill ${MY_PASS_TYPE_PILL[pass.type]}`}>{pass.type}</span>
            </span>
            {/* `purpose` is NOT NULL in the schema, but a legacy row can carry
                an empty string — a dash is better than the word "Purpose"
                standing in for one. */}
            <span className="mp-purpose gb-truncate">{pass.purpose || '—'}</span>
          </div>

          <div className="mp-facts">
            <Fact label="Date & Time" glyph="calendar">
              {formatDateTime(pass.created_at)}
            </Fact>
            {showDepartment && (
              <Fact label="Department" glyph="building">
                {pass.department_name || '—'}
              </Fact>
            )}
            <Fact label="Items" glyph="box">
              {itemsLabel(pass.item_count)}
            </Fact>
            <Fact label="Value" glyph="rupee">
              {pass.total_value ? formatCurrency(pass.total_value) : '—'}
            </Fact>
            {/* The one fact that is a badge rather than a line of text. The
                bucket and its colour are `gatePassReport`'s — the SAME three
                words the admin's report prints — so a pass cannot read
                "Completed" on one screen and "Partially Returned" on another. */}
            <div className="mp-fact">
              <span className="mp-fact-label">Status</span>
              <span className="mp-fact-value">
                <span className={`gb-pill ${reportStatusPill(pass)}`}>{reportStatusLabel(pass)}</span>
              </span>
            </div>
          </div>
        </Link>

        <button
          type="button"
          className="mp-chev"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} items on ${pass.pass_number}`}
          onClick={onToggle}
        >
          <MyPassIcon glyph="chevron" />
        </button>
      </div>

      {open && <MyPassItems pass={pass} />}
    </li>
  );
}

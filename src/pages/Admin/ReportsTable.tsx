// The register itself, drawn to the client's mock-up (2026-08-20).
//
// The mock's columns are Pass Number · Creation Date · Pass Type · Purpose /
// Description · Total Number of Items · Status · Created By, plus a per-row
// menu. TWO MORE ARE HERE ON THE CLIENT'S OWN INSTRUCTION: **Total Value of
// Items** — the view's `total_value`, the sum of the pass's priced lines — and
// **Raised By Department**. Both are columns of the CSV as well; a report and
// its export must say the same thing, so the three headings the client renamed
// on 2026-08-23 ("GP No." → Pass Number, and the two totals) moved in both
// places at once.
//
// The whole row opens `/pass/:id`, which is the ONE gate pass record format in
// this app, so the kebab carries only what the row itself cannot do: the printed
// slip. Two entries, both real destinations.
//
// It replaces `AllPassesReport.tsx`, which is DELETED — a stale reference is a
// build error rather than a second register nobody notices.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { PASS_TYPES } from '../../lib/passTypes';
import {
  itemsLabel,
  purposeText,
  reportStatusLabel,
  reportStatusPill,
  valueText,
} from '../../lib/gatePassReport';

/** RGP blue, NRGP green — the same `TYPE_PILL` colouring every guard screen and
 *  every stacked card uses, so a type chip means one thing app-wide. */
const TYPE_PILL: Record<GatePassView['type'], string> = {
  RGP: 'gb-pill-blue',
  NRGP: 'gb-pill-green',
};

function RowMenu({ pass }: { pass: GatePassView }): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function away(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <div className="gb-rep-menu-wrap" ref={wrap} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="gb-rep-kebab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${pass.pass_number}`}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className="gb-rep-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => go(`/pass/${pass.id}`)}>
            View Details
          </button>
          <button type="button" role="menuitem" onClick={() => go(`/pass/${pass.id}/print`)}>
            Print Pass
          </button>
        </div>
      )}
    </div>
  );
}

type Props = {
  rows: GatePassView[];
  /** False on the HOD's own Reports tab (2026-08-20, client: "remove the
   *  Department and Raised By columns for an individual HOD"). An HOD's rows
   *  are already narrowed to their own department by RLS, and to themself as
   *  raiser — a column that can answer only one way says nothing. Defaults
   *  true so the admin's register, which this component still is, is
   *  untouched by the new prop. */
  showPeople?: boolean;
};

export default function ReportsTable({ rows, showPeople = true }: Props): React.ReactElement {
  const navigate = useNavigate();

  return (
    <table className="gb-table">
      <thead>
        <tr>
          <th>Pass Number</th>
          <th>Creation Date</th>
          <th>Pass Type</th>
          <th>Purpose / Description</th>
          <th>Total Number of Items</th>
          <th>Total Value of Items</th>
          {showPeople && <th>Raised By Department</th>}
          <th>Status</th>
          {showPeople && <th>Created By</th>}
          <th aria-label="Actions" className="sticky-action" />
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
            <td className="gb-rep-gp">{p.pass_number}</td>
            <td className="whitespace-nowrap">{formatDateOnly(p.created_at)}</td>
            <td>
              <span className={`gb-pill ${TYPE_PILL[p.type]}`}>{PASS_TYPES[p.type].code}</span>
            </td>
            <td>
              <div className="gb-rep-purpose" title={purposeText(p)}>{purposeText(p)}</div>
            </td>
            <td className="whitespace-nowrap">{itemsLabel(p.item_count)}</td>
            <td className="gb-rep-value">{valueText(p.total_value)}</td>
            {showPeople && <td>{p.department_name ?? '—'}</td>}
            <td>
              <span className={`gb-pill ${reportStatusPill(p)}`}>{reportStatusLabel(p)}</span>
            </td>
            {showPeople && <td>{p.raised_by_name ?? '—'}</td>}
            <td className="no-print sticky-action">
              <RowMenu pass={p} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

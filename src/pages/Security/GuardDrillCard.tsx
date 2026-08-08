// One pass, fully described, as the payload of a dashboard KPI drill. A guard
// clicking "Overdue" needs to act without a second navigation, so everything
// they would otherwise open the pass detail for is here: who, which company,
// which vehicle, what material, and the dates that matter.
//
// The 2026-08-08 card rule: the card is a horizontal PassRow (nobody reads a
// wall of vertical cards anymore), and the drill's point IS the detail, so the
// row starts expanded. On the returnable drills it also carries Record
// Returns; that action used to live on the Pending Returns page, and when that
// tab was removed this became the ONLY way a guard can close an RGP, so it
// must stay. Per-line returns stay lazy: ItemReturnList mounts only once the
// guard opens one card's panel.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';
import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';
import ItemReturnList from './ItemReturnList';

type Props = {
  pass: GatePassView;
  /** Whether this drill's material has left the gate and can be closed. */
  returnable: boolean;
  onMarkReturned: (pass: GatePassView, remarks: string) => Promise<void>;
  /** A single line came back. The pass may now be closed — the DATABASE decided
   *  that in `apply_item_returns`, so the caller must re-read rather than
   *  infer it. Optional so existing callers keep compiling. */
  onItemReturned?: () => void;
};

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-navy-800 truncate">{value}</p>
    </div>
  );
}

export default function GuardDrillCard({
  pass,
  returnable,
  onMarkReturned,
  onItemReturned,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const company = parseCompanyInfo(pass.visitor_company);

  async function submitReturn() {
    setBusy(true);
    try {
      await onMarkReturned(pass, remarks);
      setOpen(false);
      setRemarks('');
    } finally {
      setBusy(false);
    }
  }

  const detail = (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Vendor" value={company.name || '—'} />
        <Field label="Visitor" value={pass.visitor_name} />
        <Field label="Department" value={pass.department_name} />
        <Field label="Vehicle" value={pass.vehicle_number || '—'} />
        <Field label="Raised By" value={pass.raised_by_name} />
        <Field label="Raised At" value={formatDateTime(pass.created_at)} />
        {pass.expected_return_date && (
          <Field label="Expected Return" value={formatDateOnly(pass.expected_return_date)} />
        )}
        {pass.verified_by_name && <Field label="Verified By" value={pass.verified_by_name} />}
      </div>

      {pass.material_summary && (
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-navy-600 leading-relaxed">{pass.material_summary}</p>
          <span className="text-xs font-semibold text-navy-500 tabular shrink-0">
            {pass.item_count} item{pass.item_count !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link to={`/pass/${pass.id}`} className="text-xs font-semibold text-accent-600 hover:underline shrink-0">
          Full details →
        </Link>
        {returnable && !open && (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Record Returns
          </button>
        )}
      </div>

      {returnable && open && (
        <div className="flex flex-col gap-3 border-t border-surface-200/60 pt-3">
          {/* Per-line returns. Mounted only once the guard opens THIS card, so a
              long Awaiting Return drill does not fire one query per pass on a
              device standing at a barrier. The pass closes itself in the
              database when the last line lands, so onReturned re-reads it. */}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">
            Return items individually
          </p>
          <ItemReturnList passId={pass.id} onReturned={onItemReturned ?? (() => {})} />

          <label className="label pt-1 border-t border-surface-200/60" htmlFor={`remarks-${pass.id}`}>
            …or return everything at once — remarks (optional)
          </label>
          <textarea
            id={`remarks-${pass.id}`}
            className="input"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Condition on return, who brought it back, etc."
          />
          <div className="flex gap-3">
            <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary flex-1" onClick={submitReturn} disabled={busy}>
              {busy ? 'Recording…' : 'Return All'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div
      className={`card overflow-hidden ${pass.is_overdue ? 'ring-1 ring-overdue-500/40' : ''}`}
    >
      <PassRow pass={pass} defaultOpen detail={detail} />
    </div>
  );
}
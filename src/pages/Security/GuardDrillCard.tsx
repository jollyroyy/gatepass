// One pass, fully described, as a premium card — the payload of a dashboard KPI
// drill. A guard clicking "Overdue" needs to act without a second navigation, so
// everything they would otherwise open the pass detail for is here: who, which
// company, which vehicle, what material, and the dates that matter.
//
// On the returnable drills this card also carries Mark Returned. That action
// used to live on the Pending Returns page; when that tab was removed this
// became the ONLY way a guard can close an RGP, so it must stay.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import Badge, { TypeChip } from '../../components/Badge';
import { OVERDUE_STYLE, STATUS_STYLES } from '../../lib/statusStyles';
import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';

type Props = {
  pass: GatePassView;
  /** Whether this drill's material has left the gate and can be closed. */
  returnable: boolean;
  onMarkReturned: (pass: GatePassView, remarks: string) => Promise<void>;
};

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-navy-800 truncate">{value}</p>
    </div>
  );
}

export default function GuardDrillCard({ pass, returnable, onMarkReturned }: Props): React.ReactElement {
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

  return (
    <div
      className={`flex flex-col gap-4 p-5 rounded-2xl card ${pass.is_overdue ? 'ring-1 ring-overdue-500/40' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TypeChip type={pass.type} />
          <Badge style={pass.is_overdue ? OVERDUE_STYLE : STATUS_STYLES[pass.status]} />
        </div>
        <Link
          to={`/pass/${pass.id}`}
          className="text-xs font-semibold text-accent-600 hover:underline shrink-0"
        >
          Full details →
        </Link>
      </div>

      <span className="font-bold text-navy-950 text-lg font-display tracking-tight truncate">
        {pass.pass_number}
      </span>

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
        <div className="border-t border-surface-200/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-1">
            Material · {pass.item_count} item{pass.item_count !== 1 ? 's' : ''}
          </p>
          <p className="text-sm text-navy-600 leading-relaxed">{pass.material_summary}</p>
        </div>
      )}

      {pass.flag_reason && (
        <div className="border-t border-surface-200/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-flagged-500 mb-1">
            Mismatch Reason
          </p>
          <p className="text-sm text-navy-700">{pass.flag_reason}</p>
        </div>
      )}

      {returnable && !open && (
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          Mark Returned
        </button>
      )}

      {returnable && open && (
        <div className="flex flex-col gap-3 border-t border-surface-200/60 pt-3">
          <label className="label" htmlFor={`remarks-${pass.id}`}>
            Remarks (optional)
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
              {busy ? 'Recording…' : 'Confirm Return'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Success popup shown after RaisePass.tsx submits a new pass.
//
// Redesigned 2026-08-10 for scannability: the fields a person needs in under a
// second — pass number, type, direction, status, vehicle — sit in one glance
// header at real size/weight; everything else is grouped into small labelled
// blocks (Vehicle & Department / Vendor & Visitor / Material) instead of one
// flat list. No new data: every value here already lived on `submittedPass` —
// vehicle number and direction just weren't rendered before.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { STATUS_STYLES } from '../../lib/statusStyles';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { formatDateTime } from '../../lib/formatDate';
import Badge, { TypeChip } from '../../components/Badge';
import ModalShell from '../../components/ModalShell';

interface PassSubmittedModalProps {
  submittedPass: GatePassView;
  deptName: string;
  itemCount: number;
  onClose: () => void;
}

/** One labelled fact inside a grouped block. `emphasize` bumps it to the
 *  weight a guard-facing "read this first" field needs (vehicle number). */
function Fact({ label, value, emphasize }: { label: string; value: React.ReactNode; emphasize?: boolean }): React.ReactElement {
  const shown = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold text-navy-500 uppercase tracking-wider">{label}</dt>
      <dd className={`mt-0.5 truncate ${emphasize ? 'text-base font-bold text-navy-950' : 'text-sm font-medium text-navy-700'}`}>
        {shown}
      </dd>
    </div>
  );
}

/** A small grouped block — the "distinct facts read as distinct blocks" rule
 *  from the pass-detail page, scaled down for a compact popup. */
function FactBlock({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-surface-200 bg-surface-50 p-3.5">
      <p className="text-[10px] font-bold text-brand-700 uppercase tracking-[0.14em] mb-2">{title}</p>
      <dl className="grid grid-cols-2 gap-3">{children}</dl>
    </div>
  );
}

export default function PassSubmittedModal({
  submittedPass,
  deptName,
  itemCount,
  onClose,
}: PassSubmittedModalProps): React.ReactElement {
  const company = parseCompanyInfo(submittedPass.visitor_company);

  return (
    <ModalShell onClose={onClose} className="max-w-lg" labelledBy="pass-submitted-title">
      {/* Glance header — pass number, type, direction, status all findable in
          one look. Reserves room on the right for ModalShell's × button. */}
      <div className="flex items-start gap-3 mb-5 pr-9">
        <div className="h-10 w-10 rounded-full bg-matched-100 flex items-center justify-center shrink-0">
          <svg className="h-6 w-6 text-matched-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p id="pass-submitted-title" className="text-[11px] font-semibold uppercase tracking-widest text-matched-600">
            Pass Submitted
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <h3 className="text-xl font-extrabold tracking-tight font-mono text-navy-950 truncate">
              {submittedPass.pass_number}
            </h3>
            <TypeChip type={submittedPass.type} />
            <span className="type-chip">{submittedPass.direction === 'in' ? 'IN' : 'OUT'}</span>
          </div>
        </div>
        <Badge style={STATUS_STYLES[submittedPass.status]} />
      </div>

      {/* Grouped facts — never one undifferentiated list. */}
      <div className="flex flex-col gap-3 mb-4">
        <FactBlock title="Vehicle &amp; Department">
          <Fact label="Vehicle Number" value={submittedPass.vehicle_number} emphasize />
          <Fact label="Department" value={deptName} />
        </FactBlock>

        <FactBlock title="Vendor &amp; Visitor">
          <Fact label="Visitor Name" value={submittedPass.visitor_name} />
          <Fact label="Vendor / Company" value={company.name} />
        </FactBlock>

        <FactBlock title="Material">
          <Fact label="Line Items" value={itemCount} />
          <Fact label="Total Quantity" value={submittedPass.total_quantity} />
        </FactBlock>
      </div>

      {/* Timeline — just the one event so far, in the same visual language as
          the pass-detail Raised → Mismatch → Override timeline. */}
      <div className="flex items-center gap-2 text-xs text-navy-500 mb-5">
        <span className="w-1.5 h-1.5 rounded-full bg-pending-500 shrink-0" />
        Raised {formatDateTime(submittedPass.created_at)} — now in the security queue.
      </div>

      <div className="flex gap-3">
        <Link to={`/pass/${submittedPass.id}`} className="btn-primary flex-1 text-center">
          View Pass
        </Link>
        <Link to="/dashboard" className="btn-secondary flex-1 text-center">
          Dashboard
        </Link>
      </div>
    </ModalShell>
  );
}

// The summary card at the top of a gate-pass record: who took what, when it
// was issued, where the pass stands, and the QR that reopens it.
//
// This is the ONE record format in the app (2026-08-18). `/pass/:id` — where
// every stacked list, KPI drill and notification lands — renders the same
// component the gate search resolves to, so a pass never reads two ways. That
// is why the fact columns carry the vendor block and the vehicle number: they
// were on the old detail page, and a drill-down must not lose them.
//
// Four columns on a wide screen — facts, more facts, the stage strip, the QR —
// collapsing to one on a phone. Presentation only; every value is read from
// the row the caller already loaded.
import React from 'react';
import type { GatePassView } from '../../types';
import { formatDateTime, formatDateOnly } from '../../lib/formatDate';
import { passRecordStages, relativeSince } from '../../lib/passRecordView';
import { parseCompanyInfo } from '../../lib/companyInfo';
import QrPass from '../QrPass';

const ICON = { className: 'w-4 h-4 shrink-0 text-navy-500', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.7 } as const;

const PERSON = <svg {...ICON}><circle cx="12" cy="8" r="3.25" /><path strokeLinecap="round" d="M4.75 19.25a7.25 7.25 0 0114.5 0" /></svg>;
const BUILDING = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 20.25h16.5M5.25 20.25V6.75l6.75-3 6.75 3v13.5M9 11.25h1.5M9 14.75h1.5M13.5 11.25H15M13.5 14.75H15" /></svg>;
const PIN = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6.5-5.4 6.5-10.1A6.5 6.5 0 005.5 10.9C5.5 15.6 12 21 12 21z" /><circle cx="12" cy="10.75" r="2.25" /></svg>;
const CALENDAR = <svg {...ICON}><rect x="3.75" y="5.25" width="16.5" height="15" rx="2" /><path strokeLinecap="round" d="M3.75 9.75h16.5M8.25 3.75v3M15.75 3.75v3" /></svg>;
const CLOCK = <svg {...ICON}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" d="M12 7.75V12l2.75 1.75" /></svg>;
const PHONE = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75h3l1.5 4.5-2.25 1.5a12 12 0 005.25 5.25l1.5-2.25 4.5 1.5v3a1.5 1.5 0 01-1.5 1.5A15.75 15.75 0 015.25 5.25a1.5 1.5 0 011.5-1.5z" /></svg>;
const TRUCK = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5h9v9h-9v-9zM12.75 10.5h3.75l2.25 2.25v3.75h-6V10.5z" /><circle cx="7" cy="18" r="1.5" /><circle cx="16.5" cy="18" r="1.5" /></svg>;

/** One labelled fact. Icon, caption, value — the caption is a caption, never a
 *  heading, so it stays Inter and neutral. */
function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }): React.ReactElement {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-navy-500">{label}</p>
        <p className="text-sm font-semibold text-navy-900 break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

export default function PassRecordSummary({ pass }: { pass: GatePassView }): React.ReactElement {
  const stages = passRecordStages(pass);
  const company = parseCompanyInfo(pass.visitor_company);
  const subtitle =
    pass.type === 'RGP' ? 'Equipment issue and return record' : 'Material issue record — non-returnable';

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start gap-3.5 mb-6">
        <span className="w-11 h-11 rounded-xl bg-accent-600 text-white flex items-center justify-center shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V19.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 017 19.5V3.75z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 3.75V8.25H19M9.5 12.75h5M9.5 15.75h5" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-xl sm:text-2xl font-semibold tracking-tight text-navy-950 break-all">{pass.pass_number}</p>
          <p className="text-sm text-navy-500">{subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 xl:gap-5">
        <div className="flex flex-col gap-5">
          <Fact icon={PERSON} label="Authorized Person's Name" value={pass.visitor_name} />
          <Fact icon={PHONE} label="Contact" value={company.phone} />
          <Fact icon={BUILDING} label="Vendor" value={company.name} />
          <Fact icon={PIN} label="Vendor address" value={company.address} />
          <Fact icon={TRUCK} label="Vehicle number" value={pass.vehicle_number} />
        </div>

        <div className="flex flex-col gap-5">
          <Fact icon={BUILDING} label="Department" value={pass.department_name} />
          <Fact icon={PIN} label="Destination" value={pass.purpose} />
          <Fact icon={PERSON} label="Issued by" value={pass.raised_by_name} />
          <Fact icon={CALENDAR} label="Issue date" value={formatDateTime(pass.created_at)} />
          {/* RGP only — an NRGP never comes back, so the row is omitted rather
              than shown as a dash that reads like missing data. */}
          {pass.type === 'RGP' && (
            <Fact icon={CLOCK} label="Expected return" value={formatDateOnly(pass.expected_return_date)} />
          )}
        </div>

        {/* The stage strip. Dots and a connecting rule, not a chart — the
            information is the order and the times, and both must survive a
            mono print. */}
        <ol className="flex flex-col gap-4 xl:border-l xl:border-surface-200 xl:pl-6">
          {stages.map((s, i) => (
            <li key={s.label} className="flex gap-3">
              <span className="flex flex-col items-center shrink-0">
                <span
                  className={`mt-1 h-3 w-3 rounded-full border-2 ${
                    i === stages.length - 1 ? 'border-accent-600 bg-accent-600' : 'border-matched-500 bg-matched-500'
                  }`}
                />
                {i < stages.length - 1 && <span className="w-px flex-1 bg-surface-300 my-1" />}
              </span>
              <div className="min-w-0 pb-1">
                <p className="text-sm font-semibold text-navy-900">{s.label}</p>
                <p className="text-xs text-navy-500">{formatDateTime(s.at)}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col items-center gap-2">
          <div className="rounded-xl border border-surface-200 p-3">
            <QrPass value={pass.qr_token} size={116} />
          </div>
          <p className="text-xs text-navy-500">Scan to view pass</p>
          <p className="text-xs text-navy-500 flex items-center gap-1.5">
            {CLOCK}
            <span>Last updated {relativeSince(pass.updated_at)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

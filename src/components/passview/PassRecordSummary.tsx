// The fact strip at the top of a gate-pass record — drawn to the client's
// mock-up (2026-08-19): five columns of labelled facts, each with its own small
// icon, and the QR that reopens the pass.
//
// This is the ONE record format in the app. `/pass/:id` — where every stacked
// list, KPI drill, guard action and notification lands — renders the same
// component the gate search resolves to, so a pass never reads two ways.
//
// WHERE THE MOCK-UP AND THIS SCHEMA DISAGREE, THE SCHEMA WINS:
//   * "Requested By ... EMP ID" — there is no employee number anywhere in this
//     database. The slot carries the raising HOD's DEPARTMENT instead, which is
//     the fact the reader actually needs and the one the ladder repeats.
//   * "Gate Exit: Main Gate" — there is no gate entity either. A verification
//     row records `gate_name` when the guard names one, so the fact is drawn
//     ONLY when it was recorded. An invented "Main Gate" would be a claim about
//     which door a truck used.
//   * "Approved Date & Time (Latest)" is this app's own event: the moment
//     security cleared the material out. Nothing else on a pass is "approved".
//
// A fact with no value is OMITTED, never drawn as an em dash — the rule the
// item table follows. A column of dashes reads as data loss.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import { formatDateTime, formatDateOnly } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { relativeSince } from '../../lib/passRecordView';
import { formatCurrency } from '../../lib/formatCurrency';
import QrPass from '../QrPass';
import { TypeChip } from '../Badge';

const ICON = { className: 'w-4 h-4 shrink-0 text-navy-500', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.7 } as const;

const PERSON = <svg {...ICON}><circle cx="12" cy="8" r="3.25" /><path strokeLinecap="round" d="M4.75 19.25a7.25 7.25 0 0114.5 0" /></svg>;
const BUILDING = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 20.25h16.5M5.25 20.25V6.75l6.75-3 6.75 3v13.5M9 11.25h1.5M9 14.75h1.5M13.5 11.25H15M13.5 14.75H15" /></svg>;
const PIN = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6.5-5.4 6.5-10.1A6.5 6.5 0 005.5 10.9C5.5 15.6 12 21 12 21z" /><circle cx="12" cy="10.75" r="2.25" /></svg>;
const CALENDAR = <svg {...ICON}><rect x="3.75" y="5.25" width="16.5" height="15" rx="2" /><path strokeLinecap="round" d="M3.75 9.75h16.5M8.25 3.75v3M15.75 3.75v3" /></svg>;
const CLOCK = <svg {...ICON}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" d="M12 7.75V12l2.75 1.75" /></svg>;
const PHONE = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75h3l1.5 4.5-2.25 1.5a12 12 0 005.25 5.25l1.5-2.25 4.5 1.5v3a1.5 1.5 0 01-1.5 1.5A15.75 15.75 0 015.25 5.25a1.5 1.5 0 011.5-1.5z" /></svg>;
const TRUCK = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5h9v9h-9v-9zM12.75 10.5h3.75l2.25 2.25v3.75h-6V10.5z" /><circle cx="7" cy="18" r="1.5" /><circle cx="16.5" cy="18" r="1.5" /></svg>;
const DOC = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V20.25H7V3.75zM14.5 3.75V8.25H19" /></svg>;
const GATE = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20.25V7.5l8-3.75 8 3.75v12.75M9.5 20.25v-6.5h5v6.5" /></svg>;
const TAG = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M4.75 5.5v5a1.5 1.5 0 00.44 1.06l7.2 7.2a1.5 1.5 0 002.12 0l5.35-5.35a1.5 1.5 0 000-2.12l-7.2-7.2a1.5 1.5 0 00-1.06-.44h-5A1.75 1.75 0 004.75 5.5z" /><circle cx="9" cy="9" r="1.1" /></svg>;
const FLAG = <svg {...ICON}><path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25V4.5m0 0h11l-2.25 3.75L17 12H6" /></svg>;

/** One labelled fact. The caption is a caption, never a heading, so it stays
 *  Inter and neutral — the gold display serif is for headings only. */
function Fact({
  icon, label, value, tone = 'plain',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** `alert` is the mock-up's red return deadline. Status outranks the house
   *  neutral, the same rule "Delete Department?" follows. */
  tone?: 'plain' | 'alert' | 'ok';
}): React.ReactElement {
  const ink =
    tone === 'alert' ? 'text-flagged-700' : tone === 'ok' ? 'text-matched-700' : 'text-navy-900';
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-navy-500">{label}</p>
        <div className={`text-sm font-semibold break-words ${ink}`}>{value}</div>
      </div>
    </div>
  );
}

/** Copies the pass number — the mock-up's little duplicate glyph beside it. A
 *  pass number is what a guard reads down a phone line, and re-typing 17
 *  characters is where a wrong pass gets looked up. */
function CopyPassNumber({ value }: { value: string }): React.ReactElement {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-icon !w-6 !h-6 shrink-0"
      aria-label={done ? 'Pass number copied' : 'Copy pass number'}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? (
        <svg className="w-3.5 h-3.5 text-matched-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4.5 4.5L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path strokeLinecap="round" d="M15 5.75H6a1.5 1.5 0 00-1.5 1.5V16" />
        </svg>
      )}
    </button>
  );
}

type Props = {
  pass: GatePassView;
  /** The entrance named on the clearing verification, when one was named. */
  gateName?: string | null;
};

export default function PassRecordSummary({ pass, gateName }: Props): React.ReactElement {
  const company = parseCompanyInfo(pass.visitor_company);

  return (
    <div className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 xl:gap-5">
        <div className="flex flex-col gap-5">
          <Fact
            icon={DOC}
            label="Gate Pass No."
            value={
              <span className="flex items-center gap-1.5">
                <span className="break-all">{pass.pass_number}</span>
                <CopyPassNumber value={pass.pass_number} />
              </span>
            }
          />
          <Fact icon={FLAG} label="Pass Type" value={<TypeChip type={pass.type} />} />
          <Fact icon={PIN} label="Purpose" value={pass.purpose} />
          {/* THE MATERIAL'S WORTH, on both pass types (client, 2026-08-19:
              "put value in all the details … overall the total value also").
              It is the sum the item table foots, off the view's own roll-up of
              the same lines. A pass whose lines carry no value at all shows
              nothing here rather than ₹0 — the strip's own rule. */}
          {pass.total_value > 0 && (
            <Fact icon={TAG} label="Total Value" value={formatCurrency(pass.total_value)} />
          )}
          {/* RGP only — an NRGP has no deadline to miss. */}
          {pass.type === 'RGP' && pass.expected_return_date && (
            <Fact
              icon={CLOCK}
              label="Return Before"
              value={formatDateOnly(pass.expected_return_date)}
              tone={pass.is_overdue ? 'alert' : 'plain'}
            />
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Fact
            icon={PERSON}
            label="Requested By"
            value={
              <>
                {pass.raised_by_name}
                {pass.department_name && (
                  <span className="block text-xs font-normal text-navy-500">{pass.department_name}</span>
                )}
              </>
            }
          />
          <Fact icon={PERSON} label="Authorized Person's Name" value={pass.visitor_name} />
          {company.name && <Fact icon={BUILDING} label="Vendor / Person" value={company.name} />}
        </div>

        <div className="flex flex-col gap-5">
          <Fact icon={CALENDAR} label="Request Date & Time" value={formatDateTime(pass.created_at)} />
          {pass.verified_at && (
            <Fact icon={CALENDAR} label="Cleared Date & Time" value={formatDateTime(pass.verified_at)} />
          )}
          {/* THE APPROVAL COUNTER IS GONE (client, 2026-08-19). "5 of 5 levels
              approved" restated, as a number, what the ladder beside it already
              says level by level and with names — and a counter that disagrees
              with the rail is how a reader stops trusting both. The vendor's
              address takes the slot. */}
          {company.address && <Fact icon={PIN} label="Vendor Address" value={company.address} />}
        </div>

        <div className="flex flex-col gap-5">
          {gateName && <Fact icon={GATE} label="Gate Exit" value={gateName} />}
          {pass.vehicle_number && <Fact icon={TRUCK} label="Vehicle No." value={pass.vehicle_number} />}
          {company.phone && <Fact icon={PHONE} label="Contact No." value={company.phone} />}
          {/* The mock's fifth column ends in a Status box. This app's badge for
              that fact is in the title row a few pixels above, and repeating a
              live badge is how two of them end up disagreeing — so the slot
              carries the moment it last moved instead. */}
          <Fact icon={CLOCK} label="Last Movement" value={formatDateTime(pass.updated_at)} />
        </div>

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

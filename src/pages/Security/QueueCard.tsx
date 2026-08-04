// One pending pass as a queue card. Extracted from GateConsole to keep that
// file under the 300-line cap; the markup is unchanged.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { TypeChip } from '../../components/Badge';
import { formatTime } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Waiting-time badge with overdue colour when >2h. */
function waitBadge(createdAt: string): { text: string; cls: string } {
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const text = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const overdue = ms > TWO_HOURS_MS;
  const cls = overdue
    ? 'bg-overdue-100 text-overdue-700 border border-overdue-300'
    : 'bg-surface-100 text-navy-500 border border-surface-300';
  return { text, cls };
}

type Props = {
  pass: GatePassView;
  /** The head of the queue gets a ring and an "Oldest" flag. */
  isOldest: boolean;
};

export default function QueueCard({ pass: p, isOldest }: Props): React.ReactElement {
  const wb = waitBadge(p.created_at);
  const companyInfo = parseCompanyInfo(p.visitor_company);

  return (
              <Link
                to={`/verify/${p.id}`}
                className={`group relative flex flex-col gap-4 p-5 rounded-2xl transition-all duration-300
                  ${isOldest ? 'ring-1 ring-brand-500/40' : ''}`}
                style={{
                  background: 'rgb(var(--glass-bg) / 0.45)',
                  backdropFilter: 'blur(24px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                  border: '1px solid rgb(var(--c-surface-200) / 0.5)',
                  boxShadow: '0 8px 32px -8px rgb(15 23 42 / 0.08), 0 2px 8px -2px rgb(15 23 42 / 0.04)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgb(var(--c-brand-400) / 0.5)';
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 20px 48px -12px rgb(15 23 42 / 0.14), 0 4px 16px -4px rgb(198 161 91 / 0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgb(var(--c-surface-200) / 0.5)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 32px -8px rgb(15 23 42 / 0.08), 0 2px 8px -2px rgb(15 23 42 / 0.04)';
                }}
              >
                {/* Top bar: type chip + wait time + oldest badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TypeChip type={p.type} />
                    {isOldest && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600 bg-brand-50/70 px-2 py-0.5 rounded-full animate-pulse-soft">
                        Oldest
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full tabular ${wb.cls}`}>
                    {wb.text}
                  </span>
                </div>

                {/* Pass number */}
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-navy-950 text-lg font-display tracking-tight truncate">{p.pass_number}</span>
                  <svg className="w-5 h-5 text-navy-300 group-hover:text-brand-500 transition-colors duration-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>

                {/* Two-column detail grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Vendor</p>
                    <p className="text-sm font-semibold text-brand-700 truncate">{companyInfo.name || '—'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Visitor</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.visitor_name}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Department</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.department_code || p.department_name}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Vehicle</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.vehicle_number || '—'}</p>
                  </div>
                </div>

                {/* Material */}
                {p.material_summary && (
                  <div className="border-t border-surface-200/60 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-1">Material</p>
                    <p className="text-sm text-navy-600 leading-relaxed line-clamp-2">{p.material_summary}</p>
                  </div>
                )}

                {/* Meta badges row */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-matched-700 bg-matched-50/80 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    {p.item_count} item{p.item_count !== 1 ? 's' : ''}
                  </span>

                  {p.type === 'RGP' && p.return_status !== 'not_applicable' && (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium
                      ${p.is_overdue
                        ? 'bg-overdue-100/80 text-overdue-700 border border-overdue-300/50'
                        : 'bg-brand-50/80 text-brand-700 border border-brand-200/50'}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {p.is_overdue ? 'Overdue' : p.return_status === 'awaiting_return' ? 'Awaiting Return' : p.return_status === 'returned' ? 'Returned' : ''}
                    </span>
                  )}
                </div>

                {/* Footer: raised at + by */}
                <div className="flex items-center gap-2 text-[11px] text-navy-400 pt-2 border-t border-surface-200/40">
                  <span>Raised {formatTime(p.created_at)}</span>
                  <span className="w-1 h-1 rounded-full bg-navy-300/50" />
                  <span>{p.raised_by_name}</span>
                </div>
              </Link>
  );
}

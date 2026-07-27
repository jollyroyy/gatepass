// RGP pending-returns log. Overdue material surfaces first so the guard deals
// with the oldest debt before the next-due item.
import React, { useCallback, useEffect, useState } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import KpiCard from '../../components/KpiCard';
import Badge, { TypeChip } from '../../components/Badge';
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import { formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';

function daysIndicator(p: GatePassView): string {
  if (!p.expected_return_date) return '—';
  const days = differenceInCalendarDays(new Date(p.expected_return_date), new Date());
  if (p.is_overdue || days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d remaining`;
}

export default function PendingReturns(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awaitingCount, setAwaitingCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [remarksDraft, setRemarksDraft] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, rowsRes] = await Promise.all([
        gp().rpc('kpis', { p_department_id: null }),
        gp()
          .from('v_gate_passes')
          .select('*')
          .eq('return_status', 'awaiting_return')
          .order('is_overdue', { ascending: false })
          .order('expected_return_date', { ascending: true }),
      ]);
      if (kpiRes.error) throw kpiRes.error;
      if (rowsRes.error) throw rowsRes.error;

      const kpiRow = (kpiRes.data as { awaiting_return: number; overdue: number }[] | null)?.[0];
      setAwaitingCount(kpiRow?.awaiting_return ?? 0);
      setOverdueCount(kpiRow?.overdue ?? 0);
      setRows((rowsRes.data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openReturnPanel(passId: string) {
    setExpandedId(passId);
    setRemarksDraft('');
    setActionError(null);
  }

  function closeReturnPanel() {
    setExpandedId(null);
    setRemarksDraft('');
    setActionError(null);
  }

  async function handleMarkReturned(pass: GatePassView) {
    setSubmittingId(pass.id);
    setActionError(null);
    try {
      const { error: rpcErr } = await gp().rpc('mark_returned', {
        p_pass_id: pass.id,
        p_remarks: remarksDraft.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      closeReturnPanel();
      await load();
    } catch (err) {
      setActionError(safeErrorMessage(err));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pending Returns</h1>
        <p className="page-subtitle">Returnable material still out at the gate.</p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <KpiCard label="Awaiting Return" value={awaitingCount} tone="brand" loading={loading} />
        <KpiCard label="Overdue" value={overdueCount} tone="overdue" loading={loading} />
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="table-wrap empty-state">No returnable material outstanding.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Visitor / Company</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Expected Return</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <React.Fragment key={p.id}>
                  <tr className={p.is_overdue ? 'border-l-4 border-l-overdue-500/40' : ''}>
                    <td className="font-semibold text-navy-900">{p.pass_number}</td>
                    <td>
                      <TypeChip type={p.type} />
                    </td>
                    <td>
                      {p.visitor_name}
                      {p.visitor_company && <span className="text-navy-400"> · {p.visitor_company}</span>}
                    </td>
                    <td className="max-w-[220px] truncate">{p.material_description}</td>
                    <td className="tabular">
                      {p.quantity} {p.unit}
                    </td>
                    <td className="tabular whitespace-nowrap">{formatDateOnly(p.expected_return_date)}</td>
                    <td>
                      {p.is_overdue ? <Badge style={OVERDUE_STYLE} /> : <span className="text-sm text-navy-500">{daysIndicator(p)}</span>}
                    </td>
                    <td>
                      <button type="button" className="btn-secondary" onClick={() => openReturnPanel(p.id)}>
                        Mark Returned
                      </button>
                    </td>
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td colSpan={8} className="bg-surface-50 p-4">
                        <div className="flex flex-col gap-3 max-w-xl">
                          <label className="label">Remarks (optional)</label>
                          <textarea
                            className="input"
                            rows={2}
                            value={remarksDraft}
                            onChange={(e) => setRemarksDraft(e.target.value)}
                            placeholder="Condition on return, who collected it, etc."
                            autoFocus
                          />
                          {actionError && <div className="alert-error">{actionError}</div>}
                          <div className="flex gap-3">
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={closeReturnPanel}
                              disabled={submittingId === p.id}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleMarkReturned(p)}
                              disabled={submittingId === p.id}
                            >
                              {submittingId === p.id ? 'Recording…' : 'Confirm Return'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

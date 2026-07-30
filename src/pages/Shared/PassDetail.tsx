// Shared pass-detail page — readable by HOD (own departments), security, and
// admin. RLS scopes what `v_gate_passes` returns; this component just renders
// whatever comes back, and treats "nothing came back" as "no access / not found".
import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { gp, supabase } from '../../supabaseClient';
import type { GatePassView, GatePassItemView, Verification, VerifyAction } from '../../types';
import { PASS_TYPES } from '../../lib/passTypes';
import { STATUS_STYLES, OVERDUE_STYLE } from '../../lib/statusStyles';
import { formatDateTime, formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import Badge, { TypeChip } from '../../components/Badge';
import QrPass from '../../components/QrPass';
import VoidPassPanel from '../HOD/VoidPassPanel';

/** `gatepass.v_verifications` — the table plus the security officer's name. */
interface VerificationView extends Verification {
  security_name: string;
}

const ACTION_DOT: Record<VerifyAction, string> = {
  matched: 'bg-matched-500',
  flagged: 'bg-flagged-500',
  returned: 'bg-brand-600',
  held: 'bg-pending-500',
  hod_reviewed: 'bg-accent-500',
  cancelled: 'bg-navy-400',
};

const ACTION_LABEL: Record<VerifyAction, string> = {
  matched: 'Matched at gate',
  flagged: 'Mismatched at gate',
  returned: 'Returned',
  held: 'Held at gate',
  hod_reviewed: 'HOD approved override',
  cancelled: 'Voided by HOD',
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <dt className="text-xs font-bold text-navy-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-navy-900 mt-0.5">{value ?? '—'}</dd>
    </div>
  );
}

export default function PassDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [verifications, setVerifications] = useState<VerificationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreated, setShowCreated] = useState(searchParams.get('created') === '1');

  // Cancel lives here as well as on /my-passes because RaisePass navigates
  // straight to this page after a successful insert. Landing on the pass you
  // just raised with no way to undo it — and having to find your way to another
  // screen to do it — was the whole problem.
  const [userId, setUserId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function handleCancelConfirm(reason: string) {
    if (!pass) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const { error: rpcErr } = await gp().rpc('cancel_pass', { p_pass_id: pass.id, p_reason: reason });
      if (rpcErr) throw rpcErr;
      setCancelOpen(false);
      setReloadKey((k) => k + 1); // re-read so status and the reason banner update
    } catch (err) {
      setCancelError(safeErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPass(undefined);
      setError(null);
      try {
        const { data, error: passErr } = await gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle();
        if (passErr) throw passErr;
        if (cancelled) return;
        setPass((data as GatePassView | null) ?? null);

        if (data) {
          const { data: itemRows, error: itemErr } = await gp()
            .from('v_gate_pass_items')
            .select('*')
            .eq('gate_pass_id', id)
            .order('line_no');
          if (itemErr) throw itemErr;
          if (!cancelled) setItems((itemRows as GatePassItemView[] | null) ?? []);

          const { data: verifs, error: verifErr } = await gp()
            .from('v_verifications')
            .select('*')
            .eq('gate_pass_id', id)
            .order('created_at');
          if (verifErr) throw verifErr;
          if (!cancelled) setVerifications((verifs as VerificationView[] | null) ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(safeErrorMessage(err));
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function dismissCreated() {
    setShowCreated(false);
    const next = new URLSearchParams(searchParams);
    next.delete('created');
    setSearchParams(next, { replace: true });
  }

  if (pass === undefined) {
    return (
      <div className="flex flex-col gap-4 max-w-4xl">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-40 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (pass === null) {
    return (
      <div className="empty-state card p-10">
        <p className="text-navy-700 font-medium">Pass not found, or you don't have access to it.</p>
        {error && <p className="text-sm text-flagged-700 mt-2">{error}</p>}
        <Link to="/" className="btn-secondary inline-block mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const companyInfo = parseCompanyInfo(pass.visitor_company);
  // Mirrors cancel_pass exactly: pending, and raised by the signed-in user.
  // Role is not re-checked here — only an HOD can ever be a pass's raised_by,
  // so raised_by === me already implies it, and the RPC re-checks regardless.
  const canCancel = pass.status === 'pending' && userId !== null && pass.raised_by === userId;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {showCreated && (
        <div className="alert-success justify-between">
          <span>
            Gate pass raised. It is now in the security queue.{' '}
            <Link to={`/pass/${pass.id}/print`} className="font-semibold underline">
              Print it now
            </Link>
            .
          </span>
          <button type="button" className="btn-icon" onClick={dismissCreated} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      <div className="card p-6 flex items-start justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight font-mono text-navy-950">{pass.pass_number}</h1>
            <TypeChip type={pass.type} />
            <Badge style={STATUS_STYLES[pass.status]} />
            {pass.is_overdue && <Badge style={OVERDUE_STYLE} />}
          </div>
          <p className="text-sm text-navy-400">{PASS_TYPES[pass.type].label}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Link to={`/pass/${pass.id}/print`} className="btn-secondary w-fit">
              Print Pass
            </Link>
            {/* Shown only to the HOD who raised it, and only while pending —
                the same three conditions cancel_pass enforces server-side. The
                RPC is the authority; this just avoids offering a button that
                would be refused. */}
            {canCancel && (
              <button type="button" className="btn-danger w-fit" onClick={() => setCancelOpen(true)}>
                Cancel Pass
              </button>
            )}
          </div>
        </div>
        {/* Encodes qr_token, NOT pass_number: the number is sequential, so a QR
            built from it could be forged for a pass nobody ever held. */}
        <QrPass value={pass.qr_token} size={110} />
      </div>

      {pass.status === 'flagged' && (
        <div className="alert-error flex-col items-start gap-2">
          <p className="font-semibold">
            Mismatched by {pass.verified_by_name ?? 'security'} — {formatDateTime(pass.verified_at)}
          </p>
          <p>{pass.flag_reason ?? 'No reason recorded.'}</p>
          {userId !== null && pass.raised_by === userId && (
            <div className="flex flex-wrap gap-2 mt-1">
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  try {
                    const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
                      p_pass_id: pass.id,
                      p_action: 'approve',
                    });
                    if (rpcErr) throw rpcErr;
                    setReloadKey((k) => k + 1);
                  } catch (err) {
                    setError(safeErrorMessage(err));
                  }
                }}
              >
                Approve Override
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={async () => {
                  try {
                    const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
                      p_pass_id: pass.id,
                      p_action: 'reject',
                      p_reason: 'HOD rejected after security flag',
                    });
                    if (rpcErr) throw rpcErr;
                    setReloadKey((k) => k + 1);
                  } catch (err) {
                    setError(safeErrorMessage(err));
                  }
                }}
              >
                Reject & Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {pass.status === 'hod_reviewed' && (
        <div className="alert-success flex-col items-start gap-1">
          <p className="font-semibold">
            HOD approved — awaiting dispatch at the gate
          </p>
        </div>
      )}

      {/* cancel_pass REQUIRES a reason, so until this existed the reason was
          collected on every void and then readable by nobody. Warning rather
          than error styling: a void is the HOD withdrawing their own paperwork,
          not a finding against anyone. */}
      {pass.status === 'cancelled' && (
        <div className="alert-warning flex-col items-start gap-1">
          <p className="font-semibold">Voided by the HOD who raised it</p>
          <p>{pass.cancel_reason ?? 'No reason recorded.'}</p>
        </div>
      )}

      <div className="card p-6">
        <h2 className="section-title mb-4">Pass Details</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <DetailRow label="Authorized Person" value={pass.visitor_name} />
          <DetailRow label="Contact No" value={companyInfo.phone || '—'} />
          <DetailRow label="Company" value={companyInfo.name} />
          <DetailRow label="Company Address" value={companyInfo.address || '—'} />
          <DetailRow label="Vehicle Number" value={pass.vehicle_number} />
          <DetailRow label="Department" value={pass.department_name} />
          <DetailRow label="Raised By" value={pass.raised_by_name} />
          <DetailRow label="Raised At" value={formatDateTime(pass.created_at)} />
        </dl>
      </div>

      <div className="card p-6">
        <h2 className="section-title mb-4">Material Items ({pass.item_count})</h2>
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <div key={item.id} className="border border-navy-200 rounded-lg p-4 bg-surface-50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <DetailRow label="Item Name" value={item.name} />
                <DetailRow label="Description" value={item.description} />
                <DetailRow label="Purpose / Reason" value={item.purpose} />
                <DetailRow label="Quantity" value={`${item.quantity} ${item.unit}`} />
                <DetailRow label="Serial No." value={item.serial_no || '—'} />
                <DetailRow label="Approx Value" value={item.approx_value != null ? `₹${item.approx_value.toLocaleString('en-IN')}` : '—'} />
                <DetailRow label="Expected Return Date" value={item.expected_return_date ? formatDateOnly(item.expected_return_date) : '—'} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="section-title mb-4">Verification Timeline</h2>
        {verifications.length === 0 ? (
          <p className="empty-state !py-6">Not yet verified at the gate.</p>
        ) : (
          <ol className="flex flex-col gap-5">
            {verifications.map((v) => {
              const qtyMismatch =
                v.verified_quantity !== null && v.verified_quantity !== pass.total_quantity;
              return (
                <li key={v.id} className="flex gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${ACTION_DOT[v.action]}`} />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold text-navy-900">
                      {ACTION_LABEL[v.action]} — {v.security_name}
                    </p>
                    <p className="text-xs text-navy-400">{formatDateTime(v.created_at)}</p>
                    {qtyMismatch && (
                      <p className="text-sm font-semibold text-flagged-700">
                        Counted {v.verified_quantity} — declared {pass.total_quantity}
                      </p>
                    )}
                    {v.verified_vehicle && (
                      <p className="text-sm text-navy-700">Vehicle checked: {v.verified_vehicle}</p>
                    )}
                    {v.remarks && <p className="text-sm text-navy-700">{v.remarks}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {cancelOpen && (
        <VoidPassPanel
          pass={pass}
          submitting={cancelling}
          error={cancelError}
          onCancel={() => {
            setCancelOpen(false);
            setCancelError(null);
          }}
          onConfirm={handleCancelConfirm}
        />
      )}
    </div>
  );
}

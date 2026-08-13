// Shared pass-detail page — readable by HOD (own departments), security, and
// admin. RLS scopes what `v_gate_passes` returns; this component just renders
// whatever comes back, and treats "nothing came back" as "no access / not found".
import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { gp, supabase } from '../../supabaseClient';
import type { GatePassView, GatePassItemView, Verification, VerifyAction } from '../../types';
import { PASS_TYPES } from '../../lib/passTypes';
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import { passStageStyle } from '../../lib/passStage';
import { formatDateTime, formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import Badge, { TypeChip } from '../../components/Badge';
import QrPass from '../../components/QrPass';
import FlaggedReviewActions from './FlaggedReviewActions';
import DetailRow from './DetailRow';
import PassDetailItems from './PassDetailItems';

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

export default function PassDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [verifications, setVerifications] = useState<VerificationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreated, setShowCreated] = useState(searchParams.get('created') === '1');

  // Raised passes are permanent — there is no cancellation (migration 024).
  const [userId, setUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

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
            {/* The SAME single badge every card shows, so a pass that read
                "Closed" in the list cannot read "Matched" at the top of its
                own record. `status` freezes at 'matched' after the outward
                trip — only `return_status` moves — which is why the raw
                status map was wrong here (client, 2026-08-11). */}
            <Badge style={passStageStyle(pass)} />
            {pass.is_overdue && <Badge style={OVERDUE_STYLE} />}
          </div>
          <p className="text-sm text-navy-500">{PASS_TYPES[pass.type].label}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Link to={`/pass/${pass.id}/print`} className="btn-secondary w-fit">
              Print Pass
            </Link>
          </div>
        </div>
        {/* Encodes qr_token, NOT pass_number: the number is sequential, so a QR
            built from it could be forged for a pass nobody ever held. */}
        <QrPass value={pass.qr_token} size={110} />
      </div>

      {pass.status === 'flagged' && (
        <div className="alert-error flex-col items-start gap-3">
          <p className="font-semibold">
            Mismatched by {pass.verified_by_name ?? 'security'} — {formatDateTime(pass.verified_at)}
          </p>
          <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-3 py-2 w-full">
            <p className="text-xs font-bold text-flagged-700 uppercase tracking-wider mb-1">
              Reason given by security
            </p>
            <p className="text-sm font-semibold text-flagged-700 whitespace-pre-wrap break-words">
              {pass.flag_reason ?? 'No reason recorded.'}
            </p>
          </div>
          {userId !== null && pass.raised_by === userId && (
            <div className="flex flex-col gap-2 mt-1">
              <p className="text-xs text-flagged-700">
                Approving lets this material through despite the mismatch. The reason above stays on the record.
              </p>
              <FlaggedReviewActions
                passId={pass.id}
                onDone={() => setReloadKey((k) => k + 1)}
                onError={(message) => setError(message)}
              />
            </div>
          )}
        </div>
      )}

      {pass.status === 'hod_reviewed' && (
        <div className="alert-success flex-col items-start gap-1">
          <p className="font-semibold">
            HOD approved — awaiting dispatch at the gate
          </p>
          {pass.flag_reason && (
            <p className="text-sm text-navy-500 whitespace-pre-wrap break-words">
              Originally flagged for: {pass.flag_reason}
            </p>
          )}
        </div>
      )}

      {pass.status === 'cancelled' && (
        <div className="alert-error flex-col items-start gap-1">
          <p className="font-semibold">
            Rejected by HOD — this pass is closed and cannot be used at the gate
          </p>
          {pass.flag_reason && (
            <p className="text-sm text-navy-500 whitespace-pre-wrap break-words">
              Security flagged it for: {pass.flag_reason}
            </p>
          )}
        </div>
      )}

      <div className="card p-6">
        <h2 className="card-title mb-4">Pass Details</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <DetailRow label="Authorized Person's Name" value={pass.visitor_name} />
          <DetailRow label="Contact No" value={companyInfo.phone || '—'} />
          <DetailRow label="Vendor" value={companyInfo.name || '—'} emphasize />
          <DetailRow label="Vendor Address" value={companyInfo.address || '—'} />
          <DetailRow label="Vehicle Number" value={pass.vehicle_number} />
          <DetailRow label="Department" value={pass.department_name} />
          <DetailRow label="Raised By" value={pass.raised_by_name} emphasize />
          <DetailRow label="Raised At" value={formatDateTime(pass.created_at)} />
          {/* RGP only — an NRGP never comes back, so omit rather than show a
              misleading "—" that reads as missing data. */}
          {pass.type === 'RGP' && pass.expected_return_date && (
            <DetailRow label="Expected Return" value={formatDateOnly(pass.expected_return_date)} emphasize />
          )}
        </dl>
      </div>

      <PassDetailItems items={items} itemCount={pass.item_count} passType={pass.type} />

      <div className="card p-6">
        <h2 className="card-title mb-4">Verification Timeline</h2>
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
                    <p className="text-xs text-navy-500">{formatDateTime(v.created_at)}</p>
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
    </div>
  );
}

// EXPIRED REVIEW — where an expiry notification lands.
//
// The client's flow (2026-08-17): "if something is not out and has expired, make
// it null and void and notify the HOD about that so that he can either raise it
// or reject it. He can review it and raise it or maybe void it completely."
//
// WHAT "NULL AND VOID" ALREADY MEANS BEFORE ANYONE PRESSES ANYTHING. Expiry is
// derived from `expires_at` (008/028) and `match_pass` refuses an expired pass,
// so from the moment the clock passes it, nothing the guard does can release
// that material. This screen does not make the pass void; it tells the HOD that
// it IS void, and lets them close the paperwork.
//
// TWO DECISIONS, the same two the mismatch screen offers, through the same
// panel:
//
//   Void It Permanently — `hod_void_expired_pass` (041): status → 'cancelled'
//                         plus a `verifications` row, so the void has an author
//                         and a time. The RPC re-checks expiry ON THE SERVER, so
//                         this screen cannot void a live pass even if it draws
//                         the button by mistake.
//   Raise It Again      — the raise form, pre-filled from this pass. The old one
//                         is voided by that form only AFTER the replacement is
//                         actually submitted: an HOD who opens the form and
//                         walks away must not have destroyed the record of what
//                         was authorised.
//
// A pass that is no longer `pending` gets an explanation instead of buttons the
// RPC would refuse — the same rule the mismatch screen follows. Authority is the
// database's; this page only decides what to draw.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { useNotifications } from '../../lib/notifications';
import { formatDateTime } from '../../lib/formatDate';
import { categoryFor } from '../../lib/passTypes';
import { isExpiredPending } from '../../lib/statusStyles';
import PassRow from '../../components/PassRow';
import PassDecisionPanel from './PassDecisionPanel';

export default function ExpiredReview(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { dismissPass } = useNotifications();

  const [pass, setPass] = useState<GatePassView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    // Cleared UP FRONT, never on the success path: a re-read that resolves in the
    // same microtask queue as a failed action would otherwise wipe the banner
    // before it ever rendered (the 2026-08-13 BlacklistTab bug).
    setError(null);
    try {
      const { data, error: err } = await gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle();
      if (err) throw err;
      setPass((data as GatePassView | null) ?? null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function voidPass(reason: string | null) {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('hod_void_expired_pass', {
        p_pass_id: id,
        p_reason: reason,
      });
      if (rpcErr) throw rpcErr;
      dismissPass(id);
      navigate('/dashboard');
    } catch (err) {
      setError(safeErrorMessage(err));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Expired Gate Pass</h1>
        </div>
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }

  if (!pass) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Expired Gate Pass</h1>
        </div>
        {error && <div className="alert-error mb-6">{error}</div>}
        <div className="empty-state">
          That gate pass could not be found, or it is not one you may review.
        </div>
      </div>
    );
  }

  // The screen's own eligibility test uses the view's `is_expired`, never a
  // comparison against `expires_at` in TypeScript: the view computes expiry in
  // `site_tz()` and a re-derivation here would disagree with `match_pass` about
  // every pass raised after 18:30 IST.
  const decidable = isExpiredPending(pass);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Expired Gate Pass</h1>
        <p className="page-subtitle">
          {pass.pass_number} · {categoryFor(pass.type, pass.direction).label}
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* What happened, in the consequence's own words. An HOD deciding what to
          do next is deciding about this sentence, so it gets the top of the page
          rather than a line in a table. */}
      <div className="card border border-overdue-500/30 bg-overdue-50/40 p-5 mb-6">
        <h2 className="card-title text-overdue-700 mb-3">Null and void</h2>
        <p className="text-body text-navy-900 font-semibold mb-3">
          This pass was never presented at the gate before it expired, so the material was never
          released. Security can no longer clear it — a replacement pass is the only way the
          material moves.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt className="text-micro text-navy-500 uppercase">Raised</dt>
            <dd className="text-body text-navy-900 tabular">{formatDateTime(pass.created_at)}</dd>
          </div>
          <div>
            <dt className="text-micro text-navy-500 uppercase">Expired</dt>
            <dd className="text-body text-navy-900 tabular">
              {pass.expires_at ? formatDateTime(pass.expires_at) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mb-6">
        <PassRow pass={pass} onOpen={(passId) => navigate(`/pass/${passId}`)} compact />
      </div>

      <PassDecisionPanel
        settled={!decidable}
        settledContent={
          <>
            This pass is no longer awaiting your decision — nothing further is needed here.{' '}
            <Link to={`/pass/${pass.id}`} className="text-accent-600 hover:underline font-semibold">
              View the pass
            </Link>
            .
          </>
        }
        voidLabel="Void It Permanently"
        voidWarning="This is final. The pass will be closed as void and can never be verified at the gate."
        help="Raising it again opens a new gate pass pre-filled from this one. This pass is voided only once the replacement is submitted."
        busy={busy}
        onRaise={() => navigate('/raise', { state: { copyFrom: pass.id } })}
        onVoid={(reason) => void voidPass(reason)}
      />
    </div>
  );
}

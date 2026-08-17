// MISMATCH REVIEW — where a mismatch notification lands.
//
// The client's flow, in full (2026-08-17): security flags a pass at the gate,
// the raising HOD is notified on the bell, and clicking that notice must show
// what the pass was, WHY it was stopped and WHO stopped it, then offer exactly
// two decisions:
//
//   Reject Permanently — the pass is void and can never be verified. This is
//                        `hod_review_flagged_pass(p_action => 'reject')`, which
//                        moves it to `cancelled` and writes a `verifications`
//                        row. There is no undo, so it sits behind an inline
//                        confirmation (never `window.confirm` — it blocks the
//                        page and breaks automation).
//   Raise It Again     — opens the raise form pre-filled from this pass. The
//                        OLD pass is voided by that form once the new one is
//                        actually submitted, not now: an HOD who opens the form
//                        and walks away must not have destroyed the only record
//                        of what the gate stopped.
//
// THIS PAGE HAS NO "APPROVE OVERRIDE" BUTTON, and that is deliberate rather than
// an omission. The override still exists — it is on the pass detail page, where
// it always was — but it is a different decision (the paperwork is fine, release
// the material) and the client asked for these two. Putting three buttons under
// a heading that promises two is how a screen gets misread at speed.
//
// AUTHORITY IS THE DATABASE'S. `hod_review_flagged_pass` refuses anyone who did
// not raise the pass; this page only decides what to draw. A reader who reaches
// it for someone else's pass, or for a pass that is no longer flagged, gets a
// plain explanation instead of buttons that would fail.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { useNotifications } from '../../lib/notifications';
import { formatDateTime } from '../../lib/formatDate';
import { categoryFor } from '../../lib/passTypes';
import PassRow from '../../components/PassRow';
import PassDecisionPanel from './PassDecisionPanel';

export default function MismatchReview(): React.ReactElement {
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

  async function reject(reason: string | null) {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
        p_pass_id: id,
        p_action: 'reject',
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
          <h1 className="page-title">Mismatch Review</h1>
        </div>
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }

  if (!pass) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Mismatch Review</h1>
        </div>
        {error && <div className="alert-error mb-6">{error}</div>}
        <div className="empty-state">
          That gate pass could not be found, or it is not one you may review.
        </div>
      </div>
    );
  }

  const settled = pass.status !== 'flagged';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Mismatch Review</h1>
        <p className="page-subtitle">
          {pass.pass_number} · {categoryFor(pass.type, pass.direction).label}
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* Why, and by whom — the two facts the client asked for, given the whole
          top of the page rather than a line in a table. An HOD deciding whether
          to void a pass is deciding about this text. */}
      <div className="card border border-flagged-500/30 bg-flagged-50/40 p-5 mb-6">
        <h2 className="card-title text-flagged-700 mb-3">Stopped at the gate</h2>
        <p className="text-body text-navy-900 font-semibold mb-3">
          {pass.flag_reason || 'No reason was recorded.'}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt className="text-micro text-navy-500 uppercase">Flagged by</dt>
            <dd className="text-body text-navy-900">{pass.verified_by_name || 'Security'}</dd>
          </div>
          <div>
            <dt className="text-micro text-navy-500 uppercase">Flagged at</dt>
            <dd className="text-body text-navy-900 tabular">
              {pass.flagged_at ? formatDateTime(pass.flagged_at) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mb-6">
        <PassRow pass={pass} onOpen={(passId) => navigate(`/pass/${passId}`)} compact />
      </div>

      <PassDecisionPanel
        settled={settled}
        settledContent={
          <>
            This pass is no longer awaiting your decision — nothing further is needed here.{' '}
            <Link to={`/pass/${pass.id}`} className="text-accent-600 hover:underline font-semibold">
              View the pass
            </Link>
            .
          </>
        }
        voidLabel="Reject Permanently"
        voidWarning="This is final. The pass will be void and the material will not be released."
        help="Raising it again opens a new gate pass pre-filled from this one. This pass is voided only once the corrected one is submitted."
        busy={busy}
        onRaise={() => navigate('/raise', { state: { copyFrom: pass.id } })}
        onVoid={(reason) => void reject(reason)}
      />
    </div>
  );
}

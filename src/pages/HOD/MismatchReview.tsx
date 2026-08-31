// REJECTED AT THE GATE — where a rejection notification lands.
//
// Security stops a pass at the barrier in writing, the raising HOD is notified
// on the bell, and clicking that notice shows what the pass was, WHY it was
// stopped and WHO stopped it (client, 2026-08-17).
//
// THERE IS NOW EXACTLY ONE THING TO DO HERE, AND IT IS NOT A DECISION. Client,
// 2026-08-31: "once a guard rejects a pass he has to mention the justification
// as to why is he rejecting the pass and then the entire pass will be cancelled
// and a new pass needs to be raised." Migration 070 dropped
// `hod_review_flagged_pass` accordingly, so the two answers this page used to
// offer are both gone:
//
//   Reject Permanently — the pass is ALREADY closed when this page opens.
//                        Asking the HOD to reject what security already
//                        rejected was a button that changed nothing.
//   Send Back to the Gate — the override, which lived on the pass record. It is
//                        deleted with the RPC behind it: a guard's refusal can
//                        no longer be answered by the requester at all.
//
// WHAT IS LEFT IS RAISE IT AGAIN — the raise form, pre-filled from this pass so
// the HOD corrects it rather than retyping it. Nothing is voided when it is
// pressed, because there is nothing left to void.
//
// AUTHORITY IS STILL THE DATABASE'S: this page reads a pass through
// `gate_passes_select` and draws it. A reader who reaches it for someone else's
// pass gets a plain explanation instead of a screen that would fail.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { useNotifications } from '../../lib/notifications';
import { formatDateTime } from '../../lib/formatDate';
import { categoryFor } from '../../lib/passTypes';
import PassRow from '../../components/PassRow';

export default function MismatchReview(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { dismissPass } = useNotifications();

  const [pass, setPass] = useState<GatePassView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Rejected at Security Gate</h1>
        </div>
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }

  if (!pass) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Rejected at Security Gate</h1>
        </div>
        {error && <div className="alert-error mb-6">{error}</div>}
        <div className="empty-state">
          That gate pass could not be found, or it is not one you may review.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rejected at Security Gate</h1>
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

      {/* ONE ACTION, and it is not a decision about this pass: the pass is
          closed, and the only thing that moves the material is a new one. The
          notice is dismissed as the HOD leaves — they have now read it, and it
          must not sit on the bell for a pass nothing can be done about. */}
      <div className="card p-5">
        <h2 className="card-title mb-2">This pass is cancelled</h2>
        <p className="text-body text-navy-700 mb-4">
          A rejection at the gate is final — the material was not released and this pass cannot be
          used again. Raising it again opens a new gate pass pre-filled from this one, so you correct
          what security stopped rather than retype it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              dismissPass(pass.id);
              navigate('/raise', { state: { copyFrom: pass.id } });
            }}
          >
            Raise It Again
          </button>
          <Link to={`/pass/${pass.id}`} className="btn-secondary text-center">
            View the pass
          </Link>
        </div>
      </div>

    </div>
  );
}

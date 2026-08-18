// `/pass/:id` — the one gate-pass record, readable by the HOD (own
// departments), security and admin. RLS scopes what `v_gate_passes` returns;
// this component renders whatever comes back and treats "nothing came back"
// as "no access / not found".
//
// IT RENDERS THE SEARCH PASS RECORD (client, 2026-08-18: "whenever we are
// clicking to check the details of our gate pass, it should show exactly in
// the same format as when we are searching with that gate pass"). Every
// stacked list in the app — the guard's KPI drills, the board drills, Overdue
// Items, Scheduled Returns, My Passes, the notification bell — routes here, so
// swapping this page's body for `PassRecordView` makes every drill-down
// identical in one place. There is no second detail format left; `DetailRow`
// and `PassDetailItems` were deleted with it.
//
// What this page adds, and the search screen does not have: the "pass raised"
// banner, and the raising HOD's decision panels (the flagged override, and the
// notices for an approved or rejected pass). They sit ABOVE the record, so the
// record itself is byte-for-byte what the gate sees.
import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useGatePassRecord } from '../../lib/useGatePassRecord';
import PassRecordView from '../../components/passview/PassRecordView';
import { formatDateTime } from '../../lib/formatDate';
import FlaggedReviewActions from './FlaggedReviewActions';

export default function PassDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreated, setShowCreated] = useState(searchParams.get('created') === '1');
  const [error, setError] = useState<string | null>(null);

  // Raised passes are permanent — there is no cancellation (migration 024).
  const [userId, setUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { record, error: loadError } = useGatePassRecord(id ?? null, reloadKey);

  function dismissCreated() {
    setShowCreated(false);
    const next = new URLSearchParams(searchParams);
    next.delete('created');
    setSearchParams(next, { replace: true });
  }

  if (record === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-40 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (record === null) {
    return (
      <div className="empty-state card p-10">
        <p className="text-navy-700 font-medium">Pass not found, or you don't have access to it.</p>
        {loadError && <p className="text-sm text-flagged-700 mt-2">{loadError}</p>}
        <Link to="/" className="btn-secondary inline-block mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { pass } = record;

  return (
    <div className="flex flex-col gap-5">
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

      {(error || loadError) && <div className="alert-error">{error ?? loadError}</div>}

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
          <p className="font-semibold">HOD approved — awaiting dispatch at the gate</p>
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

      <PassRecordView record={record} />
    </div>
  );
}

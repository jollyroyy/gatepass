// THE REVIEW QUEUE for emergency releases (migration 055).
//
// THIS CARD IS THE CONTROL, not the release button. A super admin skipping the
// approval ladder is only defensible if somebody who was not them looks at it
// afterwards and says so on the record — that is what SAP GRC's Firefighter
// controller step does, and what NIST AC-2/AU-6, ISO 27001 A.8.2 and SOX's
// treatment of management override all require. Without this screen, an
// emergency release is just a way to skip four signatures.
//
// UNREVIEWED FIRST, oldest first within that — the order the work should be
// done in, and it is the RPC that sorts, not this component.
//
// THE FOUR-EYES RULE IS THE DATABASE'S. `review_emergency_release` refuses the
// person who made the release; `canReviewRelease` restates it so the button is
// not drawn where the RPC would refuse. An admin looking at their OWN release
// sees it listed, with a sentence saying somebody else has to review it — never
// a control that will fail, and never a hidden row, because hiding it is how an
// override goes unreviewed forever.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMyProfile } from '../../lib/useMyProfile';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import {
  canReviewRelease,
  fetchEmergencyReleases,
  reviewEmergencyRelease,
  type EmergencyReleaseRow,
} from '../../lib/emergencyRelease';

export default function EmergencyReleasesCard(): React.ReactElement | null {
  const { profile } = useMyProfile();
  const [rows, setRows] = useState<EmergencyReleaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchEmergencyReleases());
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not read the emergency release log.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function review(passId: string): Promise<void> {
    setBusy(passId);
    setError(null);
    try {
      await reviewEmergencyRelease(passId, note[passId] ?? '');
      await load();
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not record that review.'));
    } finally {
      setBusy(null);
    }
  }

  // NOTHING TO SHOW IS NOT AN EMPTY STATE HERE — it is the normal, healthy
  // condition of a system nobody has had to override, and a permanent empty
  // card would train an admin to ignore this corner of the screen. A FAILED
  // read is different and must still be said out loud.
  if (!loading && !error && rows.length === 0) return null;

  const unreviewed = rows.filter((r) => !r.reviewed_at).length;

  return (
    <div className="card p-4 space-y-3">
      <h2 className="section-title mb-0">Emergency releases</h2>
      <p className="text-sm text-navy-500">
        Gate passes released past their approval ladder by a super admin.{' '}
        {unreviewed > 0
          ? `${unreviewed} still ${unreviewed === 1 ? 'needs' : 'need'} reviewing by an admin other than the one who released ${unreviewed === 1 ? 'it' : 'them'}.`
          : 'All of them have been reviewed.'}
      </p>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="skeleton h-16 w-full" />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const mine = !!profile && r.released_by === profile.id;
            const canReview = canReviewRelease(r, profile?.role ?? null, profile?.id ?? null);
            return (
              <li key={r.gate_pass_id} className="rounded-lg border border-navy-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link to={`/pass/${r.gate_pass_id}`} className="font-semibold text-accent-600">
                    {r.pass_number ?? 'Deleted pass'}
                  </Link>
                  <span className="text-xs text-navy-500">
                    {r.released_name ?? 'Unnamed account'} · {formatDateTime(r.released_at)}
                  </span>
                </div>
                <p className="text-sm text-navy-700 mt-1">{r.reason}</p>

                {r.reviewed_at ? (
                  <p className="text-xs text-matched-700 mt-2">
                    Reviewed by {r.reviewed_name ?? 'an admin'} on {formatDateTime(r.reviewed_at)}
                    {r.review_note ? ` — ${r.review_note}` : ''}
                  </p>
                ) : mine ? (
                  <p className="text-xs text-pending-700 mt-2">
                    You released this, so somebody else has to review it.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <input
                      className="input flex-1 min-w-[14rem]"
                      aria-label={`Review note for ${r.pass_number ?? r.gate_pass_id}`}
                      placeholder="Note (optional)"
                      value={note[r.gate_pass_id] ?? ''}
                      disabled={busy !== null || !canReview}
                      onChange={(e) => setNote((n) => ({ ...n, [r.gate_pass_id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy !== null || !canReview}
                      onClick={() => void review(r.gate_pass_id)}
                    >
                      Mark reviewed
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

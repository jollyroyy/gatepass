// Migration 039: an admin can no longer remove a blacklist entry directly —
// they REQUEST whitelisting with a mandatory justification, and the
// designated CEO decides. This tab lists every request, pending first, then
// a Decided group underneath. Only the CEO sees Approve/Reject controls.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { WhitelistRequest } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import WhitelistRequestCard from './WhitelistRequestCard';

export default function WhitelistRequestsTab(): React.ReactElement {
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [isCeo, setIsCeo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared up front, never on success: a refresh resolving after a failed
    // decision would otherwise wipe the refusal before it could be read.
    setError(null);
    try {
      const [ceoRes, listRes] = await Promise.all([
        gp().rpc('is_ceo'),
        gp().rpc('list_whitelist_requests', { p_status: null }),
      ]);
      if (ceoRes.error) throw ceoRes.error;
      if (listRes.error) throw listRes.error;
      setIsCeo(Boolean(ceoRes.data));
      setRequests((listRes.data as WhitelistRequest[]) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  return (
    <div>
      <h2 className="section-title mb-4">Whitelist Requests</h2>

      {error && <div className="alert-error mb-4">{error}</div>}

      {!loading && !isCeo && (
        <p className="text-sm text-navy-500 mb-4">
          Only the designated CEO can approve or reject a whitelist request. You can still review them below.
        </p>
      )}

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="table-wrap empty-state">No whitelist requests.</div>
      ) : (
        <>
          <div className="space-y-3 mb-6">
            {pending.length === 0 ? (
              <div className="table-wrap empty-state">No pending requests.</div>
            ) : (
              pending.map((r) => (
                <WhitelistRequestCard key={r.id} request={r} isCeo={isCeo} onDecided={load} onError={setError} />
              ))
            )}
          </div>

          {decided.length > 0 && (
            <>
              <h3 className="section-title">Decided</h3>
              <div className="space-y-3">
                {decided.map((r) => (
                  <WhitelistRequestCard key={r.id} request={r} isCeo={isCeo} onDecided={load} onError={setError} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

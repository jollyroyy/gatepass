// Migration 039: an admin can no longer remove a blacklist entry directly —
// they REQUEST whitelisting with a mandatory justification, and the
// designated CEO decides.
//
// THE SCREEN IS A LIST OF NAMES, NOT A LIST OF RECORDS (client, 2026-08-20):
// each request is a collapsed card and its detail — the block reason, the
// justification, the decision, and the CEO's Approve/Reject — appears only on
// the card that was opened. The OPEN CARD IS HELD HERE, one across all three
// groups, because "one at a time" is a fact about the screen and a card cannot
// know that another was opened.
//
// A DECIDED REQUEST LEAVES THE WAITING LIST (client: "suppose I have already
// given the approval, that should not appear in the approval waiting list").
// That is not a filter written twice: a decision RE-READS the list and the row
// is filed by its own `status`, so the waiting group is by construction the
// requests that still owe a decision.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { WhitelistRequest } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import WhitelistRequestCard from './WhitelistRequestCard';
import WhitelistKpiCards from './WhitelistKpiCards';
import { groupWhitelistRequests, whitelistKpis } from '../../lib/whitelistCounts';

export default function WhitelistRequestsTab(): React.ReactElement {
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [isCeo, setIsCeo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  // A decision moves the request into another group, so the card the reader
  // was looking at is no longer the one they were deciding on — it is closed
  // rather than left open under a new heading.
  const handleDecided = useCallback(() => {
    setOpenId(null);
    load();
  }, [load]);

  // ONE SPLIT FEEDS BOTH THE FIGURES AND THE LISTS, so a card cannot stand
  // over a list it does not describe — the board invariant this app has
  // carried since its first KPI.
  const groups = groupWhitelistRequests(requests);
  const kpis = whitelistKpis(groups);

  const cardFor = (r: WhitelistRequest) => (
    <WhitelistRequestCard
      key={r.id}
      request={r}
      isCeo={isCeo}
      open={openId === r.id}
      onToggle={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
      onDecided={handleDecided}
      onError={setError}
    />
  );

  return (
    <div>
      <h2 className="section-title mb-4">Whitelist of Vendors</h2>

      {!loading && <WhitelistKpiCards cards={kpis} />}

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
            {groups.pending.length === 0 ? (
              <div className="table-wrap empty-state">No requests are waiting on the CEO.</div>
            ) : (
              groups.pending.map(cardFor)
            )}
          </div>

          {/* The decided requests are split under the same two names the cards
            * carry, so each figure stands directly over the rows it counted.
            * A group with nothing in it is not drawn — its card already says
            * so, and an empty heading says it twice. */}
          {(['approved', 'rejected'] as const).map((key) =>
            groups[key].length === 0 ? null : (
              <React.Fragment key={key}>
                <h3 className="section-title">
                  {kpis.find((c) => c.key === key)?.title}
                </h3>
                <div className="space-y-3 mb-6">
                  {groups[key].map(cardFor)}
                </div>
              </React.Fragment>
            ),
          )}
        </>
      )}
    </div>
  );
}

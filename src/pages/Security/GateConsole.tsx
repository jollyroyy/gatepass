// Search Pass — the gate's working screen, and ONLY a search screen
// (client, 2026-08-18: the Pending Queue was removed from this tab).
//
// A search that resolves to one pass (an exact pass number, or any query only
// one pass answers) renders the full Gate Pass Details record in place —
// summary, item table, return activity — instead of jumping to the verify
// screen. A query several passes answer — a mobile number, a vendor, a name,
// the requester who took the material out, an order number, a make and model —
// renders as the board's own stack of cards below, each carrying the action its
// state allows (client, 2026-08-24).
//
// WHERE THE QUEUE WENT: the guard dashboard (/guard-dashboard) already counts
// it as "Pending for Gate Approval" and opens the same passes as cards, and
// those cards now carry Verify at Gate. Every gate FIGURE moved there in an
// earlier pass; the list has now followed it, so the queue has exactly one home
// and this page has one job.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GatePassView, UserRole } from '../../types';
import { useGatePassRecord } from '../../lib/useGatePassRecord';
import PassRecordView from '../../components/passview/PassRecordView';
import GateLookup from './GateLookup';
import SearchMatches from '../../components/guard/SearchMatches';

export default function GateConsole({ role = null }: { role?: UserRole | null }): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  // Captured once at mount from history state; never updated afterwards.
  const [flash] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash ?? null
  );

  // Clear the flash from history state once shown, so a refresh or back-nav
  // does not replay it.
  useEffect(() => {
    if (flash) navigate(location.pathname, { replace: true, state: {} });
    // Intentionally runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A multi-pass search from the lookup card. Null = no search running; an
  // empty array is a real answer ("nothing matches that") and must not collapse
  // into the same state.
  const [matches, setMatches] = useState<{ query: string; rows: GatePassView[] } | null>(null);

  // The pass whose full record is open under the search bar. Null = none.
  const [recordId, setRecordId] = useState<string | null>(null);
  // Bumped after a return lands on the record — only the database knows
  // whether that movement closed the pass.
  const [reloadKey, setReloadKey] = useState(0);
  const { record, error: recordError } = useGatePassRecord(recordId, reloadKey);

  // One match is an answer, not a list: a query only one pass answers opens
  // that record straight away, exactly as a pass number does.
  function handleListResults(query: string, rows: GatePassView[]) {
    if (rows.length === 1) {
      setMatches(null);
      setRecordId(rows[0].id);
      return;
    }
    setRecordId(null);
    setMatches({ query, rows });
  }

  function clearSearch() {
    setRecordId(null);
    setMatches(null);
  }

  return (
    <div>
      {/* The search bar is the page, so it is centred and alone at the top. */}
      <div className="page-header text-center">
        <h1 className="page-title">Search Pass</h1>
        <p className="page-subtitle">
          Find a pass by its number, or by the mobile number, name, vendor,
          requester, order number or make and model on it.
        </p>
      </div>

      <div className="mb-6">
        <GateLookup
          onListResults={handleListResults}
          onPassResolved={(passId) => {
            setMatches(null);
            setRecordId(passId);
          }}
        />
      </div>

      {flash && <div className="alert-success mb-6">{flash}</div>}

      {recordError && <div className="alert-error mb-6">{recordError}</div>}

      {recordId && record === undefined && (
        <div className="flex flex-col gap-4 mb-8">
          <div className="skeleton h-10 w-64" />
          <div className="skeleton h-52 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
      )}

      {record && (
        <div className="mb-8">
          <PassRecordView
            record={record}
            role={role}
            onRecorded={() => setReloadKey((k) => k + 1)}
            onClear={clearSearch}
          />
        </div>
      )}

      {matches && (
        <div className="mb-6">
          <SearchMatches query={matches.query} rows={matches.rows} onClear={clearSearch} />
        </div>
      )}
    </div>
  );
}

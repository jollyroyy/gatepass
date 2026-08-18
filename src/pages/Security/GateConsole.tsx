// Search Pass — the gate's working screen, and ONLY a search screen
// (client, 2026-08-18: the Pending Queue was removed from this tab).
//
// A search that resolves to one pass (an exact pass number, or a mobile number
// that only one pass carries) renders the full Gate Pass Details record in
// place — summary, item table, return activity — instead of jumping to the
// verify screen. A mobile number held by several people renders the list, and
// clicking a row opens that record in the same place.
//
// WHERE THE QUEUE WENT: the guard dashboard (/guard-dashboard) already counts
// it as "Pending for Gate Approval" and opens the same passes as cards, and
// those cards now carry Verify at Gate. Every gate FIGURE moved there in an
// earlier pass; the list has now followed it, so the queue has exactly one home
// and this page has one job.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { useGatePassRecord } from '../../lib/useGatePassRecord';
import PassRecordView from '../../components/passview/PassRecordView';
import GateLookup from './GateLookup';
import PhoneSearchResults from './PhoneSearchResults';

export default function GateConsole(): React.ReactElement {
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

  // A mobile-number search from the lookup card. Null = no search running;
  // an empty array is a real answer ("nobody by that number") and must not
  // collapse into the same state.
  const [phoneSearch, setPhoneSearch] = useState<{ query: string; rows: GatePassView[] } | null>(null);

  // The pass whose full record is open under the search bar. Null = none.
  const [recordId, setRecordId] = useState<string | null>(null);
  const { record, error: recordError } = useGatePassRecord(recordId);

  // One match is an answer, not a list: a mobile number that only one pass
  // carries opens that record straight away, exactly as a pass number does.
  function handlePhoneResults(query: string, rows: GatePassView[]) {
    if (rows.length === 1) {
      setPhoneSearch(null);
      setRecordId(rows[0].id);
      return;
    }
    setRecordId(null);
    setPhoneSearch({ query, rows });
  }

  function clearSearch() {
    setRecordId(null);
    setPhoneSearch(null);
  }

  return (
    <div>
      {/* The search bar is the page, so it is centred and alone at the top. */}
      <div className="page-header text-center">
        <h1 className="page-title">Search Pass</h1>
        <p className="page-subtitle">Find a pass by its number or by the mobile number of the person carrying it.</p>
      </div>

      <div className="mb-6">
        <GateLookup
          onPhoneResults={handlePhoneResults}
          onPassResolved={(passId) => {
            setPhoneSearch(null);
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
          <PassRecordView record={record} onClear={clearSearch} />
        </div>
      )}

      {phoneSearch && (
        <PhoneSearchResults
          query={phoneSearch.query}
          rows={phoneSearch.rows}
          onClear={clearSearch}
          onOpen={(id) => {
            setPhoneSearch(null);
            setRecordId(id);
          }}
        />
      )}
    </div>
  );
}

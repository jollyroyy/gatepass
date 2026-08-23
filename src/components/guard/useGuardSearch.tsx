// The search that sits in the top-right corner of both guard list pages, and
// the only search a guard has since the sidebar's Search Pass tab was removed
// (client, 2026-08-19: "put the search option on the top right along with the
// scanning also").
//
// IT IS GLOBAL, AND THAT IS THE WHOLE POINT. It never looks at the rows of the
// page it is drawn on: `useGateSearch` sends a pass number through
// `lookup_pass` (the whole register, plus the scan log and the blacklist alert)
// and a mobile number through an unfiltered `v_gate_passes` query. A pass that
// was cleared last month is found from the Pending OUT page exactly as easily
// as one standing in the queue.
//
// A single resolved pass NAVIGATES to `/pass/:id` rather than rendering in
// place. `/pass/:id` is the app's ONE gate-pass record format, and it is drawn
// in the house theme — rendering it inside this fixed-light mock-up skin would
// put a dark card on a white ground for every reader on the shipped dark
// default. A query that matches SEVERAL passes — a mobile number, a vendor, a
// name, an order number, a make and model — renders below as a stack of the
// board's own cards (`SearchMatches`), each carrying the action its state
// allows.
//
// Returned as ELEMENTS rather than as a component with props, because the
// three parts land in three different places: the bar inside the toolbar's
// flex row, the scanner and its alerts under it, and the results where the
// page's own table would otherwise be.
import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import QrScanner from '../QrScanner';
import { OUTCOME_MESSAGES, useGateSearch } from '../../lib/useGateSearch';
import SearchMatches from './SearchMatches';

const SearchGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
  </svg>
);

const ScanGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16"
    />
    <path strokeLinecap="round" d="M4 12h16" />
  </svg>
);

export interface GuardSearch {
  /** The pill input and the Scan QR button — goes in the toolbar. */
  bar: React.ReactElement;
  /** The viewfinder is open. The page hides its tab strip, its filter bar and
   *  its table while it is (client, 2026-08-19): a guard holding a slip up to
   *  a camera is not reading a list, and whatever the scan resolves to appears
   *  under the viewfinder — so the list would only be pushing it off screen. */
  scanning: boolean;
  /** The viewfinder and any alert the last query raised, or null. */
  notice: React.ReactElement | null;
  /** A multi-pass result set, or null when no search is showing. When this is
   *  non-null the page renders it INSTEAD of its own list. */
  results: React.ReactElement | null;
}

export function useGuardSearch(placeholder: string): GuardSearch {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(false);
  // Null = no mobile search showing. An EMPTY array is a real answer ("nobody
  // by that number") and must not collapse into the same state.
  const [matches, setMatches] = useState<{ query: string; rows: GatePassView[] } | null>(null);

  const onListResults = useCallback(
    (query: string, rows: GatePassView[]) => {
      // One match is an answer, not a list.
      if (rows.length === 1) {
        setMatches(null);
        navigate(`/pass/${rows[0].id}`);
        return;
      }
      setMatches({ query, rows });
    },
    [navigate]
  );

  const onPassResolved = useCallback(
    (passId: string) => {
      setMatches(null);
      navigate(`/pass/${passId}`);
    },
    [navigate]
  );

  const search = useGateSearch({ onListResults, onPassResolved });

  const handleScan = useCallback(
    (scanned: string) => {
      setScanning(false);
      setValue(scanned);
      void search.resolve(scanned);
    },
    [search]
  );

  const message = search.outcome ? OUTCOME_MESSAGES[search.outcome.outcome] : null;

  const bar = (
    <div className="gb-search-row">
      <form
        className="gb-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search.resolve(value);
        }}
      >
        <label className="sr-only" htmlFor="guard-search">
          Search any pass by number or by the mobile number of the person carrying it
        </label>
        {SearchGlyph}
        <input
          id="guard-search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
      </form>
      <button type="button" className="gb-scan-btn" onClick={() => setScanning((s) => !s)}>
        {ScanGlyph}
        {scanning ? 'Close Scanner' : 'Scan QR'}
      </button>
    </div>
  );

  const hasNotice =
    scanning || search.error !== null || search.blacklistMatch !== null || message !== null;

  const notice = hasNotice ? (
    <div className="mb-4 flex flex-col gap-3">
      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
      {search.error && <div className="gb-alert">{search.error}</div>}
      {search.blacklistMatch && (
        <div className="gb-alert">
          {'⚠ BLACKLIST ALERT: '}
          {search.blacklistMatch}
        </div>
      )}
      {message && (
        <div className="gb-alert">
          {message.text}{' '}
          {search.outcome?.passId && (
            <Link to={`/pass/${search.outcome.passId}`} className="gb-link">
              View details
            </Link>
          )}
        </div>
      )}
      {search.pendingPassId && search.blacklistMatch && (
        <div>
          <Link to={`/verify/${search.pendingPassId}`} className="gb-action gb-action-orange">
            Proceed anyway
          </Link>
        </div>
      )}
    </div>
  ) : null;

  const results = matches ? (
    <SearchMatches query={matches.query} rows={matches.rows} onClear={() => setMatches(null)} />
  ) : null;

  return { bar, notice, results, scanning };
}

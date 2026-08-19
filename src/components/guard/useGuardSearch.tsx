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
// default. A mobile number held by several people renders below, in this
// screen's own skin.
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
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import ApproveOutAction from './ApproveOutAction';

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
  /** The viewfinder and any alert the last query raised, or null. */
  notice: React.ReactElement | null;
  /** A mobile-number result set, or null when no search is showing. When this
   *  is non-null the page renders it INSTEAD of its own list. */
  results: React.ReactElement | null;
}

export function useGuardSearch(placeholder: string): GuardSearch {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(false);
  // Null = no mobile search showing. An EMPTY array is a real answer ("nobody
  // by that number") and must not collapse into the same state.
  const [phone, setPhone] = useState<{ query: string; rows: GatePassView[] } | null>(null);

  const onPhoneResults = useCallback(
    (query: string, rows: GatePassView[]) => {
      // One match is an answer, not a list.
      if (rows.length === 1) {
        setPhone(null);
        navigate(`/pass/${rows[0].id}`);
        return;
      }
      setPhone({ query, rows });
    },
    [navigate]
  );

  const onPassResolved = useCallback(
    (passId: string) => {
      setPhone(null);
      navigate(`/pass/${passId}`);
    },
    [navigate]
  );

  const search = useGateSearch({ onPhoneResults, onPassResolved });

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

  const results = phone ? (
    <PhoneMatches query={phone.query} rows={phone.rows} onClear={() => setPhone(null)} />
  ) : null;

  return { bar, notice, results };
}

/** Several passes carry the same mobile number — a person at the barrier with
 *  more than one slip to their name. Drawn in this screen's own skin, with the
 *  SAME action rule the queue uses (`canVerifyAtGate`), so a button here can
 *  never be one that always fails. */
function PhoneMatches({
  query,
  rows,
  onClear,
}: {
  query: string;
  rows: GatePassView[];
  onClear: () => void;
}): React.ReactElement {
  return (
    <section className="gb-card gb-panel" data-testid="guard-phone-results">
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">
          Mobile {query} — {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
        </h2>
        <button type="button" className="gb-link" onClick={onClear}>
          Clear search
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="gb-empty">No gate pass carries that mobile number.</div>
      ) : (
        <div className="gb-scroll">
          <table className="gb-table">
            <thead>
              <tr>
                <th>Pass No.</th>
                <th>Type</th>
                <th>Party</th>
                <th>Material</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/pass/${p.id}`} className={`gb-pill ${TYPE_PILL[p.type]}`}>
                      {p.pass_number}
                    </Link>
                  </td>
                  <td>
                    <span className={`gb-pill ${TYPE_PILL[p.type]}`}>{p.type}</span>
                  </td>
                  <td className="gb-truncate">{partyOf(p)}</td>
                  <td className="gb-truncate" title={p.material_summary ?? undefined}>
                    {p.material_summary ?? '—'}
                  </td>
                  <td>
                    {canVerifyAtGate(p) ? (
                      <ApproveOutAction id={p.id} />
                    ) : (
                      <Link to={`/pass/${p.id}`} className="gb-link">
                        View pass
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

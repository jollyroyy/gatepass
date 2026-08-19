// ============================================================================
// The gate's single entry point: scan a QR code, or type a pass number.
//
// Extracted from GateConsole when the camera arrived — that file was at 286 of
// its 300-line budget. It owns everything about FINDING a pass; GateConsole
// owns what is done with the answer.
//
// THE RESOLUTION ITSELF LIVES IN `src/lib/useGateSearch.ts` (2026-08-19), so
// this component is the house-themed view of it and the guard pages' own
// search bar is the mock-up-themed view of the same logic — one search, two
// skins, no chance of the two disagreeing about what a query means.
// ============================================================================
import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GatePassView, ScanOutcome } from '../../types';
import QrScanner from '../../components/QrScanner';
import { OUTCOME_MESSAGES, useGateSearch } from '../../lib/useGateSearch';

type Props = {
  /** A mobile-number search resolves to a LIST — Search Pass renders it full
   *  width under the search bar. */
  onPhoneResults?: (query: string, rows: GatePassView[]) => void;
  /**
   * A pass-number search resolved to a row. When this is given, the page shows
   * the full Gate Pass Details record IN PLACE instead of jumping to /verify.
   */
  onPassResolved?: (passId: string, outcome: ScanOutcome) => void;
};

export default function GateLookup({ onPhoneResults, onPassResolved }: Props = {}): React.ReactElement {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(false);

  // With no handler from the page, a clean lookup goes straight to the gate
  // screen — the behaviour this component shipped with.
  const handleResolved = useCallback(
    (passId: string, outcome: ScanOutcome) => {
      if (onPassResolved) {
        onPassResolved(passId, outcome);
        return;
      }
      if (outcome === 'ok') navigate(`/verify/${passId}`);
    },
    [navigate, onPassResolved]
  );

  const search = useGateSearch({ onPhoneResults, onPassResolved: handleResolved });

  // Close the viewfinder before resolving so the camera light goes out while the
  // round trip is in flight, rather than lingering behind the next screen.
  const handleScan = useCallback(
    (scanned: string) => {
      setScanning(false);
      setValue(scanned);
      void search.resolve(scanned);
    },
    [search]
  );

  const message = search.outcome ? OUTCOME_MESSAGES[search.outcome.outcome] : null;

  return (
    <div data-testid="gate-lookup" className="w-full max-w-2xl mx-auto flex flex-col gap-3">
      <label className="sr-only" htmlFor="gate-lookup">
        Find a pass by number or mobile
      </label>

      {/* Always mounted, never behind the scanner. A damaged code, a denied
          camera permission, or a flat-battery phone all end here. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search.resolve(value);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-500 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            id="gate-lookup"
            className="input !pl-11 !py-2.5 !rounded-full text-sm w-full"
            placeholder="Search a pass number or a mobile number…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>

        {/* Icon-only so the two actions sit on one line at every width. */}
        <button
          type="button"
          className="btn-secondary !px-3 !py-2.5 !rounded-full shrink-0"
          onClick={() => setScanning((s) => !s)}
          aria-label={scanning ? 'Close QR scanner' : 'Scan QR code'}
          title={scanning ? 'Close QR scanner' : 'Scan QR code'}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />
            <path strokeLinecap="round" d="M4 12h16" />
          </svg>
        </button>

        <button
          type="submit"
          className="btn-primary !px-5 !py-2.5 !rounded-full text-sm shrink-0"
          disabled={search.busy || !value.trim()}
        >
          {search.busy ? '…' : 'Find'}
        </button>
      </form>

      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}

      {search.error && <div className="alert-error">{search.error}</div>}

      {search.blacklistMatch && (
        <div className="border-2 border-red-400 bg-amber-50 text-red-800 px-4 py-3 rounded-md font-semibold text-sm">
          {'⚠ BLACKLIST ALERT: '}{search.blacklistMatch}
        </div>
      )}

      {message && (
        <div className={message.tone === 'error' ? 'alert-error' : 'alert-warning'}>
          {message.text}{' '}
          {search.outcome?.passId && (
            <Link to={`/pass/${search.outcome.passId}`} className="underline font-semibold">
              View details
            </Link>
          )}
        </div>
      )}

      {search.pendingPassId && search.blacklistMatch && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(`/verify/${search.pendingPassId}`)}
        >
          Proceed anyway
        </button>
      )}
    </div>
  );
}

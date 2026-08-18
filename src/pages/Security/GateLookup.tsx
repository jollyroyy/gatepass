// ============================================================================
// The gate's single entry point: scan a QR code, or type a pass number.
//
// Extracted from GateConsole when the camera arrived — that file was at 286 of
// its 300-line budget. It owns everything about FINDING a pass; GateConsole owns
// the queue and KPIs.
//
// Both paths run through the same `gatepass.lookup_pass` RPC rather than a
// client-side select, for three reasons:
//   * the QR now carries an opaque qr_token, which is not the pass_number, so
//     the client would need to know which column to match on;
//   * the RPC decides expired / voided / already-verified centrally, so this
//     screen can never disagree with what match_pass will do a moment later;
//   * every attempt, including the failures, is logged to scan_attempts. A
//     client-side select records nothing, and "someone waved 40 unknown codes at
//     gate 2 last night" is precisely what you want to be able to ask.
// ============================================================================
import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, ScanOutcome, ScanResult } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import QrScanner from '../../components/QrScanner';
import { isPhoneQuery, passMatchesPhone, phoneSearchPattern } from '../../lib/phoneSearch';

/** Direct lookup, never an includes() chain — same rule as statusStyles.ts.
 *  Adding an outcome to the Postgres function breaks the build here until it
 *  has been given wording, rather than showing the guard a blank panel. */
const OUTCOME_MESSAGES: Record<Exclude<ScanOutcome, 'ok'>, { tone: 'error' | 'warning'; text: string }> = {
  not_found: { tone: 'error', text: 'No pass matches that code. Check the slip and try again.' },
  expired: {
    tone: 'warning',
    text: 'That pass has expired and can no longer be matched. Ask the HOD to raise a new one.',
  },
  cancelled: { tone: 'warning', text: 'That pass was voided by the HOD who raised it.' },
  already_matched: { tone: 'warning', text: 'That pass has already been matched and cleared.' },
  already_flagged: { tone: 'warning', text: 'That pass has already been marked as a mismatch.' },
};

interface Outcome {
  outcome: Exclude<ScanOutcome, 'ok'>;
  passId: string | null;
}

type Props = {
  /** A mobile-number search resolves to a LIST — Search Pass renders it full
   *  width under the search bar. */
  onPhoneResults?: (query: string, rows: GatePassView[]) => void;
  /**
   * A pass-number search resolved to a row. When this is given, the page shows
   * the full Gate Pass Details record IN PLACE instead of jumping to /verify.
   *
   * It fires for EVERY outcome that carries a pass_id, not just `ok`: a guard
   * who typed the number of an expired or already-matched pass still wants to
   * read the record, and the record's own stage badge says which it is — no
   * message is raised above it. `lookup_pass` is still what decides, so the
   * scan attempt is logged and the blacklist alert still fires as before.
   */
  onPassResolved?: (passId: string, outcome: ScanOutcome) => void;
};

export default function GateLookup({ onPhoneResults, onPassResolved }: Props = {}): React.ReactElement {
  const navigate = useNavigate();

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scanning, setScanning] = useState(false);
  const [blacklistMatch, setBlacklistMatch] = useState<string | null>(null);
  const [pendingPassId, setPendingPassId] = useState<string | null>(null);

  const resolve = useCallback(
    async (code: string) => {
      const raw = code.trim();
      if (!raw) return;
      setBusy(true);
      setError(null);
      setOutcome(null);
      setBlacklistMatch(null);
      setPendingPassId(null);
      try {
        // A mobile number is a PERSON, not a pass, so it deliberately does NOT
        // go through `lookup_pass`: that RPC returns one row, decides a single
        // outcome and logs a scan attempt — none of which is true of a search
        // that may return three passes and no scan at all.
        if (isPhoneQuery(raw)) {
          const { data, error: qErr } = await gp()
            .from('v_gate_passes')
            .select('*')
            .ilike('visitor_company', phoneSearchPattern(raw))
            .order('created_at', { ascending: false })
            .limit(50);
          if (qErr) throw qErr;
          // The ilike is a narrowing on the last four digits only and can
          // over-match (an address with the same digits); this is the filter
          // that decides, on the pass's own phone field.
          const rows = ((data as GatePassView[] | null) ?? []).filter((p) => passMatchesPhone(p, raw));
          onPhoneResults?.(raw.trim(), rows);
          return;
        }

        const { data, error: rpcErr } = await gp().rpc('lookup_pass', { p_code: raw });
        if (rpcErr) throw rpcErr;

        // The RPC is `returns table (...)`, which arrives as an array.
        const row = (data as ScanResult[] | null)?.[0] ?? null;
        if (!row) {
          setError('The gate could not read that code. Try again.');
          return;
        }

        if (row.blacklist_match) setBlacklistMatch(row.blacklist_match);

        if (row.outcome === 'ok' && row.pass_id) {
          // A blacklist hit still stops here: the guard must acknowledge it
          // before the pass opens for verification.
          if (row.blacklist_match) {
            setPendingPassId(row.pass_id);
            return;
          }
          if (onPassResolved) {
            onPassResolved(row.pass_id, row.outcome);
            return;
          }
          navigate(`/verify/${row.pass_id}`);
          return;
        }
        // A pass we can actually show speaks for itself: the record carries the
        // stage badge ("Expired", "Matched") the message would have narrated,
        // so no banner is raised above it (client, 2026-08-18).
        if (row.pass_id && onPassResolved) {
          onPassResolved(row.pass_id, row.outcome);
          return;
        }
        setOutcome({
          outcome: row.outcome as Exclude<ScanOutcome, 'ok'>,
          passId: row.pass_id,
        });
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [navigate, onPhoneResults, onPassResolved]
  );

  // Close the viewfinder before resolving so the camera light goes out while the
  // round trip is in flight, rather than lingering behind the next screen.
  const handleScan = useCallback(
    (scanned: string) => {
      setScanning(false);
      setValue(scanned);
      void resolve(scanned);
    },
    [resolve]
  );

  const message = outcome ? OUTCOME_MESSAGES[outcome.outcome] : null;

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
          void resolve(value);
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

        <button type="submit" className="btn-primary !px-5 !py-2.5 !rounded-full text-sm shrink-0" disabled={busy || !value.trim()}>
          {busy ? '…' : 'Find'}
        </button>
      </form>

      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}

      {error && <div className="alert-error">{error}</div>}

      {blacklistMatch && (
        <div className="border-2 border-red-400 bg-amber-50 text-red-800 px-4 py-3 rounded-md font-semibold text-sm">
          {'⚠ BLACKLIST ALERT: '}{blacklistMatch}
        </div>
      )}

      {message && (
        <div className={message.tone === 'error' ? 'alert-error' : 'alert-warning'}>
          {message.text}{' '}
          {outcome?.passId && (
            <Link to={`/pass/${outcome.passId}`} className="underline font-semibold">
              View details
            </Link>
          )}
        </div>
      )}

      {pendingPassId && blacklistMatch && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(`/verify/${pendingPassId}`)}
        >
          Proceed anyway
        </button>
      )}
    </div>
  );
}

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
import type { ScanOutcome, ScanResult } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import QrScanner from '../../components/QrScanner';

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
  already_flagged: { tone: 'warning', text: 'That pass has already been flagged.' },
};

interface Outcome {
  outcome: Exclude<ScanOutcome, 'ok'>;
  passId: string | null;
}

export default function GateLookup(): React.ReactElement {
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
        const { data, error: rpcErr } = await gp().rpc('lookup_pass', { p_code: raw });
        if (rpcErr) throw rpcErr;

        // The RPC is `returns table (...)`, which arrives as an array.
        const row = (data as ScanResult[] | null)?.[0] ?? null;
        if (!row) {
          setError('The gate could not read that code. Try again.');
          return;
        }

        if (row.outcome === 'ok' && row.pass_id) {
          if (row.blacklist_match) {
            setBlacklistMatch(row.blacklist_match);
            setPendingPassId(row.pass_id);
            return;
          }
          navigate(`/verify/${row.pass_id}`);
          return;
        }
        setOutcome({
          outcome: row.outcome as Exclude<ScanOutcome, 'ok'>,
          passId: row.pass_id,
        });
        if (row.blacklist_match) {
          setBlacklistMatch(row.blacklist_match);
        }
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [navigate]
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
    <div className="card p-5 mb-6 flex flex-col gap-3">
      <label className="label" htmlFor="gate-lookup">
        Find a Pass
      </label>

      {scanning ? (
        <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />
      ) : (
        <button type="button" className="btn-primary w-full md:w-auto" onClick={() => setScanning(true)}>
          Scan QR Code
        </button>
      )}

      {/* Always mounted, never behind the scanner. A damaged code, a denied
          camera permission, or a flat-battery phone all end here. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void resolve(value);
        }}
        className="flex flex-col md:flex-row gap-3"
      >
        <input
          id="gate-lookup"
          className="input text-lg flex-1"
          placeholder="…or type the pass number — e.g. RGP-20260726-0001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-secondary md:w-auto" disabled={busy || !value.trim()}>
          {busy ? 'Looking up…' : 'Find Pass'}
        </button>
      </form>

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

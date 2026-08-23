// The gate's one search, extracted so every screen that offers it resolves a
// query the same way (2026-08-19: the search moved out of the sidebar and onto
// the Pending OUT and Pending RGP Return pages, top right, beside Scan QR).
//
// It is GLOBAL by construction. Neither branch below is narrowed by whatever
// list the page is showing: a pass number goes to `lookup_pass`, which reads
// the whole register, and a mobile number queries `v_gate_passes` unfiltered
// by status or date. A guard standing at the barrier is handed a slip, not a
// row of the table they happen to have open.
//
// WHY THE THREE BRANCHES DIFFER, and why this is not one query:
//   * a CODE — a whole pass number, a pass id, or the URL inside a QR — runs
//     through `gatepass.lookup_pass`, so the attempt is logged to
//     `scan_attempts`, the blacklist alert fires, and expired / voided /
//     already-verified is decided ONCE, server-side, where `match_pass` will
//     decide it again a moment later;
//   * a MOBILE NUMBER identifies a PERSON, who may hold three passes and has
//     scanned nothing. That is a list, not an outcome, so it must not be forced
//     through an RPC that returns one row and writes a scan record;
//   * anything else is FREE TEXT (client, 2026-08-24): a person's name, the
//     vendor, the requester who took the material out, an invoice / order
//     number, a make and model. `searchPassesByText` reads the pass columns and
//     the material lines and unions them, and the answer is a list by
//     construction — "there are maybe five passes in for Dell".
//
// THE CODE BRANCH USED TO SWALLOW ALL THREE. Its old test was "does the query
// contain a letter", so a typed NAME was sent to `lookup_pass` and came back
// "No pass matches that code". `isPassCodeQuery` is a SHAPE test now; a partial
// pass number falls through to the text branch, which matches `pass_number`
// with an ilike and answers with a list.
import { useCallback, useState } from 'react';
import { gp } from '../supabaseClient';
import type { GatePassView, ScanOutcome, ScanResult } from '../types';
import { safeErrorMessage } from './errors';
import { isPhoneQuery } from './phoneSearch';
import { isPassCodeQuery } from './passTextSearch';
import { searchPassesByPhone, searchPassesByText } from './searchPasses';

/** Direct lookup, never an includes() chain — same rule as statusStyles.ts.
 *  Adding an outcome to the Postgres function breaks the build here until it
 *  has been given wording, rather than showing the guard a blank panel. */
export const OUTCOME_MESSAGES: Record<Exclude<ScanOutcome, 'ok'>, { tone: 'error' | 'warning'; text: string }> = {
  not_found: { tone: 'error', text: 'No pass matches that code. Check the slip and try again.' },
  expired: {
    tone: 'warning',
    text: 'That pass has expired and can no longer be matched. Ask the HOD to raise a new one.',
  },
  cancelled: { tone: 'warning', text: 'That pass was voided by the HOD who raised it.' },
  already_matched: { tone: 'warning', text: 'That pass has already been matched and cleared.' },
  already_flagged: { tone: 'warning', text: 'That pass has already been rejected at the security gate.' },
  awaiting_approval: {
    tone: 'warning',
    text: 'That pass has not been approved by every level yet. It cannot be cleared until it has.',
  },
};

export interface GateSearchOutcome {
  outcome: Exclude<ScanOutcome, 'ok'>;
  passId: string | null;
}

export interface GateSearchHandlers {
  /** A mobile-number or free-text search resolved to a LIST (possibly empty —
   *  "nothing matches that" is a real answer and must not read as "still
   *  searching"). */
  onListResults?: (query: string, rows: GatePassView[]) => void;
  /** A pass-number search resolved to a row. Fires for EVERY outcome carrying
   *  a `pass_id`, not just `ok`: a guard who typed the number of an expired
   *  pass still wants to read the record, and the record's own stage badge
   *  says which it is. */
  onPassResolved?: (passId: string, outcome: ScanOutcome) => void;
}

export interface GateSearch {
  busy: boolean;
  error: string | null;
  outcome: GateSearchOutcome | null;
  /** The blacklist reason text when the pass's company or vehicle is listed. */
  blacklistMatch: string | null;
  /** Set instead of resolving when a blacklisted pass looks up clean: the
   *  guard must acknowledge the alert before the pass opens. */
  pendingPassId: string | null;
  resolve: (code: string) => Promise<void>;
  reset: () => void;
}

export function useGateSearch({ onListResults, onPassResolved }: GateSearchHandlers = {}): GateSearch {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<GateSearchOutcome | null>(null);
  const [blacklistMatch, setBlacklistMatch] = useState<string | null>(null);
  const [pendingPassId, setPendingPassId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setOutcome(null);
    setBlacklistMatch(null);
    setPendingPassId(null);
  }, []);

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
        if (isPhoneQuery(raw)) {
          onListResults?.(raw, await searchPassesByPhone(raw));
          return;
        }

        // Not a code and not a number: a name, a vendor, a requester, an order
        // number, a make and model. Never `lookup_pass` — that RPC answers with
        // one row and writes a scan record, and neither is right for a word
        // somebody typed.
        if (!isPassCodeQuery(raw)) {
          onListResults?.(raw, await searchPassesByText(raw));
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
          if (row.blacklist_match) {
            setPendingPassId(row.pass_id);
            return;
          }
          onPassResolved?.(row.pass_id, row.outcome);
          return;
        }
        if (row.pass_id && onPassResolved) {
          onPassResolved(row.pass_id, row.outcome);
          return;
        }
        setOutcome({ outcome: row.outcome as Exclude<ScanOutcome, 'ok'>, passId: row.pass_id });
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [onListResults, onPassResolved]
  );

  return { busy, error, outcome, blacklistMatch, pendingPassId, resolve, reset };
}

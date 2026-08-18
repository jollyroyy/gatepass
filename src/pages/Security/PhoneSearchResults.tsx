// Results of a mobile-number search at the gate.
//
// A pass number identifies ONE pass; a mobile number identifies a PERSON, who
// may be standing at the barrier with several passes to their name. So this is
// a list, not a redirect — and every row carries its own action button, because
// the guard's next move is the point of the search: "Verify at Gate" for
// anything the gate can still act on, "View Details" for anything it cannot
// (`canVerifyAtGate` is the same rule the queue and `match_pass` use, so a
// button here can never be one that always fails).
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import { parseCompanyInfo } from '../../lib/companyInfo';

type Props = {
  query: string;
  rows: GatePassView[];
  onClear: () => void;
  /** Clicking the row body opens the full record in place on Search Pass,
   *  rather than navigating away. The per-row ACTION button is unchanged —
   *  reading the record and acting at the gate are two different intents. */
  onOpen?: (id: string) => void;
};

export default function PhoneSearchResults({ query, rows, onClear, onOpen }: Props): React.ReactElement {
  return (
    <div className="card p-4 mb-6" data-testid="phone-search-results">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="card-title">
          Mobile {query}
          <span className="ms-2 text-sm text-navy-500 font-sans">
            {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
          </span>
        </h2>
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={onClear}>
          Clear
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>No gate pass carries that mobile number.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((p, i) => {
            const verifiable = canVerifyAtGate(p);
            const to = verifiable ? `/verify/${p.id}` : `/pass/${p.id}`;
            const phone = parseCompanyInfo(p.visitor_company).phone;
            return (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  {onOpen
                    ? <PassRow pass={p} index={i + 1} onOpen={onOpen} />
                    : <PassRow pass={p} index={i + 1} to={to} />}
                </div>
                <Link
                  to={to}
                  className={`${verifiable ? 'btn-primary' : 'btn-secondary'} !py-2 text-sm text-center shrink-0`}
                  aria-label={`${verifiable ? 'Verify at gate' : 'View details'} — ${p.pass_number}, ${phone}`}
                >
                  {verifiable ? 'Verify at Gate' : 'View Details'}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

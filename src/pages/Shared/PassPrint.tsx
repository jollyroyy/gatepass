// THE PRINTED GATE PASS — the page a slip is printed from.
//
// IT DRAWS ALMOST NOTHING ITSELF. The sheet is `PassSlip` and the reads behind
// it are `usePrintSlipData`. The approval RPC must allow this pass before the
// slip enters the DOM; the Print button checks again immediately before use.
//
// What is left here is what belongs to the SCREEN and not to the paper: the
// Back link, the Print button, the skeleton and the not-found card.
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePrintSlipData } from '../../lib/usePrintSlipData';
import PassSlip from '../../components/print/PassSlip';
import { canPrintPassNow, useCanPrintPass } from '../../lib/useCanPrintPass';

export default function PassPrint(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const {
    pass, items, events, roles, approvals, escalationHours, signatures, error,
  } = usePrintSlipData(id);
  const allowed = useCanPrintPass(id);
  const [revoked, setRevoked] = React.useState(false);

  async function print() {
    if (!id || !(await canPrintPassNow(id))) {
      setRevoked(true);
      return;
    }
    window.print();
  }

  if (pass === undefined || allowed === undefined) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  if (pass === null) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="empty-state card p-10">
          <p className="text-navy-700 font-medium">Pass not found, or you don't have access to it.</p>
          {error && <p className="text-sm text-flagged-700 mt-2">{error}</p>}
          <Link to="/" className="btn-secondary inline-block mt-4">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (!allowed || revoked) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="empty-state card p-10">
          <p className="text-navy-700 font-medium">This gate pass cannot be printed until all required authorities have approved it.</p>
          <Link to={`/pass/${pass.id}`} className="btn-secondary inline-block mt-4">Back to pass</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 max-w-2xl mx-auto p-4">
        <Link to={`/pass/${pass.id}`} className="btn-secondary">Back</Link>
        <button type="button" className="btn-primary" onClick={print}>Print</button>
      </div>

      {/* The printable sheet is rendered only after the approval check. */}
      <PassSlip
        pass={pass}
        items={items}
        events={events}
        roles={roles}
        approvals={approvals}
        escalationHours={escalationHours}
        signatures={signatures}
      />
    </div>
  );
}

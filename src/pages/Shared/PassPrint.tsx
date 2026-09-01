// THE PRINTED GATE PASS — the page a slip is printed from.
//
// IT DRAWS ALMOST NOTHING ITSELF. The sheet is `PassSlip` and the reads behind
// it are `usePrintSlipData`, because this page is no longer the only reader:
// Send to Vendor mounts the same component off-screen and photographs it for
// WhatsApp (client, 2026-09-01: "the same exact print pass page should be sent
// out to the vendor using the WhatsApp as well"). One markup and one set of
// reads, so the paper in the guard's hand and the picture in the vendor's chat
// cannot say different things.
//
// What is left here is what belongs to the SCREEN and not to the paper: the
// Back link, the Print button, the skeleton and the not-found card.
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePrintSlipData } from '../../lib/usePrintSlipData';
import PassSlip from '../../components/print/PassSlip';

export default function PassPrint(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const {
    pass, items, events, roles, approvals, escalationHours, signatures, error,
  } = usePrintSlipData(id);

  if (pass === undefined) {
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

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 max-w-2xl mx-auto p-4">
        <Link to={`/pass/${pass.id}`} className="btn-secondary">Back</Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      {/* THE SHEET ITSELF LIVES IN `PassSlip` (2026-09-01). This page is the
          paper's reader; Send to Vendor mounts the very same component
          off-screen and photographs it for WhatsApp (client: "the same exact
          print pass page should be sent out to the vendor using the WhatsApp
          as well"). Two readers, ONE markup — a copy would drift on the next
          change to either, which is exactly the complaint that produced this. */}
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

// THE TITLE ROW OF THE GATE PASS RECORD — what the pass IS, and the two
// things any reader may do with it that are not a decision: print it, and (the
// raising desk only) forward it to the vendor on WhatsApp.
//
// SPLIT OUT OF `PassRecordView` on 2026-08-23, when the record crossed the
// repo's 300-line cap. It holds no state and reads nothing — every fact and
// every permission is decided by the record and handed down.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import type { StatusStyle } from '../../lib/statusStyles';
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import Badge from '../Badge';
import SendToVendorButton from '../SendToVendorButton';

type Props = {
  pass: GatePassView;
  /** The pass's live stage badge, already derived by the record. */
  stage: StatusStyle;
  /** Whether this reader may forward the pass to the vendor — the raising
   *  side only. The button decides for itself whether the pass carries a
   *  usable number, and draws nothing when it does not. */
  canShare: boolean;
  onClear?: () => void;
};

const PrinterGlyph = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.25V3.75h10.5v4.5M6.75 17.25h10.5v3h-10.5v-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 17.25H4.5a1.5 1.5 0 01-1.5-1.5v-4.5a1.5 1.5 0 011.5-1.5h15a1.5 1.5 0 011.5 1.5v4.5a1.5 1.5 0 01-1.5 1.5h-2.25" />
  </svg>
);

// THE BELL IS FIXED TO THE VIEWPORT'S TOP-RIGHT CORNER, so a header row
// with buttons on its right edge sits underneath it — Print Pass was
// printing under the bell on every wide screen (client, 2026-08-19).
// 76px is the same reservation `.page-header` and the guard skin's
// `.gb-page-head` already make; this row is not a `.page-header` (it
// carries its own spacing inside the record's flex column), so it makes
// the reservation itself.
export default function PassRecordHeader({
  pass, stage, canShare, onClear,
}: Props): React.ReactElement {
  return (
      <div className="flex flex-wrap items-start justify-between gap-3 pr-[76px]">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title !mb-0">{pass.type} Gate Pass Details</h1>
            <Badge style={stage} />
            {/* ONE "Overdue", never two (client, 2026-08-20). `passStageStyle`
                already RENAMES a late open pass to Overdue, so this pill is
                drawn only when the stage badge says something else — a
                MISMATCHED pass that is also late still carries both facts. */}
            {pass.is_overdue && stage.label !== OVERDUE_STYLE.label && (
              <Badge style={OVERDUE_STYLE} />
            )}
          </div>
          <p className="page-subtitle !mb-0 mt-1">
            {pass.type === 'RGP'
              ? 'View details of this Returnable Gate Pass'
              : 'View details of this Non-Returnable Gate Pass'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* IT PREPARES THE MESSAGE AND THE SHEET; IT DOES NOT SEND
              ANYTHING. The HOD picks the chat and presses send themselves —
              this app has no WhatsApp account and delivers no message on
              anybody's behalf. What travels with the text is the PRINTED SLIP
              itself, photographed off the same component the Print Pass link
              below renders (client, 2026-09-01), so the vendor gets the QR
              code, the department and every item's make and model. */}
          {canShare && <SendToVendorButton pass={pass} />}
          <Link to={`/pass/${pass.id}/print`} className="btn-secondary inline-flex items-center gap-2">
            {PrinterGlyph}
            Print Pass
          </Link>
          {onClear && (
            <button type="button" className="btn-ghost" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>
  );
}

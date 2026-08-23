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

type Props = {
  pass: GatePassView;
  /** The pass's live stage badge, already derived by the record. */
  stage: StatusStyle;
  /** A prepared `wa.me` link, or null when there is no usable number. */
  whatsapp: string | null;
  onClear?: () => void;
};

const PrinterGlyph = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.25V3.75h10.5v4.5M6.75 17.25h10.5v3h-10.5v-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 17.25H4.5a1.5 1.5 0 01-1.5-1.5v-4.5a1.5 1.5 0 011.5-1.5h15a1.5 1.5 0 011.5 1.5v4.5a1.5 1.5 0 01-1.5 1.5h-2.25" />
  </svg>
);

const WhatsappGlyph = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.9 9.9 0 004.84 1.24h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0012.04 2zm0 18.02h-.01a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.09.81.82-3.01-.2-.31a8.24 8.24 0 01-1.26-4.22c0-4.55 3.7-8.25 8.25-8.25 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 012.41 5.83c0 4.55-3.7 8.26-8.26 8.26zm4.53-6.18c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23a7.5 7.5 0 01-1.38-1.72c-.15-.25-.02-.38.11-.5.12-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.1 3.63.58.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29z" />
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
  pass, stage, whatsapp, onClear,
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
          {/* IT OPENS WHATSAPP WITH THE TEXT PREPARED; IT DOES NOT SEND
              ANYTHING. The HOD picks the chat and presses send themselves —
              this app has no WhatsApp account and delivers no message on
              anybody's behalf. `noopener` because it leaves the app. */}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="share-whatsapp"
              className="btn-secondary inline-flex items-center gap-2"
            >
              {WhatsappGlyph}
              Send to Vendor
            </a>
          )}
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

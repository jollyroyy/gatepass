// SEND TO VENDOR — the printed pass, in the vendor's WhatsApp.
//
// The client asked for three things on this message (2026-09-01): the make and
// model of the material, the department, and the pass's QR code. The first two
// are text (`whatsappShare.ts`); the third is not — a QR code is a picture, and
// then the client said what they actually wanted, which is "the same exact
// print pass page should be sent out to the vendor using the WhatsApp as
// well". So this button does exactly that:
//
//   1. reads what the printed sheet is made of (`usePrintSlipData`),
//   2. mounts `PassSlip` — THE COMPONENT `/pass/:id/print` RENDERS, not a copy
//      of it — off-screen, at paper width,
//   3. photographs it (`slipImage.ts`),
//   4. hands the PNG and the text to the device's share sheet, or falls back to
//      a download plus `wa.me` on a desktop (`vendorShare.ts`).
//
// STILL NOTHING IS SENT BY THIS APP. The HOD picks the chat and presses send.
//
// The slip is mounted ONLY while a send is in flight: a pass record must not
// pay three queries and a hidden A5 sheet for a button nobody pressed.
import React, { useEffect, useRef, useState } from 'react';
import type { GatePassView } from '../types';
import { usePrintSlipData } from '../lib/usePrintSlipData';
import { renderSlipPng, slipFileName } from '../lib/slipImage';
import { browserShareEnv, sendToVendor } from '../lib/vendorShare';
import { passShareMessage, vendorWhatsappNumber, whatsappHref } from '../lib/whatsappShare';
import PassSlip from './print/PassSlip';

const WhatsappGlyph = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.9 9.9 0 004.84 1.24h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0012.04 2zm0 18.02h-.01a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.09.81.82-3.01-.2-.31a8.24 8.24 0 01-1.26-4.22c0-4.55 3.7-8.25 8.25-8.25 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 012.41 5.83c0 4.55-3.7 8.26-8.26 8.26zm4.53-6.18c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23a7.5 7.5 0 01-1.38-1.72c-.15-.25-.02-.38.11-.5.12-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.1 3.63.58.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29z" />
  </svg>
);

/** Off the screen, not `display:none` — a hidden node has no layout and
 *  photographs as a blank sheet. Paper width, so the capture is the A5 slip and
 *  not a phone-narrow reflow of it. `aria-hidden` because it is a duplicate of
 *  a page the reader can already reach. */
const OFFSCREEN: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: '-10000px',
  width: '760px',
  background: 'white',
  pointerEvents: 'none',
  zIndex: -1,
};

interface Props {
  pass: GatePassView;
  className?: string;
}

export default function SendToVendorButton({ pass, className }: Props): React.ReactElement | null {
  const [sending, setSending] = useState(false);
  const slipRef = useRef<HTMLDivElement>(null);
  // Null until the button is pressed: that is the switch that keeps the reads,
  // and the hidden sheet, off every pass record nobody is forwarding.
  const data = usePrintSlipData(sending ? pass.id : null);
  const number = vendorWhatsappNumber(pass);
  const slipMounted = sending && data.ready && data.pass;

  useEffect(() => {
    if (!sending || !slipMounted || !slipRef.current || !number) return undefined;
    let cancelled = false;
    (async () => {
      // A CAPTURE THAT FAILS STILL SENDS THE MESSAGE. The text carries the pass
      // number, the department and the material with its make and model; a
      // vendor holding that is not stranded, and an HOD staring at "could not
      // generate an image" has no way forward at all.
      const file = await renderSlipPng(slipRef.current!, slipFileName(pass)).catch(() => null);
      const message = passShareMessage(data.pass!, data.items, { withSlip: !!file });
      await sendToVendor(file, message, whatsappHref(number, message), browserShareEnv());
      if (!cancelled) setSending(false);
    })();
    return () => { cancelled = true; };
    // `data.items` and `data.pass` are settled by the time `ready` flips; the
    // effect is keyed on the two facts that decide whether it may run at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, slipMounted]);

  // "if it is available" is the client's own condition (2026-08-22): a pass
  // with no vendor number offers no button, because a control that opens an
  // empty chat is worse than no control.
  if (!number) return null;

  return (
    <>
      <button
        type="button"
        data-testid="share-whatsapp"
        className={className ?? 'btn-secondary inline-flex items-center gap-2'}
        disabled={sending}
        onClick={() => setSending(true)}
      >
        {WhatsappGlyph}
        {sending ? 'Preparing pass…' : 'Send to Vendor'}
      </button>
      {slipMounted && (
        <div style={OFFSCREEN} aria-hidden="true" data-testid="share-slip">
          <div ref={slipRef}>
            <PassSlip
              pass={data.pass!}
              items={data.items}
              events={data.events}
              roles={data.roles}
              approvals={data.approvals}
              escalationHours={data.escalationHours}
              signatures={data.signatures}
            />
          </div>
        </div>
      )}
    </>
  );
}

// SEND TO VENDOR — the vendor's own WhatsApp chat, in one press.
//
// It is an ANCHOR, not a button, and that is the whole point (client,
// 2026-09-01: "I don't have to select the WhatsApp manually. It should
// automatically send"). `wa.me/<number>` opens the chat belonging to the number
// on the pass with the message already typed; the HOD presses send and picks
// nothing.
//
// FOR ONE DAY THIS SENT THE PRINTED SLIP AS A PICTURE and it was wrong for this
// deployment. Attaching a file needs `navigator.share`, which is the only
// browser mechanism that can carry one — and it opens the operating system's
// app picker, so every send became "choose WhatsApp, then choose the chat". A
// link that carries a file to one known number does not exist. Sending the
// sheet itself, automatically, needs a WhatsApp Business API account, which
// this deployment does not have. So the picture is gone and the direct chat is
// back; the QR code reaches the gate on the HOD's printed sheet, as it did
// before. See `whatsappShare.ts` for the message.
//
// STILL NOTHING IS SENT BY THIS APP. The HOD presses send in their own
// WhatsApp, from their own number.
import React from 'react';
import type { GatePassItemView, GatePassView } from '../types';
import { vendorWhatsappLink } from '../lib/whatsappShare';

const WhatsappGlyph = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.9 9.9 0 004.84 1.24h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0012.04 2zm0 18.02h-.01a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.09.81.82-3.01-.2-.31a8.24 8.24 0 01-1.26-4.22c0-4.55 3.7-8.25 8.25-8.25 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 012.41 5.83c0 4.55-3.7 8.26-8.26 8.26zm4.53-6.18c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23a7.5 7.5 0 01-1.38-1.72c-.15-.25-.02-.38.11-.5.12-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.1 3.63.58.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29z" />
  </svg>
);

interface Props {
  pass: GatePassView;
  /** The material lines, when the caller has them. Optional because the
   *  raise-confirmation popup does not: the message is still complete without
   *  the breakdown, and a second read to fetch them would delay a control
   *  whose whole value is that it opens instantly. */
  items?: GatePassItemView[];
  className?: string;
}

export default function SendToVendorButton({
  pass, items = [], className,
}: Props): React.ReactElement | null {
  const href = vendorWhatsappLink(pass, items);

  // "if it is available" is the client's own condition (2026-08-22): a pass
  // with no vendor number offers no control, because one that opens an empty
  // chat is worse than none.
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="share-whatsapp"
      className={className ?? 'btn-secondary inline-flex items-center gap-2'}
    >
      {WhatsappGlyph}
      Send to Vendor
    </a>
  );
}

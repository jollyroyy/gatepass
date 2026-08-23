// FORWARDING A PASS TO THE VENDOR ON WHATSAPP (client, 2026-08-22: "give an
// option to the HODs to forward the pass details to the vendor WhatsApp if it
// is available … from the pass details page").
//
// NOTHING IS SENT BY THIS APP. There is no WhatsApp Business account here, no
// API key and no message template approval — and inventing one would mean this
// system delivering messages to third parties on somebody's behalf with no
// record of it. What this does is open `wa.me` with the text prepared: the HOD
// still picks the chat and still presses send, in their own WhatsApp, from
// their own number. That is the whole design, and it is why there is no
// migration, no secret and no log — the send is not this app's action.
//
// THE NUMBER IS THE VENDOR'S OWN, OFF THE PASS. `visitor_company` packs it as
// `{"n","a","v"}` (see `companyInfo.ts`) exactly as it was typed, so the digits
// are dug out here and everything else is dropped. A pass with no vendor number
// simply offers no button — "if it is available" is the client's own condition,
// and a control that opens an empty chat is worse than no control.
//
// THE MESSAGE CARRIES WHAT A VENDOR CAN ACT ON and no portal link: they have no
// account here, and a link every recipient is refused at is an invitation to a
// support call. Pass number, type, department, purpose, the material lines, and
// the return date when there is one.
import type { GatePassItemView, GatePassView } from '../types';
import { parseCompanyInfo } from './companyInfo';
import { formatDateOnly } from './formatDate';
import { quantityCell } from './units';

/** India, because every department, gate and vendor on this deployment is
 *  here and a bare 10-digit mobile is what people type. A number already
 *  carrying a country code keeps it — see `vendorWhatsappNumber`. */
const DEFAULT_DIAL_CODE = '91';

/**
 * The vendor's number in the digits-only form `wa.me` takes, or null when the
 * pass carries nothing usable.
 *
 * A LOCAL 10-DIGIT MOBILE GETS THE COUNTRY CODE, because `wa.me` refuses a
 * number without one and would open on an error page. Anything already 11–15
 * digits is passed through untouched: it either carries a code or is a number
 * this code has no business rewriting. Anything shorter is not a mobile number
 * and is refused rather than guessed at — a wrong number is a stranger's chat.
 */
export function vendorWhatsappNumber(
  pass: Pick<GatePassView, 'visitor_company'>,
): string | null {
  const raw = parseCompanyInfo(pass.visitor_company).phone;
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `${DEFAULT_DIAL_CODE}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** One material line, as it reads in a chat message: "1. Headset — 8 Numbers". */
function itemLine(item: GatePassItemView, index: number): string {
  const qty = quantityCell(item.quantity, item.unit);
  return `${index + 1}. ${item.name} — ${qty}`;
}

/**
 * The text the chat opens with. Plain lines, no markup: WhatsApp renders none
 * of it and a reader on a phone gets one fact per line.
 *
 * `items` is optional because the record has them and a caller elsewhere may
 * not; the message is still complete without the breakdown.
 */
export function passShareMessage(
  pass: GatePassView,
  items: GatePassItemView[] = [],
): string {
  const vendor = parseCompanyInfo(pass.visitor_company);
  const lines: string[] = [
    `${pass.type} Gate Pass ${pass.pass_number}`,
    `Department: ${pass.department_name ?? '—'}`,
  ];
  if (vendor.name) lines.push(`Vendor: ${vendor.name}`);
  if (pass.visitor_name) lines.push(`Carried by: ${pass.visitor_name}`);
  if (pass.vehicle_number) lines.push(`Vehicle: ${pass.vehicle_number}`);
  lines.push(`Purpose: ${pass.purpose}`);
  // AN RGP IS A PROMISE TO BRING MATERIAL BACK, so the date is the one fact on
  // this message the vendor is being held to. An NRGP has none and must not be
  // sent a deadline it cannot meet.
  if (pass.type === 'RGP' && pass.expected_return_date) {
    lines.push(`Expected return: ${formatDateOnly(pass.expected_return_date)}`);
  }
  if (items.length > 0) {
    lines.push('', 'Items:', ...items.map(itemLine));
  }
  return lines.join('\n');
}

/** The `wa.me` link the button opens. `encodeURIComponent`, never a hand-rolled
 *  escape: the message carries newlines, `&` and `#` and every one of them
 *  would truncate the text or break the URL. */
export function whatsappHref(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * The whole decision in one call: the link to open, or null when this pass
 * cannot be forwarded. A caller draws the button only when it is non-null.
 */
export function vendorWhatsappLink(
  pass: GatePassView,
  items: GatePassItemView[] = [],
): string | null {
  const number = vendorWhatsappNumber(pass);
  if (!number) return null;
  return whatsappHref(number, passShareMessage(pass, items));
}

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
// support call. Pass number, type, department, purpose, the material lines with
// their make / model, and the return date when there is one.
//
// NO PICTURE RIDES WITH IT, AND THAT IS A DELIBERATE TRADE (client,
// 2026-09-01: "I don't have to select the WhatsApp manually. It should
// automatically send"). For one day this button photographed the printed slip
// and handed it to `navigator.share`, which is the ONLY browser mechanism that
// can attach a file — and it opens the operating system's app picker, so the
// HOD had to choose WhatsApp and then the chat. A `wa.me` link is the only
// thing that opens ONE KNOWN NUMBER's chat in a single press, and a `wa.me`
// link carries TEXT AND NOTHING ELSE. The client chose the direct chat over the
// attachment, so the slip capture, the share sheet and the QR code are gone
// from this path; the vendor still gets the pass number, and the gate scans the
// code off the HOD's printed sheet as it always did.
//
// Sending the sheet itself, automatically, needs a WhatsApp Business API
// account — which this deployment does not have. Do not reintroduce a share
// sheet here without the client asking for the picker back.
import type { GatePassItemView, GatePassView } from '../types';
import { parseCompanyInfo } from './companyInfo';
import { formatDateOnly } from './formatDate';
import { quantityCell } from './units';

/** India, because every department, gate and vendor on this deployment is
 *  here and a bare 10-digit mobile is what people type. A number already
 *  carrying a country code keeps it — see `vendorWhatsappNumber`. */
const DEFAULT_DIAL_CODE = '91';

/** THE MALL IS NAMED ON THE MESSAGE (client, 2026-09-01: "just include quest
 *  mall and department details"). A vendor serves several sites and a bare
 *  pass number does not say whose gate it is for. Written here rather than
 *  imported from the shell chrome: this is the text of an outgoing message, not
 *  a heading, and the two are free to differ. */
const SITE_NAME = 'Quest Mall';

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

/** One material line, as it reads in a chat message:
 *  "1. Headset (Sony WH-1000XM4) — 8 Numbers".
 *
 *  THE MAKE / MODEL / SIZE IS PART OF THE ITEM'S IDENTITY, not a detail
 *  (client, 2026-09-01) — "Headset" is not enough for the vendor to know which
 *  headset is leaving the mall, and it is the fact the guard checks the
 *  material against at the barrier. It rides in brackets beside the name, the
 *  same way it rides under the name on the printed slip. */
function itemLine(item: GatePassItemView, index: number): string {
  const qty = quantityCell(item.quantity, item.unit);
  const name = item.make_model ? `${item.name} (${item.make_model})` : item.name;
  return `${index + 1}. ${name} — ${qty}`;
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
  // The department's CODE rides with its name because that is what the pass
  // number carries (`RGP-IT-0001`, migration 064) — a vendor holding both can
  // read one off the other.
  const dept = pass.department_name
    ? `${pass.department_name}${pass.department_code ? ` (${pass.department_code})` : ''}`
    : '—';
  const lines: string[] = [
    `${SITE_NAME} — ${pass.type} Gate Pass ${pass.pass_number}`,
    `Department: ${dept}`,
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

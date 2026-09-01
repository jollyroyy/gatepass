// THE PRINTED GATE PASS SLIP — the sheet itself, and nothing around it.
//
// LIFTED OUT OF `PassPrint` ON 2026-09-01 because it now has two readers, and
// they must not be able to disagree: `/pass/:id/print` renders it for paper,
// and Send to Vendor mounts this same component off-screen and photographs it
// for WhatsApp (client, 2026-09-01: "the same exact print pass page should be
// sent out to the vendor using the WhatsApp as well"). One component, one
// layout, one QR code. A copy of this markup would drift on the next change to
// either screen — which is exactly the bug the client was reporting.
//
// IT HOLDS NO STATE AND READS NOTHING. Every fact is handed in, by
// `usePrintSlipData`, so a caller can photograph it the moment it mounts
// without waiting on a query it did not start.
import React from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { quantityCell } from '../../lib/units';
import { buildApprovalSteps, type ApprovalRoleRow, type PassApprovalRow } from '../../lib/approvalLadder';
import { printedSteps } from '../../lib/printCeoBox';
import QrPass from '../QrPass';
import { QuestLockup } from '../QuestMark';
import PrintSignatureBoxes from '../../pages/Shared/PrintSignatureBoxes';
import {
  buildSignatureBoxes, receiverBoxApplies, returnReceipt,
  type PassSignatures, type ReceiptEvent,
} from '../../lib/printSignatureBoxes';

// A LOCAL formatter, not the shared `lib/formatCurrency` — the column header
// here already carries "Value (₹)", so a second ₹ in every cell would repeat
// itself down the whole table. It still has to be null-safe on its own terms
// though: `approx_value` is optional and, since 045, unset on every new line
// (no Value field on the client's mock-up), so most rows on a fresh pass will
// have none. Printing "0" for a null would tell the guard holding this slip
// the item is worth nothing, which is not what "no value was declared" means —
// so a bare item.approx_value ?? 0 here would be wrong the same way
// Math.round(null) is wrong in the shared helper.
function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

export interface PassSlipProps {
  pass: GatePassView;
  items: GatePassItemView[];
  /** The gate's own log, for ONE fact: which guard took the last line back in. */
  events: ReceiptEvent[];
  roles: ApprovalRoleRow[];
  approvals: PassApprovalRow[];
  escalationHours: number;
  /** The uploaded signatures this pass has EARNED (075) — never simply the ones
   *  its people own. An empty map is the ordinary case and draws the same slip
   *  this component drew before the feature existed. */
  signatures: PassSignatures;
}

export default function PassSlip({
  pass, items, events, roles, approvals, escalationHours, signatures,
}: PassSlipProps): React.ReactElement {
  const isRgp = pass.type === 'RGP';
  // The printed trail. `viewerRole` is deliberately left null: the "signed on
  // the printed pass" fiction exists for a GUARD reading a screen with the
  // paper in their hand, and this IS the paper — asserting a signature to the
  // sheet that would have carried it is circular.
  // …and the CEO's rung is dropped unless the CEO is the office actually in
  // play on it (client, 2026-08-31). The record on screen still draws it; the
  // paper has no room for a box nobody will ever sign. `printCeoBox.ts`.
  const steps = printedSteps(
    buildApprovalSteps(pass, roles, null, approvals),
    approvals, pass.created_at, escalationHours,
  );
  const companyInfo = parseCompanyInfo(pass.visitor_company);

  // `pass-sheet` carries the 10mm paper margin in print (src/index.css) —
  // @page's own margin is 0 there so the browser cannot print its URL
  // header/footer around the slip.
  return (
    <div className="pass-sheet max-w-2xl mx-auto p-4 print:p-0 print:max-w-none">
      <div className="border-2 border-black bg-white text-black p-5 print:break-inside-avoid">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3 mb-3">
          <div>
            {/* No subtitle: the slip's own <h1> directly below already says
                "…Gate Pass". Repeating it reads as a template artefact. */}
            <QuestLockup tone="light" size="sm" subtitle={null} className="mb-2" />
            {/* "Material" was dropped from both headings (client, 2026-08-13) —
                the item table below is already headed "Material Items". */}
            <h1 className="text-lg font-extrabold tracking-wide text-black uppercase">
              {isRgp ? 'Returnable Gate Pass' : 'Non‑Returnable Gate Pass'}
            </h1>
          </div>
          <QrPass value={pass.qr_token} size={110} />
        </div>

        {/* Serial No. and Date */}
        <div className="flex justify-between items-center text-sm border border-black bg-gray-100 px-3 py-2 mb-4">
          <div className="font-semibold text-black">
            Serial No.: <span className="font-mono font-extrabold">{pass.pass_number}</span>
          </div>
          <div className="font-semibold text-black">
            Date: <span>{formatDateOnly(pass.created_at)}</span>
          </div>
        </div>

        {/* Details */}
        <table className="w-full border-collapse text-sm mb-4">
          <tbody>
            {([
              ["Authorized Person's Name", pass.visitor_name],
              ['Contact No', companyInfo.phone],
              ['Vendor Name', companyInfo.name],
              ['Vendor Address', companyInfo.address],
              ['Vehicle No', pass.vehicle_number],
              ['Department', pass.department_name],
              ['Raised By', pass.raised_by_name],
            ] as const).map(([label, value]) => (
              <tr key={label}>
                <td className="border border-black px-3 py-1.5 font-semibold text-black w-[150px] align-top uppercase text-[11px] tracking-wide">{label}</td>
                <td className="border border-black px-3 py-1.5 text-black align-top">{value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Material Items */}
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black mb-1">
            Material Items ({pass.item_count})
          </p>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-2 py-1 font-semibold text-black text-left w-5">#</th>
                <th className="border border-black px-2 py-1 font-semibold text-black text-left">Name</th>
                <th className="border border-black px-2 py-1 font-semibold text-black text-left">Description</th>
                <th className="border border-black px-2 py-1 font-semibold text-black text-left">Purpose</th>
                <th className="border border-black px-2 py-1 font-semibold text-black text-right w-16">
                  Qty
                </th>
                <th className="border border-black px-2 py-1 font-semibold text-black text-right w-16">Value (₹)</th>
                {isRgp && (
                  <th className="border border-black px-2 py-1 font-semibold text-black text-left">Return Date</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? items.map((item, i) => (
                <tr key={item.id}>
                  <td className="border border-black px-2 py-1 text-black text-center font-extrabold">
                    {items.length > 1 ? i + 1 : item.line_no}
                  </td>
                  <td className="border border-black px-2 py-1 text-black font-semibold">
                    {item.name}
                    {/* Make / Model / Size (045) rides under the name rather than
                        its own column — an A5 slip has no width to spare, and this
                        is the fact a guard needs beside the item's identity, not
                        apart from it. */}
                    {item.make_model && (
                      <span className="block text-[10px] font-normal text-gray-700">{item.make_model}</span>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-black">{item.description}</td>
                  <td className="border border-black px-2 py-1 text-black text-[10px]">
                    {item.purpose}
                    {/* Invoice/Reference No. and Remarks (045) also have no column
                        on the mock-up — they fold into the Purpose cell, each only
                        when the HOD actually typed one, so an old priced-only pass
                        prints exactly as it always did. */}
                    {item.invoice_no && <span className="block text-gray-700">Inv/Ref: {item.invoice_no}</span>}
                    {item.remarks && <span className="block text-gray-700">Note: {item.remarks}</span>}
                  </td>
                  <td className="border border-black px-2 py-1 text-black text-right">
                    {quantityCell(item.quantity, item.unit)}
                  </td>
                  <td className="border border-black px-2 py-1 text-black text-right">{formatCurrency(item.approx_value)}</td>
                  {isRgp && (
                    <td className="border border-black px-2 py-1 text-black text-[10px]">{item.expected_return_date ? formatDateOnly(item.expected_return_date) : '—'}</td>
                  )}
                </tr>
              )) : (
                <tr>
                  <td colSpan={isRgp ? 7 : 6} className="border border-black px-2 py-2 text-black text-gray-600 italic">
                    {pass.material_summary ?? '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ONE deadline for the whole pass (client, 2026-08-19: every item
            now carries the pass's own date, so a per-item breakdown would
            only repeat the same date once per row). Stated once, plainly —
            the slip must read on a cheap mono laser with no colour. */}
        {isRgp && pass.expected_return_date && (
          <p className="text-[11px] font-bold text-black mb-4">
            Expected Return Date: <span className="font-mono font-normal">{formatDateOnly(pass.expected_return_date)}</span>
          </p>
        )}

        {/* One box per office, ticked and dated where the office has signed,
            and the receiver's ticked once every line is back over the gate.
            Built from the record's OWN ladder — the same `buildApprovalSteps`
            the pass record's timeline renders — so the paper and the screen
            cannot name a different office, person or moment. */}
        <PrintSignatureBoxes
          boxes={buildSignatureBoxes(
            steps, returnReceipt(pass, events), receiverBoxApplies(pass.type), signatures,
          )}
        />
      </div>
    </div>
  );
}

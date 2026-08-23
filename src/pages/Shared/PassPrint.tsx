import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, GatePassItemView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { quantityCell, quantityHeading } from '../../lib/units';
import { buildApprovalSteps } from '../../lib/approvalLadder';
import { useApprovalRoles } from '../../lib/useApprovalRoles';
import { usePassApprovals } from '../../lib/usePassApprovals';
import QrPass from '../../components/QrPass';
import { QuestLockup } from '../../components/QuestMark';

import PrintSignatureBoxes from './PrintSignatureBoxes';
import {
  buildSignatureBoxes, returnReceipt, type ReceiptEvent,
} from '../../lib/printSignatureBoxes';

// THE BOXES ARE BACK, WITH THE APPROVAL INSIDE THEM (client, 2026-08-22: "go
// back to the boxes that were there before … if the approval has been given,
// give a tick box inside that box … also give the approval date"). They are not
// the old empty ones: `signatureBlocks.ts` and `PrintApprovalRecord` are both
// DELETED, so a stale reference is a build error rather than a slip that prints
// two versions of the same fact. See `src/lib/printSignatureBoxes.ts`.

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

export default function PassPrint(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  // The gate's own log, for ONE fact: which guard took the last line back in
  // (client, 2026-08-23). Empty is a fine answer — a receiver's box that cannot
  // name a guard still ticks off the pass's own `actual_return_date`.
  const [events, setEvents] = useState<ReceiptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Both are the record's own hooks, and both degrade to an EMPTY list rather
  // than to an error: a slip that refuses to print because an org-chart lookup
  // failed is worse than one whose ladder reads "Not designated yet". Hooks, so
  // they are called before the loading/not-found returns below.
  const { roles } = useApprovalRoles();
  const approvals = usePassApprovals(id);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [passResult, itemsResult, eventsResult] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle(),
          gp().from('v_gate_pass_items').select('*').eq('gate_pass_id', id).order('line_no'),
          gp().from('v_verifications').select('*').eq('gate_pass_id', id).order('created_at'),
        ]);
        if (passResult.error) throw passResult.error;
        if (itemsResult.error) throw itemsResult.error;
        if (eventsResult.error) throw eventsResult.error;
        if (!cancelled) {
          setPass((passResult.data as GatePassView | null) ?? null);
          setItems((itemsResult.data as GatePassItemView[]) ?? []);
          setEvents((eventsResult.data as ReceiptEvent[]) ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(safeErrorMessage(e));
      }
    }
    if (id) load();
    return () => { cancelled = true; };
  }, [id]);

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

  const isRgp = pass.type === 'RGP';
  // The printed trail. `viewerRole` is deliberately left null: the "signed on
  // the printed pass" fiction exists for a GUARD reading a screen with the
  // paper in their hand, and this IS the paper — asserting a signature to the
  // sheet that would have carried it is circular.
  const steps = buildApprovalSteps(pass, roles, null, approvals);
  const companyInfo = parseCompanyInfo(pass.visitor_company);
  // One shared unit is printed in the Qty heading instead of its own column —
  // an A5 slip has no width to spare, and "3 / Kg" over two cells said nothing
  // "Qty (Kg) 3" does not.
  const itemUnits = items.map((i) => i.unit);

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 max-w-2xl mx-auto p-4">
        <Link to={`/pass/${pass.id}`} className="btn-secondary">Back</Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      {/* pass-sheet carries the 10mm paper margin in print (src/index.css) —
          @page's own margin is 0 there so the browser cannot print its URL
          header/footer around the slip. */}
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
                    {quantityHeading('Qty', itemUnits)}
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
                      {quantityCell(item.quantity, item.unit, itemUnits)}
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
          <PrintSignatureBoxes boxes={buildSignatureBoxes(steps, returnReceipt(pass, events))} />
        </div>
      </div>
    </div>
  );
}

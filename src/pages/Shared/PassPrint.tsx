import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, GatePassItemView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import QrPass from '../../components/QrPass';
import { QuestLockup } from '../../components/QuestMark';

import { SIGNATURE_ROWS, type SignatureBlock } from './signatureBlocks';

function SignatureBox({ label, caption }: SignatureBlock): React.ReactElement {
  return (
    <div className="flex-1">
      {/* Tall enough for a signature AND a rubber stamp over it. */}
      <div className="border border-black h-20 w-full" />
      <p className="text-[10px] text-black font-bold text-center mt-1 uppercase tracking-wider">{label}</p>
      <p className="text-[8px] text-black text-center leading-tight">{caption}</p>
    </div>
  );
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

export default function PassPrint(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [passResult, itemsResult] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle(),
          gp().from('v_gate_pass_items').select('*').eq('gate_pass_id', id).order('line_no'),
        ]);
        if (passResult.error) throw passResult.error;
        if (itemsResult.error) throw itemsResult.error;
        if (!cancelled) {
          setPass((passResult.data as GatePassView | null) ?? null);
          setItems((itemsResult.data as GatePassItemView[]) ?? []);
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
  const companyInfo = parseCompanyInfo(pass.visitor_company);

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 max-w-2xl mx-auto p-4">
        <Link to={`/pass/${pass.id}`} className="btn-secondary">Back</Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      <div className="max-w-2xl mx-auto p-4 print:p-0 print:max-w-none">
        <div className="border-2 border-black bg-white text-black p-5 print:break-inside-avoid">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3 mb-3">
            <div>
              {/* No subtitle: the slip's own <h1> directly below already says
                  "…Material Gate Pass". Repeating it reads as a template artefact. */}
              <QuestLockup tone="light" size="sm" subtitle={null} className="mb-2" />
              <h1 className="text-lg font-extrabold tracking-wide text-black uppercase">
                {isRgp ? 'Returnable Material Gate Pass' : 'Non‑Returnable Material Gate Pass'}
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
                ['Authorized Person', pass.visitor_name],
                ['Contact No', companyInfo.phone],
                ['Vendor', companyInfo.name],
                ['Vendor Address', companyInfo.address],
                ['Vehicle No', pass.vehicle_number],
                ['Department', pass.department_name],
                ['Raised By', pass.raised_by_name],
              ] as const).map(([label, value]) => (
                <tr key={label}>
                  <td className="border border-black px-3 py-1.5 font-semibold text-black w-[130px] align-top uppercase text-[11px] tracking-wide">{label}</td>
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
                  <th className="border border-black px-2 py-1 font-semibold text-black text-right w-10">Qty</th>
                  <th className="border border-black px-2 py-1 font-semibold text-black text-left w-10">Unit</th>
                  <th className="border border-black px-2 py-1 font-semibold text-black text-right w-16">Value (₹)</th>
                  <th className="border border-black px-2 py-1 font-semibold text-black text-left">Return Date</th>
                </tr>
              </thead>
              <tbody>
                {items.length > 0 ? items.map((item) => (
                  <tr key={item.id}>
                    <td className="border border-black px-2 py-1 text-black text-center">{item.line_no}</td>
                    <td className="border border-black px-2 py-1 text-black font-semibold">{item.name}</td>
                    <td className="border border-black px-2 py-1 text-black">{item.description}</td>
                    <td className="border border-black px-2 py-1 text-black text-[10px]">{item.purpose}</td>
                    <td className="border border-black px-2 py-1 text-black text-right">{item.quantity}</td>
                    <td className="border border-black px-2 py-1 text-black">{item.unit}</td>
                    <td className="border border-black px-2 py-1 text-black text-right">{formatCurrency(item.approx_value)}</td>
                    <td className="border border-black px-2 py-1 text-black text-[10px]">{item.expected_return_date ? formatDateOnly(item.expected_return_date) : '—'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="border border-black px-2 py-2 text-black text-gray-600 italic">
                      {pass.material_summary ?? '—'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Per-item Return Dates (RGP only) */}
          {isRgp && items.some((i) => i.expected_return_date) && (
            <div className="mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-black mb-1">Return Dates</p>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black px-2 py-1 font-semibold text-black text-left w-5">#</th>
                    <th className="border border-black px-2 py-1 font-semibold text-black text-left">Item</th>
                    <th className="border border-black px-2 py-1 font-semibold text-black text-left">Expected Return Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((i) => i.expected_return_date).map((item) => (
                    <tr key={item.id}>
                      <td className="border border-black px-2 py-1 text-black text-center">{item.line_no}</td>
                      <td className="border border-black px-2 py-1 text-black">{item.name}</td>
                      <td className="border border-black px-2 py-1 text-black font-mono">{formatDateOnly(item.expected_return_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Five signatures over two rows — the approval chain, then the gate.
              Identical on every category; see signatureBlocks.ts for why.
              break-inside-avoid so a page break can never split a signature
              from its label and leave an unlabelled box on the next sheet. */}
          <div className="pt-2 print:break-inside-avoid">
            {SIGNATURE_ROWS.map((row, i) => (
              <div key={i} className={`flex gap-6 print:break-inside-avoid ${i > 0 ? 'mt-4' : ''}`}>
                {row.map((block) => (
                  <SignatureBox key={block.label} label={block.label} caption={block.caption} />
                ))}
                {/* Row 2 has two blocks; this keeps them the same width as row 1's
                    three rather than stretching across the full sheet. */}
                {row.length === 2 && <div className="flex-1" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
